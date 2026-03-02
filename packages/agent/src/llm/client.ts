import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { resolveModel, type TaskType } from './router.ts';
import { calculateCost } from './pricing.ts';
import { logLlmUsage, getLlmModel } from '../memory/sqlite.ts';
import { logger } from '../logger.ts';

export type { TaskType } from './router.ts';

export interface LlmRequest {
  taskType: TaskType;
  messages: Anthropic.MessageParam[];
  system?: string;
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  model?: string;
  channel?: string;
  taskId?: string;
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
  provider: string;
  durationMs: number;
}

export interface LlmResponse {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: LlmUsage;
}

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResponse>;
  stream(request: LlmRequest): Promise<{
    stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
    finalMessage: () => Promise<{ message: Anthropic.Message; usage: LlmUsage }>;
  }>;
}

// ============================================================
// OpenRouter types (OpenAI-compatible)
// ============================================================

interface OpenRouterMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenRouterTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenRouterToolCall[] };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

// ============================================================
// Message conversion: Anthropic → OpenRouter (OpenAI format)
// ============================================================

function convertMessages(
  messages: Anthropic.MessageParam[],
  system: string | undefined,
): OpenRouterMessage[] {
  const result: OpenRouterMessage[] = [];
  if (system) result.push({ role: 'system', content: system });

  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
      continue;
    }

    if (!Array.isArray(m.content)) continue;

    // Assistant messages may contain tool_use blocks
    if (m.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: OpenRouterToolCall[] = [];

      for (const block of m.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      const msg: OpenRouterMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
      };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      result.push(msg);
      continue;
    }

    // User messages may contain tool_result blocks
    const toolResults = m.content.filter(
      (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
    );
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        const text = typeof tr.content === 'string'
          ? tr.content
          : Array.isArray(tr.content)
            ? tr.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
            : '';
        result.push({
          role: 'tool',
          content: text,
          tool_call_id: tr.tool_use_id,
        });
      }
      continue;
    }

    // Regular user message with content blocks
    const text = m.content
      .map((b) => {
        if ('text' in b && typeof b.text === 'string') return b.text;
        if ('content' in b && typeof b.content === 'string') return b.content;
        return JSON.stringify(b);
      })
      .join('\n');
    result.push({ role: 'user', content: text });
  }

  return result;
}

function convertTools(tools: Anthropic.Tool[]): OpenRouterTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/** Convert OpenRouter tool_calls response back to Anthropic ContentBlock[] */
function convertResponseContent(
  content: string | null,
  toolCalls?: OpenRouterToolCall[],
): Anthropic.ContentBlock[] {
  const blocks: Anthropic.ContentBlock[] = [];
  if (content) {
    blocks.push({ type: 'text' as const, text: content, citations: undefined });
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      let input: Record<string, unknown>;
      try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      blocks.push({
        type: 'tool_use' as const,
        id: tc.id,
        name: tc.function.name,
        input,
      } as unknown as Anthropic.ContentBlock);
    }
  }
  return blocks;
}

function mapStopReason(finishReason: string): string | null {
  if (finishReason === 'stop') return 'end_turn';
  if (finishReason === 'tool_calls') return 'tool_use';
  return finishReason ?? null;
}

// ============================================================
// OpenRouter model name mapping
// ============================================================

/**
 * Ensure model ID is in OpenRouter format.
 * Already OpenRouter (has /): pass through
 * Anthropic SDK format: claude-sonnet-4-6 → anthropic/claude-sonnet-4.6
 */
function toOpenRouterModel(model: string): string {
  if (model.includes('/')) return model; // Already OpenRouter format
  if (!model.startsWith('claude-')) return model;
  // claude-{variant}-{major}-{minor}[-datestring] → anthropic/claude-{variant}-{major}.{minor}
  const match = model.match(/^(claude-\w+)-(\d+)-(\d+)(-\d+)?$/);
  if (match) return `anthropic/${match[1]}-${match[2]}.${match[3]}`;
  return `anthropic/${model}`;
}

/**
 * Ensure model ID is in Anthropic SDK format.
 * Already Anthropic (no /): pass through
 * OpenRouter format: anthropic/claude-sonnet-4.6 → claude-sonnet-4-6
 */
function toAnthropicModel(model: string): string {
  if (!model.startsWith('anthropic/claude-')) return model;
  const slug = model.slice('anthropic/'.length); // claude-sonnet-4.6
  // claude-{variant}-{major}.{minor} → claude-{variant}-{major}-{minor}
  return slug.replace(/(\d+)\.(\d+)$/, '$1-$2');
}

/**
 * Check if a model supports tool calling (function calling).
 * Uses the catalog. If unknown, assume YES (safe default — better to try and fail with a useful error).
 */
