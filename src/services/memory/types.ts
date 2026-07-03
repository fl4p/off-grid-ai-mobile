export type MemoryScope = 'global' | 'project';
export type MemoryStatus = 'active' | 'archived' | 'deleted';
export type MemoryKind =
  | 'preference'
  | 'research_note'
  | 'source_backed_fact'
  | 'decision'
  | 'open_question'
  | 'procedure'
  | 'personal_context';

export interface MemoryItem {
  id: number;
  scope: MemoryScope;
  project_id?: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string[];
  confidence: number;
  importance: number;
  status: MemoryStatus;
  source_type: string;
  source_id?: string | null;
  source_excerpt?: string | null;
  jurisdiction?: string | null;
  as_of_date?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
}

export interface CreateMemoryInput {
  scope?: MemoryScope;
  projectId?: string;
  kind?: MemoryKind;
  title: string;
  body: string;
  tags?: string[];
  confidence?: number;
  importance?: number;
  sourceType?: string;
  sourceId?: string;
  sourceExcerpt?: string;
  jurisdiction?: string;
  asOfDate?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface StoredMemoryEmbedding extends MemoryItem {
  embedding: number[];
}

export interface MemorySearchResult {
  memory: MemoryItem;
  score: number;
  reason: 'semantic' | 'lexical';
  matchedTerms: string[];
}
