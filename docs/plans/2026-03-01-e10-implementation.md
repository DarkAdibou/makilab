# E10 — Mission Control v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend Mission Control MVP with kanban tasks, command center, streaming chat, and Home Assistant subagent.

**Architecture:** Three independent blocks built sequentially. Block A adds task management API endpoints + kanban UI + command center page. Block B adds SSE streaming to the chat endpoint + markdown rendering. Block C adds a new Home Assistant subagent via MCP client SDK. All blocks share the existing Fastify API (port 3100) and Next.js dashboard (port 3000).

**Tech Stack:** Fastify 5, Next.js 15 (App Router), React 19, @dnd-kit/core + @dnd-kit/sortable, @anthropic-ai/sdk (streaming), @modelcontextprotocol/sdk, vanilla CSS (no Tailwind).

**Design doc:** `docs/plans/2026-03-01-e10-mission-control-v2-design.md`

---

## Block A — Kanban Tasks + Command Center

### Task 1: SQLite migration — add `backlog` status

**Files:**
- Modify: `packages/agent/src/memory/sqlite.ts:82-97` (initDb, CHECK constraint)
- Modify: `packages/agent/src/subagents/tasks.ts:77` (enum in inputSchema)
- Test: `packages/agent/src/tests/tasks.test.ts`

**Context:** SQLite does not support `ALTER TABLE ... ALTER CONSTRAINT`. We must recreate the table. The current CHECK is `CHECK(status IN ('pending','in_progress','waiting_user','done','failed'))`. We need to add `'backlog'`.

**Step 1: Write the failing test**

Add to `packages/agent/src/tests/tasks.test.ts`:

```typescript
it('createTask with backlog status works', () => {
  const id = createTask({ title: 'Backlog item', createdBy: 'user', channel: 'test' });
  updateTaskStatus(id, 'backlog');
  const task = getTask(id);
  expect(task!.status).toBe('backlog');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @makilab/agent test`
Expected: FAIL — SQLite CHECK constraint rejects `'backlog'`

**Step 3: Implement the migration**

In `packages/agent/src/memory/sqlite.ts`, change the `initDb()` function's CREATE TABLE tasks statement:

```typescript
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
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

Then add a migration function called from `initDb()`, right after the CREATE TABLE statements:

```typescript
function migrateTasksAddBacklog(db: DatabaseSync): void {
  // Check if migration is needed — try inserting 'backlog' status
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const applied = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get('tasks_add_backlog');
    if (applied) return;

    // SQLite can't alter CHECK constraints — recreate table
    db.exec(`
      ALTER TABLE tasks RENAME TO tasks_old;

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
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel, created_at DESC);

      INSERT INTO tasks SELECT * FROM tasks_old;
      DROP TABLE tasks_old;

      INSERT INTO _migrations (name) VALUES ('tasks_add_backlog');
    `);
  } catch {
    // Table doesn't exist yet (fresh DB) — no migration needed
  }
}
```

Call `migrateTasksAddBacklog(db)` at the end of `initDb()`.

Also update the tasks subagent enum in `packages/agent/src/subagents/tasks.ts:77`:
```typescript
status: { type: 'string', description: 'Nouveau statut', enum: ['backlog', 'pending', 'in_progress', 'waiting_user', 'done', 'failed'] },
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @makilab/agent test`
Expected: All 31 tests PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory/sqlite.ts packages/agent/src/subagents/tasks.ts packages/agent/src/tests/tasks.test.ts
git commit -m "feat(E10): SQLite migration — add backlog status to tasks"
```

---

### Task 2: New API endpoints — PATCH tasks, POST tasks, GET stats

**Files:**
- Modify: `packages/agent/src/server.ts`
- Modify: `packages/agent/src/memory/sqlite.ts` (add `getStats()`, `updateTask()`)
- Test: `packages/agent/src/tests/server.test.ts`

**Step 1: Write the failing tests**

Add to `packages/agent/src/tests/server.test.ts`:

```typescript
it('POST /api/tasks creates a task and returns it', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Test task', priority: 'high' },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  expect(body.id).toBeDefined();
  expect(body.title).toBe('Test task');
  expect(body.status).toBe('pending');
  expect(body.priority).toBe('high');
});

it('PATCH /api/tasks/:id updates task status', async () => {
  // First create a task
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'To update' },
  });
  const { id } = createRes.json();

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${id}`,
    payload: { status: 'in_progress' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('in_progress');
});

it('GET /api/stats returns dashboard statistics', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/stats' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toHaveProperty('messagesTotal');
  expect(body).toHaveProperty('tasksActive');
  expect(body).toHaveProperty('subagentCount');
  expect(body).toHaveProperty('tasksDone7d');
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @makilab/agent test`
Expected: FAIL — routes don't exist

**Step 3: Add SQLite helpers**

In `packages/agent/src/memory/sqlite.ts`, add:

```typescript
/** Update a task's fields (partial update) */
export function updateTask(id: string, fields: { status?: string; title?: string; priority?: string }): TaskRow | null {
  const sets: string[] = [];
  const params: (string)[] = [];
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.title) { sets.push('title = ?'); params.push(fields.title); }
  if (fields.priority) { sets.push('priority = ?'); params.push(fields.priority); }
  if (sets.length === 0) return getTask(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id);
}