function modelSupportsTools(orModelId: string): boolean {
  const m = getLlmModel(orModelId);
  if (!m) return true;
  return m.supports_tools === 1;
}

// ============================================================
// OpenRouter API calls
// ============================================================

async function callOpenRouter(
  model: string,
  messages: Anthropic.MessageParam[],
  system: string | undefined,
  maxTokens: number,
  tools?: Anthropic.Tool[],
): Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null; inputTokens: number; outputTokens: number }> {
  const orMessages = convertMessages(messages, system);
  const orModel = toOpenRouterModel(model);

  const body: Record<string, unknown> = {
    model: orModel,
    messages: orMessages,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0 && modelSupportsTools(orModel)) {
    body.tools = convertTools(tools);
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'HTTP-Referer': 'https://makilab.local',
      'X-Title': 'Makilab Agent',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }

  const data = await res.json() as OpenRouterResponse;
  const choice = data.choices[0];

  return {
    content: convertResponseContent(choice?.message?.content, choice?.message?.tool_calls),
    stopReason: mapStopReason(choice?.finish_reason ?? 'stop'),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ============================================================
// OpenRouter streaming (SSE → Anthropic-like events)
// ============================================================

interface OpenRouterStreamDelta {
  content?: string | null;
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
}

interface OpenRouterStreamChunk {
  choices: Array<{ delta: OpenRouterStreamDelta; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function* streamOpenRouter(
  model: string,
  messages: Anthropic.MessageParam[],
  system: string | undefined,
  maxTokens: number,
  tools?: Anthropic.Tool[],
): AsyncGenerator<{ event: Anthropic.RawMessageStreamEvent; chunk?: OpenRouterStreamChunk }> {
  const orMessages = convertMessages(messages, system);
  const orModel = toOpenRouterModel(model);

  const body: Record<string, unknown> = {
    model: orModel,
    messages: orMessages,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools && tools.length > 0 && modelSupportsTools(orModel)) {
    body.tools = convertTools(tools);
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'HTTP-Referer': 'https://makilab.local',
      'X-Title': 'Makilab Agent',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter streaming error ${res.status}: ${text}`);
  }

  if (!res.body) throw new Error('No response body for streaming');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track tool_calls being built across deltas
  const toolCallBuilders = new Map<number, { id: string; name: string; args: string }>();
  let contentBlockIndex = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;

      let chunk: OpenRouterStreamChunk;
      try { chunk = JSON.parse(payload); } catch { continue; }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Text content delta
      if (delta.content) {
        yield {
          event: {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          } as Anthropic.RawMessageStreamEvent,
          chunk,
        };
      }

      // Tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallBuilders.get(tc.index);
          if (!existing) {
            // New tool call starting
            if (delta.content || contentBlockIndex === 0) contentBlockIndex++;
            toolCallBuilders.set(tc.index, {
              id: tc.id ?? `toolu_or_${tc.index}`,
              name: tc.function?.name ?? '',
              args: tc.function?.arguments ?? '',
            });
          } else {
            // Appending to existing
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }
        }
      }
    }
  }
}

// ============================================================
// Usage tracking
// ============================================================

function trackUsage(
  provider: string, model: string, taskType: TaskType,
  tokensIn: number, tokensOut: number, durationMs: number,
  channel?: string, taskId?: string,
): LlmUsage {
  const costUsd = calculateCost(model, tokensIn, tokensOut);

  try {
    logLlmUsage({ provider, model, taskType, channel, tokensIn, tokensOut, costUsd, durationMs, taskId });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to log LLM usage');
  }

  return { tokensIn, tokensOut, costUsd, model, provider, durationMs };
}

// ============================================================
// LLM Client
// ============================================================

export function createLlmClient(): LlmClient {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  return {
    async chat(request: LlmRequest): Promise<LlmResponse> {
      const route = resolveModel(request.taskType, request.model);
      const maxTokens = request.maxTokens ?? 4096;
      const start = Date.now();

      if (route.provider === 'openrouter') {
        const result = await callOpenRouter(route.model, request.messages, request.system, maxTokens, request.tools);
        const durationMs = Date.now() - start;
        const usage = trackUsage(
          route.provider, route.model, request.taskType,
          result.inputTokens, result.outputTokens, durationMs,
          request.channel, request.taskId,
        );
        return { content: result.content, stopReason: result.stopReason, usage };
      }

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: toAnthropicModel(route.model),
        max_tokens: maxTokens,
        messages: request.messages,
      };
      if (request.system) params.system = request.system;
      if (request.tools && request.tools.length > 0) params.tools = request.tools;

      const response = await anthropic.messages.create(params);
      const durationMs = Date.now() - start;
      const usage = trackUsage(
        route.provider, route.model, request.taskType,
        response.usage.input_tokens, response.usage.output_tokens, durationMs,
        request.channel, request.taskId,
      );

      return { content: response.content, stopReason: response.stop_reason, usage };
    },

    async stream(request: LlmRequest) {
      const route = resolveModel(request.taskType, request.model);
      const maxTokens = request.maxTokens ?? 4096;
      const start = Date.now();

      if (route.provider === 'openrouter') {
        // OpenRouter streaming: wrap SSE into Anthropic-like events
        const orStream = streamOpenRouter(route.model, request.messages, request.system, maxTokens, request.tools);

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const collectedContent: Anthropic.ContentBlock[] = [];
        let currentText = '';
        const toolCallBuilders = new Map<number, { id: string; name: string; args: string }>();
        let finishReason = 'stop';

        // Create an async iterable that collects data while yielding events
        const eventBuffer: Anthropic.RawMessageStreamEvent[] = [];
        let resolveNext: (() => void) | null = null;
        let streamDone = false;

        const pumpPromise = (async () => {
          for await (const { event, chunk } of orStream) {
            // Collect text
            if (event.type === 'content_block_delta' && 'delta' in event) {
              const delta = event.delta as { type: string; text?: string };
              if (delta.type === 'text_delta' && delta.text) {
                currentText += delta.text;
              }
            }

            // Collect tool calls from raw chunk
            if (chunk?.choices?.[0]?.delta?.tool_calls) {
              for (const tc of chunk.choices[0].delta.tool_calls) {
                const existing = toolCallBuilders.get(tc.index);
                if (!existing) {
                  toolCallBuilders.set(tc.index, {
                    id: tc.id ?? `toolu_or_${tc.index}`,
                    name: tc.function?.name ?? '',
                    args: tc.function?.arguments ?? '',
                  });
                } else {
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                }
              }
            }

            if (chunk?.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
            if (chunk?.usage) {
              totalInputTokens = chunk.usage.prompt_tokens;
              totalOutputTokens = chunk.usage.completion_tokens;
            }

            eventBuffer.push(event);
            if (resolveNext) { resolveNext(); resolveNext = null; }
          }
          streamDone = true;
          if (resolveNext) { resolveNext(); resolveNext = null; }
        })();

        const asyncIterable: AsyncIterable<Anthropic.RawMessageStreamEvent> = {
          [Symbol.asyncIterator]() {
            let idx = 0;
            return {
              async next(): Promise<IteratorResult<Anthropic.RawMessageStreamEvent>> {
                while (idx >= eventBuffer.length && !streamDone) {
                  await new Promise<void>(r => { resolveNext = r; });
                }
                if (idx < eventBuffer.length) {
                  return { value: eventBuffer[idx++], done: false };
                }
                return { value: undefined as unknown as Anthropic.RawMessageStreamEvent, done: true };
              },
            };
          },
        };

        return {
          stream: asyncIterable,
          finalMessage: async () => {
            await pumpPromise;
            const durationMs = Date.now() - start;
            const usage = trackUsage(
              route.provider, route.model, request.taskType,
              totalInputTokens, totalOutputTokens, durationMs,
              request.channel, request.taskId,
            );

            // Build content blocks
            if (currentText) {
              collectedContent.push({ type: 'text' as const, text: currentText, citations: undefined });
            }
            for (const [, tc] of toolCallBuilders) {
              let input: Record<string, unknown>;
              try { input = JSON.parse(tc.args); } catch { input = {}; }
              collectedContent.push({
                type: 'tool_use' as const,
                id: tc.id,
                name: tc.name,
                input,
              } as unknown as Anthropic.ContentBlock);
            }

            const message: Anthropic.Message = {
              id: 'msg_openrouter',
              type: 'message',
              role: 'assistant',
              content: collectedContent,
              model: toAnthropicModel(route.model),
              stop_reason: mapStopReason(finishReason) as Anthropic.Message['stop_reason'],
              stop_sequence: null,
              usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            };

            return { message, usage };
          },
        };
      }

      // Anthropic native streaming
      const params: Anthropic.MessageCreateParamsStreaming = {
        model: toAnthropicModel(route.model),
        max_tokens: maxTokens,
        messages: request.messages,
        stream: true,
      };
      if (request.system) params.system = request.system;
      if (request.tools && request.tools.length > 0) params.tools = request.tools;

      const messageStream = anthropic.messages.stream(params);

      return {
        stream: messageStream as unknown as AsyncIterable<Anthropic.RawMessageStreamEvent>,
        finalMessage: async () => {
          const message = await messageStream.finalMessage();
          const durationMs = Date.now() - start;
          const usage = trackUsage(
            route.provider, route.model, request.taskType,
            message.usage.input_tokens, message.usage.output_tokens, durationMs,
            request.channel, request.taskId,
          );
          return { message, usage };
        },
      };
    },
  };
}
