import { embeddingService } from '../rag/embedding';
import logger from '../../utils/logger';
import { stripControlTokens } from '../../utils/messageContent';
import { memoryDatabase } from './database';
import { memoryRetrievalService } from './retrieval';
import type { Message } from '../../types';
import type { CreateMemoryInput, MemoryItem, MemoryKind, MemorySearchResult, MemoryScope } from './types';

export { memoryRetrievalService } from './retrieval';
export type {
  CreateMemoryInput,
  MemoryItem,
  MemoryKind,
  MemoryScope,
  MemorySearchResult,
  MemoryStatus,
} from './types';

const VALID_KINDS: MemoryKind[] = [
  'preference',
  'research_note',
  'source_backed_fact',
  'decision',
  'open_question',
  'procedure',
  'personal_context',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stripAngleBracketTags(text: string): string {
  let result = '';
  let inTag = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<') { inTag = true; continue; }
    if (text[i] === '>') { inTag = false; continue; }
    if (!inTag) result += text[i];
  }
  return result;
}

function safeLine(text: string): string {
  return stripAngleBracketTags(text).replaceAll(/[<>]/g, '').trim();
}

function normalizeInput(input: CreateMemoryInput): CreateMemoryInput {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error('Memory title is required');
  if (!body) throw new Error('Memory body is required');
  const scope: MemoryScope = input.scope ?? (input.projectId ? 'project' : 'global');
  return {
    ...input,
    scope,
    projectId: scope === 'project' ? input.projectId : undefined,
    kind: input.kind && VALID_KINDS.includes(input.kind) ? input.kind : 'research_note',
    title,
    body,
    tags: (input.tags ?? []).map(tag => tag.trim()).filter(Boolean).slice(0, 12),
    confidence: clamp(input.confidence ?? 0.8, 0, 1),
    importance: Math.round(clamp(input.importance ?? 3, 1, 5)),
  };
}

function memoryEmbeddingText(memory: MemoryItem): string {
  return [
    memory.title,
    memory.kind,
    memory.body,
    memory.tags.join(' '),
    memory.jurisdiction ?? '',
    memory.as_of_date ?? '',
  ].filter(Boolean).join('\n');
}

function buildMessageMemoryTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Saved chat note';
  return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
}

class MemoryService {
  async ensureReady(): Promise<void> {
    await memoryDatabase.ensureReady();
  }

  async saveMemory(input: CreateMemoryInput): Promise<MemoryItem> {
    await this.ensureReady();
    const normalized = normalizeInput(input);
    const id = memoryDatabase.createMemory(normalized);
    const memory = memoryDatabase.getMemory(id);
    if (!memory) throw new Error('Saved memory could not be read back');
    memoryDatabase.addEvent(id, 'created', { scope: memory.scope, projectId: memory.project_id ?? null });
    await this.embedMemory(memory);
    return memory;
  }

  async rememberMessage(params: { message: Pick<Message, 'id' | 'role' | 'content'>; projectId?: string }): Promise<MemoryItem> {
    const content = stripControlTokens(params.message.content).trim();
    if (!content) throw new Error('Nothing to remember from this message.');
    const roleLabel = params.message.role === 'user' ? 'User said' : 'Assistant said';
    return this.saveMemory({
      projectId: params.projectId,
      scope: params.projectId ? 'project' : 'global',
      kind: 'research_note',
      title: buildMessageMemoryTitle(content),
      body: `${roleLabel}: ${content}`,
      sourceType: 'chat_message',
      sourceId: params.message.id,
    });
  }

  async listMemories(projectId?: string): Promise<MemoryItem[]> {
    await this.ensureReady();
    return memoryDatabase.getActiveMemories(projectId);
  }

  /** Number of active memories visible to a recall in this scope (project recalls include global). 0 means nothing to search. */
  async getActiveMemoryCount(projectId?: string): Promise<number> {
    await this.ensureReady();
    return memoryDatabase.getActiveMemoryCount(projectId);
  }

  async searchMemory(params: { projectId?: string; query: string; topK?: number }): Promise<MemorySearchResult[]> {
    await this.ensureReady();
    const results = await memoryRetrievalService.search(params.projectId, params.query, params.topK ?? 6);
    memoryDatabase.markUsed(results.map(result => result.memory.id));
    return results;
  }

  async forgetMemory(memoryId: number, projectId?: string): Promise<boolean> {
    await this.ensureReady();
    const memory = memoryDatabase.getMemory(memoryId);
    if (!memory || memory.status !== 'active') return false;
    if (memory.scope === 'project' && (!projectId || memory.project_id !== projectId)) return false;
    if (memory.scope === 'global' && projectId) return false;
    const changed = memoryDatabase.setStatus(memoryId, 'deleted');
    if (changed) memoryDatabase.addEvent(memoryId, 'deleted', { projectId: projectId ?? null });
    return changed;
  }

  async deleteProjectMemories(projectId: string): Promise<void> {
    await this.ensureReady();
    memoryDatabase.deleteProjectMemories(projectId);
    memoryDatabase.addEvent(null, 'project_deleted', { projectId });
  }

  formatForPrompt(results: MemorySearchResult[]): string {
    if (results.length === 0) return '';
    const sections = results.map(({ memory }) => {
      const meta = [
        `Kind: ${memory.kind}`,
        `Scope: ${memory.scope}`,
        memory.tags.length ? `Tags: ${memory.tags.map(safeLine).join(', ')}` : '',
        memory.jurisdiction ? `Jurisdiction: ${safeLine(memory.jurisdiction)}` : '',
        memory.as_of_date ? `As of: ${safeLine(memory.as_of_date)}` : '',
      ].filter(Boolean).join('\n');
      return `[Memory #${memory.id}: ${safeLine(memory.title)}]\n${meta}\n${safeLine(memory.body)}`;
    });

    return `<memory_context>\nThese are user-approved local memories. They may be incomplete or outdated. Use them only when relevant. For legal, tax, medical, or financial claims, verify against current sources when possible.\n\n${sections.join('\n\n---\n\n')}\n</memory_context>`;
  }

  formatForTool(results: MemorySearchResult[]): string {
    if (results.length === 0) return 'No matching memories found.';
    return results.map(({ memory, score, reason, matchedTerms }, index) => {
      const tags = memory.tags.length ? `\nTags: ${memory.tags.join(', ')}` : '';
      const dating = [memory.jurisdiction, memory.as_of_date ? `as of ${memory.as_of_date}` : ''].filter(Boolean).join(', ');
      const dateLine = dating ? `\nContext: ${dating}` : '';
      const matches = matchedTerms.length ? `\nMatched: ${matchedTerms.join(', ')}` : '';
      return `[${index + 1}] Memory #${memory.id}: ${memory.title}\nKind: ${memory.kind} (${reason}, score ${score.toFixed(3)})${tags}${dateLine}${matches}\n${memory.body}`;
    }).join('\n\n---\n\n');
  }

  private async embedMemory(memory: MemoryItem): Promise<void> {
    try {
      if (!embeddingService.isLoaded()) await embeddingService.load();
      const embedding = await embeddingService.embed(memoryEmbeddingText(memory));
      memoryDatabase.setEmbedding(memory.id, embedding);
    } catch (err) {
      logger.error('[Memory] Embedding generation failed; memory saved without vector index', err);
    }
  }
}

export const memoryService = new MemoryService();
