import { useRemoteServerStore } from '../../stores';
import { memoryService } from '../../services/memory';
import { isExplicitMemoryCommand } from '../../services/memory/autoCapture';
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
  memoryAutoSaveEnabled?: boolean;
  activeModelInfo?: ActiveModelInfo | null;
  projectId?: string;
  userMessage?: Pick<Message, 'id' | 'role' | 'content'>;
}): Promise<void> {
  if (!params.memoryAutoCaptureEnabled || !params.userMessage) return;
  if (isRemoteGeneration({ activeModelInfo: params.activeModelInfo })) return;

  try {
    if (params.memoryAutoSaveEnabled) {
      await memoryService.captureMemoryFromMessage({
        message: params.userMessage,
        projectId: params.projectId,
      });
      return;
    }
    await memoryService.captureCandidateFromMessage({
      message: params.userMessage,
      projectId: params.projectId,
    });
  } catch (err) {
    logger.error('[Memory] Auto-capture failed', err);
  }
}

export type ExplicitMemoryCommandResult = {
  handled: boolean;
  assistantMessage?: string;
};

export async function maybeHandleExplicitMemoryCommand(params: {
  memoryEnabled?: boolean;
  projectId?: string;
  userMessage?: Pick<Message, 'id' | 'role' | 'content'>;
}): Promise<ExplicitMemoryCommandResult> {
  if (!params.userMessage || params.userMessage.role !== 'user') return { handled: false };
  if (!isExplicitMemoryCommand(params.userMessage.content)) return { handled: false };

  if (!params.memoryEnabled) {
    return {
      handled: true,
      assistantMessage: 'Memory is off for this chat.',
    };
  }

  try {
    const saved = await memoryService.captureMemoryFromMessage({
      message: params.userMessage,
      projectId: params.projectId,
      sourceType: 'chat_command',
    });
    return {
      handled: true,
      assistantMessage: saved
        ? 'Saved to memory.'
        : "I couldn't save that as a memory. Add a little more detail and avoid sensitive details.",
    };
  } catch (err) {
    logger.error('[Memory] Explicit memory command failed', err);
    return {
      handled: true,
      assistantMessage: "I couldn't save that as a memory.",
    };
  }
}

export { isExplicitMemoryCommand };
