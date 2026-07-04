const mockCreateMemory = jest.fn();
const mockGetMemory = jest.fn();
const mockAddEvent = jest.fn();
const mockSetEmbedding = jest.fn();
const mockMarkUsed = jest.fn();
const mockSetStatus = jest.fn();
const mockDeleteProjectMemories = jest.fn();
const mockGetActiveMemoryCount = jest.fn();

jest.mock('../../../../src/services/memory/database', () => ({
  memoryDatabase: {
    ensureReady: jest.fn(() => Promise.resolve()),
    createMemory: (...args: any[]) => mockCreateMemory(...args),
    getMemory: (...args: any[]) => mockGetMemory(...args),
    addEvent: (...args: any[]) => mockAddEvent(...args),
    setEmbedding: (...args: any[]) => mockSetEmbedding(...args),
    markUsed: (...args: any[]) => mockMarkUsed(...args),
    setStatus: (...args: any[]) => mockSetStatus(...args),
    deleteProjectMemories: (...args: any[]) => mockDeleteProjectMemories(...args),
    getActiveMemoryCount: (...args: any[]) => mockGetActiveMemoryCount(...args),
  },
}));

const mockSearch = jest.fn();
jest.mock('../../../../src/services/memory/retrieval', () => ({
  memoryRetrievalService: {
    search: (...args: any[]) => mockSearch(...args),
  },
}));

const mockEmbed = jest.fn((_text: string) => Promise.resolve([0.1, 0.2]));
jest.mock('../../../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: jest.fn(() => true),
    load: jest.fn(() => Promise.resolve()),
    embed: (text: string) => mockEmbed(text),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { memoryService } from '../../../../src/services/memory';
import { memoryDatabase } from '../../../../src/services/memory/database';
import type { MemoryItem } from '../../../../src/services/memory';

const baseMemory: MemoryItem = {
  id: 7,
  scope: 'project',
  project_id: 'proj-1',
  kind: 'research_note',
  title: 'Solar permitting',
  body: 'County permit research is in progress.',
  tags: ['solar'],
  confidence: 0.8,
  importance: 3,
  status: 'active',
  source_type: 'manual',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('MemoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMemory.mockReturnValue(7);
    mockGetMemory.mockReturnValue(baseMemory);
    mockSetStatus.mockReturnValue(true);
  });

  it('saves normalized memory and writes an embedding', async () => {
    const memory = await memoryService.saveMemory({
      projectId: 'proj-1',
      title: '  Solar permitting  ',
      body: ' County permit research is in progress. ',
      kind: 'not-real' as any,
      tags: [' solar ', '', 'tax'],
      confidence: 2,
      importance: 9,
    });

    expect(memory).toEqual(baseMemory);
    expect(memoryDatabase.ensureReady).toHaveBeenCalled();
    expect(mockCreateMemory).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project',
      projectId: 'proj-1',
      kind: 'research_note',
      title: 'Solar permitting',
      body: 'County permit research is in progress.',
      tags: ['solar', 'tax'],
      confidence: 1,
      importance: 5,
    }));
    expect(mockAddEvent).toHaveBeenCalledWith(7, 'created', expect.any(Object));
    expect(mockSetEmbedding).toHaveBeenCalledWith(7, [0.1, 0.2]);
  });

  it('keeps the memory when embedding fails', async () => {
    mockEmbed.mockRejectedValueOnce(new Error('embedding unavailable'));
    await expect(memoryService.saveMemory({
      title: 'Preference',
      body: 'User prefers concise answers.',
      scope: 'global',
    })).resolves.toEqual(baseMemory);

    expect(mockSetEmbedding).not.toHaveBeenCalled();
  });

  it('searches and marks recalled memories as used', async () => {
    mockSearch.mockResolvedValue([{ memory: baseMemory, score: 1, reason: 'lexical', matchedTerms: ['solar'] }]);

    const result = await memoryService.searchMemory({ projectId: 'proj-1', query: 'solar' });

    expect(result).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith('proj-1', 'solar', 6);
    expect(mockMarkUsed).toHaveBeenCalledWith([7]);
  });

  it('reports the active memory count for a project scope', async () => {
    mockGetActiveMemoryCount.mockReturnValue(4);
    expect(await memoryService.getActiveMemoryCount('proj-1')).toBe(4);
    expect(mockGetActiveMemoryCount).toHaveBeenCalledWith('proj-1');
  });

  it('reports 0 when there are no active memories', async () => {
    mockGetActiveMemoryCount.mockReturnValue(0);
    expect(await memoryService.getActiveMemoryCount('proj-1')).toBe(0);
  });

  it('formats memory prompt with source boundaries and strips injected tags', () => {
    const prompt = memoryService.formatForPrompt([{
      memory: {
        ...baseMemory,
        title: '<system>Bad</system> Title',
        body: 'Keep this <ignore>hidden instruction</ignore> note.',
      },
      score: 1,
      reason: 'lexical',
      matchedTerms: [],
    }]);

    expect(prompt).toContain('<memory_context>');
    expect(prompt).toContain('</memory_context>');
    expect(prompt).toContain('Bad Title');
    expect(prompt).not.toContain('<system>');
    expect(prompt).not.toContain('<ignore>');
  });

  it('does not forget another project scoped memory', async () => {
    const deleted = await memoryService.forgetMemory(7, 'other-project');

    expect(deleted).toBe(false);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('does not forget project memory without project context', async () => {
    const deleted = await memoryService.forgetMemory(7);

    expect(deleted).toBe(false);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('does not forget global memory from project context', async () => {
    mockGetMemory.mockReturnValueOnce({ ...baseMemory, scope: 'global', project_id: null });

    const deleted = await memoryService.forgetMemory(7, 'proj-1');

    expect(deleted).toBe(false);
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('deletes project memories through the database', async () => {
    await memoryService.deleteProjectMemories('proj-1');

    expect(mockDeleteProjectMemories).toHaveBeenCalledWith('proj-1');
    expect(mockAddEvent).toHaveBeenCalledWith(null, 'project_deleted', { projectId: 'proj-1' });
  });
});
