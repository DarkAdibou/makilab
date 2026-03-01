/**
 * memory-retrieval.test.ts — Tests for E16 memory retrieval tables + FTS5
 *
 * Covers: memory_settings, memory_retrievals, messages FTS5 index
 */

import { describe, it, expect } from 'vitest';
import {
  getMemorySettings,
  updateMemorySettings,
  logMemoryRetrieval,
  getMemoryRetrievals,
  saveMessage,
  searchMessagesFullText,
} from '../memory/sqlite.ts';

describe('memory_settings', () => {
  it('returns valid settings shape', () => {
    // Reset to defaults first (DB is shared across test runs)
    updateMemorySettings({
      auto_retrieve_enabled: true,
      auto_retrieve_max_results: 4,
      auto_retrieve_min_score: 0.5,
      obsidian_context_enabled: true,
      obsidian_context_notes: [],
      obsidian_context_tag: 'makilab',
    });

    const settings = getMemorySettings();
    expect(settings.auto_retrieve_enabled).toBe(true);
    expect(settings.auto_retrieve_max_results).toBe(4);
    expect(settings.auto_retrieve_min_score).toBe(0.5);
    expect(settings.obsidian_context_enabled).toBe(true);
    expect(settings.obsidian_context_notes).toEqual([]);
    expect(settings.obsidian_context_tag).toBe('makilab');
  });

  it('persists changes via updateMemorySettings', () => {
    updateMemorySettings({
      auto_retrieve_enabled: false,
      auto_retrieve_max_results: 8,
      auto_retrieve_min_score: 0.7,
      obsidian_context_notes: ['Projects/makilab.md', 'Daily/today.md'],
    });

    const settings = getMemorySettings();
    expect(settings.auto_retrieve_enabled).toBe(false);
    expect(settings.auto_retrieve_max_results).toBe(8);
    expect(settings.auto_retrieve_min_score).toBe(0.7);
    expect(settings.obsidian_context_notes).toEqual(['Projects/makilab.md', 'Daily/today.md']);
    // Unchanged values should stay
    expect(settings.obsidian_context_enabled).toBe(true);
    expect(settings.obsidian_context_tag).toBe('makilab');

    // Restore defaults for next run
    updateMemorySettings({
      auto_retrieve_enabled: true,
      auto_retrieve_max_results: 4,
      auto_retrieve_min_score: 0.5,
      obsidian_context_notes: [],
    });
  });
});

describe('memory_retrievals', () => {
  it('logs and retrieves memory retrieval events', () => {
    const tag = `test-${Date.now()}`;
    logMemoryRetrieval({
      channel: tag,
      userMessagePreview: 'Quels sont mes projets en cours ?',
      memoriesInjected: 3,
      obsidianNotesInjected: 1,
      totalTokensAdded: 450,
    });

    const rows = getMemoryRetrievals(50);
    const row = rows.find(r => r.channel === tag);

    expect(row).toBeDefined();
    expect(row!.memories_injected).toBe(3);
    expect(row!.total_tokens_added).toBe(450);
    expect(row!.obsidian_notes_injected).toBe(1);
    expect(row!.id).toBeTruthy();
    expect(row!.created_at).toBeTruthy();
  });
});

describe('searchMessagesFullText (FTS5)', () => {
  it('finds messages by keyword', () => {
    const channel = `fts-test-${Date.now()}`;
    saveMessage(channel, 'user', 'Je veux commander une pizza margherita');
    saveMessage(channel, 'assistant', 'Bien sûr, je peux chercher une pizzeria pour toi');
    saveMessage(channel, 'user', 'Quel temps fait-il à Paris demain');

    const results = searchMessagesFullText('pizza');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.content.includes('pizza'))).toBe(true);
  });

  it('returns empty for no match', () => {
    const results = searchMessagesFullText('xyzzynonexistent12345');
    expect(results).toEqual([]);
  });
});
