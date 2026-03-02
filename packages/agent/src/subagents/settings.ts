import { setRouteForTaskType, getRouteForTaskType, getLlmModels } from '../memory/sqlite.ts';
import type { SubAgent, SubAgentResult } from './types.ts';

export const settingsSubAgent: SubAgent = {
  name: 'settings',
  description: 'Gestion des paramètres de l\'agent : modèle LLM utilisé pour les conversations',
  actions: [
    {
      name: 'get_model',
      description: 'Retourne le modèle LLM actuellement configuré pour les conversations',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'set_model',
      description: 'Change le modèle LLM pour les conversations. Utiliser settings__list_models pour connaître les IDs valides.',
      inputSchema: {
        type: 'object',
        properties: {
          model_id: { type: 'string', description: 'ID du modèle (ex: claude-sonnet-4-6, google/gemini-3-flash-preview)' },
        },
        required: ['model_id'],
      },
    },
    {
      name: 'list_models',
      description: 'Liste les modèles LLM disponibles pour les conversations (ceux qui supportent les outils)',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    if (action === 'get_model') {
      const modelId = getRouteForTaskType('conversation') ?? 'claude-sonnet-4-6 (défaut)';
      return { success: true, text: `Modèle actuel pour les conversations : **${modelId}**` };
    }

    if (action === 'set_model') {
      const modelId = input['model_id'] as string;
      if (!modelId) {
        return { success: false, text: 'Paramètre model_id manquant.', error: 'missing_model_id' };
      }

      const models = getLlmModels({ tools: true }).filter(m => m.modality.includes('text'));
      const known = models.find(m => m.id === modelId);
      if (!known) {
        return {
          success: false,
          text: `Modèle inconnu : "${modelId}". Utilise settings__list_models pour voir les modèles disponibles.`,
          error: 'unknown_model',
        };
      }

      setRouteForTaskType('conversation', modelId);
      return {
        success: true,
        text: `✓ Modèle mis à jour : **${known.name}** (${known.provider_slug}). Les prochains messages utiliseront ce modèle.`,
      };
    }

    if (action === 'list_models') {
      const models = getLlmModels({ tools: true })
        .filter(m => m.modality.includes('text'))
        .slice(0, 15);

      if (models.length === 0) {
        return { success: true, text: 'Aucun modèle disponible dans le catalogue. Lance une synchronisation depuis /models.' };
      }

      const lines = models.map(m => `• **${m.id}** — ${m.name} (${m.provider_slug})`).join('\n');
      return { success: true, text: `Modèles disponibles (${models.length}) :\n${lines}` };
    }

    return { success: false, text: `Action inconnue : ${action}`, error: 'unknown_action' };
  },
};
