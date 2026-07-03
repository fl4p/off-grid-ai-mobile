import {
  contextCompactionService,
  generationService,
  llmService,
} from '../../services';
import { getToolExtensions } from '../../services/tools/extensions';
import { useChatStore } from '../../stores';
import type { Message } from '../../types';
import type { MemoryRecallSummary } from '../../services/memory';

const FALLBACK_RECENT_MESSAGE_COUNT = 2;

export async function generateWithCompactionRetry(params: {
  generation: { id: string; prompt: string; messages: Message[] };
  enabledTools: string[];
  projectId?: string;
  includePreviousSummary?: boolean;
  recalledMemories?: MemoryRecallSummary[];
}): Promise<void> {
  const { generation: opts, enabledTools, projectId, includePreviousSummary = true, recalledMemories } = params;
  const extCount = getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);
  const gen = (msgs: Message[]) => (enabledTools.length > 0 || extCount > 0)
    ? generationService.generateWithTools(opts.id, msgs, { enabledToolIds: enabledTools, projectId, recalledMemories })
    : generationService.generateResponse(opts.id, msgs, { recalledMemories });
  try { await gen(opts.messages); } catch (error: any) {
    if (!contextCompactionService.isContextFullError(error)) throw error;
    await llmService.stopGeneration().catch(() => { });
    const conversation = useChatStore.getState().conversations.find(c => c.id === opts.id);
    const previousSummary = includePreviousSummary ? conversation?.compactionSummary : undefined;
    const compacted = await contextCompactionService.compact({ conversationId: opts.id, systemPrompt: opts.prompt, allMessages: opts.messages, previousSummary }).catch(async () => {
      await llmService.clearKVCache(true).catch(() => { });
      const recent = opts.messages.filter(m => m.role !== 'system').slice(-FALLBACK_RECENT_MESSAGE_COUNT);
      return [{ id: 'system', role: 'system', content: opts.prompt, timestamp: 0 } as Message, ...recent];
    });
    await gen(compacted);
  }
}
