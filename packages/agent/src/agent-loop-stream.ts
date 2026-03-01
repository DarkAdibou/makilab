/**
 * agent-loop-stream.ts
 *
 * Streaming version of the agentic loop.
 * Uses client.messages.stream() and yields StreamEvent objects as an async generator.
 * Same tool execution logic as agent-loop.ts but streams text deltas in real-time.
 *
 * Does NOT handle compaction — the non-streaming version handles that.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { findTool, tools as legacyTools } from './tools/index.ts';
import { getAllSubAgents, findSubAgent, buildCapabilitiesPrompt } from './subagents/registry.ts';
import {
  loadMemoryContext,
  buildMemoryPrompt,
  saveMessage,
  logAgentEvent,
} from './memory/sqlite.ts';
import { extractAndSaveFacts } from './memory/fact-extractor.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

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

  for (const sa of getAllSubAgents()) {
    for (const action of sa.actions) {
      anthropicTools.push({
        name: `${sa.name}${SUBAGENT_SEP}${action.name}`,
        description: `[${sa.name}] ${action.description}`,
        input_schema: action.inputSchema,
      });
    }
  }

  for (const t of legacyTools) {
    if (t.name === 'get_time') continue;
    anthropicTools.push({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    });
  }

  return anthropicTools;
}

export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; name: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; name: string; success: boolean; result?: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string };

/**
 * Runs the agentic loop in streaming mode.
 * Yields StreamEvent objects as text arrives and tools execute.
 */
export async function* runAgentLoopStreaming(
  userMessage: string,
  context: AgentContext,
): AsyncGenerator<StreamEvent> {
  const channel = context.channel ?? 'cli';

  // ── Memory context ──────────────────────────────────────────────────────
  const memCtx = loadMemoryContext(channel);
  const memorySection = buildMemoryPrompt(memCtx);
  const capabilitiesSection = buildCapabilitiesPrompt();

  const systemParts = [BASE_SYSTEM_PROMPT];
  if (memorySection) systemParts.push(memorySection);
  if (capabilitiesSection) systemParts.push(capabilitiesSection);
  const systemPrompt = systemParts.join('\n\n');

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
  let fullText = '';

  // ── Agentic loop ────────────────────────────────────────────────────────
  try {
    while (iterations < config.agentMaxIterations) {
      iterations++;

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: anthropicTools,
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            yield { type: 'text_delta', content: event.delta.text };
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason === 'end_turn') {
        break;
      }

      if (finalMessage.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: finalMessage.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of finalMessage.content) {
          if (block.type !== 'tool_use') continue;

          const startTime = Date.now();
          let resultContent: string;
          let success = true;

          const isSubagent = block.name.includes(SUBAGENT_SEP);
          const [subagentName, ...actionParts] = isSubagent ? block.name.split(SUBAGENT_SEP) : [undefined];
          const actionName = isSubagent ? actionParts.join(SUBAGENT_SEP) : block.name;

          yield { type: 'tool_start', name: block.name, args: block.input as Record<string, unknown> };

          logAgentEvent({
            type: 'tool_call',
            channel,
            subagent: subagentName,
            action: actionName,
            input: block.input,
          });

          if (isSubagent) {
            const subagent = findSubAgent(subagentName ?? '');
            if (!subagent) {
              resultContent = `Erreur : subagent "${subagentName}" introuvable`;
              success = false;
            } else {
              logger.info({ subagent: subagentName, action: actionName }, 'Subagent call');
              const result = await subagent.execute(
                actionName ?? '',
                block.input as Record<string, unknown>,
              );
              resultContent = result.text;
              if (!result.success && result.error) {
                resultContent += `\nErreur: ${result.error}`;
                success = false;
              }
            }
          } else {
            const tool = findTool(block.name);
            if (!tool) {
              resultContent = `Erreur : outil "${block.name}" introuvable`;
              success = false;
            } else {
              try {
                resultContent = await tool.execute(block.input as Record<string, unknown>);
              } catch (err) {
                resultContent = `Erreur lors de l'exécution de ${block.name}: ${err instanceof Error ? err.message : String(err)}`;
                success = false;
              }
            }
          }

          const durationMs = Date.now() - startTime;

          logAgentEvent({
            type: 'tool_result',
            channel,
            subagent: subagentName,
            action: actionName,
            output: resultContent.slice(0, 500),
            success,
            durationMs,
          });

          yield { type: 'tool_end', name: block.name, success, result: resultContent.slice(0, 200) };

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
    return;
  }

  if (!fullText) {
    fullText = `Désolé, j'ai atteint la limite d'itérations (${config.agentMaxIterations}). Reformule ta demande.`;
  }

  // ── Persist + background tasks ──────────────────────────────────────────
  saveMessage(channel, 'user', userMessage);
  saveMessage(channel, 'assistant', fullText);

  extractAndSaveFacts(userMessage, fullText, channel).catch(() => {});

  yield { type: 'done', fullText };
}
