import type { Conversation } from '../../types';

export function resolveMemoryProjectId(
  activeConversation: Pick<Conversation, 'projectId'> | null | undefined,
  pendingProjectId?: string,
): string | undefined {
  return activeConversation ? activeConversation.projectId : pendingProjectId;
}