/** Get dashboard statistics */
export function getStats(): { messagesTotal: number; tasksActive: number; subagentCount: number; tasksDone7d: number } {
  const db = getDb();
  const messagesTotal = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE channel = 'mission_control'").get() as { c: number }).c;
  const tasksActive = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('pending','in_progress','waiting_user')").get() as { c: number }).c;
  const tasksDone7d = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= datetime('now', '-7 days')").get() as { c: number }).c;
  return { messagesTotal, tasksActive, subagentCount: 0, tasksDone7d }; // subagentCount filled by server
}
```

**Step 4: Add the routes**

In `packages/agent/src/server.ts`, add these imports and routes:

```typescript
// Add to imports
import { getRecentMessages, listTasks, createTask, getTask, updateTask, getStats } from './memory/sqlite.ts';

// POST /api/tasks — create a task from the dashboard
app.post<{ Body: { title: string; priority?: string; status?: string } }>(
  '/api/tasks',
  async (req, reply) => {
    const { title, priority, status } = req.body;
    const id = createTask({
      title,
      createdBy: 'user',
      channel: 'mission_control',
      priority: priority as 'low' | 'medium' | 'high' | undefined,
    });
    if (status && status !== 'pending') {
      updateTask(id, { status });
    }
    const task = getTask(id);
    return reply.status(201).send(task);
  },
);

// PATCH /api/tasks/:id — update task fields
app.patch<{ Params: { id: string }; Body: { status?: string; title?: string; priority?: string } }>(
  '/api/tasks/:id',
  async (req) => {
    const task = updateTask(req.params.id, req.body);
    if (!task) throw { statusCode: 404, message: 'Task not found' };
    return task;
  },
);

// GET /api/stats — dashboard statistics
app.get('/api/stats', async () => {
  const stats = getStats();
  stats.subagentCount = getAllSubAgents().length;
  return stats;
});
```

**Step 5: Run tests**

Run: `pnpm --filter @makilab/agent test`
Expected: All tests PASS (34 total: 17 hardening + 10 tasks + 7 server)

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/memory/sqlite.ts packages/agent/src/tests/server.test.ts
git commit -m "feat(E10): API endpoints — POST/PATCH tasks + GET stats"
```

---

### Task 3: Dashboard — Kanban Tasks page

**Files:**
- Create: `packages/dashboard/app/tasks/page.tsx`
- Create: `packages/dashboard/app/components/kanban-board.tsx`
- Create: `packages/dashboard/app/components/task-card.tsx`
- Create: `packages/dashboard/app/components/new-task-modal.tsx`
- Modify: `packages/dashboard/app/lib/api.ts` (add task API helpers)
- Modify: `packages/dashboard/app/globals.css` (kanban styles)
- Modify: `packages/dashboard/app/components/sidebar.tsx` (add Tasks nav item)

**Dependencies to install:**
```bash
cd packages/dashboard && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 1: Add API helpers**

In `packages/dashboard/app/lib/api.ts`, add:

```typescript
export interface TaskInfo {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_by: string;
  channel: string;
  created_at: string;
  updated_at: string;
}

export async function fetchTasks(limit = 100): Promise<TaskInfo[]> {
  const res = await fetch(`${API_BASE}/tasks?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createTaskApi(title: string, priority = 'medium', status = 'pending'): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, priority, status }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateTaskApi(id: string, fields: { status?: string; title?: string; priority?: string }): Promise<TaskInfo> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface StatsInfo {
  messagesTotal: number;
  tasksActive: number;
  subagentCount: number;
  tasksDone7d: number;
}

export async function fetchStats(): Promise<StatsInfo> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

**Step 2: Create the TaskCard component**

Create `packages/dashboard/app/components/task-card.tsx`:

```tsx
'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskInfo } from '../lib/api';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'badge-destructive',
  medium: 'badge-primary',
  low: 'badge-muted',
};

export function TaskCard({ task }: { task: TaskInfo }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`card kanban-card${isDragging ? ' dragging' : ''}`}>
      <div className="kanban-card-header">
        <span className="kanban-card-title">{task.title}</span>
        <span className={`badge ${PRIORITY_COLORS[task.priority] ?? 'badge-muted'}`}>{task.priority}</span>
      </div>
      <div className="kanban-card-meta">
        <span>{task.created_by}</span>
        <span>{new Date(task.created_at).toLocaleDateString('fr-FR')}</span>
      </div>
    </div>
  );
}
```

**Step 3: Create the KanbanBoard component**

Create `packages/dashboard/app/components/kanban-board.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './task-card';
import type { TaskInfo } from '../lib/api';
import { updateTaskApi } from '../lib/api';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: 'var(--muted-foreground)' },
  { id: 'pending', label: 'Todo', color: 'var(--accent)' },
  { id: 'in_progress', label: 'In Progress', color: 'var(--primary)' },
  { id: 'done', label: 'Done', color: 'var(--success, #22c55e)' },
];

