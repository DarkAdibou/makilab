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
import { findTool } from './tools/index.ts';
import { getAllSubAgents, findSubAgent, buildCapabilitiesPrompt } from './subagents/registry.ts';
import { getRelevantSkills, buildSkillsIndexPrompt, buildSkillsBodyPrompt } from './skills/loader.ts';
import {
  loadMemoryContext,
  buildMemoryPrompt,
  saveMessage,
  countMessages,
  getOldestMessages,
  deleteMessagesUpTo,
  saveSummary,
  getAgentPrompt,
  checkPermission,
} from './memory/sqlite.ts';
import { extractAndSaveFacts } from './memory/fact-extractor.ts';
import { autoRetrieve, buildRetrievalPrompt } from './memory/retriever.ts';
import { indexConversation, indexSummary } from './memory/semantic-indexer.ts';
import { getMcpTools, isMcpTool, callMcpTool } from './mcp/bridge.ts';
import { createLlmClient, type TaskType } from './llm/client.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const llm = createLlmClient();

const CONFIRM_WORDS = new Set(['oui', 'yes', 'ok', 'confirme', 'go', 'yep', 'ouais', 'affirmatif', 'proceed']);

/**
 * Détecte si le dernier message utilisateur (avec du texte) est une confirmation.
 * Ignore les messages composés uniquement de tool_results.
 */
export function wasJustConfirmed(messages: Anthropic.MessageParam[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    // Extraire le texte du message (content peut être string ou array)
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter(b => b.type === 'text');
      if (textBlocks.length === 0) continue; // uniquement des tool_results — ignorer
      text = textBlocks.map(b => ('text' in b ? b.text : '')).join(' ');
    }
    const normalized = text.trim().toLowerCase().replace(/[!.?]+$/, '');
    return CONFIRM_WORDS.has(normalized);
  }
  return false;
}

const COMPACTION_THRESHOLD = 30;
const COMPACT_KEEP_RECENT = 20;

/**
 * Separator used in tool names to identify subagent calls.
 * Format: "subagent__action" (double underscore to avoid conflicts)
 */
const SUBAGENT_SEP = '__';

/** Load agent prompt from DB (editable via Mission Control) */
function getBaseSystemPrompt(): string {
  return getAgentPrompt();
}

/** Build the full tool list: subagent actions + MCP tools */
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
 * @returns The agent's final text response and accumulated cost
 */
export async function runAgentLoop(
  userMessage: string,
  context: AgentContext,
): Promise<{ reply: string; costUsd: number }> {
  const channel = context.channel ?? 'cli';

  // ── Memory context ────────────────────────────────────────────────────────
  const memCtx = loadMemoryContext(channel);
  const memorySection = buildMemoryPrompt(memCtx);
  const capabilitiesSection = buildCapabilitiesPrompt();

  // E16: Auto-retrieve relevant memories + Obsidian context
  const retrieval = await autoRetrieve(userMessage, channel);
  const retrievalSection = buildRetrievalPrompt(retrieval);

  const cronSection = context.from === 'cron'
    ? '## Mode tâche automatique\nTu exécutes une tâche planifiée. Agis directement sans commenter tes intentions. Pas de "Bien sûr", "Je vais", "Je m\'apprête à" — exécute et rapporte le résultat uniquement.'
    : '';

  // Build system prompt as blocks for prompt caching:
  // - Stable block (base prompt + capabilities) → cache_control: ephemeral
  // - Dynamic block (cron + memory + retrieval) → no cache
  const skillsIndex = buildSkillsIndexPrompt();
  const relevantSkills = getRelevantSkills(userMessage);
  const skillsBody = buildSkillsBodyPrompt(relevantSkills);

  const stableText = [getBaseSystemPrompt(), capabilitiesSection, skillsIndex].filter(Boolean).join('\n\n');
  const dynamicText = [cronSection, memorySection, retrievalSection, skillsBody].filter(Boolean).join('\n\n');
  const systemBlocks = [
    ...(stableText ? [{ type: 'text' as const, text: stableText, cache_control: { type: 'ephemeral' as const } }] : []),
    ...(dynamicText ? [{ type: 'text' as const, text: dynamicText }] : []),
  ];

  // Use SQLite history (T1), fall back to context.history if empty (first run)
  const sqliteHistory = memCtx.recentMessages;
  const historyToUse = sqliteHistory.length > 0 ? sqliteHistory : (context.history ?? []);

  const messages: Anthropic.MessageParam[] = [
    ...historyToUse.map((h) => {
      const ch = (h as { channel?: string }).channel;
      return {
        role: h.role as 'user' | 'assistant',
        content: ch && ch !== 'mission_control'
          ? `[${ch.charAt(0).toUpperCase() + ch.slice(1)}] ${h.content}`
          : h.content,
      };
    }),
    { role: 'user', content: userMessage },
  ];

  const anthropicTools = buildToolList();
  let iterations = 0;
  let finalReply = '';
  let totalCostUsd = 0;

  // ── Agentic loop ──────────────────────────────────────────────────────────
  while (iterations < config.agentMaxIterations) {
    iterations++;

    const response = await llm.chat({
      taskType: ((context.taskType ?? 'conversation') as TaskType),
      messages,
      systemBlocks,
      tools: anthropicTools,
      model: context.model,
      channel,
    });
    totalCostUsd += response.usage.costUsd;

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
            const permission = checkPermission(subagentName ?? '', actionName ?? '');
            if (permission === 'denied') {
              resultContent = `Action refusée : ${block.name} n'est pas autorisée.`;
            } else if (permission === 'confirm_required' && !wasJustConfirmed(messages)) {
              resultContent = `⚠️ CONFIRMATION REQUISE — L'action ${block.name} (${JSON.stringify(block.input)}) nécessite ta confirmation. Réponds "oui" pour confirmer ou "non" pour annuler.`;
            } else {
              // 'allowed' OU confirmé → exécuter normalement
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

  return { reply: finalReply, costUsd: totalCostUsd };
}
