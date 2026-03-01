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
                  CHECK(status IN ('backlog','pending','in_progress','waiting_user','done','failed')),
      created_by  TEXT NOT NULL CHECK(created_by IN ('user','agent','cron')),
      channel     TEXT NOT NULL,
      priority    TEXT NOT NULL DEFAULT 'medium'
                  CHECK(priority IN ('low','medium','high')),
      context     TEXT NOT NULL DEFAULT '{}',
      due_at      TEXT,
      cron_id     TEXT,
      description TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
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

    -- Journal d'activité de l'agent (tool calls, messages, errors)
    CREATE TABLE IF NOT EXISTS agent_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('tool_call','tool_result','message','error')),
      channel     TEXT NOT NULL,
      subagent    TEXT,
      action      TEXT,
      input       TEXT,
      output      TEXT,
      success     INTEGER,
      duration_ms INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(type, created_at DESC);
  `);

  migrateTasksAddBacklog(db);
  repairTaskStepsFk(db);
  migrateTasksAddDescriptionTags(db);
}

/** Migration: add 'backlog' to tasks.status CHECK constraint for existing DBs */
function migrateTasksAddBacklog(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db.prepare(
    "SELECT name FROM _migrations WHERE name = 'tasks_add_backlog'"
  ).get() as { name: string } | undefined;

  if (row) return; // already applied

  // Check if the current schema already includes 'backlog' (fresh DB)
  const schemaRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get() as { sql: string } | undefined;

  if (!schemaRow || schemaRow.sql.includes('backlog')) {
    // Fresh DB (table just created with backlog) or no tasks table — record and return
    db.prepare("INSERT INTO _migrations (name) VALUES ('tasks_add_backlog')").run();
    return;
  }

  // Existing DB with old CHECK constraint — migrate using rename/recreate
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');

  try {
    db.exec('ALTER TABLE task_steps RENAME TO task_steps_old');
    db.exec('ALTER TABLE tasks RENAME TO tasks_old');

    db.exec(`
      CREATE TABLE tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('backlog','pending','in_progress','waiting_user','done','failed')),
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
      CREATE INDEX idx_tasks_status ON tasks(status, created_at DESC);
      CREATE INDEX idx_tasks_channel ON tasks(channel, created_at DESC);
    `);

    db.exec(`
      CREATE TABLE task_steps (
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
      CREATE INDEX idx_task_steps_task_id ON task_steps(task_id, step_order ASC);
    `);

    db.exec('INSERT INTO tasks SELECT * FROM tasks_old');
    db.exec('INSERT INTO task_steps SELECT * FROM task_steps_old');
    db.exec('DROP TABLE task_steps_old');
    db.exec('DROP TABLE tasks_old');
    db.prepare("INSERT INTO _migrations (name) VALUES ('tasks_add_backlog')").run();

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** Repair: fix task_steps FK if it references tasks_old (from a corrupted migration) */
function repairTaskStepsFk(db: DatabaseSync): void {
  const stepSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='task_steps'"
  ).get() as { sql: string } | undefined;

  if (!stepSchema || !stepSchema.sql.includes('tasks_old')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');

  try {
    db.exec('ALTER TABLE task_steps RENAME TO task_steps_broken');
    db.exec(`
      CREATE TABLE task_steps (
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
    db.exec('INSERT INTO task_steps SELECT * FROM task_steps_broken');
    db.exec('DROP TABLE task_steps_broken');
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** Migration: add description + tags columns to tasks for existing DBs */
function migrateTasksAddDescriptionTags(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const existing = db.prepare(
    "SELECT name FROM _migrations WHERE name = 'tasks_add_description_tags'"
  ).get();
  if (existing) return;

  const schema = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get() as { sql: string } | undefined);

  if (schema?.sql.includes('description')) {
    db.prepare("INSERT INTO _migrations (name) VALUES ('tasks_add_description_tags')").run();
    return;
  }

  db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  db.prepare("INSERT INTO _migrations (name) VALUES ('tasks_add_description_tags')").run();
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
  description: string;
  tags: string; // JSON array string
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
  description?: string;
  tags?: string[];
}): string {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO tasks (id, title, created_by, channel, priority, context, due_at, cron_id, description, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.title,
    params.createdBy,
    params.channel,
    params.priority ?? 'medium',
    JSON.stringify(params.context ?? {}),
    params.dueAt ?? null,
    params.cronId ?? null,
    params.description ?? '',
    JSON.stringify(params.tags ?? []),
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

/** List tasks — filtered by status, tag, priority, search (optional) */
export function listTasks(filter?: { status?: string; channel?: string; limit?: number; tag?: string; priority?: string; search?: string }): TaskRow[] {
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: (string | number)[] = [];
  if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
  if (filter?.channel) { sql += ' AND channel = ?'; params.push(filter.channel); }
  if (filter?.priority) { sql += ' AND priority = ?'; params.push(filter.priority); }
  if (filter?.tag) { sql += " AND tags LIKE '%' || ? || '%'"; params.push(`"${filter.tag}"`); }
  if (filter?.search) { sql += " AND (title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%')"; params.push(filter.search, filter.search); }
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

/** Update a task's fields (partial update) */
export function updateTask(id: string, fields: { status?: string; title?: string; priority?: string; description?: string; tags?: string[]; due_at?: string | null }): TaskRow | null {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.title) { sets.push('title = ?'); params.push(fields.title); }
  if (fields.priority) { sets.push('priority = ?'); params.push(fields.priority); }
  if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
  if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(fields.tags)); }
  if (fields.due_at !== undefined) { sets.push('due_at = ?'); params.push(fields.due_at); }
  if (sets.length === 0) return getTask(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id);
}

