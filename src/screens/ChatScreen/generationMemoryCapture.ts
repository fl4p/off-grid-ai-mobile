import { useRemoteServerStore } from '../../stores';
import { memoryService } from '../../services/memory';
import logger from '../../utils/logger';
import type { DownloadedModel, Message, RemoteModel } from '../../types';

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
};

export function isRemoteGeneration(params: { activeModelInfo?: ActiveModelInfo | null }): boolean {
  if (params.activeModelInfo?.isRemote === true) return true;
  const { activeServerId, activeRemoteTextModelId } = useRemoteServerStore.getState();
  return !!(activeServerId && activeRemoteTextModelId);
}

export async function maybeCaptureMemoryCandidate(params: {
  memoryAutoCaptureEnabled?: boolean;
  activeModelInfo?: ActiveModelInfo | null;
  projectId?: string;
  userMessage?: Pick<Message, 'id' | 'role' | 'content'>;
}): Promise<void> {
  if (!params.memoryAutoCaptureEnabled || !params.userMessage) return;
  if (isRemoteGeneration({ activeModelInfo: params.activeModelInfo })) return;

  try {
    await memoryService.captureCandidateFromMessage({
      message: params.userMessage,
      projectId: params.projectId,
    });
  } catch (err) {
    logger.error('[Memory] Auto-capture failed', err);
  }
}
