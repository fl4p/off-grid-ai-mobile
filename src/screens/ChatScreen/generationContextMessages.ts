import { useChatStore } from '../../stores';
import type { Message } from '../../types';

function applyCompactionPrefix(params: {
  conversation: any;
  systemPrompt: string;
  messages: Message[];
  includeCompactionSummary?: boolean;
}): { prefix: Message[]; filtered: Message[] } {
  const { conversation, systemPrompt, messages, includeCompactionSummary = true } = params;
  const prefix: Message[] = [{ id: 'system', role: 'system', content: systemPrompt, timestamp: 0 }];
  let filtered = messages;
  if (conversation?.compactionSummary && conversation?.compactionCutoffMessageId) {
    if (includeCompactionSummary) {
      prefix.push({ id: 'compaction-summary', role: 'assistant', content: `[Previous conversation summary]\n${conversation.compactionSummary}`, timestamp: 0 });
    }
    const cutoffIdx = messages.findIndex(m => m.id === conversation.compactionCutoffMessageId);
    if (cutoffIdx !== -1) filtered = messages.slice(cutoffIdx + 1);
  }
  return { prefix, filtered };
}

export function buildMessagesForContext(params: {
  conversationId: string;
  messageText: string;
  systemPrompt: string;
  includeCompactionSummary?: boolean;
}): Message[] {
  const { conversationId, messageText, systemPrompt, includeCompactionSummary } = params;
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const allMessages = (conversation?.messages || []).filter(m => !m.isSystemInfo);
  const { prefix, filtered } = applyCompactionPrefix({
    conversation,
    systemPrompt,
    messages: allMessages,
    includeCompactionSummary,
  });
  const lastMsg = filtered.at(-1);
  const userMessageForContext = (lastMsg?.role === 'user' ? { ...lastMsg, content: messageText } : lastMsg) as Message;
  return [...prefix, ...filtered.slice(0, -1), userMessageForContext];
}

export function buildMessagesWithCompactionPrefix(params: {
  conversation: any;
  systemPrompt: string;
  messages: Message[];
  includeCompactionSummary?: boolean;
}): Message[] {
  const { conversation, systemPrompt, messages, includeCompactionSummary } = params;
  const { prefix, filtered } = applyCompactionPrefix({
    conversation,
    systemPrompt,
    messages,
    includeCompactionSummary,
  });
  return [...prefix, ...filtered];
}
