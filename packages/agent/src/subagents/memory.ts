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
import { semanticSearch, upsertKnowledge, deleteByIds, CONVERSATIONS_COLLECTION, KNOWLEDGE_COLLECTION } from '../memory/qdrant.ts';
import { getCoreMemory, deleteFact, searchMessagesFullText, clearChannelMessages, clearChannelSummaries, countMessages } from '../memory/sqlite.ts';
import { deleteConversationsByChannel } from '../memory/qdrant.ts';

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
    {
      name: 'forget',
      description:
        "Oublier un sujet — supprime les faits et souvenirs liés de toute la mémoire (SQLite + Qdrant)",
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Le sujet à oublier' },
        },
        required: ['topic'],
      },
    },
    {
      name: 'clear_history',
      description:
        "Efface l'historique de conversation d'un canal (messages + résumés + souvenirs Qdrant). " +
        "IMPORTANT : Appelle d'abord avec confirm=false pour voir ce qui sera supprimé, " +
        "puis montre le résumé à l'utilisateur et demande confirmation avant de rappeler avec confirm=true. " +
        "Les faits durables (core_memory) sont CONSERVÉS.",
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Le canal à nettoyer (ex: mission_control, whatsapp)' },
          confirm: { type: 'boolean', description: "false = dry run (prévisualisation), true = suppression effective. Toujours commencer par false.", default: false },
        },
        required: ['channel'],
      },
    },
    {
      name: 'search_text',
      description:
        "Recherche par mots-clés dans l'historique des messages (FTS5, complémentaire à search sémantique)",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Mots-clés à chercher' },
          limit: { type: 'number', description: 'Nombre max de résultats (défaut: 10)' },
        },
        required: ['query'],
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

        case 'forget': {
          const topic = input.topic as string;
          let deletedMemories = 0;
          let deletedFacts = 0;

          // 1. Semantic search Qdrant for related memories
          const vector = await embedText(topic);
          if (vector) {
            const results = await semanticSearch(vector, 20);
            const relevantResults = results.filter(r => r.score >= 0.5);

            const convIds: string[] = [];
            const knowledgeIds: string[] = [];
            for (const r of relevantResults) {
              if (r.collection === CONVERSATIONS_COLLECTION) {
                convIds.push(r.id);
              } else {
                knowledgeIds.push(r.id);
              }
            }

            await deleteByIds(CONVERSATIONS_COLLECTION, convIds);
            await deleteByIds(KNOWLEDGE_COLLECTION, knowledgeIds);
            deletedMemories = convIds.length + knowledgeIds.length;
          }

          // 2. Delete matching facts from core_memory
          const facts = getCoreMemory();
          const topicLower = topic.toLowerCase();
          for (const [key, value] of Object.entries(facts)) {
            if (key.toLowerCase().includes(topicLower) || value.toLowerCase().includes(topicLower)) {
              deleteFact(key);
              deletedFacts++;
            }
          }

          return {
            success: true,
            text: `Oublié "${topic}" : ${deletedMemories} souvenir(s) Qdrant + ${deletedFacts} fait(s) SQLite supprimés.`,
          };
        }

        case 'clear_history': {
          const channel = input.channel as string;
          const confirm = input.confirm === true;

          const msgCount = countMessages(channel);

          if (!confirm) {
            return {
              success: true,
              text: `⚠️ Dry run — voici ce qui sera supprimé pour le canal "${channel}" :\n` +
                `- ${msgCount} message(s)\n` +
                `- Résumés de compaction\n` +
                `- Souvenirs Qdrant liés à ce canal\n` +
                `- Les faits durables (core_memory) seront CONSERVÉS\n\n` +
                `Demande confirmation à l'utilisateur avant de rappeler avec confirm=true.`,
            };
          }

          const deletedMsgs = clearChannelMessages(channel);
          const deletedSummaries = clearChannelSummaries(channel);
          await deleteConversationsByChannel(channel);

          logger.info({ channel, deletedMsgs, deletedSummaries }, 'Channel history cleared');

          return {
            success: true,
            text: `Historique du canal "${channel}" effacé :\n` +
              `- ${deletedMsgs} message(s) supprimé(s)\n` +
              `- ${deletedSummaries} résumé(s) supprimé(s)\n` +
              `- Souvenirs Qdrant du canal supprimés\n` +
              `- Faits durables conservés ✓`,
          };
        }

        case 'search_text': {
          const query = input.query as string;
          const limit = (input.limit as number) ?? 10;
          const results = searchMessagesFullText(query, limit);

          if (results.length === 0) {
            return { success: true, text: `Aucun message trouvé pour "${query}"` };
          }

          const formatted = results.map(m =>
            `[${m.channel}] ${m.created_at} (${m.role}): ${m.content.slice(0, 200)}`
          ).join('\n');

          return {
            success: true,
            text: `${results.length} message(s) trouvé(s) :\n${formatted}`,
          };
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