/** Delete a task by ID */
export function deleteTask(id: string): boolean {
  const result = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Get all unique tags across tasks */
export function getUniqueTags(): string[] {
  const rows = getDb().prepare("SELECT DISTINCT tags FROM tasks WHERE tags != '[]'").all() as unknown as { tags: string }[];
  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.tags) as string[];
      for (const t of parsed) tagSet.add(t);
    } catch { /* skip */ }
  }
  return [...tagSet].sort();
}

/** Get dashboard statistics */
export function getStats(): { messagesTotal: number; tasksActive: number; subagentCount: number; tasksDone7d: number } {
  const db = getDb();
  const messagesTotal = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE channel = 'mission_control'").get() as { c: number }).c;
  const tasksActive = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('pending','in_progress','waiting_user')").get() as { c: number }).c;
  const tasksDone7d = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= datetime('now', '-7 days')").get() as { c: number }).c;
  return { messagesTotal, tasksActive, subagentCount: 0, tasksDone7d };
}

/** Get all steps for a task, ordered */
export function getTaskSteps(taskId: string): TaskStepRow[] {
  return getDb().prepare(`
    SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order ASC
  `).all(taskId) as unknown as TaskStepRow[];
}

// ============================================================
// Agent Events (activity log)
// ============================================================

export interface AgentEventRow {
  id: number;
  type: string;
  channel: string;
  subagent: string | null;
  action: string | null;
  input: string | null;
  output: string | null;
  success: number | null;
  duration_ms: number | null;
  created_at: string;
}

export function logAgentEvent(event: {
  type: 'tool_call' | 'tool_result' | 'message' | 'error';
  channel: string;
  subagent?: string;
  action?: string;
  input?: unknown;
  output?: unknown;
  success?: boolean;
  durationMs?: number;
}): void {
  getDb().prepare(`
    INSERT INTO agent_events (type, channel, subagent, action, input, output, success, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.type,
    event.channel,
    event.subagent ?? null,
    event.action ?? null,
    event.input ? JSON.stringify(event.input) : null,
    event.output ? JSON.stringify(event.output) : null,
    event.success !== undefined ? (event.success ? 1 : 0) : null,
    event.durationMs ?? null,
  );
}

export function listAgentEvents(filter?: {
  type?: string;
  channel?: string;
  limit?: number;
}): AgentEventRow[] {
  let sql = 'SELECT * FROM agent_events WHERE 1=1';
  const params: (string | number)[] = [];
  if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
  if (filter?.channel) { sql += ' AND channel = ?'; params.push(filter.channel); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter?.limit ?? 100);
  return getDb().prepare(sql).all(...params) as unknown as AgentEventRow[];
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
