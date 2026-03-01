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
    logMemoryRetrieval({
      channel: 'whatsapp',
      userMessagePreview: 'Quels sont mes projets en cours ?',
      memoriesInjected: 3,
      obsidianNotesInjected: 1,
      totalTokensAdded: 450,
    });

    logMemoryRetrieval({
      channel: 'mission_control',
      userMessagePreview: 'Résume ma journée',
      memoriesInjected: 2,
      obsidianNotesInjected: 0,
      totalTokensAdded: 200,
    });

    const rows = getMemoryRetrievals(10);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Find our entries (order may vary when timestamps match)
    const whatsappRow = rows.find(r => r.channel === 'whatsapp' && r.memories_injected === 3);
    const mcRow = rows.find(r => r.channel === 'mission_control' && r.memories_injected === 2);

    expect(whatsappRow).toBeDefined();
    expect(whatsappRow!.total_tokens_added).toBe(450);
    expect(whatsappRow!.obsidian_notes_injected).toBe(1);
    expect(whatsappRow!.id).toBeTruthy();
    expect(whatsappRow!.created_at).toBeTruthy();

    expect(mcRow).toBeDefined();
    expect(mcRow!.total_tokens_added).toBe(200);
    expect(mcRow!.obsidian_notes_injected).toBe(0);
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
