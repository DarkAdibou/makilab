/**
 * agent-loop.ts
 *
 * Core agentic loop for Makilab Agent.
 *
 * Architecture (E3+):
 * - Subagents are exposed as Anthropic tools — Claude picks which to call
 * - Each subagent action = one Anthropic tool (name: subagent__action)
 * - Legacy tools (get_time) co-exist during transition
 * - Memory context injected into system prompt each turn
 *
 * Flow per turn:
 * 1. Load memory context (SQLite T1: facts + history + summary)
 * 2. Build tool list from subagent registry + legacy tools
 * 3. LLM call → may trigger tool_use (subagent calls)
 * 4. Execute subagent actions, feed results back
 * 5. Repeat until end_turn or max iterations
 * 6. Persist exchange + fire-and-forget fact extraction + auto-compact
 *
 * Security:
 * - Max iterations enforced to prevent infinite loops
 * - Tool errors reported to Claude, never thrown to user
 * - Permission checks: TODO E3 (before subagent execute)
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { findTool, tools as legacyTools } from './tools/index.ts';
import { getAllSubAgents, findSubAgent, buildCapabilitiesPrompt } from './subagents/registry.ts';
import {
  loadMemoryContext,
  buildMemoryPrompt,
  saveMessage,
  countMessages,
  getOldestMessages,
  deleteMessagesUpTo,
  saveSummary,
} from './memory/sqlite.ts';
import { extractAndSaveFacts } from './memory/fact-extractor.ts';
import { autoRetrieve, buildRetrievalPrompt } from './memory/retriever.ts';
import { indexConversation, indexSummary } from './memory/semantic-indexer.ts';
import { getMcpTools, isMcpTool, callMcpTool } from './mcp/bridge.ts';
import { createLlmClient, type TaskType } from './llm/client.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const llm = createLlmClient();

const COMPACTION_THRESHOLD = 30;
const COMPACT_KEEP_RECENT = 20;

/**
 * Separator used in tool names to identify subagent calls.
 * Format: "subagent__action" (double underscore to avoid conflicts)
 */
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
- Tu ne contournes jamais une permission refusée

Tâches planifiées :
- Si l'utilisateur demande quelque chose "dans X minutes", "à 18h", "demain matin", etc. → crée une tâche ponctuelle avec tasks__create :
  - title : description courte de l'action
  - due_at : date/heure ISO 8601 UTC (calcule à partir de l'heure actuelle)
  - cron_prompt : le prompt à exécuter au moment voulu (ex: "Souhaite bonne nuit à l'utilisateur")
  - channel : le canal actuel
  - notify_channels : inclure le canal actuel si c'est whatsapp (ex: ["whatsapp"])
  - PAS de cron_expression (c'est une tâche one-shot, pas récurrente)
- Le système exécutera automatiquement la tâche quand due_at sera atteint
- La tâche sera visible dans le kanban jusqu'à son exécution

Tâches récurrentes :
- Ne crée JAMAIS de tâche récurrente (tasks__create avec cron_expression) sauf si l'utilisateur le demande EXPLICITEMENT
- Mots-clés qui justifient une tâche récurrente : "tous les jours", "chaque semaine", "récurrent"
- Une question ponctuelle ("quel est le dernier article de...") n'est PAS une tâche récurrente — réponds directement
- Avant de créer une tâche récurrente, confirme avec l'utilisateur : fréquence, prompt, horaire

Mémoire long terme :
- Si l'utilisateur fait référence à une conversation passée ou un sujet déjà discuté, utilise memory__search
- Si tu manques de contexte sur un sujet qui a potentiellement été abordé avant, utilise memory__search
- En cas de doute, demande à l'utilisateur s'il veut que tu cherches dans ta mémoire`;

/** Build the full tool list: subagent actions + legacy tools */
function buildToolList(): Anthropic.Tool[] {
  const anthropicTools: Anthropic.Tool[] = [];

  // Subagent actions as tools (name: "subagent__action")
  for (const sa of getAllSubAgents()) {
    for (const action of sa.actions) {
      anthropicTools.push({
        name: `${sa.name}${SUBAGENT_SEP}${action.name}`,
        description: `[${sa.name}] ${action.description}`,
        input_schema: action.inputSchema,
      });
    }
  }

  // Legacy tools (kept during transition, will be removed in E4)
  for (const t of legacyTools) {
    // Skip get_time — now handled by the time subagent
    if (t.name === 'get_time') continue;
    anthropicTools.push({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    });
  }

  // MCP tools (auto-discovered from connected servers)
  anthropicTools.push(...getMcpTools());

  return anthropicTools;
}

/** Auto-compact conversation history when too long (fire-and-forget) */
async function compactHistory(channel: string): Promise<void> {
  try {
    const total = countMessages(channel);
    if (total <= COMPACTION_THRESHOLD) return;

    const toCompact = total - COMPACT_KEEP_RECENT;
    const oldMessages = getOldestMessages(channel, toCompact);
    if (oldMessages.length === 0) return;

    const lastId = oldMessages[oldMessages.length - 1]!.id;
    const transcript = oldMessages
      .map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content}`)
      .join('\n');

    const response = await llm.chat({
      taskType: 'compaction',
      messages: [
        {
          role: 'user',
          content: `Résume cet historique de conversation de façon concise.
Garde les informations importantes : décisions prises, faits mentionnés, tâches accomplies ou en cours.
Retourne uniquement le résumé, sans introduction.\n\n${transcript}`,
        },
      ],
      maxTokens: 1024,
      channel,
    });

    const summary = response.content.find((b) => b.type === 'text')?.text ?? '';
    if (summary) {
      saveSummary(channel, summary, lastId);
      indexSummary(channel, summary).catch(() => {});
      deleteMessagesUpTo(channel, lastId);
      logger.info({ channel, compacted: toCompact }, 'History compacted');
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Compaction failed');
  }
}

