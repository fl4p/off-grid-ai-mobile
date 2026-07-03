const mockGetEmbeddingsForRecall = jest.fn();
const mockGetActiveMemories = jest.fn();

jest.mock('../../../../src/services/memory/database', () => ({
  memoryDatabase: {
    getEmbeddingsForRecall: (...args: any[]) => mockGetEmbeddingsForRecall(...args),
    getActiveMemories: (...args: any[]) => mockGetActiveMemories(...args),
  },
}));

const mockEmbed = jest.fn();
const mockLoad = jest.fn(() => Promise.resolve());
const mockIsLoaded = jest.fn(() => true);

jest.mock('../../../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: () => mockIsLoaded(),
    load: () => mockLoad(),
    embed: (text: string) => mockEmbed(text),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { memoryRetrievalService } from '../../../../src/services/memory/retrieval';

const memory = {
  id: 1,
  scope: 'project',
  project_id: 'proj-1',
  kind: 'research_note',
  title: 'Solar tax notes',
  body: 'Research the solar panel credit rules before filing.',
  tags: ['tax', 'solar'],
  confidence: 0.8,
  importance: 4,
  status: 'active',
  source_type: 'manual',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('MemoryRetrievalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEmbeddingsForRecall.mockReturnValue([]);
    mockGetActiveMemories.mockReturnValue([]);
    mockEmbed.mockResolvedValue([1, 0]);
  });

  it('uses lexical search when embeddings are unavailable', async () => {
    mockGetActiveMemories.mockReturnValue([
      memory,
      { ...memory, id: 2, title: 'Cooking', body: 'Pasta notes', tags: ['food'], importance: 5 },
    ]);

    const result = await memoryRetrievalService.search('proj-1', 'solar tax');

    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe(1);
    expect(result[0].reason).toBe('lexical');
    expect(result[0].matchedTerms).toEqual(expect.arrayContaining(['solar', 'tax']));
  });

  it('uses semantic search when embeddings are present', async () => {
    mockGetEmbeddingsForRecall.mockReturnValue([
      { ...memory, embedding: [1, 0] },
      { ...memory, id: 2, title: 'Unrelated', body: 'Other notes', tags: [], embedding: [0, 1] },
    ]);

    const result = await memoryRetrievalService.search('proj-1', 'panel credit', 1);

    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe(1);
    expect(result[0].reason).toBe('semantic');
  });

  it('does not return unrelated semantic memories below the relevance floor', async () => {
    mockGetEmbeddingsForRecall.mockReturnValue([
      { ...memory, id: 2, title: 'Cooking', body: 'Pasta notes', tags: ['food'], embedding: [0, 1] },
    ]);
    mockGetActiveMemories.mockReturnValue([
      { ...memory, id: 2, title: 'Cooking', body: 'Pasta notes', tags: ['food'] },
    ]);

    const result = await memoryRetrievalService.search('proj-1', 'solar tax');

    expect(result).toEqual([]);
  });

  it('falls back to lexical search when semantic embedding fails', async () => {
    mockGetEmbeddingsForRecall.mockReturnValue([{ ...memory, embedding: [1, 0] }]);
    mockGetActiveMemories.mockReturnValue([memory]);
    mockEmbed.mockRejectedValueOnce(new Error('embed failed'));

    const result = await memoryRetrievalService.search('proj-1', 'solar');

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('lexical');
  });

  it('returns no results for empty queries', async () => {
    const result = await memoryRetrievalService.search('proj-1', '   ');

    expect(result).toEqual([]);
    expect(mockGetEmbeddingsForRecall).not.toHaveBeenCalled();
  });
});
