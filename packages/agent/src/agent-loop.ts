/**
 * agent-loop.ts
 *
 * Core agentic loop for Makilab Agent.
 *
 * Implements the Anthropic tool-use pattern:
 * 1. Load memory context from SQLite (facts + history + summary)
 * 2. Send user message + history to Claude with memory-enriched system prompt
 * 3. If Claude wants to use a tool → execute it, feed result back
 * 4. Repeat until Claude gives a final text response or max iterations reached
 * 5. Persist exchange to SQLite + fire-and-forget fact extraction
 * 6. Auto-compact if message count exceeds threshold
 *
 * Security:
 * - Max iterations enforced (config.agentMaxIterations) to prevent infinite loops
 * - Tool errors are caught and reported back to Claude gracefully
 * - Never leaks internal errors to the user as-is
 *
 * Extension points:
 * - Add tools in packages/agent/src/tools/index.ts
 * - Permission checks added in E3 (before tool execution)
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { findTool, tools } from './tools/index.ts';
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
import type { AgentContext } from '@makilab/shared';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * Number of messages per channel before auto-compaction triggers.
 * When exceeded, oldest messages are summarized and pruned.
 */
const COMPACTION_THRESHOLD = 30;

/**
 * How many messages to compact in one pass.
 * Keeps the most recent 20 messages, summarizes the rest.
 */
const COMPACT_KEEP_RECENT = 20;

/**
 * Base system prompt injected into every conversation.
 * Memory facts from SQLite core_memory are appended dynamically.
 */
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

/**
 * Summarize old messages and prune them from the database.
 * Called automatically when message count exceeds COMPACTION_THRESHOLD.
 * Fire-and-forget — errors are caught and logged.
 *
 * @param channel - The channel to compact
 */
async function compactHistory(channel: string): Promise<void> {
  try {
    const total = countMessages(channel);
    if (total <= COMPACTION_THRESHOLD) return;

    // How many messages to compact: keep COMPACT_KEEP_RECENT most recent
    const toCompact = total - COMPACT_KEEP_RECENT;
    const oldMessages = getOldestMessages(channel, toCompact);
    if (oldMessages.length === 0) return;

    const lastId = oldMessages[oldMessages.length - 1]!.id;

    // Build transcript for summarization
    const transcript = oldMessages
      .map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content}`)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Cheap model for background tasks
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Résume cet historique de conversation de façon concise.
Garde les informations importantes : décisions prises, faits mentionnés, tâches accomplies ou en cours.
Retourne uniquement le résumé, sans introduction.

${transcript}`,
        },
      ],
    });

    const summary =
      response.content.find((b) => b.type === 'text')?.text ?? '';

    if (summary) {
      saveSummary(channel, summary, lastId);
      deleteMessagesUpTo(channel, lastId);
      console.log(
        `🗜️  Compaction [${channel}]: ${toCompact} messages → résumé (${summary.length} chars)`,
      );
    }
  } catch (err) {
    console.error(
      '⚠️  Compaction failed (non-critical):',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Runs the agentic loop for a single user message.
 *
 * @param userMessage - The user's message text
 * @param context - Channel, sender, and optional conversation history (ignored in E2+, SQLite used instead)
 * @returns The agent's final text response
 */
export async function runAgentLoop(
  userMessage: string,
  context: AgentContext,
): Promise<string> {
  const channel = context.channel ?? 'cli';

  // ── E2-L2.2: Load memory context ──────────────────────────────────────────
  const memCtx = loadMemoryContext(channel);
  const memorySection = buildMemoryPrompt(memCtx);
  const systemPrompt = memorySection
    ? `${BASE_SYSTEM_PROMPT}\n\n${memorySection}`
    : BASE_SYSTEM_PROMPT;

  // Build message history: use SQLite history (T1) instead of in-memory history
  // Falls back to context.history if SQLite is empty (first run compatibility)
  const sqliteHistory = memCtx.recentMessages;
  const historyToUse =
    sqliteHistory.length > 0 ? sqliteHistory : (context.history ?? []);

  const messages: Anthropic.MessageParam[] = [
    ...historyToUse.map((h) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Convert our Tool interface to Anthropic's format
  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  let iterations = 0;
  let finalReply = '';

  while (iterations < config.agentMaxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    // Claude finished — capture final response
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      finalReply = textBlock?.type === 'text' ? textBlock.text : '';
      break;
    }

    // Claude wants to use tools — execute them and loop
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const tool = findTool(block.name);

        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Erreur : outil "${block.name}" introuvable dans le registre`,
            is_error: true,
          });
          continue;
        }

        try {
          // TODO (E3): Check permissions before executing
          // await permissionManager.check(tool.name, context.from);
          const result = await tool.execute(
            block.input as Record<string, unknown>,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Erreur lors de l'exécution de ${block.name}: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    break;
  }

  if (!finalReply) {
    finalReply = `Désolé, j'ai atteint la limite d'itérations (${config.agentMaxIterations}). Reformule ta demande.`;
  }

  // ── E2-L2.2: Persist exchange to SQLite ───────────────────────────────────
  saveMessage(channel, 'user', userMessage);
  saveMessage(channel, 'assistant', finalReply);

  // ── E2-L2.3: Fire-and-forget fact extraction ──────────────────────────────
  // Never awaited — errors are caught inside extractAndSaveFacts
  extractAndSaveFacts(userMessage, finalReply, channel).catch(() => {});

  // ── E2-L2.4: Auto-compaction (background) ─────────────────────────────────
  // Triggers when message count exceeds threshold
  const msgCount = countMessages(channel);
  if (msgCount > COMPACTION_THRESHOLD) {
    compactHistory(channel).catch(() => {});
  }

  return finalReply;
}
