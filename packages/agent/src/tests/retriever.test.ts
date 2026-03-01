/**
 * retriever.test.ts — Tests for auto-retriever module (E16)
 *
 * Mocks embeddings + qdrant to avoid network calls in tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock embeddings + qdrant (no network in tests)
vi.mock('../memory/embeddings.ts', () => ({
  embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  EMBEDDING_DIMENSION: 1024,
}));
vi.mock('../memory/qdrant.ts', () => ({
  semanticSearch: vi.fn().mockResolvedValue([
    { score: 0.8, payload: { type: 'conversation', channel: 'whatsapp', user_message: 'test souvenir', assistant_message: 'réponse test', timestamp: '2026-02-28T10:00:00Z' } },
    { score: 0.6, payload: { type: 'fact', content: 'Adrien', key: 'user_name', timestamp: '2026-02-25T12:00:00Z' } },
    { score: 0.3, payload: { type: 'summary', content: 'Résumé ancien', channel: 'cli', timestamp: '2026-01-01T00:00:00Z' } },
  ]),
  SCORE_THRESHOLD: 0.3,
}));

import { autoRetrieve, formatTimeAgo, buildRetrievalPrompt } from '../memory/retriever.ts';

describe('formatTimeAgo', () => {
  it('formats recent timestamps as "heure"', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(formatTimeAgo(oneHourAgo)).toContain('heure');
  });

  it('formats minutes ago', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatTimeAgo(tenMinAgo)).toContain('min');
  });

  it('formats very recent as "à l\'instant"', () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe('à l\'instant');
  });

  it('formats days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    expect(formatTimeAgo(threeDaysAgo)).toContain('jour');
  });

  it('formats weeks ago', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    expect(formatTimeAgo(twoWeeksAgo)).toContain('semaine');
  });

  it('formats old dates as full date', () => {
    expect(formatTimeAgo('2025-01-15T10:00:00Z')).toMatch(/2025/);
  });
});

describe('autoRetrieve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns qdrant memories filtered by min score', async () => {
    const result = await autoRetrieve('bonjour', 'mission_control');
    // Default min_score = 0.5, so the 0.3 score result should be filtered out
    expect(result.qdrantMemories.length).toBe(2);
    expect(result.qdrantMemories[0].score).toBe(0.8);
    expect(result.qdrantMemories[0].type).toBe('conversation');
    expect(result.qdrantMemories[0].timeAgo).toBeTruthy();
    expect(result.qdrantMemories[1].score).toBe(0.6);
  });

  it('maps conversation type correctly', async () => {
    const result = await autoRetrieve('test', 'cli');
    const conv = result.qdrantMemories.find(m => m.type === 'conversation');
    expect(conv).toBeDefined();
    expect(conv!.content).toContain('User: test souvenir');
    expect(conv!.content).toContain('Assistant: réponse test');
    expect(conv!.channel).toBe('whatsapp');
  });

  it('maps fact type correctly', async () => {
    const result = await autoRetrieve('test', 'cli');
    const fact = result.qdrantMemories.find(m => m.type === 'fact');
    expect(fact).toBeDefined();
    expect(fact!.content).toContain('user_name');
    expect(fact!.content).toContain('Adrien');
  });

  it('returns empty obsidianNotes when obsidian not configured', async () => {
    const result = await autoRetrieve('test', 'cli');
    expect(result.obsidianNotes).toEqual([]);
  });
});

describe('buildRetrievalPrompt', () => {
  it('formats memories into system prompt section', () => {
    const prompt = buildRetrievalPrompt({
      qdrantMemories: [
        { content: 'User: test\nAssistant: réponse', score: 0.8, channel: 'whatsapp', timestamp: '2026-02-28T10:00:00Z', timeAgo: 'il y a 2 jours', type: 'conversation' },
      ],
      obsidianNotes: [],
    });
    expect(prompt).toContain('## Souvenirs pertinents');
    expect(prompt).toContain('il y a 2 jours');
    expect(prompt).toContain('whatsapp');
  });

  it('returns empty string when no memories', () => {
    expect(buildRetrievalPrompt({ qdrantMemories: [], obsidianNotes: [] })).toBe('');
  });

  it('includes obsidian notes section', () => {
    const prompt = buildRetrievalPrompt({
      qdrantMemories: [],
      obsidianNotes: [{ path: 'Carrière.md', content: 'Mon parcours...' }],
    });
    expect(prompt).toContain('## Notes de référence');
    expect(prompt).toContain('Carrière.md');
    expect(prompt).toContain('Mon parcours...');
  });

  it('includes both sections when both present', () => {
    const prompt = buildRetrievalPrompt({
      qdrantMemories: [
        { content: 'Un souvenir', score: 0.7, channel: 'cli', timestamp: '2026-03-01T00:00:00Z', timeAgo: 'il y a 1 jour', type: 'fact' },
      ],
      obsidianNotes: [{ path: 'Notes.md', content: 'Du contenu' }],
    });
    expect(prompt).toContain('## Souvenirs pertinents');
    expect(prompt).toContain('## Notes de référence');
  });
});
