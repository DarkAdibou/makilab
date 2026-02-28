/**
 * sqlite.ts — Tier 1 Memory (node:sqlite built-in)
 *
 * The foundation memory layer. Always available, zero external dependencies.
 * Uses Node.js 22+ built-in SQLite (node:sqlite) — no native compilation needed.
 *
 * If Qdrant (T2) or PostgreSQL (T3) are down, this layer keeps the agent functional.
 *
 * Tables:
 *   core_memory   — Durable facts about the user (injected into every system prompt)
 *   messages      — Full conversation history per channel
 *   summaries     — Rolling summaries of compacted old messages
 *
 * Key behaviors:
 *   - Last 20 messages loaded as context per channel
 *   - Facts extracted automatically after each exchange (background, non-blocking)
 *   - Auto-compaction when messages > 30 per channel (summarize + prune)
 *
 * Extension points:
 *   - E9: Add FTS5 full-text search index on messages
 *   - E9: Cross-channel memory queries
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Store DB in monorepo root (never inside a package)
const rootDir = resolve(fileURLToPath(import.meta.url), '../../../..');
const DB_PATH = resolve(rootDir, 'makilab.db');

let db: DatabaseSync | null = null;

/** Get or create the SQLite database connection (singleton) */
function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL'); // Better concurrent read performance
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

/** Initialize database schema on first run */
function initSchema(db: DatabaseSync): void {
  db.exec(`
    -- Durable facts about the user
    -- Injected into every system prompt so the agent always "knows" you
    CREATE TABLE IF NOT EXISTS core_memory (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Full conversation history per channel
    -- Last 20 messages loaded as context on each turn
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel    TEXT NOT NULL,
      role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel_created
      ON messages(channel, created_at DESC);

    -- Rolling summaries of old messages (post-compaction)
    -- Preserves context without keeping raw messages forever
    CREATE TABLE IF NOT EXISTS summaries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel    TEXT NOT NULL,
      content    TEXT NOT NULL,
      covers_up_to_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_channel
      ON summaries(channel, created_at DESC);
  `);
}

// ============================================================
// Core Memory (durable facts)
// ============================================================

/** Get all core facts — injected into every system prompt */
export function getCoreMemory(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM core_memory').all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Store or update a durable fact */
export function setFact(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO core_memory (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

/** Delete a fact */
export function deleteFact(key: string): void {
  getDb().prepare('DELETE FROM core_memory WHERE key = ?').run(key);
}

// ============================================================
// Messages (conversation history)
// ============================================================

/** Save a message to history */
export function saveMessage(
  channel: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  getDb().prepare(`
    INSERT INTO messages (channel, role, content) VALUES (?, ?, ?)
  `).run(channel, role, content);
}

/** Load last N messages for a channel (for context window) */
export function getRecentMessages(
  channel: string,
  limit = 20,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT role, content FROM messages
    WHERE channel = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(channel, limit) as Array<{ role: string; content: string }>;

  // Reverse to get chronological order
  return rows
    .reverse()
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
}

/** Count messages for a channel */
export function countMessages(channel: string): number {
  const result = getDb().prepare(
    'SELECT COUNT(*) as count FROM messages WHERE channel = ?'
  ).get(channel) as { count: number };
  return result.count;
}

/** Delete old messages for a channel up to a given ID */
export function deleteMessagesUpTo(channel: string, upToId: number): void {
  getDb().prepare(
    'DELETE FROM messages WHERE channel = ? AND id <= ?'
  ).run(channel, upToId);
}

/** Get the oldest N messages for a channel (used for compaction) */
export function getOldestMessages(
  channel: string,
  count: number,
): Array<{ id: number; role: string; content: string }> {
  return getDb().prepare(`
    SELECT id, role, content FROM messages
    WHERE channel = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(channel, count) as Array<{ id: number; role: string; content: string }>;
}

// ============================================================
// Summaries (compacted history)
// ============================================================

/** Save a compaction summary */
export function saveSummary(
  channel: string,
  content: string,
  coversUpToId: number,
): void {
  getDb().prepare(`
    INSERT INTO summaries (channel, content, covers_up_to_id) VALUES (?, ?, ?)
  `).run(channel, content, coversUpToId);
}

/** Get the latest summary for a channel */
export function getLatestSummary(channel: string): string | null {
  const row = getDb().prepare(`
    SELECT content FROM summaries
    WHERE channel = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(channel) as { content: string } | undefined;
  return row?.content ?? null;
}

// ============================================================
// Context builder (used by agent loop)
// ============================================================

export interface MemoryContext {
  facts: Record<string, string>;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  summary: string | null;
}

/**
 * Load all Tier 1 memory for a channel in one call.
 * Used by the agent loop before every LLM call.
 */
export function loadMemoryContext(channel: string): MemoryContext {
  return {
    facts: getCoreMemory(),
    recentMessages: getRecentMessages(channel, 20),
    summary: getLatestSummary(channel),
  };
}

/**
 * Build the memory portion of the system prompt.
 * Injected into BASE_SYSTEM_PROMPT in agent-loop.ts
 */
export function buildMemoryPrompt(ctx: MemoryContext): string {
  const parts: string[] = [];

  if (Object.keys(ctx.facts).length > 0) {
    const factLines = Object.entries(ctx.facts)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    parts.push(`## Ce que tu sais sur l'utilisateur\n${factLines}`);
  }

  if (ctx.summary) {
    parts.push(`## Résumé des échanges précédents\n${ctx.summary}`);
  }

  return parts.join('\n\n');
}
