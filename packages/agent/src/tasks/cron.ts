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
import type { ScheduledTask } from 'node-cron';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { runAgentLoop } from '../agent-loop.ts';
import { createTask, listRecurringTasks, logTaskExecution } from '../memory/sqlite.ts';
import { runWorkflow } from './runner.ts';
import type { WorkflowStep } from './runner.ts';
import type { Channel } from '@makilab/shared';

const dynamicJobs = new Map<string, ScheduledTask>();

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

  // Dynamic recurring tasks from database
  syncRecurringTasks();

  logger.info({}, 'CRON scheduler started');
}

/** Load recurring tasks from DB and schedule them */
export function syncRecurringTasks(): void {
  for (const [id, job] of dynamicJobs) {
    job.stop();
    dynamicJobs.delete(id);
  }

  const tasks = listRecurringTasks();
  for (const task of tasks) {
    if (!task.cron_expression || !task.cron_prompt) continue;

    try {
      const job = cron.schedule(task.cron_expression, async () => {
        logger.info({ taskId: task.id, title: task.title }, 'Running recurring task');
        const start = Date.now();
        try {
          const reply = await runAgentLoop(task.cron_prompt!, {
            channel: (task.channel as Channel) ?? 'cli',
            from: 'cron',
            history: [],
            model: task.model ?? undefined,
          });
          const summary = reply.length > 500 ? reply.slice(0, 500) + '…' : reply;
          logTaskExecution({
            taskId: task.id,
            status: 'success',
            durationMs: Date.now() - start,
            resultSummary: summary,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ taskId: task.id, err: message }, 'Recurring task failed');
          logTaskExecution({
            taskId: task.id,
            status: 'error',
            durationMs: Date.now() - start,
            errorMessage: message,
          });
        }
      });

      dynamicJobs.set(task.id, job);
      logger.info({ taskId: task.id, cron: task.cron_expression, title: task.title }, 'Scheduled recurring task');
    } catch (err) {
      logger.warn({ taskId: task.id, cron: task.cron_expression, err: err instanceof Error ? err.message : String(err) }, 'Invalid cron expression — skipping');
    }
  }

  logger.info({ count: dynamicJobs.size }, 'Dynamic CRON jobs synced');
}

/** Execute a recurring task immediately (manual trigger) */
export async function executeRecurringTask(task: { id: string; cron_prompt: string | null; channel: string; model?: string | null }): Promise<{ success: boolean; durationMs: number; result?: string; error?: string }> {
  if (!task.cron_prompt) {
    return { success: false, durationMs: 0, error: 'No cron_prompt defined' };
  }

  const start = Date.now();
  try {
    const reply = await runAgentLoop(task.cron_prompt, {
      channel: (task.channel as Channel) ?? 'cli',
      from: 'cron',
      history: [],
      model: task.model ?? undefined,
    });
    const durationMs = Date.now() - start;
    const summary = reply.length > 500 ? reply.slice(0, 500) + '…' : reply;
    logTaskExecution({ taskId: task.id, status: 'success', durationMs, resultSummary: summary });
    return { success: true, durationMs, result: summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    logTaskExecution({ taskId: task.id, status: 'error', durationMs, errorMessage: message });
    return { success: false, durationMs, error: message };
  }
}
