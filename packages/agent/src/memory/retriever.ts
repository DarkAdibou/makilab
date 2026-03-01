/**
 * retriever.ts — Auto-retrieval module (E16)
 *
 * Provides automatic context enrichment before each LLM call:
 *   1. Semantic search in Qdrant (conversations + knowledge)
 *   2. Fixed Obsidian context notes + tag-based discovery
 *
 * All errors are caught and logged as warnings — never blocks the agent loop.
 */

import { embedText } from './embeddings.ts';
import { semanticSearch } from './qdrant.ts';
import type { SearchResult } from './qdrant.ts';
import { getMemorySettings, logMemoryRetrieval } from './sqlite.ts';
import type { MemorySettings } from './sqlite.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export interface RetrievedMemory {
  content: string;
  score: number;
  channel: string;
  timestamp: string;
  timeAgo: string;
  type: 'conversation' | 'summary' | 'fact';
}

export interface ObsidianNote {
  path: string;
  content: string;
}

export interface RetrievalResult {
  qdrantMemories: RetrievedMemory[];
  obsidianNotes: ObsidianNote[];
}

const EMPTY_RESULT: RetrievalResult = { qdrantMemories: [], obsidianNotes: [] };
const MAX_CONTENT_LENGTH = 500;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAGGED_NOTES = 5;

/**
 * Format an ISO date string as a French relative time.
 *
 * - < 1 min → "à l'instant"
 * - < 60 min → "il y a X min"
 * - < 24h → "il y a X heure(s)"
 * - < 7 days → "il y a X jour(s)"
 * - < 30 days → "il y a X semaine(s)"
 * - else → full date "15 janvier 2026"
 */
export function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'dans le futur';

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (days < 30) return `il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;

  return new Date(isoDate).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Map a Qdrant SearchResult to a RetrievedMemory.
 */
function mapToMemory(result: SearchResult): RetrievedMemory {
  const payload = result.payload;
  const type = (payload.type as string) ?? (payload.user_message ? 'conversation' : 'fact');
  const timestamp = (payload.timestamp as string) ?? new Date().toISOString();
  const channel = (payload.channel as string) ?? 'unknown';

  let content: string;
  if (type === 'conversation') {
    const user = (payload.user_message as string) ?? '';
    const assistant = (payload.assistant_message as string) ?? '';
    content = `User: ${user}\nAssistant: ${assistant}`;
  } else if (type === 'fact') {
    const key = payload.key as string | undefined;
    const value = payload.content as string | undefined;
    content = key && value ? `${key}: ${value}` : (value ?? String(payload.content ?? ''));
  } else {
    content = (payload.content as string) ?? '';
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '…';
  }

  return {
    content,
    score: result.score,
    channel,
    timestamp,
    timeAgo: formatTimeAgo(timestamp),
    type: type as RetrievedMemory['type'],
  };
}

/**
 * Fetch fixed and tagged Obsidian context notes.
 * All errors are caught — Obsidian may be offline.
 */
async function fetchObsidianContextNotes(settings: MemorySettings): Promise<ObsidianNote[]> {
  if (!config.obsidianRestApiKey) return [];

  // Ensure self-signed cert is accepted
  const prevTls = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

  const baseUrl = 'https://127.0.0.1:27124';
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.obsidianRestApiKey}`,
    'Content-Type': 'application/json',
  };

  const notes: ObsidianNote[] = [];
  const seenPaths = new Set<string>();

  // 1. Fetch fixed notes
  for (const notePath of settings.obsidian_context_notes) {
    try {
      const res = await fetch(`${baseUrl}/vault/${encodeURIComponent(notePath)}`, { headers });
      if (!res.ok) continue;
      const text = await res.text();
      const truncated = text.length > MAX_NOTE_LENGTH ? text.slice(0, MAX_NOTE_LENGTH) + '…' : text;
      notes.push({ path: notePath, content: truncated });
      seenPaths.add(notePath);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), path: notePath }, 'Failed to fetch fixed Obsidian note');
    }
  }

  // 2. Search for tagged notes
  if (settings.obsidian_context_tag) {
    try {
      const searchRes = await fetch(`${baseUrl}/search/simple/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: `tag:#${settings.obsidian_context_tag}` }),
      });
      if (searchRes.ok) {
        const results = await searchRes.json() as Array<{ filename: string }>;
        let taggedCount = 0;

        for (const result of results) {
          if (taggedCount >= MAX_TAGGED_NOTES) break;
          const filename = result.filename;
          if (seenPaths.has(filename)) continue;

          try {
            const noteRes = await fetch(`${baseUrl}/vault/${encodeURIComponent(filename)}`, { headers });
            if (!noteRes.ok) continue;
            const text = await noteRes.text();
            const truncated = text.length > MAX_NOTE_LENGTH ? text.slice(0, MAX_NOTE_LENGTH) + '…' : text;
            notes.push({ path: filename, content: truncated });
            seenPaths.add(filename);
            taggedCount++;
          } catch {
            // Skip individual note fetch failures
          }
        }
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to search Obsidian tagged notes');
    }
  }

  // Restore TLS setting
  if (prevTls !== undefined) {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = prevTls;
  } else {
    delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
  }

  return notes;
}

