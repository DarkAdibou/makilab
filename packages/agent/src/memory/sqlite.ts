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
import { randomUUID } from 'node:crypto';

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

    -- Tâches agentiques persistées
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','in_progress','waiting_user','done','failed')),
      created_by  TEXT NOT NULL CHECK(created_by IN ('user','agent','cron')),
      channel     TEXT NOT NULL,
      priority    TEXT NOT NULL DEFAULT 'medium'
                  CHECK(priority IN ('low','medium','high')),
      context     TEXT NOT NULL DEFAULT '{}',
      due_at      TEXT,
      cron_id     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel, created_at DESC);

    -- Étapes d'une tâche (workflow multi-subagents)
    CREATE TABLE IF NOT EXISTS task_steps (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id              TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      step_order           INTEGER NOT NULL,
      subagent             TEXT NOT NULL,
      action               TEXT NOT NULL,
      input                TEXT,
      output               TEXT,
      status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','in_progress','done','failed','skipped')),
      requires_confirmation INTEGER NOT NULL DEFAULT 0,
      model_used           TEXT,
      cost_usd             REAL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id, step_order ASC);
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
// Tasks (agentique multi-step)
// ============================================================

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  created_by: string;
  channel: string;
  priority: string;
  context: string;
  due_at: string | null;
  cron_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskStepRow {
  id: number;
  task_id: string;
  step_order: number;
  subagent: string;
  action: string;
  input: string | null;
  output: string | null;
  status: string;
  requires_confirmation: number;
  model_used: string | null;
  cost_usd: number | null;
}

/** Create a new task — returns the generated ID */
export function createTask(params: {
  title: string;
  createdBy: 'user' | 'agent' | 'cron';
  channel: string;
  priority?: 'low' | 'medium' | 'high';
  context?: Record<string, unknown>;
  dueAt?: string;
  cronId?: string;
}): string {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO tasks (id, title, created_by, channel, priority, context, due_at, cron_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.title,
    params.createdBy,
    params.channel,
    params.priority ?? 'medium',
    JSON.stringify(params.context ?? {}),
    params.dueAt ?? null,
    params.cronId ?? null,
  );
  return id;
}

/** Update task status */
export function updateTaskStatus(id: string, status: string): void {
  getDb().prepare(`
    UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id);
}

/** Get a task by ID */
export function getTask(id: string): TaskRow | null {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | null;
}

/** List tasks — filtered by status (optional) */
export function listTasks(filter?: { status?: string; channel?: string; limit?: number }): TaskRow[] {
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: (string | number)[] = [];
  if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
  if (filter?.channel) { sql += ' AND channel = ?'; params.push(filter.channel); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter?.limit ?? 20);
  return getDb().prepare(sql).all(...params) as unknown as TaskRow[];
}

/** Add a step to a task */
export function addTaskStep(params: {
  taskId: string;
  stepOrder: number;
  subagent: string;
  action: string;
  input?: unknown;
  requiresConfirmation?: boolean;
}): number {
  const result = getDb().prepare(`
    INSERT INTO task_steps (task_id, step_order, subagent, action, input, requires_confirmation)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.taskId,
    params.stepOrder,
    params.subagent,
    params.action,
    params.input ? JSON.stringify(params.input) : null,
    params.requiresConfirmation ? 1 : 0,
  );
  return result.lastInsertRowid as number;
}

/** Update a step with result */
export function updateTaskStep(stepId: number, update: {
  status: string;
  output?: unknown;
  modelUsed?: string;
  costUsd?: number;
}): void {
  getDb().prepare(`
    UPDATE task_steps
    SET status = ?, output = ?, model_used = ?, cost_usd = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    update.status,
    update.output ? JSON.stringify(update.output) : null,
    update.modelUsed ?? null,
    update.costUsd ?? null,
    stepId,
  );
}

/** Get all steps for a task, ordered */
export function getTaskSteps(taskId: string): TaskStepRow[] {
  return getDb().prepare(`
    SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order ASC
  `).all(taskId) as unknown as TaskStepRow[];
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
