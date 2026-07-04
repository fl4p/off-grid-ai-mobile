import { ragService, retrievalService, memoryService } from '../../services';
import { embeddingService } from '../../services/rag/embedding';
import type { MemoryRecallSummary } from '../../services/memory';
import logger from '../../utils/logger';

async function injectRagContext(projectId: string | undefined, query: string, prompt: string): Promise<string> {
  if (!projectId) return prompt;
  try {
    const docs = await ragService.getDocumentsByProject(projectId);
    const enabledDocs = docs.filter((d: import('../../services/rag').RagDocument) => d.enabled);
    if (enabledDocs.length === 0) return prompt;
    if (!embeddingService.isLoaded()) {
      embeddingService.load().catch(err => logger.error('[RAG] Embedding warmup failed', err));
    }
    const docList = enabledDocs.map((d: import('../../services/rag').RagDocument) => `- ${d.name}`).join('\n');
    let kbPrompt = `\n\nYou have a knowledge base with these documents:\n${docList}`;
    kbPrompt += '\nUse the search_knowledge_base tool to look up specific information from these documents.';
    const r = await ragService.searchProject(projectId, query);
    if (r.chunks.length > 0) {
      kbPrompt += `\n\n${retrievalService.formatForPrompt(r)}`;
    }
    return prompt + kbPrompt;
  } catch (err) {
    logger.error('[RAG] Context injection failed', err);
  }
  return prompt;
}

type InjectedChatContext = {
  prompt: string;
  recalledMemories: MemoryRecallSummary[];
};

async function injectMemoryContext(
  projectId: string | undefined,
  query: string,
  prompt: string,
): Promise<InjectedChatContext> {
  try {
    const memories = await memoryService.searchMemory({ projectId, query, topK: 6 });
    if (memories.length === 0) return { prompt, recalledMemories: [] };
    return {
      prompt: `${prompt}\n\n${memoryService.formatForPrompt(memories)}`,
      recalledMemories: memoryService.formatRecallSummaries(memories),
    };
  } catch (err) {
    logger.error('[Memory] Context injection failed', err);
    return { prompt, recalledMemories: [] };
  }
}

export async function buildChatContext(params: {
  projectId?: string;
  query: string;
  prompt: string;
  includeMemory?: boolean;
}): Promise<InjectedChatContext> {
  const memoryContext = params.includeMemory === false
    ? { prompt: params.prompt, recalledMemories: [] }
    : await injectMemoryContext(params.projectId, params.query, params.prompt);
  const prompt = await injectRagContext(params.projectId, params.query, memoryContext.prompt);
  return { prompt, recalledMemories: memoryContext.recalledMemories };
}

export async function injectChatContext(params: {
  projectId?: string;
  query: string;
  prompt: string;
  includeMemory?: boolean;
}): Promise<string> {
  return (await buildChatContext(params)).prompt;
}