function KanbanColumn({ id, label, color, tasks, children }: {
  id: string; label: string; color: string; tasks: TaskInfo[]; children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`kanban-column${isOver ? ' kanban-column-over' : ''}`}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">
          <span className="kanban-column-dot" style={{ background: color }} />
          {label}
        </span>
        <span className="badge badge-muted">{tasks.length}</span>
      </div>
      <div className="kanban-column-body">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => <TaskCard key={task.id} task={task} />)}
        </SortableContext>
        {children}
      </div>
    </div>
  );
}

export function KanbanBoard({ initialTasks, onTaskCreated }: {
  initialTasks: TaskInfo[];
  onTaskCreated?: () => void;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(null);

  // Group tasks by status
  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = tasks.filter(t => t.status === col.id);
    return acc;
  }, {} as Record<string, TaskInfo[]>);

  // Tasks with other statuses (failed, waiting_user) go in their current column or In Progress
  const otherTasks = tasks.filter(t => !COLUMNS.some(c => c.id === t.status));
  if (otherTasks.length > 0) {
    grouped['in_progress'] = [...(grouped['in_progress'] ?? []), ...otherTasks];
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTask(tasks.find(t => t.id === event.active.id) ?? null);
  }, [tasks]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    // Determine target column
    const targetColumn = COLUMNS.find(c => c.id === over.id)?.id
      ?? tasks.find(t => t.id === over.id)?.status;
    if (!targetColumn) return;

    const taskId = active.id as string;
    const currentTask = tasks.find(t => t.id === taskId);
    if (!currentTask || currentTask.status === targetColumn) return;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: targetColumn } : t));

    try {
      await updateTaskApi(taskId, { status: targetColumn });
    } catch {
      // Revert on error
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: currentTask.status } : t));
    }
  }, [tasks]);

  // Sync when initialTasks change
  if (initialTasks !== tasks && initialTasks.length !== tasks.length) {
    setTasks(initialTasks);
  }

  return (
    <DndContext collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="kanban-board">
        {COLUMNS.map(col => (
          <KanbanColumn key={col.id} {...col} tasks={grouped[col.id] ?? []}>
            {col.id === 'backlog' && onTaskCreated && (
              <button className="btn btn-ghost kanban-add-btn" onClick={onTaskCreated}>+ Ajouter</button>
            )}
          </KanbanColumn>
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
```

**Step 4: Create the NewTaskModal component**

Create `packages/dashboard/app/components/new-task-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { createTaskApi } from '../lib/api';

export function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await createTaskApi(title.trim(), priority, 'backlog');
      onCreated();
      onClose();
    } catch {
      // TODO: show error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content card" onClick={e => e.stopPropagation()}>
        <h3>Nouvelle tâche</h3>
        <form onSubmit={handleSubmit}>
          <input
            className="textarea"
            type="text"
            placeholder="Titre de la tâche..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
          <div className="modal-row">
            <label>Priorité</label>
            <select className="textarea" value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">Basse</option>
              <option value="medium">Moyenne</option>
              <option value="high">Haute</option>
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !title.trim()}>
              {loading ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 5: Create the Tasks page**

Create `packages/dashboard/app/tasks/page.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchTasks } from '../lib/api';
import type { TaskInfo } from '../lib/api';
import { KanbanBoard } from '../components/kanban-board';
import { NewTaskModal } from '../components/new-task-modal';

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [showModal, setShowModal] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks(200);
      setTasks(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  return (
    <div className="tasks-container">
      <div className="tasks-header">
        <h1>Tasks</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Nouvelle tâche</button>
      </div>
      <KanbanBoard initialTasks={tasks} onTaskCreated={() => setShowModal(true)} />
      {showModal && <NewTaskModal onClose={() => setShowModal(false)} onCreated={loadTasks} />}
    </div>
  );
}
```

**Step 6: Update sidebar**

In `packages/dashboard/app/components/sidebar.tsx`, update the nav items array:

```typescript
const NAV_SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/', label: 'Command Center', icon: '📊' },
      { href: '/chat', label: 'Chat', icon: '💬' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { href: '/tasks', label: 'Tasks', icon: '✅' },
      { href: '/connections', label: 'Connections', icon: '🔌' },
    ],
  },
];
```

Update the sidebar render to use sections:

```tsx
<nav className="sidebar-nav">
  {NAV_SECTIONS.map(section => (
    <div key={section.label} className="sidebar-section">
      <span className="sidebar-section-label">{section.label}</span>
      {section.items.map(item => (
        <Link key={item.href} href={item.href} className={`sidebar-link${pathname === item.href ? ' active' : ''}`}>
          <span className="sidebar-icon">{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </div>
  ))}
</nav>
```

**Step 7: Add CSS for kanban + modal + sections**

Append to `packages/dashboard/app/globals.css`:

```css
/* Sidebar sections */
.sidebar-section { margin-bottom: 24px; }
.sidebar-section-label {
  display: block;
  padding: 0 16px;
  margin-bottom: 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

/* Tasks page */
.tasks-container { display: flex; flex-direction: column; gap: 24px; }
.tasks-header { display: flex; align-items: center; justify-content: space-between; }

/* Kanban */
.kanban-board {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
  min-height: calc(100vh - 200px);
}
.kanban-column {
  flex: 1;
  min-width: 260px;
  max-width: 340px;
  background: var(--muted);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: background 0.15s;
}
.kanban-column-over { background: color-mix(in srgb, var(--primary) 10%, var(--muted)); }
.kanban-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.kanban-column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.875rem;
}
.kanban-column-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.kanban-column-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 60px;
}

/* Kanban card */
.kanban-card {
  cursor: grab;
  padding: 12px;
  transition: box-shadow 0.15s;
}
.kanban-card:hover { box-shadow: var(--shadow-md); }
.kanban-card.dragging { opacity: 0.5; box-shadow: var(--shadow-lg); }
.kanban-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.kanban-card-title { font-weight: 500; font-size: 0.875rem; line-height: 1.4; }
.kanban-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}

.kanban-add-btn {
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted-foreground);
}

/* Badge destructive (for high priority) */
.badge-destructive {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-content {
  width: 100%;
  max-width: 440px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-content h3 { margin: 0; }
.modal-content form { display: flex; flex-direction: column; gap: 12px; }
.modal-row { display: flex; align-items: center; gap: 12px; }
.modal-row label { font-size: 0.875rem; font-weight: 500; min-width: 60px; }
.modal-row select { flex: 1; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
```

**Step 8: Build and verify**

Run:
```bash
cd packages/dashboard && pnpm build
```
Expected: Build succeeds with no errors.

**Step 9: Commit**

```bash
git add packages/dashboard/ packages/agent/src/tests/
git commit -m "feat(E10): kanban tasks page — drag-and-drop, create task modal, sidebar sections"
```

---

### Task 4: Dashboard — Command Center page

**Files:**
- Create: `packages/dashboard/app/command/page.tsx` (new home page at `/`)
- Move: chat from `packages/dashboard/app/page.tsx` to `packages/dashboard/app/chat/page.tsx`
- Modify: `packages/dashboard/app/lib/api.ts` (already has `fetchStats`)
- Modify: `packages/dashboard/app/globals.css` (stat card styles)

**Step 1: Move chat to /chat**

Move `packages/dashboard/app/page.tsx` to `packages/dashboard/app/chat/page.tsx` (the content stays the same).

**Step 2: Create the Command Center page at /**

Create `packages/dashboard/app/page.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchStats, fetchTasks, fetchMessages } from './lib/api';
import type { StatsInfo, TaskInfo } from './lib/api';

export default function CommandCenter() {
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [activeTasks, setActiveTasks] = useState<TaskInfo[]>([]);
  const [recentMessages, setRecentMessages] = useState<Array<{ role: string; content: string }>>([]);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
    fetchTasks(20).then(tasks => setActiveTasks(tasks.filter(t => t.status === 'in_progress' || t.status === 'pending'))).catch(() => {});
    fetchMessages('mission_control', 10).then(setRecentMessages).catch(() => {});
  }, []);

  return (
    <div className="command-center">
      <h1>Command Center</h1>

      <div className="stat-grid">
        <StatCard label="Messages" value={stats?.messagesTotal ?? '—'} icon="💬" />
        <StatCard label="Tâches actives" value={stats?.tasksActive ?? '—'} icon="✅" />
        <StatCard label="Subagents" value={stats?.subagentCount ?? '—'} icon="🔌" />
        <StatCard label="Terminées (7j)" value={stats?.tasksDone7d ?? '—'} icon="📈" />
      </div>

      <div className="command-grid">
        <div className="card command-section">
          <h2>Tâches en cours</h2>
          {activeTasks.length === 0 && <p className="text-muted">Aucune tâche active</p>}
          {activeTasks.slice(0, 5).map(t => (
            <div key={t.id} className="command-task-row">
              <span className={`badge ${t.status === 'in_progress' ? 'badge-primary' : 'badge-muted'}`}>{t.status}</span>
              <span className="command-task-title">{t.title}</span>
              <span className={`badge ${t.priority === 'high' ? 'badge-destructive' : 'badge-muted'}`}>{t.priority}</span>
            </div>
          ))}
        </div>

        <div className="card command-section">
          <h2>Activité récente</h2>
          {recentMessages.length === 0 && <p className="text-muted">Aucune activité</p>}
          {recentMessages.slice(0, 8).map((m, i) => (
            <div key={i} className="command-message-row">
              <span className={`badge ${m.role === 'user' ? 'badge-primary' : 'badge-success'}`}>{m.role}</span>
              <span className="command-message-text">{m.content.substring(0, 120)}{m.content.length > 120 ? '…' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
```

**Step 3: Add CSS for Command Center**

Append to `packages/dashboard/app/globals.css`:

```css
/* Command Center */
.command-center { display: flex; flex-direction: column; gap: 24px; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  text-align: center;
}
.stat-card-icon { font-size: 1.5rem; margin-bottom: 8px; }
.stat-card-value { font-size: 2rem; font-weight: 600; line-height: 1; }
.stat-card-label { font-size: 0.875rem; color: var(--muted-foreground); margin-top: 4px; }

.command-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 16px;
}
.command-section { padding: 20px; }
.command-section h2 { font-size: 1rem; font-weight: 600; margin: 0 0 16px 0; }

.command-task-row, .command-message-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.command-task-row:last-child, .command-message-row:last-child { border-bottom: none; }
.command-task-title, .command-message-text {
  flex: 1;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text-muted { color: var(--muted-foreground); font-size: 0.875rem; }
```

**Step 4: Build and verify**

Run:
```bash
cd packages/dashboard && pnpm build
```
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/dashboard/
git commit -m "feat(E10): command center page + chat moved to /chat"
```

---

## Block B — Streaming Chat

### Task 5: Agent loop streaming + SSE endpoint

**Files:**
- Create: `packages/agent/src/agent-loop-stream.ts`
- Modify: `packages/agent/src/server.ts` (add `/api/chat/stream` SSE route)
- Test: `packages/agent/src/tests/server.test.ts`

**Step 1: Create the streaming agent loop**

Create `packages/agent/src/agent-loop-stream.ts`:

```typescript
/**
 * agent-loop-stream.ts — Streaming version of the agentic loop.
 *
 * Uses Anthropic's .stream() API to yield text deltas and tool events.
 * The caller (SSE endpoint) can flush each event to the client immediately.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { findTool, tools as legacyTools } from './tools/index.ts';
import { getAllSubAgents, findSubAgent, buildCapabilitiesPrompt } from './subagents/registry.ts';
import { loadMemoryContext, buildMemoryPrompt, saveMessage, countMessages } from './memory/sqlite.ts';
import { extractAndSaveFacts } from './memory/fact-extractor.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SUBAGENT_SEP = '__';

const BASE_SYSTEM_PROMPT = `Tu es Makilab, un agent personnel semi-autonome.
Tu aides ton utilisateur avec ses tâches quotidiennes : emails, recherche, notes, bookmarks, etc.
Tu réponds toujours en français sauf si on te parle dans une autre langue.
Tu es concis, précis et proactif.

Principes fondamentaux :
- Tu ne fais que ce qui t'est explicitement autorisé (whitelist)
- Tu demandes confirmation avant les actions importantes
- Tu logs tout ce que tu fais (transparence totale)
- En cas de doute, tu t'arrêtes et tu demandes
- Tu ne contournes jamais une permission refusée`;

function buildToolList(): Anthropic.Tool[] {
  const anthropicTools: Anthropic.Tool[] = [];
  for (const sa of getAllSubAgents()) {
    for (const action of sa.actions) {
      anthropicTools.push({
        name: `${sa.name}${SUBAGENT_SEP}${action.name}`,
        description: `[${sa.name}] ${action.description}`,
        input_schema: action.inputSchema,
      });
    }
  }
  for (const t of legacyTools) {
    if (t.name === 'get_time') continue;
    anthropicTools.push({ name: t.name, description: t.description, input_schema: t.input_schema });
  }
  return anthropicTools;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; success: boolean }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string };

/**
 * Streaming agentic loop — yields events as they happen.
 */
export async function* runAgentLoopStreaming(
  userMessage: string,
  context: AgentContext,
): AsyncGenerator<StreamEvent> {
  const channel = context.channel ?? 'cli';

  const memCtx = loadMemoryContext(channel);
  const memorySection = buildMemoryPrompt(memCtx);
  const capabilitiesSection = buildCapabilitiesPrompt();

  const systemParts = [BASE_SYSTEM_PROMPT];
  if (memorySection) systemParts.push(memorySection);
  if (capabilitiesSection) systemParts.push(capabilitiesSection);
  const systemPrompt = systemParts.join('\n\n');

  const sqliteHistory = memCtx.recentMessages;
  const historyToUse = sqliteHistory.length > 0 ? sqliteHistory : (context.history ?? []);

  const messages: Anthropic.MessageParam[] = [
    ...historyToUse.map((h) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const anthropicTools = buildToolList();
  let iterations = 0;
  let fullText = '';

  while (iterations < config.agentMaxIterations) {
    iterations++;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    let currentToolName = '';
    const contentBlocks: Anthropic.ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolName = event.content_block.name;
          yield { type: 'tool_start', name: currentToolName };
        }
        contentBlocks.push(event.content_block as Anthropic.ContentBlock);
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          yield { type: 'text', content: event.delta.text };
        }
      }
    }

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason === 'end_turn') {
      break;
    }

    if (finalMessage.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: finalMessage.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use') continue;

        let resultContent: string;

        if (block.name.includes(SUBAGENT_SEP)) {
          const [subagentName, ...actionParts] = block.name.split(SUBAGENT_SEP);
          const actionName = actionParts.join(SUBAGENT_SEP);
          const subagent = findSubAgent(subagentName ?? '');

          if (!subagent) {
            resultContent = `Erreur : subagent "${subagentName}" introuvable`;
          } else {
            logger.info({ subagent: subagentName, action: actionName }, 'Subagent call (stream)');
            const result = await subagent.execute(actionName ?? '', block.input as Record<string, unknown>);
            resultContent = result.text;
            if (!result.success && result.error) resultContent += `\nErreur: ${result.error}`;
            yield { type: 'tool_end', name: block.name, success: result.success };
          }
        } else {
          const tool = findTool(block.name);
          if (!tool) {
            resultContent = `Erreur : outil "${block.name}" introuvable`;
          } else {
            try {
              resultContent = await tool.execute(block.input as Record<string, unknown>);
              yield { type: 'tool_end', name: block.name, success: true };
            } catch (err) {
              resultContent = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
              yield { type: 'tool_end', name: block.name, success: false };
            }
          }
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  if (!fullText) {
    fullText = `Désolé, j'ai atteint la limite d'itérations (${config.agentMaxIterations}).`;
  }

  // Persist
  saveMessage(channel, 'user', userMessage);
  saveMessage(channel, 'assistant', fullText);
  extractAndSaveFacts(userMessage, fullText, channel).catch(() => {});

  yield { type: 'done', fullText };
}
```

**Step 2: Add SSE endpoint to server**

In `packages/agent/src/server.ts`, add the import and route:

```typescript
// Add to imports
import { runAgentLoopStreaming } from './agent-loop-stream.ts';

// POST /api/chat/stream — SSE streaming
app.post<{ Body: { message: string; channel?: string } }>(
  '/api/chat/stream',
  async (req, reply) => {
    const { message, channel = 'mission_control' } = req.body;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      const stream = runAgentLoopStreaming(message, {
        channel: channel as 'mission_control',
        from: 'mission_control',
        history: [],
      });

      for await (const event of stream) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) })}\n\n`);
    }

    reply.raw.end();
  },
);
```

**Step 3: Write test**

Add to `packages/agent/src/tests/server.test.ts`:

```typescript
it('POST /api/chat/stream returns SSE content-type', async () => {
  // We can't test the full stream without an API key, but we can test the route exists
  const res = await app.inject({
    method: 'POST',
    url: '/api/chat/stream',
    payload: { message: 'test' },
  });
  // Will fail with API error but route should exist (not 404)
  expect(res.statusCode).not.toBe(404);
});
```

**Step 4: Run tests**

Run: `pnpm --filter @makilab/agent test`
Expected: Tests pass (route exists, may return error without API key but not 404).

**Step 5: Commit**

```bash
git add packages/agent/src/agent-loop-stream.ts packages/agent/src/server.ts packages/agent/src/tests/server.test.ts
git commit -m "feat(E10): streaming agent loop + SSE endpoint POST /api/chat/stream"
```

---

### Task 6: Dashboard — Streaming chat + markdown

**Files:**
- Modify: `packages/dashboard/app/chat/page.tsx` (SSE reader)
- Modify: `packages/dashboard/app/lib/api.ts` (add `sendMessageStream`)
- Modify: `packages/dashboard/app/globals.css` (markdown styles in chat)

**Dependencies:**
```bash
cd packages/dashboard && pnpm add react-markdown
```

**Step 1: Add streaming API helper**

In `packages/dashboard/app/lib/api.ts`, add:

```typescript
/** Stream a chat response via SSE — yields parsed events */
export async function* sendMessageStream(
  message: string,
  channel = 'mission_control',
): AsyncGenerator<{ type: string; content?: string; name?: string; fullText?: string; message?: string; success?: boolean }> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch { /* skip malformed */ }
      }
    }
  }
}
```

**Step 2: Update chat page to use streaming**

Rewrite `packages/dashboard/app/chat/page.tsx` to:
- Use `sendMessageStream` instead of `sendMessage`
- Build assistant bubble content incrementally
- Show tool usage indicators
- Use `react-markdown` for rendering

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchMessages, sendMessageStream } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchMessages('mission_control', 50).then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatus]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    setToolStatus('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    // Add empty assistant bubble
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      let fullContent = '';
      for await (const event of sendMessageStream(text)) {
        if (event.type === 'text') {
          fullContent += event.content ?? '';
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: fullContent };
            return updated;
          });
        } else if (event.type === 'tool_start') {
          setToolStatus(`Utilisation de ${event.name?.replace('__', ' → ')}...`);
        } else if (event.type === 'tool_end') {
          setToolStatus('');
        } else if (event.type === 'error') {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: `Erreur: ${event.message}` };
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: `Erreur de connexion` };
        return updated;
      });
    }

    setLoading(false);
    setToolStatus('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>Chat</h1>
        <span className="badge badge-muted">mission_control</span>
      </div>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.role === 'assistant' ? (
              <ReactMarkdown>{m.content || '...'}</ReactMarkdown>
            ) : (
              m.content
            )}
          </div>
        ))}
        {toolStatus && (
          <div className="chat-tool-status">
            <span className="chat-tool-spinner" />
            {toolStatus}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="textarea chat-textarea"
          placeholder="Envoyer un message..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Add markdown + tool status CSS**

Append to `packages/dashboard/app/globals.css`:

```css
/* Chat markdown */
.chat-bubble.assistant p { margin: 0.5em 0; }
.chat-bubble.assistant p:first-child { margin-top: 0; }
.chat-bubble.assistant p:last-child { margin-bottom: 0; }
.chat-bubble.assistant pre {
  background: var(--muted);
  border-radius: var(--radius);
  padding: 12px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  margin: 0.5em 0;
}
.chat-bubble.assistant code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  background: var(--muted);
  padding: 2px 4px;
  border-radius: 3px;
}
.chat-bubble.assistant pre code { background: none; padding: 0; }
.chat-bubble.assistant a { color: var(--primary); text-decoration: underline; }
.chat-bubble.assistant ul, .chat-bubble.assistant ol { margin: 0.5em 0; padding-left: 1.5em; }
.chat-bubble.assistant li { margin: 0.25em 0; }
.chat-bubble.assistant strong { font-weight: 600; }