/**
 * Runs the agentic loop for a single user message.
 *
 * @param userMessage - The user's message text
 * @param context - Channel, sender (history is loaded from SQLite in E2+)
 * @returns The agent's final text response
 */
export async function runAgentLoop(
  userMessage: string,
  context: AgentContext,
): Promise<string> {
  const channel = context.channel ?? 'cli';

  // ── Memory context ────────────────────────────────────────────────────────
  const memCtx = loadMemoryContext(channel);
  const memorySection = buildMemoryPrompt(memCtx);
  const capabilitiesSection = buildCapabilitiesPrompt();

  // E16: Auto-retrieve relevant memories + Obsidian context
  const retrieval = await autoRetrieve(userMessage, channel);
  const retrievalSection = buildRetrievalPrompt(retrieval);

  const systemPrompt = [BASE_SYSTEM_PROMPT, memorySection, retrievalSection, capabilitiesSection]
    .filter(Boolean)
    .join('\n\n');

  // Use SQLite history (T1), fall back to context.history if empty (first run)
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
  let finalReply = '';

  // ── Agentic loop ──────────────────────────────────────────────────────────
  while (iterations < config.agentMaxIterations) {
    iterations++;

    const response = await llm.chat({
      taskType: 'conversation' as TaskType,
      messages,
      system: systemPrompt,
      tools: anthropicTools,
      model: context.model,
      channel,
    });

    if (response.stopReason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      finalReply = textBlock?.type === 'text' ? textBlock.text : '';
      break;
    }

    if (response.stopReason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let resultContent: string;

        // MCP tool call (name starts with mcp_)
        if (isMcpTool(block.name)) {
          logger.info({ tool: block.name }, 'MCP tool call');
          const result = await callMcpTool(block.name, block.input as Record<string, unknown>);
          resultContent = result.text;
          if (!result.success) {
            resultContent = `Erreur: ${result.text}`;
          }
        } else if (block.name.includes(SUBAGENT_SEP)) {
          const [subagentName, ...actionParts] = block.name.split(SUBAGENT_SEP);
          const actionName = actionParts.join(SUBAGENT_SEP); // handle edge case
          const subagent = findSubAgent(subagentName ?? '');

          if (!subagent) {
            resultContent = `Erreur : subagent "${subagentName}" introuvable`;
          } else {
            // TODO (E3): Check permissions before executing
            // if (permission === 'denied') { resultContent = 'Action refusée'; }
            // if (permission === 'confirm') { /* ask user */ }
            logger.info({ subagent: subagentName, action: actionName }, 'Subagent call');
            const result = await subagent.execute(
              actionName ?? '',
              block.input as Record<string, unknown>,
            );
            resultContent = result.text;
            if (!result.success && result.error) {
              resultContent += `\nErreur: ${result.error}`;
            }
          }
        } else {
          // Legacy tool
          const tool = findTool(block.name);
          if (!tool) {
            resultContent = `Erreur : outil "${block.name}" introuvable`;
          } else {
            try {
              resultContent = await tool.execute(block.input as Record<string, unknown>);
            } catch (err) {
              resultContent = `Erreur lors de l'exécution de ${block.name}: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break; // Unexpected stop reason
  }

  if (!finalReply) {
    finalReply = `Désolé, j'ai atteint la limite d'itérations (${config.agentMaxIterations}). Reformule ta demande.`;
  }

  // ── Persist + background tasks ────────────────────────────────────────────
  saveMessage(channel, 'user', userMessage);
  saveMessage(channel, 'assistant', finalReply);

  // Collect tool result texts from the conversation
  const toolResultTexts = messages
    .filter(m => m.role === 'user' && Array.isArray(m.content))
    .flatMap(m => (m.content as Array<{ type: string; content?: string | Array<{ type: string; text?: string }> }>))
    .filter(b => b.type === 'tool_result')
    .map(b => {
      if (typeof b.content === 'string') return b.content;
      if (Array.isArray(b.content)) return b.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      return '';
    })
    .filter(Boolean);

  extractAndSaveFacts(userMessage, finalReply, channel, toolResultTexts).catch(() => {});
  indexConversation(channel, userMessage, finalReply).catch(() => {});

  const msgCount = countMessages(channel);
  if (msgCount > COMPACTION_THRESHOLD) {
    compactHistory(channel).catch(() => {});
  }

  return finalReply;
}
