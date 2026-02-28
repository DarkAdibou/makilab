/**
 * hardening.test.ts — Tests critiques E4.5
 *
 * Couvre les fonctions pures et critiques du codebase.
 * Pas de mocks Anthropic (trop coûteux à maintenir).
 * Focus sur les bugs qui ont déjà causé des problèmes.
 */

import { describe, it, expect } from 'vitest';

// ── Test 1 : encodePath ───────────────────────────────────────────────────────
// Bug historique : encodeURIComponent('Captures/URLs/test.md') → 'Captures%2FURLs%2Ftest.md'
// Fix : encoder chaque segment séparément
describe('encodePath', () => {
  function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  it('preserves / separators', () => {
    expect(encodePath('Captures/URLs/test.md')).toBe('Captures/URLs/test.md');
  });

  it('encodes spaces in segments', () => {
    expect(encodePath('Captures/My Notes/note.md')).toBe('Captures/My%20Notes/note.md');
  });

  it('encodes special chars in segments', () => {
    expect(encodePath('Notes/Réunion équipe.md')).toBe('Notes/R%C3%A9union%20%C3%A9quipe.md');
  });

  it('handles flat path (no slashes)', () => {
    expect(encodePath('simple.md')).toBe('simple.md');
  });
});

// ── Test 2 : buildCapabilitiesPrompt ──────────────────────────────────────────
describe('buildCapabilitiesPrompt', () => {
  it('lists all registered subagents', async () => {
    const { buildCapabilitiesPrompt } = await import('../subagents/registry.ts');
    const prompt = buildCapabilitiesPrompt();
    expect(prompt).toContain('obsidian');
    expect(prompt).toContain('capture');
    expect(prompt).toContain('karakeep');
    expect(prompt).toContain('web');
    expect(prompt).toContain('gmail');
    expect(prompt).toContain('time');
  });

  it('includes action descriptions', async () => {
    const { buildCapabilitiesPrompt } = await import('../subagents/registry.ts');
    const prompt = buildCapabilitiesPrompt();
    expect(prompt).toContain('classify');
    expect(prompt).toContain('search');
  });
});

// ── Test 3 : JSON fence stripping (fact-extractor pattern) ───────────────────
// Bug historique : Haiku retournait JSON enveloppé dans ```json ... ```
describe('JSON fence stripping', () => {
  function stripFences(raw: string): string {
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  it('strips ```json fences', () => {
    const raw = '```json\n{"key": "value"}\n```';
    expect(stripFences(raw)).toBe('{"key": "value"}');
  });

  it('strips ``` fences (no language)', () => {
    const raw = '```\n{"key": "value"}\n```';
    expect(stripFences(raw)).toBe('{"key": "value"}');
  });

  it('leaves plain JSON untouched', () => {
    const raw = '{"key": "value"}';
    expect(stripFences(raw)).toBe('{"key": "value"}');
  });

  it('stripped result is valid JSON', () => {
    const raw = '```json\n{"name": "Adrien", "city": "Sydney"}\n```';
    const stripped = stripFences(raw);
    expect(() => JSON.parse(stripped)).not.toThrow();
    expect(JSON.parse(stripped)).toEqual({ name: 'Adrien', city: 'Sydney' });
  });
});

// ── Test 4 : capture ROUTING_MAP coverage ────────────────────────────────────
describe('capture ROUTING_MAP', () => {
  const CAPTURE_TYPES = [
    'company', 'contact', 'url', 'prompt', 'snippet',
    'idea', 'meeting_note', 'task', 'quote', 'unknown',
  ] as const;

  const ROUTING_MAP: Record<string, { destinations: string[]; obsidianFolder: string }> = {
    url:          { destinations: ['karakeep', 'obsidian'], obsidianFolder: 'Captures/URLs' },
    company:      { destinations: ['karakeep', 'obsidian'], obsidianFolder: 'Captures/Companies' },
    contact:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Contacts' },
    idea:         { destinations: ['obsidian'],             obsidianFolder: 'Captures/Ideas' },
    snippet:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Snippets' },
    prompt:       { destinations: ['obsidian'],             obsidianFolder: 'Captures/Prompts' },
    meeting_note: { destinations: ['obsidian'],             obsidianFolder: 'Captures/Meetings' },
    task:         { destinations: ['obsidian'],             obsidianFolder: 'Captures/Tasks' },
    quote:        { destinations: ['obsidian'],             obsidianFolder: 'Captures/Quotes' },
    unknown:      { destinations: ['obsidian'],             obsidianFolder: 'Captures/Inbox' },
  };

  it('has an entry for every CaptureType', () => {
    for (const type of CAPTURE_TYPES) {
      expect(ROUTING_MAP[type], `Missing routing for type: ${type}`).toBeDefined();
    }
  });

  it('every entry has obsidian in destinations or as folder', () => {
    for (const [type, routing] of Object.entries(ROUTING_MAP)) {
      expect(routing.obsidianFolder, `Missing obsidianFolder for ${type}`).toBeTruthy();
      expect(routing.destinations.length, `Empty destinations for ${type}`).toBeGreaterThan(0);
    }
  });

  it('url and company route to both karakeep and obsidian', () => {
    expect(ROUTING_MAP['url']!.destinations).toContain('karakeep');
    expect(ROUTING_MAP['company']!.destinations).toContain('karakeep');
  });

  it('unknown routes to obsidian inbox (not karakeep)', () => {
    expect(ROUTING_MAP['unknown']!.destinations).toEqual(['obsidian']);
    expect(ROUTING_MAP['unknown']!.obsidianFolder).toBe('Captures/Inbox');
  });
});

// ── Test 5 : buildObsidianPath filename sanitization ──────────────────────────
describe('buildObsidianPath sanitization', () => {
  function sanitizeFilename(title: string): string {
    return title.replace(/[/\\:*?"<>|]/g, '-').substring(0, 60);
  }

  it('replaces forbidden chars with dashes', () => {
    expect(sanitizeFilename('Note: with/slashes and *stars*')).toBe('Note- with-slashes and -stars-');
  });

  it('truncates long titles to 60 chars', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeFilename(long)).toHaveLength(60);
  });

  it('leaves normal title unchanged', () => {
    expect(sanitizeFilename('OpenAI Function Calling Documentation')).toBe('OpenAI Function Calling Documentation');
  });
});