/* Chat textarea auto-resize */
.chat-textarea { resize: none; overflow-y: hidden; min-height: 42px; }

/* Tool status */
.chat-tool-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  font-style: italic;
}
.chat-tool-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

**Step 4: Build and verify**

Run:
```bash
cd packages/dashboard && pnpm build
```
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/dashboard/ packages/agent/src/
git commit -m "feat(E10): streaming chat with SSE + markdown rendering"
```

---

## Block C — Home Assistant SubAgent

### Task 7: Home Assistant subagent

**Files:**
- Create: `packages/agent/src/subagents/homeassistant.ts`
- Modify: `packages/agent/src/subagents/registry.ts` (register)
- Modify: `packages/shared/src/index.ts` (add `'homeassistant'` to SubAgentName)
- Modify: `packages/agent/src/config.ts` (add HA env vars)
- Test: `packages/agent/src/tests/hardening.test.ts` (update subagent count)

**Dependencies:**
```bash
cd packages/agent && pnpm add @modelcontextprotocol/sdk
```

**Step 1: Add config vars**

In `packages/agent/src/config.ts`, add to the config object:

```typescript
  // Home Assistant
  haUrl: optional('HA_URL', ''),
  haAccessToken: optional('HA_ACCESS_TOKEN', ''),
```

In `validateConfig()`, add optional warning:

```typescript
if (!process.env['HA_URL']) optionalWarnings.push('HA_URL (home assistant disabled)');
```

**Step 2: Add to SubAgentName**

In `packages/shared/src/index.ts`, add `'homeassistant'` to the union:

```typescript
export type SubAgentName =
  | 'time'
  | 'obsidian'
  | 'gmail'
  | 'web'
  | 'karakeep'
  | 'capture'
  | 'tasks'
  | 'homeassistant'
  | 'code'
  | 'indeed'
  | 'notebooklm'
  | 'calendar'
  | 'drive';
