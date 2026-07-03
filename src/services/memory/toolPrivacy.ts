import type { Message } from '../../types';

const MEMORY_TOOL_NAMES = new Set(['search_memory', 'save_memory', 'forget_memory']);

type ToolPrivacyMessage = Pick<Message, 'role' | 'content' | 'toolCallId' | 'toolCalls' | 'toolName'>;

export function isMemoryToolName(name?: string | null): boolean {
  return !!name && MEMORY_TOOL_NAMES.has(name);
}

export function collectMemoryToolCallIds(messages: ToolPrivacyMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const toolCall of msg.toolCalls || []) {
        if (isMemoryToolName(toolCall.name) && toolCall.id) ids.add(toolCall.id);
      }
    }
    if (msg.role === 'tool' && msg.toolCallId && isMemoryToolName(msg.toolName)) {
      ids.add(msg.toolCallId);
    }
  }
  return ids;
}

export function scrubMemoryToolMessages<T extends Message>(messages: T[]): T[] {
  const memoryToolCallIds = collectMemoryToolCallIds(messages);
  const scrubbed: T[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      if (isMemoryToolName(msg.toolName) || (msg.toolCallId && memoryToolCallIds.has(msg.toolCallId))) {
        continue;
      }
      scrubbed.push(msg);
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const toolCalls = msg.toolCalls.filter(toolCall => {
        if (isMemoryToolName(toolCall.name)) return false;
        return !toolCall.id || !memoryToolCallIds.has(toolCall.id);
      });
      if (toolCalls.length > 0) {
        scrubbed.push({ ...msg, toolCalls } as T);
      } else if (msg.content.trim()) {
        const next = { ...msg };
        delete next.toolCalls;
        scrubbed.push(next as T);
      }
      continue;
    }

    scrubbed.push(msg);
  }

  return scrubbed;
}
