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
  getAgentPrompt,
} from './memory/sqlite.ts';
import { extractAndSaveFacts } from './memory/fact-extractor.ts';
import { autoRetrieve, buildRetrievalPrompt } from './memory/retriever.ts';
import { indexConversation } from './memory/semantic-indexer.ts';
import { getMcpTools, isMcpTool, callMcpTool } from './mcp/bridge.ts';
import { createLlmClient } from './llm/client.ts';
import { logger } from './logger.ts';
import type { AgentContext } from '@makilab/shared';

const llm = createLlmClient();

const SUBAGENT_SEP = '__';

/** Load agent prompt from DB (editable via Mission Control) */
function getBaseSystemPrompt(): string {
  return getAgentPrompt();
}

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

  // MCP tools (auto-discovered from connected servers)
  anthropicTools.push(...getMcpTools());

  return anthropicTools;
}

export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; name: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; name: string; success: boolean; result?: string }
  | { type: 'cost'; costUsd: number; model?: string }
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

  // E16: Auto-retrieve relevant memories + Obsidian context
  const retrieval = await autoRetrieve(userMessage, channel);
  const retrievalSection = buildRetrievalPrompt(retrieval);

  const systemPrompt = [getBaseSystemPrompt(), memorySection, retrievalSection, capabilitiesSection]
    .filter(Boolean)
    .join('\n\n');

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
  let totalCostUsd = 0;
  let resolvedModel = '';

  // ── Agentic loop ────────────────────────────────────────────────────────
  try {
    while (iterations < config.agentMaxIterations) {
      iterations++;

      const streamResult = await llm.stream({
        taskType: 'conversation',
        messages,
        system: systemPrompt,
        tools: anthropicTools,
        model: context.model,
        channel,
      });

      for await (const event of streamResult.stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            yield { type: 'text_delta', content: event.delta.text };
          }
        }
      }

      const { message: finalMessage, usage } = await streamResult.finalMessage();
      totalCostUsd += usage.costUsd;
      if (!resolvedModel) resolvedModel = usage.model;

      // If the stream produced no text (e.g. OpenRouter providers that send tool_calls
      // without delta.content, triggering the non-streaming fallback), recover the text
      // from message.content — the asyncIterable is already closed so we yield it now.
      if (!fullText) {
        const textBlock = finalMessage.content.find(b => b.type === 'text') as { text: string } | undefined;
        if (textBlock?.text) {
          fullText = textBlock.text;
          yield { type: 'text_delta', content: textBlock.text };
        }
      }

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

          const isMcp = isMcpTool(block.name);
          const isSubagent = !isMcp && block.name.includes(SUBAGENT_SEP);

          let subagentName: string | undefined;
          let actionName: string;
          if (isSubagent) {
            const parts = block.name.split(SUBAGENT_SEP);
            subagentName = parts[0];
            actionName = parts.slice(1).join(SUBAGENT_SEP);
          } else {
            subagentName = isMcp ? 'mcp' : undefined;
            actionName = block.name;
          }

          yield { type: 'tool_start', name: block.name, args: block.input as Record<string, unknown> };

          logAgentEvent({
            type: 'tool_call',
            channel,
            subagent: subagentName,
            action: actionName,
            input: block.input,
          });

          if (isMcp) {
            logger.info({ tool: block.name }, 'MCP tool call');
            const mcpResult = await callMcpTool(block.name, block.input as Record<string, unknown>);
            resultContent = mcpResult.text;
            success = mcpResult.success;
          } else if (isSubagent) {
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

  extractAndSaveFacts(userMessage, fullText, channel, toolResultTexts).catch(() => {});
  indexConversation(channel, userMessage, fullText).catch(() => {});

  yield { type: 'cost', costUsd: totalCostUsd, model: resolvedModel };
  yield { type: 'done', fullText };
}
