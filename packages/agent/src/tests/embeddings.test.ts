import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmbed = vi.fn().mockResolvedValue({
  data: [{ embedding: new Array(1024).fill(0.1) }],
});

// Mock the voyageai module before importing
vi.mock('voyageai', () => {
  return {
    VoyageAIClient: class {
      embed = mockEmbed;
      constructor(_opts: Record<string, unknown>) {}
    },
  };
});

// Mock config to provide VOYAGE_API_KEY
vi.mock('../config.ts', () => ({
  config: {
    voyageApiKey: 'test-key',
  },
}));

vi.mock('../logger.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { embedText, embedTexts, EMBEDDING_DIMENSION } from '../memory/embeddings.ts';

describe('embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('EMBEDDING_DIMENSION is 1024', () => {
    expect(EMBEDDING_DIMENSION).toBe(1024);
  });

  it('embedText returns a float array of correct dimension', async () => {
    const result = await embedText('hello world');
    expect(result).toHaveLength(1024);
    expect(typeof result![0]).toBe('number');
  });

  it('embedTexts returns arrays for multiple inputs', async () => {
    mockEmbed.mockResolvedValueOnce({
      data: [
        { embedding: new Array(1024).fill(0.2) },
        { embedding: new Array(1024).fill(0.3) },
      ],
    });

    const results = await embedTexts(['hello', 'world']);
    expect(results).toHaveLength(2);
    expect(results![0]).toHaveLength(1024);
  });
});
