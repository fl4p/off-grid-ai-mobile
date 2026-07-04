import { embeddingService } from '../rag/embedding';
import logger from '../../utils/logger';
import { stripControlTokens } from '../../utils/messageContent';
import { memoryDatabase } from './database';
import { memoryRetrievalService } from './retrieval';
import { extractMemoryCandidateFromText } from './autoCapture';
import type { Message } from '../../types';
import type {
  ApproveMemoryCandidateInput,
  CreateMemoryCandidateInput,
  CreateMemoryInput,
  MemoryCandidate,
  MemoryItem,
  MemoryKind,
  MemoryRecallSummary,
  MemorySearchResult,
  MemoryScope,
} from './types';

export { memoryRetrievalService } from './retrieval';
export type {
  ApproveMemoryCandidateInput,
  CreateMemoryCandidateInput,
  CreateMemoryInput,
  MemoryCandidate,
  MemoryCandidateStatus,
  MemoryItem,
  MemoryKind,
  MemoryRecallSummary,
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
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 4000;
const MAX_FORMAT_BODY_LENGTH = 1200;
const MAX_METADATA_LENGTH = 160;
const MAX_SOURCE_EXCERPT_LENGTH = 500;
const MAX_TAG_LENGTH = 48;

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
  return stripAngleBracketTags(text).replaceAll(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeOptionalLine(value: string | undefined, maxLength = MAX_METADATA_LENGTH): string | undefined {
  if (!value) return undefined;
  const normalized = safeLine(value);
  return normalized ? truncateText(normalized, maxLength) : undefined;
}

function normalizeInput(input: CreateMemoryInput): CreateMemoryInput {
  const title = truncateText(safeLine(input.title), MAX_TITLE_LENGTH);
  const body = truncateText(input.body.trim(), MAX_BODY_LENGTH);
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
    tags: (input.tags ?? [])
      .map(tag => normalizeOptionalLine(tag, MAX_TAG_LENGTH))
      .filter((tag): tag is string => !!tag)
      .slice(0, 12),
    confidence: clamp(input.confidence ?? 0.8, 0, 1),
    importance: Math.round(clamp(input.importance ?? 3, 1, 5)),
    sourceType: normalizeOptionalLine(input.sourceType),
    sourceId: normalizeOptionalLine(input.sourceId),
    sourceExcerpt: normalizeOptionalLine(input.sourceExcerpt, MAX_SOURCE_EXCERPT_LENGTH),
    jurisdiction: normalizeOptionalLine(input.jurisdiction),
    asOfDate: normalizeOptionalLine(input.asOfDate),
    validFrom: normalizeOptionalLine(input.validFrom),
    validUntil: normalizeOptionalLine(input.validUntil),
  };
}

function normalizeCandidateInput(input: CreateMemoryCandidateInput): CreateMemoryCandidateInput {
  const normalized = normalizeInput({
    ...input,
    confidence: input.confidence ?? 0.65,
  });
  return {
    ...input,
    ...normalized,
    sourceType: normalized.sourceType ?? 'auto_capture',
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

function canonicalMemoryBody(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .toLowerCase();
}

function hasSameMemoryContent(
  item: Pick<MemoryItem | MemoryCandidate, 'body'>,
  input: Pick<CreateMemoryInput | CreateMemoryCandidateInput, 'body'>,
): boolean {
  return canonicalMemoryBody(item.body) === canonicalMemoryBody(input.body);
}

function hasSameWriteScope(
  item: Pick<MemoryItem | MemoryCandidate, 'scope' | 'project_id'>,
  input: Pick<CreateMemoryInput | CreateMemoryCandidateInput, 'scope' | 'projectId'>,
): boolean {
  if (item.scope !== input.scope) return false;
  return item.scope === 'global' || item.project_id === input.projectId;
}

function findDuplicateActiveMemory(input: CreateMemoryInput | CreateMemoryCandidateInput): MemoryItem | undefined {
  return memoryDatabase
    .getActiveMemories(input.projectId)
    .find(memory => hasSameWriteScope(memory, input) && hasSameMemoryContent(memory, input));
}

function findDuplicatePendingCandidate(input: CreateMemoryCandidateInput): MemoryCandidate | undefined {
  return memoryDatabase
    .getPendingCandidates(input.projectId)
    .find(candidate => hasSameWriteScope(candidate, input) && hasSameMemoryContent(candidate, input));
}

function memoryContentKey(memory: MemoryItem): string {
  return [
    memory.scope,
    memory.project_id ?? '',
    canonicalMemoryBody(memory.body),
  ].join('\u0000');
}

function canAccessCandidate(candidate: MemoryCandidate, projectId?: string): boolean {
  if (candidate.scope === 'global') return true;
  return !!projectId && candidate.project_id === projectId;
}

function hasCandidateEdit(edits: ApproveMemoryCandidateInput, key: keyof ApproveMemoryCandidateInput): boolean {
  return Object.prototype.hasOwnProperty.call(edits, key);
}

function buildApprovedMemoryInput(candidate: MemoryCandidate, edits: ApproveMemoryCandidateInput): CreateMemoryInput {
  const projectId = candidate.scope === 'project' ? candidate.project_id ?? undefined : undefined;
  return {
    scope: candidate.scope,
    projectId,
    kind: edits.kind ?? candidate.kind,
    title: edits.title ?? candidate.title,
    body: edits.body ?? candidate.body,
    tags: edits.tags ?? candidate.tags,
    confidence: edits.confidence ?? candidate.confidence,
    importance: edits.importance ?? candidate.importance,
    sourceType: candidate.source_type,
    sourceId: candidate.source_id ?? undefined,
    sourceExcerpt: candidate.source_excerpt ?? undefined,
    jurisdiction: hasCandidateEdit(edits, 'jurisdiction') ? edits.jurisdiction : candidate.jurisdiction ?? undefined,
    asOfDate: hasCandidateEdit(edits, 'asOfDate') ? edits.asOfDate : candidate.as_of_date ?? undefined,
  };
}

type CaptureMessageParams = {
  message: Pick<Message, 'id' | 'role' | 'content'>;
  projectId?: string;
};
type CaptureMemoryFromMessageParams = CaptureMessageParams & {
  sourceType?: string;
};

class MemoryService {
  async ensureReady(): Promise<void> {
    await memoryDatabase.ensureReady();
  }

  async saveMemory(input: CreateMemoryInput): Promise<MemoryItem> {
    await this.ensureReady();
    const normalized = normalizeInput(input);
    const duplicate = findDuplicateActiveMemory(normalized);
    if (duplicate) return duplicate;
    const id = memoryDatabase.createMemory(normalized);
    const memory = memoryDatabase.getMemory(id);
    if (!memory) throw new Error('Saved memory could not be read back');
    memoryDatabase.addEvent(id, 'created', { scope: memory.scope, projectId: memory.project_id ?? null });
    await this.embedMemory(memory);
    return memory;
  }

  async createCandidate(input: CreateMemoryCandidateInput): Promise<MemoryCandidate> {
    await this.ensureReady();
    const normalized = normalizeCandidateInput(input);
    const id = memoryDatabase.createCandidate(normalized);
    const candidate = memoryDatabase.getCandidate(id);
    if (!candidate) throw new Error('Saved memory candidate could not be read back');
    memoryDatabase.addEvent(null, 'candidate_created', { candidateId: candidate.id, scope: candidate.scope, projectId: candidate.project_id ?? null });
    return candidate;
  }

  async captureCandidateFromMessage(params: CaptureMessageParams): Promise<MemoryCandidate | null> {
    const content = stripControlTokens(params.message.content).trim();
    if (params.message.role !== 'user' || !content) return null;
    await this.ensureReady();
    const scope = params.projectId ? 'project' : 'global';
    const existingMemory = memoryDatabase.getActiveMemoryBySource('auto_capture', params.message.id, params.projectId);
    if (existingMemory) return null;
    const existingCandidate = memoryDatabase.getCandidateBySource('auto_capture', params.message.id, params.projectId);
    if (existingCandidate) return existingCandidate.status === 'pending' ? existingCandidate : null;
    const extracted = extractMemoryCandidateFromText(content, { projectId: params.projectId });
    if (!extracted) return null;
    const candidateInput: CreateMemoryCandidateInput = {
      ...extracted,
      scope,
      projectId: params.projectId,
      sourceType: 'auto_capture',
      sourceId: params.message.id,
      sourceExcerpt: extracted.sourceExcerpt ?? content,
    };
    const duplicateMemory = findDuplicateActiveMemory(candidateInput);
    if (duplicateMemory) return null;
    const duplicateCandidate = findDuplicatePendingCandidate(candidateInput);
    if (duplicateCandidate) return duplicateCandidate;
    return this.createCandidate(candidateInput);
  }

  async captureMemoryFromMessage(params: CaptureMemoryFromMessageParams): Promise<MemoryItem | null> {
    const content = stripControlTokens(params.message.content).trim();
    if (params.message.role !== 'user' || !content) return null;
    await this.ensureReady();
    const scope = params.projectId ? 'project' : 'global';
    const sourceType = params.sourceType ?? 'auto_capture';
    const existingMemory = memoryDatabase.getActiveMemoryBySource(sourceType, params.message.id, params.projectId);
    if (existingMemory) return existingMemory;
    const existingCandidate = memoryDatabase.getCandidateBySource(sourceType, params.message.id, params.projectId);
    if (existingCandidate) return null;
    const extracted = extractMemoryCandidateFromText(content, { projectId: params.projectId });
    if (!extracted) return null;
    const memoryInput: CreateMemoryInput = {
      ...extracted,
      scope,
      projectId: params.projectId,
      sourceType,
      sourceId: params.message.id,
      sourceExcerpt: extracted.sourceExcerpt ?? content,
    };
    const duplicate = findDuplicateActiveMemory(memoryInput);
    if (duplicate) return duplicate;
    const duplicateCandidate = findDuplicatePendingCandidate(memoryInput);
    if (duplicateCandidate) {
      memoryDatabase.deleteCandidate(duplicateCandidate.id);
    }
    return this.saveMemory(memoryInput);
  }

  async rememberMessage(params: CaptureMessageParams): Promise<MemoryItem> {
    const content = stripControlTokens(params.message.content).trim();
    if (!content) throw new Error('Nothing to remember from this message.');
    await this.ensureReady();
    const existing = memoryDatabase.getActiveMemoryBySource('chat_message', params.message.id, params.projectId);
    if (existing) return existing;
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
    this.deleteDuplicateActiveMemories(projectId);
    return memoryDatabase.getActiveMemories(projectId);
  }

  async listPendingCandidates(projectId?: string): Promise<MemoryCandidate[]> {
    await this.ensureReady();
    return memoryDatabase.getPendingCandidates(projectId);
  }

  async getCandidate(candidateId: number, projectId?: string): Promise<MemoryCandidate | null> {
    await this.ensureReady();
    const candidate = memoryDatabase.getCandidate(candidateId);
    if (!candidate || !canAccessCandidate(candidate, projectId)) return null;
    return candidate;
  }

  async approveCandidate(candidateId: number, edits: ApproveMemoryCandidateInput = {}, projectId?: string): Promise<MemoryItem | null> {
    await this.ensureReady();
    const candidate = memoryDatabase.getCandidate(candidateId);
    if (!candidate || candidate.status !== 'pending' || !canAccessCandidate(candidate, projectId)) return null;
    const saved = await this.saveMemory(buildApprovedMemoryInput(candidate, edits));
    memoryDatabase.deleteCandidate(candidate.id);
    memoryDatabase.addEvent(saved.id, 'candidate_approved', { candidateId: candidate.id });
    return saved;
  }

  async discardCandidate(candidateId: number, projectId?: string): Promise<boolean> {
    await this.ensureReady();
    const candidate = memoryDatabase.getCandidate(candidateId);
    if (!candidate || candidate.status !== 'pending' || !canAccessCandidate(candidate, projectId)) return false;
    const changed = memoryDatabase.deleteCandidate(candidateId);
    if (changed) memoryDatabase.addEvent(null, 'candidate_dismissed', { candidateId });
    return changed;
  }

  /** Number of active memories visible to a recall in this scope (project recalls include global). 0 means nothing to search. */
  async getActiveMemoryCount(projectId?: string): Promise<number> {
    await this.ensureReady();
    return memoryDatabase.getActiveMemoryCount(projectId);
  }

  async searchMemory(params: { projectId?: string; query: string; topK?: number }): Promise<MemorySearchResult[]> {
    await this.ensureReady();
    this.deleteDuplicateActiveMemories(params.projectId);
    const results = await memoryRetrievalService.search(params.projectId, params.query, params.topK ?? 6);
    memoryDatabase.markUsed(results.map(result => result.memory.id));
    return results;
  }

  async forgetMemory(memoryId: number, projectId?: string, opts: { allowGlobalFromProject?: boolean } = {}): Promise<boolean> {
    await this.ensureReady();
    const memory = memoryDatabase.getMemory(memoryId);
    if (!memory || memory.status !== 'active') return false;
    if (memory.scope === 'project' && (!projectId || memory.project_id !== projectId)) return false;
    if (memory.scope === 'global' && projectId && !opts.allowGlobalFromProject) return false;
    const changed = memoryDatabase.deleteMemory(memoryId);
    if (changed) memoryDatabase.addEvent(null, 'deleted', { memoryId, projectId: projectId ?? null });
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
      return `[Memory #${memory.id}: ${safeLine(memory.title)}]\n${meta}\n${safeLine(truncateText(memory.body, MAX_FORMAT_BODY_LENGTH))}`;
    });

    return `<memory_context>\nThese are user-approved local memories. They may be incomplete or outdated. Use them only when relevant. For legal, tax, medical, or financial claims, verify against current sources when possible.\n\n${sections.join('\n\n---\n\n')}\n</memory_context>`;
  }

  formatForTool(results: MemorySearchResult[]): string {
    if (results.length === 0) return 'No matching memories found.';
    return results.map(({ memory, score, reason, matchedTerms }, index) => {
      const title = safeLine(memory.title);
      const body = safeLine(truncateText(memory.body, MAX_FORMAT_BODY_LENGTH));
      const tags = memory.tags.length ? `\nTags: ${memory.tags.map(safeLine).join(', ')}` : '';
      const dating = [
        memory.jurisdiction ? safeLine(memory.jurisdiction) : '',
        memory.as_of_date ? `as of ${safeLine(memory.as_of_date)}` : '',
      ].filter(Boolean).join(', ');
      const dateLine = dating ? `\nContext: ${dating}` : '';
      const matches = matchedTerms.length ? `\nMatched: ${matchedTerms.map(safeLine).join(', ')}` : '';
      return `[${index + 1}] Memory #${memory.id}: ${title}\nKind: ${memory.kind} (${reason}, score ${score.toFixed(3)})${tags}${dateLine}${matches}\n${body}`;
    }).join('\n\n---\n\n');
  }

  formatRecallSummaries(results: MemorySearchResult[]): MemoryRecallSummary[] {
    return results.map(({ memory, score, reason }) => ({
      id: memory.id,
      scope: memory.scope,
      kind: memory.kind,
      sourceType: safeLine(memory.source_type || 'manual'),
      jurisdiction: memory.jurisdiction ? safeLine(memory.jurisdiction) : undefined,
      asOfDate: memory.as_of_date ? safeLine(memory.as_of_date) : undefined,
      score,
      reason,
    }));
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

  private deleteDuplicateActiveMemories(projectId?: string): void {
    const seen = new Set<string>();
    for (const memory of memoryDatabase.getActiveMemories(projectId)) {
      const key = memoryContentKey(memory);
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      if (memoryDatabase.deleteMemory(memory.id)) {
        memoryDatabase.addEvent(null, 'duplicate_deleted', { memoryId: memory.id });
      }
    }
  }
}

export const memoryService = new MemoryService();
