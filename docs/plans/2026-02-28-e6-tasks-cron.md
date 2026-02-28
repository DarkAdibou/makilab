# E6 — Gestionnaire de Tâches + CRON Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Donner à Makilab la capacité de gérer des tâches agentiques multi-étapes persistées en SQLite, et d'exécuter des workflows proactifs via un scheduler CRON.

**Architecture:** Deux nouvelles tables SQLite (`tasks`, `task_steps`) étendant la DB existante (`makilab.db`). Un SubAgent `tasks` expose CRUD + exécution de workflow à l'orchestrateur. Un scheduler CRON (`node-cron`) démarre au boot et lance des workflows prédéfinis sur planning.

**Tech Stack:** node-cron (scheduling), node:sqlite (existant), types AgentTask/TaskStep déjà dans `@makilab/shared`.

---

## Contexte codebase

Fichiers clés à connaître :
- `packages/agent/src/memory/sqlite.ts` — DB SQLite singleton, pattern `getDb()`, `initSchema()` déjà en place
- `packages/shared/src/index.ts` — Types `AgentTask`, `TaskStep`, `TaskStatus` déjà définis (lignes 94-121)
- `packages/agent/src/subagents/registry.ts` — Ajouter le subagent tasks ici
- `packages/agent/src/subagents/types.ts` — Interface `SubAgent` + `JsonSchemaProperty`
- `packages/agent/src/index.ts` — Démarrer le CRON scheduler ici
- `packages/agent/src/agent-loop.ts` — `runAgentLoop()` est déjà disponible pour les CRON jobs
- `packages/agent/src/logger.ts` — Logger Pino singleton (utiliser partout)
- `packages/agent/src/config.ts` — Variables d'env (ajouter `CRON_BRIEFING_ENABLED`, `CRON_CHANNEL`)

Pattern d'un subagent existant pour référence : `packages/agent/src/subagents/get-time.ts` (le plus simple).

---

## Task 1 : Étendre le schéma SQLite — tables tasks + task_steps

**Files:**
- Modify: `packages/agent/src/memory/sqlite.ts`

Le but : ajouter les deux nouvelles tables dans `initSchema()` qui est déjà appelée au boot. Pas de migration — `CREATE TABLE IF NOT EXISTS` gère l'idempotence.

**Step 1 : Ajouter les tables dans initSchema()**

Dans `initSchema()` (ligne 47), après le bloc `summaries`, ajouter :

```typescript
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
```

**Step 2 : Ajouter les fonctions CRUD dans sqlite.ts**

Après la section `Summaries` (ligne ~184), ajouter une nouvelle section :

```typescript
// ============================================================
// Tasks (agentique multi-step)
// ============================================================

import { randomUUID } from 'node:crypto';

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
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null;
}

/** List tasks — filtered by status (optional) */
export function listTasks(filter?: { status?: string; channel?: string; limit?: number }): TaskRow[] {
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: unknown[] = [];
  if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
  if (filter?.channel) { sql += ' AND channel = ?'; params.push(filter.channel); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter?.limit ?? 20);
  return getDb().prepare(sql).all(...params) as TaskRow[];
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
  `).all(taskId) as TaskStepRow[];
}
```

Note : l'import `randomUUID` doit être ajouté en haut de `sqlite.ts` :
```typescript
import { randomUUID } from 'node:crypto';
```

**Step 3 : Vérifier TypeScript**

```bash
cd "d:/SynologyDrive/IA et agents/makilab"
pnpm --filter @makilab/agent exec tsc --noEmit
```

Expected : aucune erreur.

**Step 4 : Commit**

```bash
git add packages/agent/src/memory/sqlite.ts
git commit -m "feat(E6): tasks + task_steps tables in SQLite + CRUD functions"
```

---

## Task 2 : SubAgent `tasks` — CRUD via WhatsApp

**Files:**
- Create: `packages/agent/src/subagents/tasks.ts`
- Modify: `packages/agent/src/subagents/registry.ts`
- Modify: `packages/shared/src/index.ts` (vérifier que 'tasks' est dans SubAgentName — oui, ligne 57)

**Step 1 : Créer tasks.ts**

```typescript
/**
 * tasks.ts — SubAgent: Gestionnaire de tâches agentiques
 *
 * Permet à Claude de créer, consulter et mettre à jour des tâches
 * persistées en SQLite. Les tâches sont multi-étapes et observables
 * depuis Mission Control (E7).
 *
 * Actions:
 *   - create  : crée une nouvelle tâche
 *   - list    : liste les tâches (filtrables par statut)
 *   - get     : détails d'une tâche + ses étapes
 *   - update  : change le statut d'une tâche
 */

