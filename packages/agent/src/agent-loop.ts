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
import { indexConversation, indexSummary } from './memory/semantic-indexer.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

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
- Tu ne contournes jamais une permission refusée`;

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

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Résume cet historique de conversation de façon concise.
Garde les informations importantes : décisions prises, faits mentionnés, tâches accomplies ou en cours.
Retourne uniquement le résumé, sans introduction.\n\n${transcript}`,
        },
      ],
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

  const systemParts = [BASE_SYSTEM_PROMPT];
  if (memorySection) systemParts.push(memorySection);
  if (capabilitiesSection) systemParts.push(capabilitiesSection);
  const systemPrompt = systemParts.join('\n\n');

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

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      finalReply = textBlock?.type === 'text' ? textBlock.text : '';
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let resultContent: string;

        // Subagent call (name contains SUBAGENT_SEP)
        if (block.name.includes(SUBAGENT_SEP)) {
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

  extractAndSaveFacts(userMessage, finalReply, channel).catch(() => {});
  indexConversation(channel, userMessage, finalReply).catch(() => {});

  const msgCount = countMessages(channel);
  if (msgCount > COMPACTION_THRESHOLD) {
    compactHistory(channel).catch(() => {});
  }

  return finalReply;
}
