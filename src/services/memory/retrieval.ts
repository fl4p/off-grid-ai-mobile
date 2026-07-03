import { embeddingService } from '../rag/embedding';
import { cosineSimilarity } from '../rag/vectorMath';
import logger from '../../utils/logger';
import { memoryDatabase } from './database';
import type { MemoryItem, MemorySearchResult, StoredMemoryEmbedding } from './types';

const MIN_TOKEN_LENGTH = 3;
const MIN_SEMANTIC_SCORE = 0.55;

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  return Array.from(new Set(matches.filter(token => token.length >= MIN_TOKEN_LENGTH)));
}

function lexicalScore(memory: MemoryItem, queryTokens: string[]): { score: number; matchedTerms: string[] } {
  const title = memory.title.toLowerCase();
  const body = memory.body.toLowerCase();
  const tags = memory.tags.join(' ').toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    let matched = false;
    if (title.includes(token)) { score += 3; matched = true; }
    if (tags.includes(token)) { score += 2; matched = true; }
    if (body.includes(token)) { score += 1; matched = true; }
    if (matched) matchedTerms.push(token);
  }

  if (score > 0) score += Math.max(0, memory.importance) * 0.05;
  return { score, matchedTerms };
}

function sortAndLimit(results: MemorySearchResult[], topK: number): MemorySearchResult[] {
  return results
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
    .slice(0, topK);
}

function meetsSemanticThreshold(score: number): boolean {
  return score >= MIN_SEMANTIC_SCORE;
}

class MemoryRetrievalService {
  async search(projectId: string | undefined, query: string, topK = 6): Promise<MemorySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queryTokens = tokenize(trimmed);
    const embedded = memoryDatabase.getEmbeddingsForRecall(projectId);
    if (embedded.length > 0) {
      const semantic = await this.searchSemantic({ projectId, query: trimmed, queryTokens, embedded, topK });
      if (semantic.length > 0) return semantic;
    }
    return this.searchLexical(projectId, queryTokens, topK);
  }

  private async searchSemantic(params: {
    projectId: string | undefined;
    query: string;
    queryTokens: string[];
    embedded: StoredMemoryEmbedding[];
    topK: number;
  }): Promise<MemorySearchResult[]> {
    try {
      if (!embeddingService.isLoaded()) await embeddingService.load();
      const queryVec = await embeddingService.embed(params.query);
      const scored = params.embedded.map(memory => {
        const lexical = lexicalScore(memory, params.queryTokens);
        const semanticScore = cosineSimilarity(queryVec, memory.embedding);
        return {
          memory,
          score: semanticScore + lexical.score * 0.08 + memory.importance * 0.01,
          reason: 'semantic' as const,
          matchedTerms: lexical.matchedTerms,
          semanticScore,
        };
      }).filter(result => meetsSemanticThreshold(result.semanticScore));
      return sortAndLimit(scored, params.topK);
    } catch (err) {
      logger.error('[MemoryRetrieval] Semantic search failed; falling back to lexical', err);
      return this.searchLexical(params.projectId, params.queryTokens, params.topK);
    }
  }

  private searchLexical(projectId: string | undefined, queryTokens: string[], topK: number): MemorySearchResult[] {
    const memories = memoryDatabase.getActiveMemories(projectId);
    const scored = memories.map(memory => {
      const lexical = lexicalScore(memory, queryTokens);
      return {
        memory,
        score: lexical.score,
        reason: 'lexical' as const,
        matchedTerms: lexical.matchedTerms,
      };
    });
    return sortAndLimit(scored, topK);
  }
}

export const memoryRetrievalService = new MemoryRetrievalService();
