import { useState, useEffect, useCallback, useMemo } from 'react';
import { showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useAppStore, useChatStore } from '../../stores';
import { imageGenerationService, onnxImageGeneratorService } from '../../services';
import type { ImageGenerationState } from '../../services';
import { saveImageToGallery } from '../ChatScreen/useSaveImage';
import { GeneratedImage } from '../../types';

export const formatDate = (dateStr: string): string => {
  const ts = Number(dateStr);
  const date = Number.isNaN(ts) ? new Date(dateStr) : new Date(ts);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const useGalleryActions = (conversationId: string | undefined) => {
  const { generatedImages, removeGeneratedImage } = useAppStore();
  const conversations = useChatStore(s => s.conversations);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState()
  );

  useEffect(() => {
    const unsubscribe = imageGenerationService.subscribe((state) => {
      setImageGenState(state);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const syncFromDisk = async () => {
      try {
        const diskImages = await onnxImageGeneratorService.getGeneratedImages();
        if (diskImages.length > 0) {
          const { generatedImages: storeImages, addGeneratedImage } = useAppStore.getState();
          const existingIds = new Set(storeImages.map(img => img.id));
          for (const img of diskImages) {
            if (!existingIds.has(img.id)) {
              addGeneratedImage(img);
            }
          }
        }
      } catch {
        // Silently fail
      }
    };
    syncFromDisk();
  }, []);

  const chatImageIds = useMemo(() => {
    if (!conversationId) return null;
    const convo = conversations.find(c => c.id === conversationId);
    if (!convo) return new Set<string>();
    const ids = new Set<string>();
    for (const msg of convo.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'image') ids.add(att.id);
        }
      }
    }
    return ids;
  }, [conversationId, conversations]);

  // Images that live only as chat message attachments (e.g. run_python matplotlib
  // plots), not in the generated-image store. These are what countConversationImages
  // counts, so without surfacing them the chat gallery shows "Gallery (1)" but an
  // empty grid. Mapped into the GeneratedImage shape the grid/viewer expect;
  // imagePath is stored without the file:// prefix because GridItem re-adds it.
  const chatAttachmentImages = useMemo<GeneratedImage[]>(() => {
    if (!conversationId) return [];
    const convo = conversations.find(c => c.id === conversationId);
    if (!convo) return [];
    const imgs: GeneratedImage[] = [];
    for (const msg of convo.messages) {
      for (const att of msg.attachments || []) {
        if (att.type === 'image' && att.uri) {
          imgs.push({
            id: att.id,
            prompt: att.fileName || 'Image',
            imagePath: att.uri.replace(/^file:\/\//, ''),
            width: 0, height: 0, steps: 0, seed: 0, modelId: '',
            createdAt: new Date(msg.timestamp).toISOString(),
            conversationId,
          });
        }
      }
    }
    return imgs;
  }, [conversationId, conversations]);

  const displayImages = useMemo(() => {
    if (!conversationId) return generatedImages;
    const fromStore = generatedImages.filter(
      img => img.conversationId === conversationId || (chatImageIds && chatImageIds.has(img.id))
    );
    // Merge store-backed images with attachment-only images (plots), deduped by id.
    const seen = new Set(fromStore.map(i => i.id));
    const merged = [...fromStore];
    for (const img of chatAttachmentImages) {
      if (!seen.has(img.id)) { seen.add(img.id); merged.push(img); }
    }
    return merged;
  }, [generatedImages, conversationId, chatImageIds, chatAttachmentImages]);

  const handleDelete = useCallback((image: GeneratedImage) => {
    const doDelete = async () => {
      setAlertState(hideAlert());
      await onnxImageGeneratorService.deleteGeneratedImage(image.id);
      removeGeneratedImage(image.id);
      if (selectedImage?.id === image.id) setSelectedImage(null);
    };
    setAlertState(showAlert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { doDelete(); },
        },
      ]
    ));
  }, [selectedImage, removeGeneratedImage]);

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleImageSelection = useCallback((imageId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setAlertState(showAlert(
      'Delete Images',
      `Are you sure you want to delete ${count} image${count > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const doDeleteSelected = async () => {
              setAlertState(hideAlert());
              for (const imageId of selectedIds) {
                await onnxImageGeneratorService.deleteGeneratedImage(imageId);
                removeGeneratedImage(imageId);
              }
              setSelectedIds(new Set());
              setIsSelectMode(false);
            };
            doDeleteSelected();
          },
        },
      ]
    ));
  }, [selectedIds, removeGeneratedImage]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayImages.map(img => img.id)));
  }, [displayImages]);

  // Reuse the single gallery-save implementation (real Photos/MediaStore) rather
  // than a divergent copy — keeps behaviour identical to the chat image viewer.
  const handleSaveImage = useCallback(async (image: GeneratedImage) => {
    await saveImageToGallery(image.imagePath, setAlertState);
  }, []);

  const handleCancelGeneration = useCallback(() => {
    imageGenerationService.cancelGeneration().catch(() => {});
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedImage(null);
    setShowDetails(false);
  }, []);

  return {
    isSelectMode,
    selectedIds,
    selectedImage,
    setSelectedImage,
    showDetails,
    setShowDetails,
    alertState,
    setAlertState,
    imageGenState,
    displayImages,
    handleDelete,
    toggleSelectMode,
    toggleImageSelection,
    handleDeleteSelected,
    selectAll,
    handleSaveImage,
    handleCancelGeneration,
    closeViewer,
  };
};
