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
  updateTask,
  updateTaskStatus,
  getTask,
  listTasks,
  getTaskSteps,
  listRecurringTasks,
} from '../memory/sqlite.ts';
import { syncRecurringTasks } from '../tasks/cron.ts';
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
          title:           { type: 'string', description: 'Titre court de la tâche' },
          priority:        { type: 'string', description: 'Priorité', enum: ['low', 'medium', 'high'], default: 'medium' },
          channel:         { type: 'string', description: 'Canal origine (whatsapp, cli...)' },
          due_at:          { type: 'string', description: 'Échéance ISO 8601 (optionnel)' },
          cron_expression: { type: 'string', description: 'Expression CRON pour tâches récurrentes (ex: "0 8 * * 1" = lundi 8h). Laisser vide pour une tâche ponctuelle.' },
          cron_prompt:     { type: 'string', description: 'Le prompt à exécuter automatiquement (pour tâches récurrentes OU planifiées one-shot avec due_at)' },
          notify_channels: { type: 'array', items: { type: 'string' }, description: 'Canaux supplémentaires où envoyer le résultat (ex: ["whatsapp","mission_control"])' },
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
      description: "Détails complets d'une tâche et ses étapes",
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
      description: "Met à jour le statut d'une tâche",
      inputSchema: {
        type: 'object',
        properties: {
          id:     { type: 'string', description: 'UUID de la tâche' },
          status: { type: 'string', description: 'Nouveau statut', enum: ['backlog', 'pending', 'in_progress', 'waiting_user', 'done', 'failed'] },
        },
        required: ['id', 'status'],
      },
    },
    {
      name: 'list_recurring',
      description: 'Liste toutes les tâches récurrentes (activées et désactivées)',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      if (action === 'create') {
        const cronExpr = input['cron_expression'] as string | undefined;
        const id = createTask({
          title: input['title'] as string,
          createdBy: 'user',
          channel: input['channel'] as string,
          priority: (input['priority'] as 'low' | 'medium' | 'high') ?? 'medium',
          dueAt: input['due_at'] as string | undefined,
          cronExpression: cronExpr,
          cronEnabled: !!cronExpr,
          cronPrompt: input['cron_prompt'] as string | undefined,
          notifyChannels: input['notify_channels'] as string[] | undefined,
        });
        if (cronExpr) syncRecurringTasks();
        // Auto-assign optimal model for recurring tasks
        if (input['cron_prompt']) {
          try {
            const { classifyAndAssignModel } = await import('../llm/classify-task.ts');
            const model = await classifyAndAssignModel(input['cron_prompt'] as string);
            if (model) {
              updateTask(id, { model });
            }
          } catch { /* classification is best-effort */ }
        }
        logger.info({ taskId: id, title: input['title'], recurring: !!cronExpr }, 'Task created');
        const recurringInfo = cronExpr ? ` (récurrente: ${cronExpr})` : '';
        return {
          success: true,
          text: `Tâche créée : **${input['title'] as string}**${recurringInfo} (ID: ${id.slice(0, 8)}…)`,
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

      if (action === 'list_recurring') {
        const tasks = listRecurringTasks();
        if (tasks.length === 0) {
          return { success: true, text: 'Aucune tâche récurrente configurée.' };
        }
        const formatted = tasks.map((t) => {
          const status = t.cron_enabled ? 'Activée' : 'Désactivée';
          return `- **${t.title}** — ${t.cron_expression} — ${status}\n  Prompt: ${t.cron_prompt ?? '(aucun)'}`;
        }).join('\n');
        return { success: true, text: `${tasks.length} tâche(s) récurrente(s):\n\n${formatted}`, data: tasks };
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