```

**Step 3: Create the subagent**

Create `packages/agent/src/subagents/homeassistant.ts`:

```typescript
/**
 * homeassistant.ts — SubAgent: Home Assistant
 *
 * Connects to Home Assistant's MCP server (Streamable HTTP) to control
 * smart home devices. Exposes entities that the HA admin has made available
 * through the Assist pipeline.
 *
 * Auth: Long-lived access token (HA_ACCESS_TOKEN)
 * Transport: Streamable HTTP at HA_URL/api/mcp
 *
 * Actions:
 *   - list_entities : list available entities
 *   - get_state     : get current state of an entity
 *   - call_service  : call a HA service (turn_on, turn_off, etc.)
 *   - assist        : send natural language command to Assist pipeline
 */

import { config } from '../config.ts';
import { logger } from '../logger.ts';
import type { SubAgent, SubAgentResult } from './types.ts';

const HA_MCP_URL = config.haUrl ? `${config.haUrl}/api/mcp` : '';

async function haFetch(endpoint: string, method = 'GET', body?: unknown): Promise<Response> {
  const url = `${config.haUrl}${endpoint}`;
  return fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${config.haAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const homeassistantSubAgent: SubAgent = {
  name: 'homeassistant',
  description:
    'Contrôle la maison connectée via Home Assistant. ' +
    'Peut lister les entités, lire leur état, et exécuter des services (allumer/éteindre lumières, etc.).',

  actions: [
    {
      name: 'list_entities',
      description: 'Liste les entités disponibles dans Home Assistant',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Filtrer par domaine (light, switch, sensor, climate...). Vide = tous.' },
        },
        required: [],
      },
    },
    {
      name: 'get_state',
      description: "Récupère l'état actuel d'une entité (lumière, capteur, thermostat...)",
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: "ID de l'entité (ex: light.salon, sensor.temperature_bureau)" },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'call_service',
      description: 'Appelle un service Home Assistant (turn_on, turn_off, toggle, set_temperature...)',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Domaine du service (light, switch, climate, scene...)' },
          service: { type: 'string', description: 'Nom du service (turn_on, turn_off, toggle...)' },
          entity_id: { type: 'string', description: "ID de l'entité cible" },
          data: { type: 'object', description: 'Données additionnelles (brightness, temperature...)', properties: {}, required: [] },
        },
        required: ['domain', 'service', 'entity_id'],
      },
    },
    {
      name: 'assist',
      description: 'Envoie une commande en langage naturel au pipeline Assist de Home Assistant',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Commande en langage naturel (ex: "allume la lumière du salon")' },
        },
        required: ['text'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    if (!config.haUrl || !config.haAccessToken) {
      return { success: false, text: 'Home Assistant non configuré (HA_URL / HA_ACCESS_TOKEN manquant)', error: 'Missing config' };
    }

    try {
      if (action === 'list_entities') {
        return await listEntities(input['domain'] as string | undefined);
      }
      if (action === 'get_state') {
        return await getState(input['entity_id'] as string);
      }
      if (action === 'call_service') {
        return await callService(
          input['domain'] as string,
          input['service'] as string,
          input['entity_id'] as string,
          input['data'] as Record<string, unknown> | undefined,
        );
      }
      if (action === 'assist') {
        return await sendAssist(input['text'] as string);
      }
      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return { success: false, text: 'Erreur Home Assistant', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

async function listEntities(domain?: string): Promise<SubAgentResult> {
  const r = await haFetch('/api/states');
  if (!r.ok) throw new Error(`HA API ${r.status}`);
  let entities = await r.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string } }>;

  if (domain) {
    entities = entities.filter(e => e.entity_id.startsWith(`${domain}.`));
  }

  const list = entities.slice(0, 50).map(e =>
    `- **${e.entity_id}** (${e.attributes.friendly_name ?? ''}): ${e.state}`
  ).join('\n');

  return {
    success: true,
    text: `${entities.length} entité(s)${domain ? ` (domaine: ${domain})` : ''}:\n\n${list}`,
    data: entities.slice(0, 50).map(e => ({ entity_id: e.entity_id, state: e.state, name: e.attributes.friendly_name })),
  };
}

async function getState(entityId: string): Promise<SubAgentResult> {
  const r = await haFetch(`/api/states/${entityId}`);
  if (r.status === 404) return { success: false, text: `Entité non trouvée: ${entityId}`, error: 'Not found' };
  if (!r.ok) throw new Error(`HA API ${r.status}`);
  const entity = await r.json() as { entity_id: string; state: string; attributes: Record<string, unknown> };

  const attrs = Object.entries(entity.attributes)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  return {
    success: true,
    text: `**${entityId}**: ${entity.state}\n\nAttributs:\n${attrs}`,
    data: entity,
  };
}

async function callService(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<SubAgentResult> {
  logger.info({ domain, service, entityId }, 'HA: calling service');
  const payload = { entity_id: entityId, ...(data ?? {}) };
  const r = await haFetch(`/api/services/${domain}/${service}`, 'POST', payload);
  if (!r.ok) throw new Error(`HA service ${r.status}: ${await r.text()}`);
  return {
    success: true,
    text: `Service ${domain}.${service} exécuté sur ${entityId}`,
    data: { domain, service, entityId },
  };
}

async function sendAssist(text: string): Promise<SubAgentResult> {
  logger.info({ text }, 'HA: assist command');
  const r = await haFetch('/api/conversation/process', 'POST', { text, language: 'fr' });
  if (!r.ok) throw new Error(`HA Assist ${r.status}`);
  const result = await r.json() as { response: { speech: { plain: { speech: string } } } };
  const speech = result.response?.speech?.plain?.speech ?? 'Pas de réponse';
  return {
    success: true,
    text: `Assist: ${speech}`,
    data: result,
  };
}
```

**Step 4: Register the subagent**

In `packages/agent/src/subagents/registry.ts`, add:

```typescript
import { homeassistantSubAgent } from './homeassistant.ts';
```

Add to the SUBAGENTS array (conditionally, only if configured):

```typescript
const SUBAGENTS: SubAgent[] = [
  getTimeSubAgent,
  webSubAgent,
  karakeepSubAgent,
  obsidianSubAgent,
  gmailSubAgent,
  captureSubAgent,
  tasksSubAgent,
  ...(config.haUrl ? [homeassistantSubAgent] : []),
];
```

Note: You'll need to import config:
```typescript
import { config } from '../config.ts';
```

**Step 5: Update hardening test**

In `packages/agent/src/tests/hardening.test.ts`, find the test that checks subagent count and update the expected number. Since HA is conditional (env var not set in tests), the count stays at 7.

**Step 6: Run tests**

Run: `pnpm --filter @makilab/agent test`
Expected: All tests PASS (subagent count unchanged because HA_URL not set in test env)

**Step 7: Commit**

```bash
git add packages/agent/src/subagents/homeassistant.ts packages/agent/src/subagents/registry.ts packages/agent/src/config.ts packages/shared/src/index.ts
git commit -m "feat(E10): Home Assistant subagent — list, state, service, assist"
```

---

### Task 8: Final — update PROGRESS.md, build, push

**Step 1: Run all tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: All tests PASS.

**Step 2: Build dashboard**

```bash
cd packages/dashboard && pnpm build
```
Expected: Build succeeds.

**Step 3: Update PROGRESS.md**

Update E10 status to ✅, add stories, update dernière session and handoff prompt.

**Step 4: Commit and push**

```bash
git add PROGRESS.md
git commit -m "chore: PROGRESS.md — E10 Mission Control v2 terminé ✅"
git push
```
