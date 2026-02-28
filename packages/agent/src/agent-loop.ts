/**
 * agent-loop.ts
 * 
 * Core agentic loop for Makilab Agent.
 * 
 * Implements the Anthropic tool-use pattern:
 * 1. Send user message + history to Claude
 * 2. If Claude wants to use a tool → execute it, feed result back
 * 3. Repeat until Claude gives a final text response or max iterations reached
 * 
 * Security:
 * - Max iterations enforced (config.agentMaxIterations) to prevent infinite loops
 * - Tool errors are caught and reported back to Claude gracefully
 * - Never leaks internal errors to the user as-is
 * 
 * Extension points:
 * - Add tools in packages/agent/src/tools/index.ts
 * - Memory injection added in E2 (before the LLM call)
 * - Permission checks added in E3 (before tool execution)
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { findTool, tools } from './tools/index.ts';
import type { AgentContext } from '@makilab/shared';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * System prompt injected into every conversation.
 * Extended in E2 with memory facts from SQLite core_memory.
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
 * Runs the agentic loop for a single user message.
 * 
 * @param userMessage - The user's message text
 * @param context - Channel, sender, and conversation history
 * @returns The agent's final text response
 */
export async function runAgentLoop(
  userMessage: string,
  context: AgentContext,
): Promise<string> {
  // Build message history for this turn
  const messages: Anthropic.MessageParam[] = [
    ...context.history.map((h) => ({
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

  while (iterations < config.agentMaxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: BASE_SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    // Claude finished — return text response
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text : '';
    }

    // Claude wants to use tools — execute them and loop
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const tool = findTool(block.name);

        if (!tool) {
          // Unknown tool — report error to Claude
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
          const result = await tool.execute(block.input as Record<string, unknown>);
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

  return `Désolé, j'ai atteint la limite d'itérations (${config.agentMaxIterations}). Reformule ta demande.`;
}
