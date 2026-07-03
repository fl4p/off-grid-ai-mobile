/**
 * Integration Tests: Memory Flow
 *
 * Exercises memoryService -> memoryDatabase -> retrieval -> tool handlers with
 * a lightweight in-memory SQLite mock. Embeddings are mocked, but the service
 * wiring and SQL adapter paths are real.
 */

type MemoryRow = {
  id: number;
  scope: string;
  project_id: string | null;
  kind: string;
  title: string;
  body: string;
  tags_json: string;
  confidence: number;
  importance: number;
  status: string;
  source_type: string;
  source_id: string | null;
  source_excerpt: string | null;
  jurisdiction: string | null;
  as_of_date: string | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

type CandidateRow = {
  id: number;
  scope: string;
  project_id: string | null;
  kind: string;
  title: string;
  body: string;
  tags_json: string;
  confidence: number;
  importance: number;
  status: string;
  source_type: string;
  source_id: string | null;
  source_excerpt: string | null;
  jurisdiction: string | null;
  as_of_date: string | null;
  created_at: string;
  updated_at: string;
};

let memories: MemoryRow[] = [];
let candidates: CandidateRow[] = [];
let embeddings: Array<{ memory_id: number; embedding: ArrayBuffer }> = [];
let events: any[] = [];
let nextMemoryId = 1;
let nextCandidateId = 1;

function activeRows(projectId?: string): MemoryRow[] {
  return memories.filter(row => row.status === 'active' && (
    projectId ? row.scope === 'global' || (row.scope === 'project' && row.project_id === projectId) : row.scope === 'global'
  ));
}

function executeMemorySql(sql: string, params: any[] = []) {
  const normalized = sql.replace(/\s+/g, ' ');
  if (normalized.includes('INSERT INTO memory_items')) {
    const now = params[16];
    const row: MemoryRow = {
      id: nextMemoryId++,
      scope: params[0],
      project_id: params[1],
      kind: params[2],
      title: params[3],
      body: params[4],
      tags_json: params[5],
      confidence: params[6],
      importance: params[7],
      status: params[8],
      source_type: params[9],
      source_id: params[10],
      source_excerpt: params[11],
      jurisdiction: params[12],
      as_of_date: params[13],
      valid_from: params[14],
      valid_until: params[15],
      created_at: now,
      updated_at: params[17],
      last_used_at: null,
    };
    memories.push(row);
    return { rows: [], insertId: row.id, rowsAffected: 1 };
  }
  if (normalized.includes('INSERT INTO memory_candidates')) {
    const now = params[14];
    const row: CandidateRow = {
      id: nextCandidateId++,
      scope: params[0],
      project_id: params[1],
      kind: params[2],
      title: params[3],
      body: params[4],
      tags_json: params[5],
      confidence: params[6],
      importance: params[7],
      status: params[8],
      source_type: params[9],
      source_id: params[10],
      source_excerpt: params[11],
      jurisdiction: params[12],
      as_of_date: params[13],
      created_at: now,
      updated_at: params[15],
    };
    candidates.push(row);
    return { rows: [], insertId: row.id, rowsAffected: 1 };
  }
  if (normalized.includes('SELECT e.embedding, m.*')) {
    const projectId = params[0];
    const rows = embeddings
      .map(entry => ({ ...memories.find(row => row.id === entry.memory_id), embedding: entry.embedding }))
      .filter((row: any) => row.id && row.status === 'active')
      .filter((row: any) => projectId ? row.scope === 'global' || (row.scope === 'project' && row.project_id === projectId) : row.scope === 'global');
    return { rows, insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_items WHERE id = ?')) {
    return { rows: memories.filter(row => row.id === params[0]), insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_candidates WHERE id = ?')) {
    return { rows: candidates.filter(row => row.id === params[0]), insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_items') && normalized.includes('source_type = ?') && normalized.includes('source_id = ?')) {
    const [sourceType, sourceId, projectId] = params;
    const rows = memories
      .filter(row => row.status === 'active')
      .filter(row => row.source_type === sourceType && row.source_id === sourceId)
      .filter(row => projectId ? row.scope === 'project' && row.project_id === projectId : row.scope === 'global')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 1);
    return { rows, insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_items') && normalized.includes("status = 'active'")) {
    return { rows: activeRows(params[0]), insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_candidates') && normalized.includes('source_type = ?') && normalized.includes('source_id = ?')) {
    const [sourceType, sourceId, projectId] = params;
    const rows = candidates
      .filter(row => row.source_type === sourceType && row.source_id === sourceId)
      .filter(row => projectId ? row.scope === 'project' && row.project_id === projectId : row.scope === 'global')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 1);
    return { rows, insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('SELECT * FROM memory_candidates') && normalized.includes("status = 'pending'")) {
    const projectId = params[0];
    const rows = candidates.filter(row => row.status === 'pending' && (
      projectId ? row.scope === 'global' || (row.scope === 'project' && row.project_id === projectId) : row.scope === 'global'
    ));
    return { rows, insertId: 0, rowsAffected: 0 };
  }
  if (normalized.includes('DELETE FROM memory_embeddings WHERE memory_id = ?')) {
    embeddings = embeddings.filter(entry => entry.memory_id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: 1 };
  }
  if (normalized.includes('DELETE FROM memory_events WHERE memory_id = ?')) {
    const before = events.length;
    events = events.filter(event => event.memory_id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: before - events.length };
  }
  if (normalized.includes('DELETE FROM memory_items WHERE id = ?')) {
    const before = memories.length;
    memories = memories.filter(row => row.id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: before - memories.length };
  }
  if (normalized.includes('DELETE FROM memory_candidates WHERE id = ?')) {
    const before = candidates.length;
    candidates = candidates.filter(row => row.id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: before - candidates.length };
  }
  if (normalized.includes('INSERT INTO memory_embeddings')) {
    embeddings.push({ memory_id: params[0], embedding: params[1] });
    return { rows: [], insertId: embeddings.length, rowsAffected: 1 };
  }
  if (normalized.includes('UPDATE memory_items SET last_used_at = ? WHERE id = ?')) {
    const row = memories.find(item => item.id === params[1]);
    if (row) row.last_used_at = params[0];
    return { rows: [], insertId: 0, rowsAffected: row ? 1 : 0 };
  }
  if (normalized.includes('UPDATE memory_items SET status = ?')) {
    const row = memories.find(item => item.id === params[2]);
    if (row) {
      row.status = params[0];
      row.updated_at = params[1];
    }
    return { rows: [], insertId: 0, rowsAffected: row ? 1 : 0 };
  }
  if (normalized.includes('UPDATE memory_candidates SET status = ?')) {
    const row = candidates.find(item => item.id === params[2]);
    if (row) {
      row.status = params[0];
      row.updated_at = params[1];
    }
    return { rows: [], insertId: 0, rowsAffected: row ? 1 : 0 };
  }
  if (normalized.includes('INSERT INTO memory_events')) {
    events.push({ memory_id: params[0], action: params[1], details_json: params[2], created_at: params[3] });
    return { rows: [], insertId: events.length, rowsAffected: 1 };
  }
  if (normalized.includes('DELETE FROM memory_embeddings WHERE memory_id IN')) {
    const projectId = params[0];
    const ids = new Set(memories.filter(row => row.project_id === projectId).map(row => row.id));
    embeddings = embeddings.filter(entry => !ids.has(entry.memory_id));
    return { rows: [], insertId: 0, rowsAffected: 1 };
  }
  if (normalized.includes('DELETE FROM memory_items WHERE project_id = ?')) {
    const before = memories.length;
    memories = memories.filter(row => row.project_id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: before - memories.length };
  }
  if (normalized.includes('DELETE FROM memory_candidates WHERE project_id = ?')) {
    const before = candidates.length;
    candidates = candidates.filter(row => row.project_id !== params[0]);
    return { rows: [], insertId: 0, rowsAffected: before - candidates.length };
  }
  return { rows: [], insertId: 0, rowsAffected: 0 };
}

const mockDb = {
  executeSync: jest.fn(executeMemorySql),
  execute: jest.fn(() => Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 })),
  close: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

function mockVectorFor(text: string): number[] {
  const lower = text.toLowerCase();
  if (lower.includes('solar') || lower.includes('tax')) return [1, 0];
  if (lower.includes('terse') || lower.includes('concise')) return [0.8, 0.2];
  return [0, 1];
}

jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: jest.fn(() => true),
    load: jest.fn(() => Promise.resolve()),
    embed: jest.fn((text: string) => Promise.resolve(mockVectorFor(text))),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { memoryService } from '../../../src/services/memory';
import { memoryDatabase } from '../../../src/services/memory/database';
import { executeToolCall } from '../../../src/services/tools/handlers';

describe('Memory Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memories = [];
    candidates = [];
    embeddings = [];
    events = [];
    nextMemoryId = 1;
    nextCandidateId = 1;
    (memoryDatabase as any).ready = false;
    (memoryDatabase as any).db = null;
    mockDb.executeSync.mockImplementation(executeMemorySql);
  });

  it('saves, embeds, searches, and formats project memory for prompt injection', async () => {
    const saved = await memoryService.saveMemory({
      projectId: 'proj-tax',
      title: 'Solar tax credit research',
      body: 'User is researching solar panel tax credits and must verify current IRS rules before filing.',
      tags: ['solar', 'tax'],
      kind: 'research_note',
      jurisdiction: 'United States',
      asOfDate: '2026-07-03',
    });

    const results = await memoryService.searchMemory({ projectId: 'proj-tax', query: 'solar tax credit' });
    const prompt = memoryService.formatForPrompt(results);

    expect(saved.id).toBe(1);
    expect(embeddings).toHaveLength(1);
    expect(events.some(event => event.action === 'created')).toBe(true);
    expect(results[0].memory.title).toBe('Solar tax credit research');
    expect(prompt).toContain('<memory_context>');
    expect(prompt).toContain('verify current IRS rules');
    expect(prompt).toContain('Jurisdiction: United States');
  });

  it('keeps project memory scoped while global memory is available everywhere', async () => {
    await memoryService.saveMemory({
      projectId: 'proj-a',
      title: 'Solar project detail',
      body: 'Project A is about solar installation permits.',
      tags: ['solar'],
    });
    await memoryService.saveMemory({
      scope: 'global',
      title: 'Terse response preference',
      body: 'User prefers concise answers.',
      tags: ['style'],
    });

    const globalOnly = await memoryService.searchMemory({ query: 'solar concise' });
    const projectResults = await memoryService.searchMemory({ projectId: 'proj-a', query: 'solar concise' });

    expect(globalOnly.map(result => result.memory.title)).toEqual(['Terse response preference']);
    expect(projectResults.map(result => result.memory.title)).toEqual(expect.arrayContaining([
      'Solar project detail',
      'Terse response preference',
    ]));
  });

  it('lets a project context forget a global memory it can recall', async () => {
    const shared = await memoryService.saveMemory({
      scope: 'global',
      title: 'Shared tax note',
      body: 'This shared note should be visible inside projects.',
    });

    const before = await memoryService.searchMemory({ projectId: 'proj-a', query: 'shared tax note' });
    const denied = await memoryService.forgetMemory(shared.id, 'proj-a');
    const deleted = await memoryService.forgetMemory(shared.id, 'proj-a', { allowGlobalFromProject: true });
    const after = await memoryService.searchMemory({ projectId: 'proj-a', query: 'shared tax note' });

    expect(before.map(result => result.memory.id)).toContain(shared.id);
    expect(denied).toBe(false);
    expect(deleted).toBe(true);
    expect(after.map(result => result.memory.id)).not.toContain(shared.id);
    expect(embeddings.some(entry => entry.memory_id === shared.id)).toBe(false);
  });

  it('captures, reviews, approves, and recalls a memory candidate', async () => {
    const candidate = await memoryService.captureCandidateFromMessage({
      message: {
        id: 'msg-auto-1',
        role: 'user',
        content: 'Remember that the county solar permit office closes at 3 PM on Fridays.',
      },
      projectId: 'proj-tax',
    });
    const pending = await memoryService.listPendingCandidates('proj-tax');
    const saved = await memoryService.approveCandidate(candidate!.id, {
      title: 'Permit office hours',
      tags: ['solar', 'permit'],
    }, 'proj-tax');
    const afterPending = await memoryService.listPendingCandidates('proj-tax');
    const results = await memoryService.searchMemory({ projectId: 'proj-tax', query: 'permit office Fridays' });

    expect(candidate).toEqual(expect.objectContaining({
      id: 1,
      status: 'pending',
      source_type: 'auto_capture',
      source_id: 'msg-auto-1',
    }));
    expect(pending).toHaveLength(1);
    expect(saved).toEqual(expect.objectContaining({
      id: 1,
      title: 'Permit office hours',
      source_type: 'auto_capture',
      source_id: 'msg-auto-1',
    }));
    expect(afterPending).toHaveLength(0);
    expect(candidates).toHaveLength(0);
    expect(results.map(result => result.memory.title)).toContain('Permit office hours');
    expect(events.some(event => event.action === 'candidate_created')).toBe(true);
    expect(events.some(event => event.action === 'candidate_approved')).toBe(true);
  });

  it('saves a chat message once when remembered repeatedly', async () => {
    const message = {
      id: 'chat-msg-1',
      role: 'assistant' as const,
      content: 'Portugal hobby radio notes should be checked against current ANACOM rules.',
    };

    const first = await memoryService.rememberMessage({ message });
    const second = await memoryService.rememberMessage({ message });

    expect(first.id).toBe(1);
    expect(second.id).toBe(1);
    expect(memories).toHaveLength(1);
    expect(memories[0].source_type).toBe('chat_message');
    expect(memories[0].source_id).toBe('chat-msg-1');
  });

  it('supports save/search/forget through tool handlers', async () => {
    const save = await executeToolCall({
      id: 'tc-save',
      name: 'save_memory',
      arguments: {
        title: 'Solar filing note',
        body: 'Check state rebate eligibility separately from federal tax credits.',
        tags: 'solar, rebate',
        kind: 'research_note',
      },
      context: { projectId: 'proj-tax' },
    });
    const searchBefore = await executeToolCall({
      id: 'tc-search',
      name: 'search_memory',
      arguments: { query: 'solar rebate' },
      context: { projectId: 'proj-tax' },
    });
    const forget = await executeToolCall({
      id: 'tc-forget',
      name: 'forget_memory',
      arguments: { memory_id: '1' },
      context: { projectId: 'proj-tax' },
    });
    const searchAfter = await executeToolCall({
      id: 'tc-search-2',
      name: 'search_memory',
      arguments: { query: 'solar rebate' },
      context: { projectId: 'proj-tax' },
    });

    expect(save.error).toBeUndefined();
    expect(save.content).toContain('Saved memory #1');
    expect(searchBefore.content).toContain('Solar filing note');
    expect(forget.content).toContain('Forgot memory #1');
    expect(searchAfter.content).toContain('No matching memories found');
  });

  it('does not let a project-context memory tool forget shared memories', async () => {
    const shared = await memoryService.saveMemory({
      scope: 'global',
      title: 'Shared filing note',
      body: 'Shared tax note visible inside projects.',
    });

    const forget = await executeToolCall({
      id: 'tc-forget-global',
      name: 'forget_memory',
      arguments: { memory_id: String(shared.id) },
      context: { projectId: 'proj-tax' },
    });
    const after = await memoryService.searchMemory({ projectId: 'proj-tax', query: 'shared filing note' });

    expect(forget.content).toContain('could not be removed');
    expect(after.map(result => result.memory.id)).toContain(shared.id);
  });
});
