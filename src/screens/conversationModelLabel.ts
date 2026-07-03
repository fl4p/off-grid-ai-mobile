import type { Conversation, DownloadedModel, RemoteModel } from '../types';

export function resolveConversationModelName(
  conversation: Conversation,
  downloadedModels: DownloadedModel[],
  discoveredModels: Record<string, RemoteModel[]>,
): string | null {
  if (!conversation.modelId) return null;

  if (conversation.serverId) {
    const remote = (discoveredModels[conversation.serverId] || []).find(
      model => model.id === conversation.modelId,
    );
    return remote?.name || conversation.modelId;
  }

  return downloadedModels.find(model => model.id === conversation.modelId)?.name || conversation.modelId;
}
