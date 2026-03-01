# E16 — Mémoire hybride unifiée — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rendre l'agent proactivement intelligent avec auto-retrieval Qdrant, notes Obsidian contextuelles, FTS5, oubli actif, et page /memory dashboard.

**Architecture:** Nouveau module `retriever.ts` appelé synchroniquement avant chaque tour LLM. Enrichit le system prompt avec 4 souvenirs Qdrant (score > 0.5) + notes Obsidian (fixes + taggées #makilab). Extraction de faits étendue aux tool results. Page /memory avec faits éditables, recherche hybride, et settings.

**Tech Stack:** Node.js 24, TypeScript, node:sqlite (FTS5), Qdrant, Voyage AI, Obsidian REST API, Next.js 15.

**Design doc:** `docs/plans/2026-03-02-e16-unified-memory-design.md`

---

### Task 1: SQLite migrations — memory_settings + memory_retrievals + FTS5

**Files:**
- Modify: `packages/agent/src/memory/sqlite.ts`
- Test: `packages/agent/src/tests/memory-retrieval.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/agent/src/tests/memory-retrieval.test.ts
import { describe, it, expect } from 'vitest';
import {
  getMemorySettings,
  updateMemorySettings,
  logMemoryRetrieval,
  getMemoryRetrievals,
  searchMessagesFullText,
  saveMessage,
} from '../memory/sqlite.ts';

describe('memory_settings', () => {
  it('returns defaults when no settings exist', () => {
    const s = getMemorySettings();
    expect(s.auto_retrieve_enabled).toBe(true);
    expect(s.auto_retrieve_max_results).toBe(4);
    expect(s.auto_retrieve_min_score).toBe(0.5);
    expect(s.obsidian_context_enabled).toBe(true);
    expect(s.obsidian_context_tag).toBe('makilab');
    expect(s.obsidian_context_notes).toEqual([]);
  });

  it('updates and persists settings', () => {
    updateMemorySettings({ auto_retrieve_max_results: 6, obsidian_context_tag: 'agent' });
    const s = getMemorySettings();
    expect(s.auto_retrieve_max_results).toBe(6);
    expect(s.obsidian_context_tag).toBe('agent');
    expect(s.auto_retrieve_enabled).toBe(true); // unchanged
  });
});

describe('memory_retrievals', () => {
  it('logs and retrieves memory retrievals', () => {
    logMemoryRetrieval({
      channel: 'mission_control',
      userMessagePreview: 'bonjour test',
      memoriesInjected: 3,
      obsidianNotesInjected: 1,
      totalTokensAdded: 450,
    });
    const rows = getMemoryRetrievals(5);
    expect(rows.length).toBe(1);
    expect(rows[0].channel).toBe('mission_control');
    expect(rows[0].memories_injected).toBe(3);
  });
});

describe('FTS5 full-text search', () => {
  it('finds messages by keyword', () => {
    saveMessage('test-fts', 'user', 'Je veux acheter un écran 4K pour le NUC');
    saveMessage('test-fts', 'assistant', 'Bonne idée, quel budget ?');
    saveMessage('test-fts', 'user', 'Environ 300 euros');

    const results = searchMessagesFullText('écran 4K');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('écran 4K');
  });

  it('returns empty for no match', () => {
    const results = searchMessagesFullText('xyznonexistent');
    expect(results.length).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @makilab/agent test src/tests/memory-retrieval.test.ts
```
Expected: FAIL — functions not exported yet.

**Step 3: Implement SQLite migrations + functions**

Add to `packages/agent/src/memory/sqlite.ts`:

1. **Migration `memory_settings`** — table avec defaults seedés :
```sql
CREATE TABLE IF NOT EXISTS memory_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO memory_settings (key, value) VALUES
  ('auto_retrieve_enabled', 'true'),
  ('auto_retrieve_max_results', '4'),
  ('auto_retrieve_min_score', '0.5'),
  ('obsidian_context_enabled', 'true'),
  ('obsidian_context_notes', '[]'),
  ('obsidian_context_tag', 'makilab');
```

2. **Migration `memory_retrievals`** :
```sql
CREATE TABLE IF NOT EXISTS memory_retrievals (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  user_message_preview TEXT,
  memories_injected INTEGER DEFAULT 0,
  obsidian_notes_injected INTEGER DEFAULT 0,
  total_tokens_added INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

3. **Migration FTS5** :
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);
-- Triggers for auto-sync
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
```

4. **Interface + functions** :
```typescript
export interface MemorySettings {
  auto_retrieve_enabled: boolean;
  auto_retrieve_max_results: number;
  auto_retrieve_min_score: number;
  obsidian_context_enabled: boolean;
  obsidian_context_notes: string[];
  obsidian_context_tag: string;
}

export function getMemorySettings(): MemorySettings { ... }
export function updateMemorySettings(updates: Partial<MemorySettings>): void { ... }

export interface MemoryRetrievalRow {
  id: string; channel: string; user_message_preview: string;
  memories_injected: number; obsidian_notes_injected: number;
  total_tokens_added: number; created_at: string;
}

export function logMemoryRetrieval(params: { channel: string; userMessagePreview: string; memoriesInjected: number; obsidianNotesInjected: number; totalTokensAdded: number }): void { ... }
export function getMemoryRetrievals(limit?: number): MemoryRetrievalRow[] { ... }

export function searchMessagesFullText(query: string, limit?: number): MessageRow[] { ... }
```

**Notes d'implémentation FTS5 :**
- `searchMessagesFullText` utilise : `SELECT m.* FROM messages_fts fts JOIN messages m ON m.rowid = fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`
- La migration FTS5 doit aussi re-indexer les messages existants : `INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages`
- Attention : node:sqlite supporte FTS5 nativement, pas besoin d'extension.

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @makilab/agent test src/tests/memory-retrieval.test.ts
```
Expected: 5 tests PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/memory/sqlite.ts packages/agent/src/tests/memory-retrieval.test.ts
git commit -m "feat(E16): SQLite migrations — memory_settings, memory_retrievals, FTS5"
```

---

### Task 2: Auto-retriever module

**Files:**
- Create: `packages/agent/src/memory/retriever.ts`
- Test: `packages/agent/src/tests/retriever.test.ts`

**Step 1: Write failing test**

```typescript
// packages/agent/src/tests/retriever.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock embeddings + qdrant (no network in tests)
vi.mock('../memory/embeddings.ts', () => ({
  embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  EMBEDDING_DIMENSION: 1024,
}));
vi.mock('../memory/qdrant.ts', () => ({
  semanticSearch: vi.fn().mockResolvedValue([
    { score: 0.8, payload: { type: 'conversation', channel: 'whatsapp', user_message: 'test souvenir', assistant_message: 'réponse', timestamp: '2026-02-28T10:00:00Z' } },
    { score: 0.6, payload: { type: 'fact', content: 'user_name: Adrien', key: 'user_name', timestamp: '2026-02-25T12:00:00Z' } },
  ]),
  SCORE_THRESHOLD: 0.3,
}));

import { autoRetrieve, formatTimeAgo } from '../memory/retriever.ts';

describe('autoRetrieve', () => {
  it('returns qdrant memories with scores and timeAgo', async () => {
    const result = await autoRetrieve('bonjour', 'mission_control');
    expect(result.qdrantMemories).toHaveLength(2);
    expect(result.qdrantMemories[0].score).toBe(0.8);
    expect(result.qdrantMemories[0].type).toBe('conversation');
    expect(result.qdrantMemories[0].timeAgo).toBeTruthy();
  });

  it('respects settings for max results and min score', async () => {
    // With default settings (max 4, min 0.5), both results should pass
    const result = await autoRetrieve('test', 'cli');
    expect(result.qdrantMemories.length).toBeLessThanOrEqual(4);
    result.qdrantMemories.forEach(m => expect(m.score).toBeGreaterThanOrEqual(0.5));
  });
});

describe('formatTimeAgo', () => {
  it('formats recent timestamps', () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
    expect(formatTimeAgo(oneHourAgo)).toContain('heure');
  });

  it('formats old timestamps as date', () => {
    expect(formatTimeAgo('2025-01-15T10:00:00Z')).toContain('2025');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @makilab/agent test src/tests/retriever.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement retriever.ts**

```typescript
// packages/agent/src/memory/retriever.ts
import { embedText } from './embeddings.ts';
import { semanticSearch } from './qdrant.ts';
import type { SearchResult } from './qdrant.ts';
import { getMemorySettings, logMemoryRetrieval } from './sqlite.ts';
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

/** Format ISO timestamp as relative "il y a X" string */
export function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (days < 30) return `il y a ${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`;
  // Fallback: date formatée
  return new Date(isoDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Auto-retrieve relevant memories from Qdrant + Obsidian context notes */
export async function autoRetrieve(
  userMessage: string,
  channel: string,
): Promise<RetrievalResult> {
  const settings = getMemorySettings();
  const result: RetrievalResult = { qdrantMemories: [], obsidianNotes: [] };

  if (!settings.auto_retrieve_enabled) return result;

  // 1. Qdrant semantic search
  try {
    const vector = await embedText(userMessage);
    if (vector) {
      const raw = await semanticSearch(vector, settings.auto_retrieve_max_results + 2);
      result.qdrantMemories = raw
        .filter(r => r.score >= settings.auto_retrieve_min_score)
        .slice(0, settings.auto_retrieve_max_results)
        .map(r => mapSearchResult(r));
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Auto-retrieve Qdrant failed — skipping');
  }

  // 2. Obsidian context notes
  if (settings.obsidian_context_enabled && config.obsidianApiKey) {
    try {
      result.obsidianNotes = await fetchObsidianContextNotes(settings);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Auto-retrieve Obsidian failed — skipping');
    }
  }

  // 3. Log retrieval for observability
  const totalTokens = estimateTokens(result);
  logMemoryRetrieval({
    channel,
    userMessagePreview: userMessage.slice(0, 100),
    memoriesInjected: result.qdrantMemories.length,
    obsidianNotesInjected: result.obsidianNotes.length,
    totalTokensAdded: totalTokens,
  });

  if (result.qdrantMemories.length > 0 || result.obsidianNotes.length > 0) {
    logger.info({
      memories: result.qdrantMemories.length,
      obsidian: result.obsidianNotes.length,
      tokens: totalTokens,
    }, 'Auto-retrieve completed');
  }

  return result;
}

function mapSearchResult(r: SearchResult): RetrievedMemory {
  const p = r.payload;
  const type = (p.type as string) ?? (p.user_message ? 'conversation' : 'fact');
  let content: string;
  if (type === 'conversation') {
    content = `User: ${p.user_message}\nAssistant: ${p.assistant_message}`;
  } else {
    content = (p.content as string) ?? `${p.key}: ${p.value}`;
  }
  return {
    content: content.slice(0, 500),
    score: r.score,
    channel: (p.channel as string) ?? 'unknown',
    timestamp: (p.timestamp as string) ?? '',
    timeAgo: formatTimeAgo((p.timestamp as string) ?? new Date().toISOString()),
    type: type as RetrievedMemory['type'],
  };
}

/** Build system prompt section from retrieval results */
export function buildRetrievalPrompt(retrieval: RetrievalResult): string {
  const sections: string[] = [];

  if (retrieval.qdrantMemories.length > 0) {
    const items = retrieval.qdrantMemories.map(m =>
      `- [${m.timeAgo}, ${m.channel}] ${m.content}`
    );
    sections.push(`## Souvenirs pertinents\n${items.join('\n')}`);
  }

  if (retrieval.obsidianNotes.length > 0) {
    const items = retrieval.obsidianNotes.map(n =>
      `### ${n.path}\n${n.content}`
    );
    sections.push(`## Notes de référence\n${items.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

async function fetchObsidianContextNotes(settings: { obsidian_context_notes: string[]; obsidian_context_tag: string }): Promise<ObsidianNote[]> {
  const notes: ObsidianNote[] = [];
  const baseUrl = `https://127.0.0.1:27124`;
  const headers = {
    'Authorization': `Bearer ${config.obsidianApiKey}`,
    'Content-Type': 'application/json',
  };

  // Fixed notes from settings
  for (const path of settings.obsidian_context_notes) {
    try {
      const res = await fetch(`${baseUrl}/vault/${encodeURIComponent(path)}`, { headers });
      if (res.ok) {
        const content = await res.text();
        notes.push({ path, content: content.slice(0, 1000) });
      }
    } catch { /* skip unavailable notes */ }
  }

  // Tagged notes via search
  try {
    const res = await fetch(`${baseUrl}/search/simple/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: `tag:#${settings.obsidian_context_tag}` }),
    });
    if (res.ok) {
      const results = await res.json() as Array<{ filename: string; content?: string }>;
      for (const r of results.slice(0, 5)) { // max 5 tagged notes
        if (!settings.obsidian_context_notes.includes(r.filename)) {
          // Fetch full content
          try {
            const noteRes = await fetch(`${baseUrl}/vault/${encodeURIComponent(r.filename)}`, { headers });
            if (noteRes.ok) {
              const content = await noteRes.text();
              notes.push({ path: r.filename, content: content.slice(0, 1000) });
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* Obsidian search unavailable */ }

  return notes;
}

function estimateTokens(result: RetrievalResult): number {
  let chars = 0;
  for (const m of result.qdrantMemories) chars += m.content.length + 50; // overhead
  for (const n of result.obsidianNotes) chars += n.content.length + 50;
  return Math.ceil(chars / 4); // ~4 chars per token approximation
}
```

**Step 4: Run tests**

```bash
pnpm --filter @makilab/agent test src/tests/retriever.test.ts
```
Expected: 4 tests PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/memory/retriever.ts packages/agent/src/tests/retriever.test.ts
git commit -m "feat(E16): auto-retriever module — Qdrant + Obsidian context"
```

---

### Task 3: Integrate auto-retrieval into agent loops

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (L167–174, L286)
- Modify: `packages/agent/src/agent-loop-stream.ts` (L102–104, L266)

**Step 1: Modify agent-loop.ts**

At the top, add import:
```typescript
import { autoRetrieve, buildRetrievalPrompt } from './memory/retriever.ts';
```

At L167–174, after `loadMemoryContext` and `buildMemoryPrompt`, add auto-retrieval:
```typescript
const memCtx = loadMemoryContext(channel);
const memorySection = buildMemoryPrompt(memCtx);
const capabilitiesSection = buildCapabilitiesPrompt();

// E16: Auto-retrieve relevant memories + Obsidian context
const retrieval = await autoRetrieve(userMessage, channel);
const retrievalSection = buildRetrievalPrompt(retrieval);

const systemPrompt = [BASE_SYSTEM_PROMPT, memorySection, retrievalSection, capabilitiesSection]
  .filter(Boolean)
  .join('\n\n');
```

At L286, modify `extractAndSaveFacts` call to pass tool results:
```typescript
// Collect tool result texts from the conversation
const toolResults = messages
  .filter(m => m.role === 'user' && Array.isArray(m.content))
  .flatMap(m => (m.content as Array<{ type: string; content?: string }>))
  .filter(b => b.type === 'tool_result' && b.content)
  .map(b => b.content as string);

extractAndSaveFacts(userMessage, finalReply, channel, toolResults).catch(() => {});
```

**Step 2: Modify agent-loop-stream.ts (same pattern)**

Same imports, same insertion point (L102–104), same tool results collection at L266.

**Step 3: Run all tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: All existing tests PASS (the autoRetrieve call is async but should not break mocked tests).

**Step 4: Commit**

```bash
git add packages/agent/src/agent-loop.ts packages/agent/src/agent-loop-stream.ts
git commit -m "feat(E16): integrate auto-retrieval into agent loops"
```

---

### Task 4: Enriched fact extraction (tool results)

**Files:**
- Modify: `packages/agent/src/memory/fact-extractor.ts`

**Step 1: Update function signature**

Change L50–54:
```typescript
export async function extractAndSaveFacts(
  userMessage: string,
  assistantReply: string,
  channel: string,
  toolResults?: string[],
): Promise<void>
```

**Step 2: Update prompt to include tool results**

In the LLM prompt (around L58–68), add a section if toolResults is non-empty:
```typescript
const toolContext = toolResults?.length
  ? `\n\nRésultats d'outils consultés pendant cet échange :\n${toolResults.slice(0, 3).map(r => r.slice(0, 500)).join('\n---\n')}`
  : '';
```

Include `toolContext` in the user message sent to the LLM, after the exchange text.

**Step 3: Run tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: All tests PASS (the new param is optional, existing calls unaffected).

**Step 4: Commit**

```bash
git add packages/agent/src/memory/fact-extractor.ts
git commit -m "feat(E16): enriched fact extraction from tool results"
```

---

### Task 5: Memory subagent — forget + search_text actions

**Files:**
- Modify: `packages/agent/src/subagents/memory.ts`
- Modify: `packages/agent/src/memory/qdrant.ts` (add `deleteByIds`)

**Step 1: Add `deleteByIds` to qdrant.ts**

```typescript
/** Delete points by ID from a collection */
export async function deleteByIds(collection: string, ids: string[]): Promise<void> {
  const client = getClient();
  if (!client || ids.length === 0) return;
  await client.delete(collection, { points: ids });
}
```

**Step 2: Add actions to memory subagent**

Add two new actions in the `actions` array:

```typescript
{
  name: 'forget',
  description: "Oublier un sujet — supprime les faits et souvenirs liés de toute la mémoire (SQLite + Qdrant)",
  inputSchema: {
    type: 'object' as const,
    properties: {
      topic: { type: 'string' as const, description: 'Le sujet à oublier' },
    },
    required: ['topic'],
  },
},
{
  name: 'search_text',
  description: 'Recherche par mots-clés dans l\'historique des messages (FTS5, complémentaire à search sémantique)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const, description: 'Mots-clés à chercher' },
      limit: { type: 'number' as const, description: 'Nombre max de résultats (défaut: 10)' },
    },
    required: ['query'],
  },
},
```

Implement in `execute`:

**`forget`** :
1. `embedText(topic)` → vector
2. `semanticSearch(vector, 20)` → collect IDs from both collections
3. `deleteByIds('conversations', convIds)` + `deleteByIds('knowledge', knowledgeIds)`
4. Search `core_memory` for facts containing topic (case-insensitive) → `deleteFact(key)`
5. Return summary: "Supprimé X souvenirs + Y faits"

**`search_text`** :
1. `searchMessagesFullText(query, limit)` from sqlite.ts
2. Format results with channel, date, content preview

**Step 3: Run tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: PASS (hardening test lists all subagents — verify `memory` still has correct action count).

**Step 4: Commit**

```bash
git add packages/agent/src/subagents/memory.ts packages/agent/src/memory/qdrant.ts
git commit -m "feat(E16): memory subagent — forget + search_text actions"
```

---

### Task 6: API endpoints for memory

**Files:**
- Modify: `packages/agent/src/server.ts`

**Step 1: Add 8 endpoints**

```typescript
// GET /api/memory/facts — list all core_memory facts
server.get('/api/memory/facts', async () => {
  const facts = getCoreMemory();
  return Object.entries(facts).map(([key, value]) => ({ key, value }));
});

// POST /api/memory/facts — add a fact
server.post<{ Body: { key: string; value: string } }>('/api/memory/facts', async (req) => {
  setFact(req.body.key, req.body.value);
  return { success: true };
});

// DELETE /api/memory/facts/:key — delete a fact
server.delete<{ Params: { key: string } }>('/api/memory/facts/:key', async (req) => {
  deleteFact(req.params.key);
  return { success: true };
});

// GET /api/memory/search?q=...&mode=semantic|text
server.get<{ Querystring: { q: string; mode?: string; limit?: string } }>(
  '/api/memory/search', async (req) => { ... }
);

// GET /api/memory/settings
server.get('/api/memory/settings', async () => getMemorySettings());

// PATCH /api/memory/settings
server.patch<{ Body: Partial<MemorySettings> }>('/api/memory/settings', async (req) => {
  updateMemorySettings(req.body);
  return getMemorySettings();
});

// GET /api/memory/stats — nb vectors, nb facts, last indexation
server.get('/api/memory/stats', async () => { ... });

// GET /api/memory/retrievals?limit=20
server.get<{ Querystring: { limit?: string } }>('/api/memory/retrievals', async (req) => {
  return getMemoryRetrievals(parseInt(req.query.limit ?? '20', 10));
});
```

Pour `/api/memory/search` :
- `mode=semantic` : `embedText(q)` → `semanticSearch(vector, limit)` — retourner score + content + channel + timestamp
- `mode=text` (défaut) : `searchMessagesFullText(q, limit)` — retourner channel + content + date

Pour `/api/memory/stats` :
- Nombre de faits : `Object.keys(getCoreMemory()).length`
- Nombre de messages : `countMessages('*')` ou requête `SELECT COUNT(*) FROM messages`
- Stats Qdrant : appel conditionnel `client.getCollection()` pour le nombre de vecteurs

**Step 2: Run server tests**

```bash
pnpm --filter @makilab/agent test src/tests/server.test.ts
```
Expected: PASS (new endpoints don't break existing ones).

**Step 3: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(E16): API endpoints — memory facts, search, settings, stats"
```

---

### Task 7: Dashboard — page /memory

**Files:**
- Create: `packages/dashboard/app/memory/page.tsx`
- Modify: `packages/dashboard/app/components/sidebar.tsx`
- Modify: `packages/dashboard/app/lib/api.ts`
- Modify: `packages/dashboard/app/globals.css`

**Step 1: Add API helpers in lib/api.ts**

```typescript
// Memory types
export interface FactInfo { key: string; value: string }
export interface MemorySettingsInfo {
  auto_retrieve_enabled: boolean;
  auto_retrieve_max_results: number;
  auto_retrieve_min_score: number;
  obsidian_context_enabled: boolean;
  obsidian_context_notes: string[];
  obsidian_context_tag: string;
}
export interface MemoryRetrievalInfo {
  id: string; channel: string; user_message_preview: string;
  memories_injected: number; obsidian_notes_injected: number;
  total_tokens_added: number; created_at: string;
}
export interface MemorySearchResult {
  content: string; channel: string; score?: number; created_at: string;
}
export interface MemoryStats {
  factsCount: number; messagesCount: number; vectorsCount: number;
}

// Memory API helpers
export async function fetchFacts(): Promise<FactInfo[]> { ... }
export async function addFact(key: string, value: string): Promise<void> { ... }
export async function deleteFactApi(key: string): Promise<void> { ... }
export async function fetchMemorySettings(): Promise<MemorySettingsInfo> { ... }
export async function updateMemorySettingsApi(updates: Partial<MemorySettingsInfo>): Promise<MemorySettingsInfo> { ... }
export async function searchMemory(query: string, mode: 'semantic' | 'text', limit?: number): Promise<MemorySearchResult[]> { ... }
export async function fetchMemoryStats(): Promise<MemoryStats> { ... }
export async function fetchMemoryRetrievals(limit?: number): Promise<MemoryRetrievalInfo[]> { ... }
```

**Step 2: Add Memory link in sidebar**

In `packages/dashboard/app/components/sidebar.tsx`, add dans la section MANAGE :
```typescript
{ href: '/memory', label: '🧠 Mémoire' },
```

**Step 3: Build page /memory**

`packages/dashboard/app/memory/page.tsx` — Client component avec 4 sections :

1. **Faits connus** : liste avec edit/delete inline, formulaire ajout
2. **Recherche** : barre de recherche avec toggle sémantique/texte, résultats
3. **Auto-retrieval** : toggles, sliders, log dernières injections
4. **Notes Obsidian** : liste notes configurées, ajout/suppression, champ tag

Pattern CSS : réutiliser les classes existantes `.stat-card`, `.detail-panel`, `.toggle-switch`, etc.

**Step 4: Add CSS styles**

Ajouter dans `globals.css` les styles spécifiques :
- `.fact-row` : ligne éditable avec boutons edit/delete
- `.search-mode-toggle` : toggle sémantique/texte
- `.slider-setting` : slider avec label + valeur
- `.retrieval-log` : table des dernières injections
- `.obsidian-notes-list` : liste de notes avec delete

**Step 5: Build dashboard**

```bash
pnpm --filter @makilab/dashboard build
```
Expected: Build OK, 13 pages.

**Step 6: Commit**

```bash
git add packages/dashboard/app/memory/page.tsx packages/dashboard/app/components/sidebar.tsx packages/dashboard/app/lib/api.ts packages/dashboard/app/globals.css
git commit -m "feat(E16): dashboard /memory — facts, search, settings, obsidian"
```

---

### Task 8: PROGRESS.md + verification

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Run all tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: All tests PASS (99 existing + ~7 new = ~106 tests).

**Step 2: Build dashboard**

```bash
pnpm --filter @makilab/dashboard build
```
Expected: 13 pages, build OK.

**Step 3: Update PROGRESS.md**

- Table des epics : E16 → ✅ Terminé
- Section E16 détaillée avec stories L16.1–L16.7
- Mettre à jour "Dernière session" et "Handoff prompt"

**Step 4: Commit and push**

```bash
git add PROGRESS.md
git commit -m "docs: E16 mémoire hybride unifiée terminé ✅"
git push
```
