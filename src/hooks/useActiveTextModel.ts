import { useMemo } from 'react';
import { useAppStore, useRemoteServerStore } from '../stores';
import { DownloadedModel, RemoteModel } from '../types';

type ActiveTextModelResult = {
  /** The resolved active model (remote preferred over local) */
  model: DownloadedModel | RemoteModel | null;
  /** The model ID suitable for creating conversations */
  modelId: string | null;
  /** Display name */
  modelName: string;
  /** Whether the active model is remote */
  isRemote: boolean;
  /** Remote server id when isRemote; undefined for local models. */
  serverId?: string;
};

/**
 * Returns the currently active text model, preferring remote over local.
 * Use this anywhere you need to know if a text model is available.
 */
export function useActiveTextModel(): ActiveTextModelResult {
  const downloadedModels = useAppStore((s) => s.downloadedModels);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeServerId = useRemoteServerStore((s) => s.activeServerId);
  const activeRemoteTextModelId = useRemoteServerStore((s) => s.activeRemoteTextModelId);
  const discoveredModels = useRemoteServerStore((s) => s.discoveredModels);

  return useMemo(() => {
    // Check remote first
    if (activeServerId && activeRemoteTextModelId) {
      const remoteModel = (discoveredModels[activeServerId] || []).find(
        (m) => m.id === activeRemoteTextModelId,
      );
      if (remoteModel) {
        return {
          model: remoteModel,
          modelId: remoteModel.id,
          modelName: remoteModel.name,
          isRemote: true,
          serverId: activeServerId,
        };
      }
    }
    // Fall back to local
    const localModel = downloadedModels.find((m) => m.id === activeModelId);
    if (localModel) {
      return {
        model: localModel,
        modelId: localModel.id,
        modelName: localModel.name,
        isRemote: false,
      };
    }
    return { model: null, modelId: null, modelName: 'Unknown', isRemote: false };
  }, [activeServerId, activeRemoteTextModelId, discoveredModels, activeModelId, downloadedModels]);
}

/**
 * Resolves which text model a NEW chat should start with: the currently-selected
 * model (remote preferred over local), falling back to the last loaded local
 * model, then the first downloaded model. Returns a null modelId when nothing is
 * available. Use this instead of `downloadedModels[0]` so a new chat honours the
 * user's last selection instead of resetting to the first available model.
 */
export function useNewChatModel(): { modelId: string | null; serverId?: string } {
  const active = useActiveTextModel();
  const lastTextModelId = useAppStore((s) => s.lastTextModelId);
  const downloadedModels = useAppStore((s) => s.downloadedModels);

  return useMemo(() => {
    if (active.modelId) {
      return { modelId: active.modelId, serverId: active.isRemote ? active.serverId : undefined };
    }
    return { modelId: lastTextModelId ?? downloadedModels[0]?.id ?? null };
  }, [active, lastTextModelId, downloadedModels]);
}
