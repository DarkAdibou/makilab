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
