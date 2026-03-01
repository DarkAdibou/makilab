/**
 * memory.ts — SubAgent: Semantic Memory Search
 *
 * Provides semantic search over past conversations and knowledge.
 * Uses Voyage AI embeddings + Qdrant vector search.
 *
 * The agent decides when to use this — not automatic on every message.
 */

import { logger } from '../logger.ts';
import type { SubAgent, SubAgentResult } from './types.ts';
import { embedText } from '../memory/embeddings.ts';
import { semanticSearch, upsertKnowledge } from '../memory/qdrant.ts';

export const memorySubAgent: SubAgent = {
  name: 'memory',
  description:
    'Recherche sémantique dans la mémoire long terme. ' +
    'Utilise ce subagent quand l\'utilisateur fait référence à une conversation passée, ' +
    'un sujet déjà discuté, ou quand tu manques de contexte. ' +
    'Tu peux aussi demander à l\'utilisateur si tu n\'es pas sûr de devoir chercher.',

  actions: [
    {
      name: 'search',
      description:
        'Recherche sémantique dans les conversations passées et la base de connaissances. ' +
        'Retourne les résultats les plus pertinents triés par similarité.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'La requête de recherche en langage naturel',
          },
          limit: {
            type: 'number',
            description: 'Nombre maximum de résultats (défaut: 5)',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'index',
      description:
        'Indexe manuellement un texte dans la base de connaissances. Usage rare (debug, injection manuelle).',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Le texte à indexer',
          },
          type: {
            type: 'string',
            description: 'Type de contenu',
            enum: ['summary', 'fact'],
            default: 'fact',
          },
          key: {
            type: 'string',
            description: 'Clé identifiant le fait (optionnel)',
          },
        },
        required: ['content'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      switch (action) {
        case 'search': {
          const query = input.query as string;
          const limit = (input.limit as number) || 5;

          const vector = await embedText(query);
          if (!vector) {
            return { success: false, text: 'Embedding non disponible (clé API Voyage AI manquante)', error: 'no_api_key' };
          }

          const results = await semanticSearch(vector, limit);

          if (results.length === 0) {
            return { success: true, text: 'Aucun résultat pertinent trouvé dans la mémoire.' };
          }

          const formatted = results.map((r, i) => {
            const p = r.payload;
            if (p.role === 'exchange') {
              return `${i + 1}. [Score: ${r.score.toFixed(2)}] Conversation (${p.channel}, ${p.timestamp}):\n   User: ${p.user_message}\n   Agent: ${(p.assistant_message as string)?.slice(0, 200)}`;
            }
            return `${i + 1}. [Score: ${r.score.toFixed(2)}] ${p.type} (${p.timestamp}): ${(p.content as string)?.slice(0, 300)}`;
          }).join('\n\n');

          return {
            success: true,
            text: `${results.length} résultat(s) trouvé(s) :\n\n${formatted}`,
            data: results,
          };
        }

        case 'index': {
          const content = input.content as string;
          const type = (input.type as 'summary' | 'fact') || 'fact';
          const key = input.key as string | undefined;

          const vector = await embedText(content);
          if (!vector) {
            return { success: false, text: 'Embedding non disponible', error: 'no_api_key' };
          }

          await upsertKnowledge({ vector, type, content, key });
          return { success: true, text: `Contenu indexé dans la collection knowledge (type: ${type})` };
        }

        default:
          return { success: false, text: `Action inconnue: ${action}`, error: 'unknown_action' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, action }, 'Memory subagent error');
      return { success: false, text: `Erreur mémoire: ${message}`, error: message };
    }
  },
};
