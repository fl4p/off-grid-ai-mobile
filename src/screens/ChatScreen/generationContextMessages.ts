import { useChatStore } from '../../stores';
import { scrubMemoryToolMessages } from '../../services/memory/toolPrivacy';
import type { Message } from '../../types';

function applyCompactionPrefix(params: {
  conversation: any;
  systemPrompt: string;
  messages: Message[];
  includeCompactionSummary?: boolean;
  includeMemoryToolMessages?: boolean;
}): { prefix: Message[]; filtered: Message[] } {
  const { conversation, systemPrompt, includeCompactionSummary = true, includeMemoryToolMessages = true } = params;
  const prefix: Message[] = [{ id: 'system', role: 'system', content: systemPrompt, timestamp: 0 }];
  let scopedMessages = params.messages;
  if (conversation?.compactionSummary && conversation?.compactionCutoffMessageId) {
    if (includeCompactionSummary) {
      prefix.push({ id: 'compaction-summary', role: 'assistant', content: `[Previous conversation summary]\n${conversation.compactionSummary}`, timestamp: 0 });
    }
    const cutoffIdx = scopedMessages.findIndex(m => m.id === conversation.compactionCutoffMessageId);
    if (cutoffIdx !== -1) scopedMessages = scopedMessages.slice(cutoffIdx + 1);
  }
  const filtered = includeMemoryToolMessages ? scopedMessages : scrubMemoryToolMessages(scopedMessages);
  return { prefix, filtered };
}

export function buildMessagesForContext(params: {
  conversationId: string;
  messageText: string;
  systemPrompt: string;
  includeCompactionSummary?: boolean;
  includeMemoryToolMessages?: boolean;
}): Message[] {
  const { conversationId, messageText, systemPrompt, includeCompactionSummary, includeMemoryToolMessages } = params;
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const allMessages = (conversation?.messages || []).filter(m => !m.isSystemInfo);
  const { prefix, filtered } = applyCompactionPrefix({
    conversation,
    systemPrompt,
    messages: allMessages,
    includeCompactionSummary,
    includeMemoryToolMessages,
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
  includeMemoryToolMessages?: boolean;
}): Message[] {
  const { conversation, systemPrompt, messages, includeCompactionSummary, includeMemoryToolMessages } = params;
  const { prefix, filtered } = applyCompactionPrefix({
    conversation,
    systemPrompt,
    messages,
    includeCompactionSummary,
    includeMemoryToolMessages,
  });
  return [...prefix, ...filtered];
}
