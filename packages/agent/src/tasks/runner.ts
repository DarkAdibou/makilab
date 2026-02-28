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

    const stepId = addTaskStep({
      taskId,
      stepOrder,
      subagent: step.subagent,
      action: step.action,
      input: step.input,
      requiresConfirmation: step.requiresConfirmation,
    });

    if (step.requiresConfirmation) {
      updateTaskStep(stepId, { status: 'skipped' });
      logger.warn({ taskId, stepId, subagent: step.subagent }, 'Step skipped — requires confirmation (not yet implemented)');
      results.push(`Étape ${stepOrder} ignorée (confirmation requise) : ${step.subagent}/${step.action}`);
      continue;
    }

    const subagent = findSubAgent(step.subagent);
    if (!subagent) {
      updateTaskStep(stepId, { status: 'failed', output: { error: 'Subagent not found' } });
      failed = true;
      results.push(`Étape ${stepOrder} : subagent "${step.subagent}" introuvable`);
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
        results.push(`Étape ${stepOrder} (${step.subagent}/${step.action}) : ${result.error ?? result.text}`);
        break;
      }

      results.push(`Étape ${stepOrder} (${step.subagent}/${step.action}) : ${result.text.substring(0, 100)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateTaskStep(stepId, { status: 'failed', output: { error: msg } });
      failed = true;
      results.push(`Étape ${stepOrder} erreur : ${msg}`);
      break;
    }
  }

  const finalStatus = failed ? 'failed' : 'done';
  updateTaskStatus(taskId, finalStatus);
  logger.info({ taskId, finalStatus }, 'Workflow complete');

  return results.join('\n');
}
