import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @qdrant/js-client-rest
const mockUpsert = vi.fn().mockResolvedValue({});
const mockSearch = vi.fn().mockResolvedValue([
  { id: 'abc', score: 0.85, payload: { content: 'test result', type: 'exchange', channel: 'cli', timestamp: '2026-03-01' } },
]);
const mockGetCollections = vi.fn().mockResolvedValue({ collections: [] });
const mockCreateCollection = vi.fn().mockResolvedValue({});

vi.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: class {
      upsert = mockUpsert;
      search = mockSearch;
      getCollections = mockGetCollections;
      createCollection = mockCreateCollection;
    },
  };
});

vi.mock('../config.ts', () => ({
  config: { qdrantUrl: 'http://localhost:6333', voyageApiKey: 'test-key' },
}));

vi.mock('../logger.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock embeddings to avoid importing voyageai
vi.mock('../memory/embeddings.ts', () => ({
  EMBEDDING_DIMENSION: 1024,
}));

import {
  initCollections,
  upsertConversation,
  upsertKnowledge,
  semanticSearch,
  CONVERSATIONS_COLLECTION,
  KNOWLEDGE_COLLECTION,
  SCORE_THRESHOLD,
} from '../memory/qdrant.ts';

describe('qdrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports correct collection names', () => {
    expect(CONVERSATIONS_COLLECTION).toBe('conversations');
    expect(KNOWLEDGE_COLLECTION).toBe('knowledge');
  });

  it('SCORE_THRESHOLD is 0.3', () => {
    expect(SCORE_THRESHOLD).toBe(0.3);
  });

  it('initCollections creates both collections when they dont exist', async () => {
    await initCollections();
    expect(mockCreateCollection).toHaveBeenCalledTimes(2);
  });

  it('initCollections skips existing collections', async () => {
    mockGetCollections.mockResolvedValueOnce({
      collections: [{ name: 'conversations' }, { name: 'knowledge' }],
    });
    await initCollections();
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it('upsertConversation calls qdrant upsert with correct collection', async () => {
    const vector = new Array(1024).fill(0.1);
    await upsertConversation({
      vector,
      channel: 'cli',
      userMessage: 'hello',
      assistantMessage: 'world',
    });
    expect(mockUpsert).toHaveBeenCalledWith('conversations', expect.objectContaining({
      points: expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ channel: 'cli', user_message: 'hello' }),
        }),
      ]),
    }));
  });

  it('upsertKnowledge calls qdrant upsert with correct collection', async () => {
    const vector = new Array(1024).fill(0.1);
    await upsertKnowledge({
      vector,
      type: 'fact',
      content: 'user likes coffee',
      key: 'preference_coffee',
    });
    expect(mockUpsert).toHaveBeenCalledWith('knowledge', expect.objectContaining({
      points: expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ type: 'fact', key: 'preference_coffee' }),
        }),
      ]),
    }));
  });

  it('semanticSearch returns results above threshold', async () => {
    const vector = new Array(1024).fill(0.1);
    const results = await semanticSearch(vector, 5);
    // mockSearch returns 1 result per collection, so 2 total (both above threshold)
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBe(0.85);
  });

  it('semanticSearch filters results below threshold', async () => {
    mockSearch.mockResolvedValue([
      { id: 'a', score: 0.2, payload: { content: 'low score' } },
    ]);
    const vector = new Array(1024).fill(0.1);
    const results = await semanticSearch(vector, 5);
    expect(results).toHaveLength(0);
  });
});
