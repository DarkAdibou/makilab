/**
 * web.test.ts — Tests E18: SearXNG + Brave fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing web module
vi.mock('../config.ts', () => ({
  config: {
    searxngUrl: '',
    braveSearchApiKey: '',
  },
}));

import { config } from '../config.ts';
import { searchSearxng, searchBrave } from '../subagents/web.ts';

const mutableConfig = config as Record<string, string>;

describe('searchSearxng', () => {
  beforeEach(() => {
    mutableConfig['searxngUrl'] = 'http://localhost:8080';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mutableConfig['searxngUrl'] = '';
  });

  it('returns formatted results from SearXNG JSON API', async () => {
    const mockResponse = {
      results: [
        { title: 'Result 1', url: 'https://example.com/1', content: 'Description 1' },
        { title: 'Result 2', url: 'https://example.com/2', content: 'Description 2' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await searchSearxng('test query', 5);

    expect(result.success).toBe(true);
    expect(result.text).toContain('SearXNG');
    expect(result.text).toContain('Result 1');
    expect(result.data).toHaveLength(2);

    // Check fetch was called with correct URL
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(fetchCall[0] as string);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('test query');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('returns empty results gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await searchSearxng('obscure query', 5);
    expect(result.success).toBe(true);
    expect(result.text).toContain('Aucun résultat');
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(searchSearxng('test', 5)).rejects.toThrow('SearXNG error: 500');
  });

  it('respects count limit', async () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      title: `Result ${i}`, url: `https://example.com/${i}`, content: `Desc ${i}`,
    }));

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await searchSearxng('test', 3);
    expect(result.data).toHaveLength(3);
  });
});

describe('searchBrave', () => {
  beforeEach(() => {
    mutableConfig['braveSearchApiKey'] = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mutableConfig['braveSearchApiKey'] = '';
  });

  it('returns formatted results from Brave API', async () => {
    const mockResponse = {
      web: {
        results: [
          { title: 'Brave Result', url: 'https://brave.com/1', description: 'Brave desc' },
        ],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await searchBrave('test query', 5);

    expect(result.success).toBe(true);
    expect(result.text).toContain('Brave');
    expect(result.data).toHaveLength(1);
  });

  it('returns error when API key missing', async () => {
    mutableConfig['braveSearchApiKey'] = '';
    const result = await searchBrave('test', 5);
    expect(result.success).toBe(false);
    expect(result.error).toContain('BRAVE_SEARCH_API_KEY');
  });
});

describe('webSubAgent fallback logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mutableConfig['searxngUrl'] = '';
    mutableConfig['braveSearchApiKey'] = '';
  });

  it('uses SearXNG when configured', async () => {
    mutableConfig['searxngUrl'] = 'http://localhost:8080';
    const { webSubAgent } = await import('../subagents/web.ts');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ title: 'SX', url: 'https://sx.com', content: 'hi' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await webSubAgent.execute('search', { query: 'test' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('SearXNG');
  });

  it('falls back to Brave when SearXNG fails', async () => {
    mutableConfig['searxngUrl'] = 'http://localhost:8080';
    mutableConfig['braveSearchApiKey'] = 'test-key';
    const { webSubAgent } = await import('../subagents/web.ts');

    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Connection refused'))  // SearXNG fail
      .mockResolvedValueOnce(                                   // Brave success
        new Response(JSON.stringify({ web: { results: [{ title: 'Brave', url: 'https://b.com', description: 'ok' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await webSubAgent.execute('search', { query: 'test' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('Brave');
  });

  it('returns error when no search engine configured', async () => {
    mutableConfig['searxngUrl'] = '';
    mutableConfig['braveSearchApiKey'] = '';
    const { webSubAgent } = await import('../subagents/web.ts');

    const result = await webSubAgent.execute('search', { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.text).toContain('Aucun moteur');
  });
});
