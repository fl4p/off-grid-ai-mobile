import { Dispatch, SetStateAction } from 'react';
import { Clipboard } from 'react-native';
import { showAlert, AlertState } from '../../components';
import { Message } from '../../types';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { triggerHaptic } from '../../utils/haptics';
import { buildTranscript, conversationHasReasoning } from '../../utils/transcript';
import {
  regenerateResponseFn, executeDeleteConversationFn, handleImageGenerationFn,
} from './useChatGenerationActions';
import type { GenerationDeps } from './useChatGenerationActions';

type SetState<T> = Dispatch<SetStateAction<T>>;

type RetryParams = {
  activeConversationId: string | null | undefined;
  hasActiveModel: boolean;
  activeConversation: any;
  deleteMessagesAfter: (c: string, m: string) => void;
  setDebugInfo: SetState<any>;
};

export async function handleRetryMessageFn(
  message: Message, genDeps: GenerationDeps, p: RetryParams,
): Promise<void> {
  if (!p.activeConversationId || !p.hasActiveModel) return;
  // Stop any in-flight TTS before deleting messages (no-op without pro audio)
  callHook(HOOKS.audioStop);
  const msgs = p.activeConversation?.messages || [];
  if (message.role === 'user') {
    const idx = msgs.findIndex((m: Message) => m.id === message.id);
    if (idx !== -1 && idx < msgs.length - 1) p.deleteMessagesAfter(p.activeConversationId, message.id);
    await regenerateResponseFn(genDeps, { setDebugInfo: p.setDebugInfo, userMessage: message });
  } else {
    const idx = msgs.findIndex((m: Message) => m.id === message.id);
    const prev = idx > 0 ? msgs.slice(0, idx).reverse().find((m: Message) => m.role === 'user') : null;
    if (prev) {
      p.deleteMessagesAfter(p.activeConversationId, prev.id);
      await regenerateResponseFn(genDeps, { setDebugInfo: p.setDebugInfo, userMessage: prev });
    }
  }
}

type EditParams = {
  message: Message;
  newContent: string;
  activeConversationId: string | null | undefined;
  hasActiveModel: boolean;
  updateMessageContent: (c: string, m: string, v: string) => void;
  deleteMessagesAfter: (c: string, m: string) => void;
  setDebugInfo: SetState<any>;
};

export async function handleEditMessageFn(genDeps: GenerationDeps, p: EditParams): Promise<void> {
  if (!p.activeConversationId || !p.hasActiveModel) return;
  p.updateMessageContent(p.activeConversationId, p.message.id, p.newContent);
  p.deleteMessagesAfter(p.activeConversationId, p.message.id);
  await regenerateResponseFn(genDeps, { setDebugInfo: p.setDebugInfo, userMessage: { ...p.message, content: p.newContent } });
}

export function handleDeleteConversationFn(
  genDeps: GenerationDeps,
  p: { activeConversationId: string | null | undefined; activeConversation: any; setAlertState: SetState<AlertState> },
): void {
  if (!p.activeConversationId || !p.activeConversation) return;
  p.setAlertState(showAlert(
    'Delete Conversation',
    'Are you sure you want to delete this conversation? This will also delete all images generated in this chat.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { executeDeleteConversationFn(genDeps).catch(() => {}); } },
    ],
  ));
}

export function handleCopyTranscriptFn(
  p: { activeConversation: any; setAlertState: SetState<AlertState> },
): void {
  const messages: Message[] = p.activeConversation?.messages || [];
  // Guard on the rendered transcript, not the raw count: system-info messages
  // (e.g. "Model loaded") are filtered out, so a chat can have messages yet
  // still produce an empty transcript.
  if (buildTranscript(messages).length === 0) {
    p.setAlertState(showAlert('Nothing to Copy', 'This conversation has no messages yet.'));
    return;
  }

  const copy = (includeReasoning: boolean) => {
    Clipboard.setString(buildTranscript(messages, { includeReasoning }));
    triggerHaptic('notificationSuccess');
  };

  // Copy the plain transcript straight away and confirm. When the conversation
  // contains thinking/reasoning text, offer a one-tap upgrade to include it.
  // (CustomAlert hides itself after a button's onPress, so we can't chain a
  // second confirmation alert — copying up front keeps a single alert.)
  copy(false);
  if (conversationHasReasoning(messages)) {
    p.setAlertState(showAlert(
      'Copied',
      "Transcript copied to clipboard. Include the model's reasoning too?",
      [
        { text: 'Text only', style: 'cancel' },
        { text: 'Include reasoning', onPress: () => copy(true) },
      ],
    ));
    return;
  }
  p.setAlertState(showAlert('Copied', 'Transcript copied to clipboard.'));
}

export async function handleGenerateImageFromMsgFn(
  prompt: string, genDeps: GenerationDeps,
  p: { activeConversationId: string | null | undefined; activeImageModel: any; setAlertState: SetState<AlertState> },
): Promise<void> {
  if (!p.activeConversationId || !p.activeImageModel) {
    p.setAlertState(showAlert('No Image Model', 'Please load an image model first from the Models screen.'));
    return;
  }
  await handleImageGenerationFn(genDeps, { prompt, conversationId: p.activeConversationId, skipUserMessage: true });
}
