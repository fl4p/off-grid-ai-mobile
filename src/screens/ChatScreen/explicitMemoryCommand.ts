import { useChatStore, useProjectStore } from '../../stores';
import type { MediaAttachment, Message } from '../../types';
import {
  isExplicitMemoryCommand,
  maybeHandleExplicitMemoryCommand,
} from './generationMemoryCapture';

type AddMessage = (convId: string, msg: any) => Message;

function isMemoryEnabledForContext(conversation: any, project: any): boolean {
  return conversation?.memoryEnabled !== false && project?.memoryEnabled !== false;
}

function buildMemoryCommandContent(text: string, attachments?: MediaAttachment[]): string {
  const documentText = (attachments ?? [])
    .filter(attachment => attachment.type === 'document' && attachment.textContent)
    .map(attachment => [
      `Attached document: ${attachment.fileName || 'document'}`,
      attachment.textContent,
    ].join('\n'))
    .join('\n\n');
  return documentText ? `${text}\n\n${documentText}` : text;
}

export async function handleExplicitMemoryCommandIfNeeded(params: {
  text: string;
  attachments?: MediaAttachment[];
  conversationId: string;
  addMessage: AddMessage;
}): Promise<boolean> {
  if (params.text.includes('\n\n')) return false;
  if (!isExplicitMemoryCommand(params.text)) return false;

  const userMessage = params.addMessage(params.conversationId, {
    role: 'user',
    content: params.text,
    attachments: params.attachments,
  });
  const conversation = useChatStore.getState().conversations.find(c => c.id === params.conversationId);
  const project = conversation?.projectId ? useProjectStore.getState().getProject(conversation.projectId) : null;
  const result = await maybeHandleExplicitMemoryCommand({
    memoryEnabled: isMemoryEnabledForContext(conversation, project),
    projectId: conversation?.projectId,
    userMessage: {
      ...userMessage,
      content: buildMemoryCommandContent(params.text, params.attachments),
    },
  });
  params.addMessage(params.conversationId, {
    role: 'assistant',
    content: result.assistantMessage ?? 'Saved to memory.',
  });
  return true;
}