import type { SubAgent, SubAgentResult } from './types.ts';
import {
  createTask,
  updateTaskStatus,
  getTask,
  listTasks,
  getTaskSteps,
} from '../memory/sqlite.ts';
import { logger } from '../logger.ts';

export const tasksSubAgent: SubAgent = {
  name: 'tasks',
  description:
    'Crée et gère des tâches agentiques persistées. Utilise pour : ' +
    '"rappelle-moi de...", "crée une tâche pour...", "quelles sont mes tâches en cours ?".' +
    'Les tâches sont visibles dans Mission Control.',

  actions: [
    {
      name: 'create',
      description: 'Crée une nouvelle tâche persistée',
      inputSchema: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Titre court de la tâche' },
          priority: { type: 'string', description: 'Priorité', enum: ['low', 'medium', 'high'], default: 'medium' },
          channel:  { type: 'string', description: 'Canal origine (whatsapp, cli...)' },
          due_at:   { type: 'string', description: 'Échéance ISO 8601 (optionnel)' },
        },
        required: ['title', 'channel'],
      },
    },
    {
      name: 'list',
      description: 'Liste les tâches (toutes ou filtrées par statut)',
      inputSchema: {
        type: 'object',
        properties: {
          status:  { type: 'string', description: 'Filtre statut : pending, in_progress, done, failed (optionnel)' },
          limit:   { type: 'number', description: 'Nombre max de résultats (défaut 10)' },
        },
        required: [],
      },
    },
    {
      name: 'get',
      description: 'Détails complets d\'une tâche et ses étapes',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID de la tâche' },
        },
        required: ['id'],
      },
    },
    {
      name: 'update',
      description: 'Met à jour le statut d\'une tâche',
      inputSchema: {
        type: 'object',
        properties: {
          id:     { type: 'string', description: 'UUID de la tâche' },
          status: { type: 'string', description: 'Nouveau statut', enum: ['pending', 'in_progress', 'waiting_user', 'done', 'failed'] },
        },
        required: ['id', 'status'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      if (action === 'create') {
        const id = createTask({
          title: input['title'] as string,
          createdBy: 'user',
          channel: input['channel'] as string,
          priority: (input['priority'] as 'low' | 'medium' | 'high') ?? 'medium',
          dueAt: input['due_at'] as string | undefined,
        });
        logger.info({ taskId: id, title: input['title'] }, 'Task created');
        return {
          success: true,
          text: `Tâche créée : **${input['title'] as string}** (ID: ${id.slice(0, 8)}…)`,
          data: { id },
        };
      }

      if (action === 'list') {
        const tasks = listTasks({
          status: input['status'] as string | undefined,
          limit: (input['limit'] as number) ?? 10,
        });
        if (tasks.length === 0) {
          return { success: true, text: 'Aucune tâche trouvée.', data: [] };
        }
        const lines = tasks.map((t) =>
          `- [${t.status}] **${t.title}** (${t.priority}) — ${t.id.slice(0, 8)}…`
        );
        return {
          success: true,
          text: `${tasks.length} tâche(s) :\n${lines.join('\n')}`,
          data: tasks,
        };
      }

      if (action === 'get') {
        const task = getTask(input['id'] as string);
        if (!task) {
          return { success: false, text: `Tâche introuvable : ${input['id'] as string}`, error: 'Not found' };
        }
        const steps = getTaskSteps(task.id);
        const stepsText = steps.length > 0
          ? '\nÉtapes :\n' + steps.map((s) => `  ${s.step_order}. [${s.status}] ${s.subagent}/${s.action}`).join('\n')
          : '\nAucune étape.';
        return {
          success: true,
          text: `Tâche **${task.title}**\nStatut: ${task.status} | Priorité: ${task.priority}\nCréée: ${task.created_at}${stepsText}`,
          data: { task, steps },
        };
      }

      if (action === 'update') {
        const task = getTask(input['id'] as string);
        if (!task) {
          return { success: false, text: `Tâche introuvable : ${input['id'] as string}`, error: 'Not found' };
        }
        updateTaskStatus(input['id'] as string, input['status'] as string);
        logger.info({ taskId: input['id'], status: input['status'] }, 'Task updated');
        return {
          success: true,
          text: `Tâche **${task.title}** → statut : **${input['status'] as string}**`,
          data: { id: input['id'], status: input['status'] },
        };
      }

      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur Tasks SubAgent',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
```

**Step 2 : Enregistrer dans registry.ts**

Dans `packages/agent/src/subagents/registry.ts`, ajouter l'import et l'entrée :

```typescript
import { tasksSubAgent } from './tasks.ts';
// Dans SUBAGENTS :
  tasksSubAgent,
```

**Step 3 : Vérifier TypeScript**

```bash
pnpm --filter @makilab/agent exec tsc --noEmit
```

**Step 4 : Commit**

```bash
git add packages/agent/src/subagents/tasks.ts packages/agent/src/subagents/registry.ts
git commit -m "feat(E6): tasks subagent — create, list, get, update"
```

---

## Task 3 : Task Runner — exécution de workflows multi-steps

**Files:**
- Create: `packages/agent/src/tasks/runner.ts`

Le runner exécute les étapes d'une tâche séquentiellement, en passant l'output d'une étape comme contexte à la suivante via l'agent loop.

**Step 1 : Créer packages/agent/src/tasks/runner.ts**

```typescript
/**
 * runner.ts — Task workflow executor
 *
 * Exécute les étapes d'une AgentTask séquentiellement.
 * Chaque étape appelle directement le subagent via le registry.
 * L'output de chaque étape est persisté dans task_steps.
 *
 * Utilisé par :
 *   - Le CRON scheduler (E6)
 *   - Le SubAgent tasks (action 'run' — E6+)
 *   - Mission Control (E7)
 */

import { findSubAgent } from '../subagents/registry.ts';
import {
  getTask,
  getTaskSteps,
  updateTaskStatus,
  updateTaskStep,
  addTaskStep,
} from '../memory/sqlite.ts';
import { logger } from '../logger.ts';

export interface WorkflowStep {
  subagent: string;
  action: string;
  input: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

/**
 * Execute a predefined workflow (list of steps) for a given task.
 * Each step result is persisted. Task status updated on completion.
 *
 * @param taskId - UUID of an existing task in SQLite
 * @param steps - Ordered list of steps to execute
 * @returns Summary text of what was done
 */
export async function runWorkflow(taskId: string, steps: WorkflowStep[]): Promise<string> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  logger.info({ taskId, stepCount: steps.length, title: task.title }, 'Workflow starting');
  updateTaskStatus(taskId, 'in_progress');

  const results: string[] = [];
  let failed = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepOrder = i + 1;

    // Persist step record
    const stepId = addTaskStep({
      taskId,
      stepOrder,
      subagent: step.subagent,
      action: step.action,
      input: step.input,
      requiresConfirmation: step.requiresConfirmation,
    });

    // Skip if requires confirmation (E6: not yet implemented — log warning)
    if (step.requiresConfirmation) {
      updateTaskStep(stepId, { status: 'skipped' });
      logger.warn({ taskId, stepId, subagent: step.subagent }, 'Step skipped — requires confirmation (not yet implemented)');
      results.push(`⏭️ Étape ${stepOrder} ignorée (confirmation requise) : ${step.subagent}/${step.action}`);
      continue;
    }

    const subagent = findSubAgent(step.subagent);
    if (!subagent) {
      updateTaskStep(stepId, { status: 'failed', output: { error: 'Subagent not found' } });
      failed = true;
      results.push(`❌ Étape ${stepOrder} : subagent "${step.subagent}" introuvable`);
      break;
    }

    try {
      logger.info({ taskId, stepOrder, subagent: step.subagent, action: step.action }, 'Executing step');
      updateTaskStep(stepId, { status: 'in_progress' });

      const result = await subagent.execute(step.action, step.input);

      updateTaskStep(stepId, {
        status: result.success ? 'done' : 'failed',
        output: { text: result.text, data: result.data, error: result.error },
      });

      if (!result.success) {
        failed = true;
        results.push(`❌ Étape ${stepOrder} (${step.subagent}/${step.action}) : ${result.error ?? result.text}`);
        break;
      }

      results.push(`✅ Étape ${stepOrder} (${step.subagent}/${step.action}) : ${result.text.substring(0, 100)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateTaskStep(stepId, { status: 'failed', output: { error: msg } });
      failed = true;
      results.push(`❌ Étape ${stepOrder} erreur : ${msg}`);
      break;
    }
  }

  const finalStatus = failed ? 'failed' : 'done';
  updateTaskStatus(taskId, finalStatus);
  logger.info({ taskId, finalStatus }, 'Workflow complete');

  return results.join('\n');
}
```

**Step 2 : Vérifier TypeScript**

```bash
pnpm --filter @makilab/agent exec tsc --noEmit
```

**Step 3 : Commit**

```bash
git add packages/agent/src/tasks/runner.ts
git commit -m "feat(E6): task workflow runner — sequential multi-step execution"
```

---

## Task 4 : CRON Scheduler — briefing matin + résumé soir

**Files:**
- Create: `packages/agent/src/tasks/cron.ts`
- Modify: `packages/agent/src/config.ts` (ajouter 2 vars optionnelles)
- Modify: `packages/agent/src/index.ts` (démarrer le scheduler)
- Install: `node-cron` package

**Step 1 : Installer node-cron**

```bash
cd "d:/SynologyDrive/IA et agents/makilab"
pnpm --filter @makilab/agent add node-cron
pnpm --filter @makilab/agent add -D @types/node-cron
```

**Step 2 : Ajouter les vars de config dans config.ts**

Dans l'objet `config`, après `agentMaxIterations` :

```typescript
// CRON — all optional, disabled if not set
cronEnabled: optional('CRON_ENABLED', 'false') === 'true',
cronChannel: optional('CRON_CHANNEL', 'whatsapp') as 'whatsapp' | 'cli',
cronBriefingSchedule: optional('CRON_BRIEFING_SCHEDULE', '0 7 * * *'),
cronEveningSchedule: optional('CRON_EVENING_SCHEDULE', '0 19 * * *'),
```

**Step 3 : Créer packages/agent/src/tasks/cron.ts**

```typescript
/**
 * cron.ts — CRON Scheduler
 *
 * Exécute des workflows proactifs sur planning.
 * Démarre au boot si CRON_ENABLED=true.
 *
 * Jobs définis :
 *   - Briefing matin (défaut: 07:00) — heure + résumé tâches en cours
 *   - Résumé soir (défaut: 19:00) — tâches du jour
 *
 * Extension points :
 *   - E7: Jobs configurables depuis Mission Control
 *   - E8: Surveillance emails Gmail
 *   - E12: Briefing enrichi (météo, agenda, relances)
 */

import cron from 'node-cron';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { runAgentLoop } from '../agent-loop.ts';
import { createTask } from '../memory/sqlite.ts';
import { runWorkflow } from './runner.ts';
import type { WorkflowStep } from './runner.ts';

/** Start all CRON jobs. Call once at boot if CRON_ENABLED=true */
export function startCron(): void {
  if (!config.cronEnabled) {
    logger.info({}, 'CRON disabled (CRON_ENABLED not set)');
    return;
  }

  logger.info({
    briefing: config.cronBriefingSchedule,
    evening: config.cronEveningSchedule,
    channel: config.cronChannel,
  }, 'CRON scheduler starting');

  // ── Briefing matin ─────────────────────────────────────────────────────
  cron.schedule(config.cronBriefingSchedule, async () => {
    logger.info({}, 'CRON: morning briefing triggered');
    try {
      const taskId = createTask({
        title: 'Briefing matin',
        createdBy: 'cron',
        channel: config.cronChannel,
        cronId: 'morning_briefing',
      });

      const steps: WorkflowStep[] = [
        { subagent: 'time', action: 'get', input: { timezone: 'Australia/Sydney' } },
        { subagent: 'tasks', action: 'list', input: { status: 'in_progress', limit: 5 } },
      ];

      const summary = await runWorkflow(taskId, steps);

      // Send briefing via agent loop (generates a natural language summary)
      const briefingPrompt = `C'est l'heure du briefing matin. Voici ce que j'ai collecté automatiquement :\n\n${summary}\n\nFais un briefing concis et proactif.`;
      await runAgentLoop(briefingPrompt, { channel: config.cronChannel, from: 'cron', history: [] });

      logger.info({ taskId }, 'CRON: morning briefing complete');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'CRON: morning briefing failed');
    }
  });

  // ── Résumé soir ────────────────────────────────────────────────────────
  cron.schedule(config.cronEveningSchedule, async () => {
    logger.info({}, 'CRON: evening summary triggered');
    try {
      const taskId = createTask({
        title: 'Résumé soir',
        createdBy: 'cron',
        channel: config.cronChannel,
        cronId: 'evening_summary',
      });

      const steps: WorkflowStep[] = [
        { subagent: 'tasks', action: 'list', input: { status: 'done', limit: 10 } },
        { subagent: 'tasks', action: 'list', input: { status: 'pending', limit: 5 } },
      ];

      const summary = await runWorkflow(taskId, steps);

      const eveningPrompt = `C'est l'heure du résumé de fin de journée. Voici les données :\n\n${summary}\n\nFais un résumé bref et encourage pour demain.`;
      await runAgentLoop(eveningPrompt, { channel: config.cronChannel, from: 'cron', history: [] });

      logger.info({ taskId }, 'CRON: evening summary complete');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'CRON: evening summary failed');
    }
  });

  logger.info({}, 'CRON scheduler started');
}
```

**Step 4 : Démarrer le CRON dans index.ts**

Dans `packages/agent/src/index.ts`, après `validateConfig(logger)`, ajouter :

```typescript
import { startCron } from './tasks/cron.ts';
// ...
startCron();
```

**Step 5 : Vérifier TypeScript**

```bash
pnpm --filter @makilab/agent exec tsc --noEmit
```

**Step 6 : Commit**

```bash
git add packages/agent/src/tasks/cron.ts packages/agent/src/config.ts packages/agent/src/index.ts pnpm-lock.yaml packages/agent/package.json
git commit -m "feat(E6): CRON scheduler — briefing matin + résumé soir (node-cron)"
```

---

## Task 5 : Tests Vitest — tasks + runner

**Files:**
- Create: `packages/agent/src/tests/tasks.test.ts`

Tests focalisés sur les fonctions pures et la logique CRUD. Pas de mocks LLM.

**Step 1 : Créer le fichier de tests**

```typescript
/**
 * tasks.test.ts — Tests E6 : tasks CRUD + runner logic
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Test 1 : Task CRUD (SQLite in-memory) ─────────────────────────────────────
// Note : on teste les fonctions directement — la DB SQLite est initialisée
// automatiquement dans getDb(). On utilise un channel unique pour isoler les tests.

describe('Task CRUD', () => {
  // Unique channel per test run to avoid cross-test pollution
  const testChannel = `test-${Date.now()}`;

  it('createTask returns a UUID', async () => {
    const { createTask } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Test task', createdBy: 'user', channel: testChannel });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('getTask returns the created task', async () => {
    const { createTask, getTask } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Get test', createdBy: 'agent', channel: testChannel, priority: 'high' });
    const task = getTask(id);
    expect(task).not.toBeNull();
    expect(task!.title).toBe('Get test');
    expect(task!.priority).toBe('high');
    expect(task!.status).toBe('pending');
  });

  it('updateTaskStatus changes the status', async () => {
    const { createTask, getTask, updateTaskStatus } = await import('../memory/sqlite.ts');
    const id = createTask({ title: 'Status test', createdBy: 'user', channel: testChannel });
    updateTaskStatus(id, 'done');
    const task = getTask(id);
    expect(task!.status).toBe('done');
  });

  it('listTasks returns tasks for the channel', async () => {
    const { createTask, listTasks } = await import('../memory/sqlite.ts');
    const ch = `list-${Date.now()}`;
    createTask({ title: 'Task A', createdBy: 'user', channel: ch });
    createTask({ title: 'Task B', createdBy: 'cron', channel: ch });
    const tasks = listTasks({ channel: ch });
    expect(tasks.length).toBe(2);
  });

  it('listTasks filters by status', async () => {
    const { createTask, updateTaskStatus, listTasks } = await import('../memory/sqlite.ts');
    const ch = `filter-${Date.now()}`;
    const id1 = createTask({ title: 'Pending', createdBy: 'user', channel: ch });
    const id2 = createTask({ title: 'Done', createdBy: 'user', channel: ch });
    updateTaskStatus(id2, 'done');
    const pending = listTasks({ channel: ch, status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0]!.id).toBe(id1);
  });
});

// ── Test 2 : Task Steps ────────────────────────────────────────────────────────
describe('Task Steps', () => {
  it('addTaskStep returns a step ID', async () => {
    const { createTask, addTaskStep } = await import('../memory/sqlite.ts');
    const taskId = createTask({ title: 'Step test', createdBy: 'user', channel: 'test-steps' });
    const stepId = addTaskStep({ taskId, stepOrder: 1, subagent: 'time', action: 'get', input: {} });
    expect(typeof stepId).toBe('number');
    expect(stepId).toBeGreaterThan(0);
  });

  it('getTaskSteps returns steps in order', async () => {
    const { createTask, addTaskStep, getTaskSteps } = await import('../memory/sqlite.ts');
    const taskId = createTask({ title: 'Multi step', createdBy: 'user', channel: 'test-steps-2' });
    addTaskStep({ taskId, stepOrder: 2, subagent: 'obsidian', action: 'search', input: { query: 'test' } });
    addTaskStep({ taskId, stepOrder: 1, subagent: 'time', action: 'get', input: {} });
    const steps = getTaskSteps(taskId);
    expect(steps.length).toBe(2);
    expect(steps[0]!.step_order).toBe(1);
    expect(steps[1]!.step_order).toBe(2);
  });
});

// ── Test 3 : WorkflowStep structure ───────────────────────────────────────────
describe('WorkflowStep type', () => {
  it('valid step structure accepted by runner', () => {
    // Pure type check — no execution
    const step = {
      subagent: 'time',
      action: 'get',
      input: { timezone: 'Australia/Sydney' },
      requiresConfirmation: false,
    };
    expect(step.subagent).toBe('time');
    expect(step.action).toBe('get');
    expect(step.input).toHaveProperty('timezone');
  });

  it('requiresConfirmation defaults to undefined (falsy)', () => {
    const step = { subagent: 'obsidian', action: 'create', input: { path: 'test.md', content: '# test' } };
    expect(step['requiresConfirmation']).toBeUndefined();
  });
});
```

**Step 2 : Lancer les tests**

```bash
cd "d:/SynologyDrive/IA et agents/makilab"
pnpm --filter @makilab/agent test
```

Expected :
```
✓ src/tests/tasks.test.ts (9 tests)
✓ src/tests/hardening.test.ts (17 tests)
Test Files  2 passed (2)
Tests       26 passed (26)
```

**Step 3 : Commit**

```bash
git add packages/agent/src/tests/tasks.test.ts
git commit -m "test(E6): 9 tests Vitest — Task CRUD, steps, workflow structure"
```

---

## Task 6 : Smoke test complet + PROGRESS.md + push

**Step 1 : Vérifier que tout compile**

```bash
pnpm --filter @makilab/agent exec tsc --noEmit
```

**Step 2 : Lancer tous les tests**

```bash
pnpm --filter @makilab/agent test
```

Expected : 26+ tests passent.

**Step 3 : Smoke test boot**

```bash
pnpm dev:agent 2>&1 | head -15
```

Expected : logs Pino JSON + `"msg":"CRON disabled (CRON_ENABLED not set)"` (CRON désactivé par défaut) + les 2 tests heure Sydney + Obsidian search.

**Step 4 : Test manuel CRUD tasks via CLI**

Modifier temporairement `packages/agent/src/index.ts` pour ajouter un test tasks (ou taper dans la boucle interactive si disponible) :

```typescript
// Test tasks subagent
const r3 = await runAgentLoop('Crée une tâche haute priorité : préparer le plan E7 Mission Control', { channel: CHANNEL, from: 'test', history: [] });
console.log('🤖', r3);

const r4 = await runAgentLoop('Quelles sont mes tâches en cours ?', { channel: CHANNEL, from: 'test', history: [] });
console.log('🤖', r4);
```

Expected : Claude appelle `tasks__create` puis `tasks__list` et retourne une réponse en français.

**Step 5 : Mettre à jour PROGRESS.md**

Ajouter la section E6 dans PROGRESS.md :

```markdown
## E6 — Tâches + CRON

Plan détaillé : `docs/plans/2026-02-28-e6-tasks-cron.md`

| Story | Titre | Statut |
|---|---|---|
| L6.1 | SQLite tasks + task_steps tables + CRUD functions | ✅ |
| L6.2 | SubAgent Tasks (create, list, get, update) | ✅ |
| L6.3 | Task Runner — exécution workflows multi-étapes | ✅ |
| L6.4 | CRON scheduler — briefing matin + résumé soir | ✅ |
| L6.5 | 9 tests Vitest — CRUD tasks, steps, workflow | ✅ |
```

Mettre à jour le statut global : `E6 terminé — Prochaine étape : E7 Mission Control`

**Step 6 : Commit + push**

```bash
git add PROGRESS.md
git commit -m "chore: PROGRESS.md — E6 Tâches + CRON terminé ✅"
git push origin master
```

---

## Résumé des fichiers touchés

| Fichier | Action | Raison |
|---|---|---|
| `packages/agent/src/memory/sqlite.ts` | Modify | Tables tasks + task_steps + CRUD |
| `packages/agent/src/subagents/tasks.ts` | Create | SubAgent CRUD tâches |
| `packages/agent/src/subagents/registry.ts` | Modify | Enregistrer tasksSubAgent |
| `packages/agent/src/tasks/runner.ts` | Create | Exécuteur workflow séquentiel |
| `packages/agent/src/tasks/cron.ts` | Create | Scheduler CRON 2 jobs |
| `packages/agent/src/config.ts` | Modify | 4 vars CRON optionnelles |
| `packages/agent/src/index.ts` | Modify | Démarrer CRON au boot |
| `packages/agent/package.json` | Modify | Dépendance node-cron |
| `packages/agent/src/tests/tasks.test.ts` | Create | 9 tests Vitest |
| `PROGRESS.md` | Modify | Section E6 |

## Ce que E6 ne fait PAS (YAGNI)

- Pas de PostgreSQL (E15 — migration NUC)
- Pas de notifications WhatsApp depuis le CRON (le CRON génère un message via `runAgentLoop` qui est persisté en SQLite — la livraison WhatsApp est gérée par le gateway existant en E8)
- Pas de configuration CRON depuis Mission Control (E7)
- Pas de branches git par tâche (E11)
- Pas de concurrence / file d'attente de tâches (E15)
- Pas d'action `tasks__run` (le runner est appelé par le CRON, pas encore exposé à Claude)
