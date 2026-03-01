import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { resolveModel, type TaskType } from './router.ts';
import { calculateCost } from './pricing.ts';
import { logLlmUsage } from '../memory/sqlite.ts';
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

async function callOpenRouter(
  model: string,
  messages: Anthropic.MessageParam[],
  system: string | undefined,
  maxTokens: number,
): Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null; inputTokens: number; outputTokens: number }> {
  const openRouterMessages: Array<{ role: string; content: string }> = [];
  if (system) openRouterMessages.push({ role: 'system', content: system });

  for (const m of messages) {
    if (typeof m.content === 'string') {
      openRouterMessages.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const text = m.content
        .map((b) => {
          if ('text' in b && typeof b.text === 'string') return b.text;
          if ('content' in b && typeof b.content === 'string') return b.content;
          return JSON.stringify(b);
        })
        .join('\n');
      openRouterMessages.push({ role: m.role, content: text });
    }
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'HTTP-Referer': 'https://makilab.local',
      'X-Title': 'Makilab Agent',
    },
    body: JSON.stringify({
      model,
      messages: openRouterMessages,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  return {
    content: [{ type: 'text' as const, text: choice?.message?.content ?? '', citations: undefined }],
    stopReason: choice?.finish_reason === 'stop' ? 'end_turn' : choice?.finish_reason ?? null,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

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

export function createLlmClient(): LlmClient {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  return {
    async chat(request: LlmRequest): Promise<LlmResponse> {
      const route = resolveModel(request.taskType, request.model);
      const maxTokens = request.maxTokens ?? 4096;
      const start = Date.now();

      if (route.provider === 'openrouter') {
        const result = await callOpenRouter(route.model, request.messages, request.system, maxTokens);
        const durationMs = Date.now() - start;
        const usage = trackUsage(
          route.provider, route.model, request.taskType,
          result.inputTokens, result.outputTokens, durationMs,
          request.channel, request.taskId,
        );
        return { content: result.content, stopReason: result.stopReason, usage };
      }

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: route.model,
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

      if (route.provider === 'openrouter') {
        throw new Error('Streaming not supported with OpenRouter provider. Use chat() instead.');
      }

      const maxTokens = request.maxTokens ?? 4096;
      const start = Date.now();

      const params: Anthropic.MessageCreateParamsStreaming = {
        model: route.model,
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