/**
 * Estimate token count (~4 chars per token).
 */
function estimateTokens(result: RetrievalResult): number {
  let chars = 0;
  for (const m of result.qdrantMemories) {
    chars += m.content.length + m.timeAgo.length + m.channel.length + 20;
  }
  for (const n of result.obsidianNotes) {
    chars += n.content.length + n.path.length + 20;
  }
  return Math.ceil(chars / 4);
}

/**
 * Auto-retrieve relevant memories and Obsidian notes for context enrichment.
 *
 * 1. Read settings
 * 2. Embed user message → semantic search in Qdrant
 * 3. Fetch Obsidian context notes (fixed + tagged)
 * 4. Log retrieval event
 * 5. Return results (never throws)
 */
export async function autoRetrieve(userMessage: string, channel: string): Promise<RetrievalResult> {
  try {
    const settings = getMemorySettings();
    if (!settings.auto_retrieve_enabled) return EMPTY_RESULT;

    const result: RetrievalResult = { qdrantMemories: [], obsidianNotes: [] };

    // Qdrant semantic search
    try {
      const vector = await embedText(userMessage);
      if (vector) {
        const searchResults = await semanticSearch(vector, settings.auto_retrieve_max_results + 2);
        result.qdrantMemories = searchResults
          .filter((r) => r.score >= settings.auto_retrieve_min_score)
          .slice(0, settings.auto_retrieve_max_results)
          .map(mapToMemory);
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Qdrant retrieval failed');
    }

    // Obsidian context notes
    if (settings.obsidian_context_enabled && config.obsidianRestApiKey) {
      try {
        result.obsidianNotes = await fetchObsidianContextNotes(settings);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Obsidian context fetch failed');
      }
    }

    // Log retrieval event
    const tokens = estimateTokens(result);
    logMemoryRetrieval({
      channel,
      userMessagePreview: userMessage.slice(0, 100),
      memoriesInjected: result.qdrantMemories.length,
      obsidianNotesInjected: result.obsidianNotes.length,
      totalTokensAdded: tokens,
    });

    return result;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Auto-retrieve failed entirely');
    return EMPTY_RESULT;
  }
}

/**
 * Format retrieval results into a system prompt section.
 * Returns empty string if nothing to inject.
 */
export function buildRetrievalPrompt(retrieval: RetrievalResult): string {
  const parts: string[] = [];

  if (retrieval.qdrantMemories.length > 0) {
    const lines = retrieval.qdrantMemories
      .map((m) => `- [${m.timeAgo}, ${m.channel}] ${m.content}`)
      .join('\n');
    parts.push(`## Souvenirs pertinents\n${lines}`);
  }

  if (retrieval.obsidianNotes.length > 0) {
    const sections = retrieval.obsidianNotes
      .map((n) => `### ${n.path}\n${n.content}`)
      .join('\n\n');
    parts.push(`## Notes de référence\n${sections}`);
  }

  return parts.join('\n\n');
}
