# E14 — LLM Router + Cost Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unified LLM client that routes calls to the optimal provider/model per task type, tracks all token usage and costs, and provides a Costs dashboard + chat model selector in Mission Control.

**Architecture:** A `packages/agent/src/llm/` module encapsulates Anthropic SDK + OpenRouter behind a common interface. A config-based router maps task types to provider+model. Every call is tracked in a new `llm_usage` SQLite table. The dashboard gets a new `/costs` page and a model dropdown in `/chat`.

**Tech Stack:** Anthropic SDK (existing), OpenRouter via fetch (no new deps), SQLite (existing), Next.js 15 (existing), vanilla CSS (existing).

---

## Task 1: Pricing table + cost calculation utility

**Files:**
- Create: `packages/agent/src/llm/pricing.ts`
- Test: `packages/agent/tests/pricing.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/tests/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { calculateCost, getModelPrice } from '../src/llm/pricing.ts';

describe('pricing', () => {
  it('returns price for known model', () => {
    const price = getModelPrice('claude-sonnet-4-6');
    expect(price).toEqual({ input: 3.0, output: 15.0 });
  });

  it('returns null for unknown model', () => {
    expect(getModelPrice('unknown-model')).toBeNull();
  });

  it('calculates cost correctly', () => {
    // 1000 input tokens + 500 output tokens with Sonnet
    // input: 3.0/1M * 1000 = 0.003, output: 15.0/1M * 500 = 0.0075
    const cost = calculateCost('claude-sonnet-4-6', 1000, 500);
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('returns 0 for unknown model', () => {
    expect(calculateCost('unknown', 100, 100)).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @makilab/agent exec vitest run tests/pricing.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/agent/src/llm/pricing.ts

/** Per-million-token pricing (USD) */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':             { input: 15.0,  output: 75.0 },
  'claude-sonnet-4-6':           { input: 3.0,   output: 15.0 },
  'claude-haiku-4-5-20251001':   { input: 0.80,  output: 4.0 },
  // OpenRouter
  'google/gemini-2.0-flash-001': { input: 0.10,  output: 0.40 },
  'meta-llama/llama-4-scout':    { input: 0.15,  output: 0.60 },
};

export function getModelPrice(model: string): { input: number; output: number } | null {
  return PRICING[model] ?? null;
}

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

export function listAvailableModels(): Array<{ id: string; label: string; provider: string }> {
  return [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', provider: 'anthropic' },
    { id: 'claude-opus-4-6', label: 'Claude Opus', provider: 'anthropic' },
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini Flash', provider: 'openrouter' },
  ];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @makilab/agent exec vitest run tests/pricing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/llm/pricing.ts packages/agent/tests/pricing.test.ts
git commit -m "feat(E14): pricing table + cost calculation utility"
```

---

## Task 2: LLM usage tracking (SQLite table + functions)

**Files:**
- Modify: `packages/agent/src/memory/sqlite.ts` (add table + functions)
- Test: `packages/agent/tests/llm-usage.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/tests/llm-usage.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { logLlmUsage, getLlmUsageSummary, getLlmUsageHistory, getRecentLlmUsage } from '../src/memory/sqlite.ts';

describe('llm_usage', () => {
  it('logs and retrieves usage', () => {
    const id = logLlmUsage({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      taskType: 'conversation',
      channel: 'mission_control',
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.0105,
      durationMs: 2000,
    });
    expect(id).toBeGreaterThan(0);

    const recent = getRecentLlmUsage(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].model).toBe('claude-sonnet-4-6');
  });

  it('computes summary', () => {
    const summary = getLlmUsageSummary('month');
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.totalCalls).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @makilab/agent exec vitest run tests/llm-usage.test.ts`
Expected: FAIL — functions not found

**Step 3: Add migration + functions to sqlite.ts**

Add to `initSchema()` migration block:
```typescript
// Migration: llm_usage table
if (!appliedMigrations.has('add_llm_usage_table')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      channel TEXT,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      duration_ms INTEGER,
      task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec("INSERT INTO _migrations (name) VALUES ('add_llm_usage_table')");
}
```

Add functions:
```typescript
export interface LlmUsageRow {
  id: number;
  provider: string;
  model: string;
  task_type: string;
  channel: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number | null;
  task_id: string | null;
  created_at: string;
}

export function logLlmUsage(params: {
  provider: string;
  model: string;
  taskType: string;
  channel?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs?: number;
  taskId?: string;
}): number {
  const result = getDb().prepare(`
    INSERT INTO llm_usage (provider, model, task_type, channel, tokens_in, tokens_out, cost_usd, duration_ms, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.provider, params.model, params.taskType,
    params.channel ?? null, params.tokensIn, params.tokensOut,
    params.costUsd, params.durationMs ?? null, params.taskId ?? null,
  );
  return result.lastInsertRowid as number;
}

export function getRecentLlmUsage(limit = 50): LlmUsageRow[] {
  return getDb().prepare(
    'SELECT * FROM llm_usage ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as unknown as LlmUsageRow[];
}

export function getLlmUsageSummary(period: 'day' | 'week' | 'month' | 'year'): {
  totalCost: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byModel: Array<{ model: string; cost: number; calls: number }>;
  byTaskType: Array<{ taskType: string; cost: number; calls: number }>;
} {
  const periodMap = { day: '-1 day', week: '-7 days', month: 'start of month', year: 'start of year' };
  const since = periodMap[period];
  const db = getDb();

  const totals = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
           COUNT(*) as total_calls,
           COALESCE(SUM(tokens_in), 0) as total_tokens_in,
           COALESCE(SUM(tokens_out), 0) as total_tokens_out
    FROM llm_usage WHERE created_at >= datetime('now', ?)
  `).get(since) as { total_cost: number; total_calls: number; total_tokens_in: number; total_tokens_out: number };

  const byModel = db.prepare(`
    SELECT model, COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as calls
    FROM llm_usage WHERE created_at >= datetime('now', ?)
    GROUP BY model ORDER BY cost DESC
  `).all(since) as unknown as Array<{ model: string; cost: number; calls: number }>;

  const byTaskType = db.prepare(`
    SELECT task_type as taskType, COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as calls
    FROM llm_usage WHERE created_at >= datetime('now', ?)
    GROUP BY task_type ORDER BY cost DESC
  `).all(since) as unknown as Array<{ taskType: string; cost: number; calls: number }>;

  return {
    totalCost: totals.total_cost,
    totalCalls: totals.total_calls,
    totalTokensIn: totals.total_tokens_in,
    totalTokensOut: totals.total_tokens_out,
    byModel,
    byTaskType,
  };
}

export function getLlmUsageHistory(days = 30): Array<{ date: string; cost: number; calls: number }> {
  return getDb().prepare(`
    SELECT DATE(created_at) as date, COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as calls
    FROM llm_usage WHERE created_at >= datetime('now', ?)
    GROUP BY DATE(created_at) ORDER BY date ASC
  `).all(`-${days} days`) as unknown as Array<{ date: string; cost: number; calls: number }>;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @makilab/agent exec vitest run tests/llm-usage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory/sqlite.ts packages/agent/tests/llm-usage.test.ts
git commit -m "feat(E14): llm_usage SQLite table + tracking functions"
```

---

## Task 3: LLM Router (config-based routing)

**Files:**
- Create: `packages/agent/src/llm/router.ts`
- Test: `packages/agent/tests/router.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/tests/router.test.ts
import { describe, it, expect } from 'vitest';
import { resolveModel, type TaskType } from '../src/llm/router.ts';

describe('LLM router', () => {
  it('routes conversation to anthropic sonnet', () => {
    const route = resolveModel('conversation');
    expect(route.provider).toBe('anthropic');
    expect(route.model).toBe('claude-sonnet-4-6');
  });

  it('routes fact_extraction to haiku', () => {
    const route = resolveModel('fact_extraction');
    expect(route.model).toContain('haiku');
  });

  it('routes classification to openrouter when key present', () => {
    const route = resolveModel('classification');
    // Falls back to anthropic if no OPENROUTER_API_KEY
    expect(route.provider).toBeDefined();
  });

  it('respects explicit model override', () => {
    const route = resolveModel('conversation', 'claude-opus-4-6');
    expect(route.model).toBe('claude-opus-4-6');
    expect(route.provider).toBe('anthropic');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @makilab/agent exec vitest run tests/router.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/agent/src/llm/router.ts
import { config } from '../config.ts';

export type TaskType = 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task' | 'orchestration';

interface ModelRoute {
  provider: 'anthropic' | 'openrouter';
  model: string;
}

const DEFAULT_ROUTES: Record<TaskType, ModelRoute> = {
  conversation:     { provider: 'anthropic',   model: 'claude-sonnet-4-6' },
  compaction:       { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  fact_extraction:  { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  classification:   { provider: 'openrouter',  model: 'google/gemini-2.0-flash-001' },
  cron_task:        { provider: 'anthropic',   model: 'claude-sonnet-4-6' },
  orchestration:    { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
};

/** Map model ID to its provider */
function inferProvider(model: string): 'anthropic' | 'openrouter' {
  if (model.startsWith('claude-')) return 'anthropic';
  return 'openrouter';
}

/**
 * Resolve which provider + model to use for a given task type.
 *
 * Priority:
 * 1. Explicit model override (from chat dropdown or task config)
 * 2. Default route for the task type
 * 3. Falls back to anthropic if openrouter key missing
 */
export function resolveModel(taskType: TaskType, modelOverride?: string): ModelRoute {
  if (modelOverride) {
    return { provider: inferProvider(modelOverride), model: modelOverride };
  }

  const route = DEFAULT_ROUTES[taskType];

  // Fallback: if openrouter requested but no API key, use anthropic haiku
  if (route.provider === 'openrouter' && !config.openrouterApiKey) {
    return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  }

  return route;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @makilab/agent exec vitest run tests/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/llm/router.ts packages/agent/tests/router.test.ts
git commit -m "feat(E14): LLM router — config-based model routing"
```

---

## Task 4: LLM Client (unified interface + Anthropic provider)

**Files:**
- Create: `packages/agent/src/llm/client.ts`
- Test: `packages/agent/tests/llm-client.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agent/tests/llm-client.test.ts
import { describe, it, expect } from 'vitest';
import { createLlmClient, type TaskType } from '../src/llm/client.ts';

describe('LLM client', () => {
  it('exports createLlmClient', () => {
    expect(typeof createLlmClient).toBe('function');
  });

  it('creates client with chat and stream methods', () => {
    const client = createLlmClient();
    expect(typeof client.chat).toBe('function');
    expect(typeof client.stream).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @makilab/agent exec vitest run tests/llm-client.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/agent/src/llm/client.ts
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
  model?: string;    // explicit override
  channel?: string;
  taskId?: string;   // for cron tasks
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
      // Extract text from content blocks (tool_result blocks → join as text)
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
    content: [{ type: 'text' as const, text: choice?.message?.content ?? '' }],
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

  // Fire-and-forget tracking
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

      // Anthropic
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

      // OpenRouter doesn't support streaming with our format — fall back to chat
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
        stream: messageStream,
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @makilab/agent exec vitest run tests/llm-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/llm/client.ts packages/agent/tests/llm-client.test.ts
git commit -m "feat(E14): LLM client — unified interface + Anthropic + OpenRouter providers"
```

---

## Task 5: Migrate agent-loop.ts to LLM Client

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`

**Step 1: Replace Anthropic client with LLM Client**

Changes required:
1. Remove `import Anthropic from '@anthropic-ai/sdk'` (keep the type import)
2. Remove `const client = new Anthropic(...)`
3. Add `import { createLlmClient } from './llm/client.ts'`
4. Add `const llm = createLlmClient()`
5. In main loop (line 188): replace `client.messages.create()` with `llm.chat()`
6. In compactHistory (line 120): replace `client.messages.create()` with `llm.chat()`
7. Pass `taskType` and `channel` to each call

Main loop call becomes:
```typescript
const response = await llm.chat({
  taskType: 'conversation',
  model: modelOverride,  // from context (new param)
  messages,
  system: systemPrompt,
  tools: anthropicTools,
  maxTokens: 4096,
  channel,
});
// Access: response.content, response.stopReason, response.usage
```

Compaction call becomes:
```typescript
const response = await llm.chat({
  taskType: 'compaction',
  messages: [{ role: 'user', content: `Résume cet historique...${transcript}` }],
  maxTokens: 1024,
  channel,
});
```

**Step 2: Add `model` parameter to `runAgentLoop`**

```typescript
export async function runAgentLoop(
  userMessage: string,
  context: AgentContext & { model?: string },
): Promise<string> {
```

**Step 3: Run existing tests**

Run: `pnpm --filter @makilab/agent exec vitest run`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add packages/agent/src/agent-loop.ts
git commit -m "feat(E14): migrate agent-loop.ts to unified LLM client"
```

---

## Task 6: Migrate agent-loop-stream.ts to LLM Client

**Files:**
- Modify: `packages/agent/src/agent-loop-stream.ts`

**Step 1: Replace Anthropic client with LLM Client**

Same pattern as Task 5:
1. Remove direct Anthropic import, add `createLlmClient` import
2. Replace `client.messages.stream()` with `llm.stream()`
3. Adapt the stream consumption to use `stream.stream` and `stream.finalMessage()`
4. Add `model` parameter to `runAgentLoopStreaming`

Stream call becomes:
```typescript
const { stream: messageStream, finalMessage } = await llm.stream({
  taskType: 'conversation',
  model: modelOverride,
  messages,
  system: systemPrompt,
  tools: anthropicTools,
  maxTokens: 4096,
  channel,
});

for await (const event of messageStream) {
  // existing event handling
}

const { message: finalMsg, usage } = await finalMessage();
```

**Step 2: Run existing tests**

Run: `pnpm --filter @makilab/agent exec vitest run`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add packages/agent/src/agent-loop-stream.ts
git commit -m "feat(E14): migrate agent-loop-stream.ts to unified LLM client"
```

---

## Task 7: Migrate background calls (fact-extractor, capture, orchestrator)

**Files:**
- Modify: `packages/agent/src/memory/fact-extractor.ts`
- Modify: `packages/agent/src/subagents/capture.ts`
- Modify: `packages/agent/src/subagents/orchestrator.ts` (if used)

**Step 1: Migrate fact-extractor.ts**

Replace:
```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: config.anthropicApiKey });
// ...
const response = await client.messages.create({ model: 'claude-haiku-4-5-20251001', ... });
```

With:
```typescript
import { createLlmClient } from '../llm/client.ts';
const llm = createLlmClient();
// ...
const response = await llm.chat({
  taskType: 'fact_extraction',
  messages: [{ role: 'user', content: prompt }],
  maxTokens: 512,
  channel,
});
const raw = response.content.find((b) => b.type === 'text')?.text ?? '{}';
```

**Step 2: Migrate capture.ts**

Same pattern — replace `client.messages.create()` with `llm.chat({ taskType: 'classification', ... })`.

**Step 3: Migrate orchestrator.ts**

Same pattern — `llm.chat({ taskType: 'orchestration', ... })`.

**Step 4: Run all tests**

Run: `pnpm --filter @makilab/agent exec vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory/fact-extractor.ts packages/agent/src/subagents/capture.ts packages/agent/src/subagents/orchestrator.ts
git commit -m "feat(E14): migrate background LLM calls to unified client"
```

---

## Task 8: Migrate CRON task execution + pass model from task

**Files:**
- Modify: `packages/agent/src/tasks/cron.ts`
- Modify: `packages/agent/src/memory/sqlite.ts` (add `model` column to `tasks`)

**Step 1: Add model column to tasks table**

In `initSchema()`, add migration:
```typescript
if (!appliedMigrations.has('add_tasks_model_column')) {
  db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
  db.exec("INSERT INTO _migrations (name) VALUES ('add_tasks_model_column')");
}
```

Update `TaskRow` interface to include `model: string | null`.
Update `createTask` and `updateTask` to handle the `model` field.

**Step 2: Pass model to runAgentLoop in cron.ts**

In `syncRecurringTasks()`, line 118:
```typescript
await runAgentLoop(task.cron_prompt!, {
  channel: (task.channel as Channel) ?? 'cli',
  from: 'cron',
  history: [],
  model: task.model ?? undefined,  // NEW: pass task's configured model
});
```

Same in `executeRecurringTask()`.

Also update `logTaskExecution` calls to include the model:
```typescript
logTaskExecution({
  taskId: task.id,
  status: 'success',
  durationMs: Date.now() - start,
  model: task.model ?? 'claude-sonnet-4-6',
});
```

**Step 3: Update tasks subagent to accept model param**

In `packages/agent/src/subagents/tasks.ts`, add `model` to the `create` action inputSchema and pass it through.

**Step 4: Run tests**

Run: `pnpm --filter @makilab/agent exec vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory/sqlite.ts packages/agent/src/tasks/cron.ts packages/agent/src/subagents/tasks.ts
git commit -m "feat(E14): add model field to tasks + pass to CRON execution"
```

---

## Task 9: Cost API endpoints

**Files:**
- Modify: `packages/agent/src/server.ts`

**Step 1: Add endpoints**

```typescript
// GET /api/costs/summary?period=month
app.get('/api/costs/summary', async (request) => {
  const { period = 'month' } = request.query as { period?: string };
  const validPeriods = ['day', 'week', 'month', 'year'];
  const p = validPeriods.includes(period) ? period : 'month';
  return getLlmUsageSummary(p as 'day' | 'week' | 'month' | 'year');
});

// GET /api/costs/history?days=30
app.get('/api/costs/history', async (request) => {
  const { days = '30' } = request.query as { days?: string };
  return getLlmUsageHistory(parseInt(days, 10) || 30);
});

// GET /api/costs/recent?limit=50
app.get('/api/costs/recent', async (request) => {
  const { limit = '50' } = request.query as { limit?: string };
  return getRecentLlmUsage(parseInt(limit, 10) || 50);
});

// GET /api/models — available models for dropdown
app.get('/api/models', async () => {
  return listAvailableModels();
});
```

**Step 2: Add imports to server.ts**

```typescript
import { getLlmUsageSummary, getLlmUsageHistory, getRecentLlmUsage } from './memory/sqlite.ts';
import { listAvailableModels } from './llm/pricing.ts';
```

**Step 3: Add model param to chat/stream endpoints**

In POST `/api/chat/stream` handler, extract `model` from request body and pass to `runAgentLoopStreaming`:
```typescript
const { message, channel = 'mission_control', model } = request.body as { message: string; channel?: string; model?: string };
// Pass model to streaming loop
const events = runAgentLoopStreaming(message, { channel, from: 'user', history: [], model });
```

Same for POST `/api/chat`.

**Step 4: Test manually**

Run: `pnpm dev:api`
Then: `curl http://localhost:3100/api/costs/summary?period=month`
Expected: JSON response with totalCost, byModel, byTaskType

**Step 5: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(E14): cost API endpoints + model param on chat"
```

---

## Task 10: Dashboard — Costs page

**Files:**
- Create: `packages/dashboard/app/costs/page.tsx`
- Modify: `packages/dashboard/app/components/sidebar.tsx` (add Costs link)
- Modify: `packages/dashboard/app/lib/api.ts` (add cost API helpers)
- Modify: `packages/dashboard/app/globals.css` (add costs styles)

**Step 1: Add API helpers**

In `packages/dashboard/app/lib/api.ts`, add:
```typescript
export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byModel: Array<{ model: string; cost: number; calls: number }>;
  byTaskType: Array<{ taskType: string; cost: number; calls: number }>;
}

export interface CostHistoryPoint {
  date: string;
  cost: number;
  calls: number;
}

export interface LlmUsageEntry {
  id: number;
  provider: string;
  model: string;
  task_type: string;
  channel: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number | null;
  created_at: string;
}

export async function fetchCostSummary(period = 'month'): Promise<CostSummary> {
  const res = await fetch(`${API_BASE}/costs/summary?period=${period}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchCostHistory(days = 30): Promise<CostHistoryPoint[]> {
  const res = await fetch(`${API_BASE}/costs/history?days=${days}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchRecentUsage(limit = 50): Promise<LlmUsageEntry[]> {
  const res = await fetch(`${API_BASE}/costs/recent?limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

**Step 2: Add Costs link to sidebar**

In `packages/dashboard/app/components/sidebar.tsx`, add to MANAGE items:
```typescript
{ href: '/costs', label: 'Couts', icon: '💰' },
```

After Taches, before Connections.

**Step 3: Create costs page**

Create `packages/dashboard/app/costs/page.tsx` with:
- Period selector (jour/semaine/mois/année)
- 4 stat cards (coût total, appels, tokens, modèle top)
- Cost history chart (simple ASCII/CSS bar chart — no chart library needed)
- Two breakdown tables (par modèle + par type de tâche)
- Recent calls table (scrollable)

The page uses the same vanilla CSS dark mode patterns as the rest of the dashboard. Use CSS grid for the stat cards, standard `<table>` for breakdowns.

**Step 4: Add CSS styles**

In `globals.css`, add `.costs-*` classes following existing patterns (`.stat-card`, `.data-table` etc.).

**Step 5: Test visually**

Run: `pnpm dev:api` + `pnpm dev:dashboard`
Navigate to `/costs` — verify layout, period selector, data display.

**Step 6: Commit**

```bash
git add packages/dashboard/app/costs/page.tsx packages/dashboard/app/components/sidebar.tsx packages/dashboard/app/lib/api.ts packages/dashboard/app/globals.css
git commit -m "feat(E14): Costs dashboard page with breakdowns and history"
```

---

## Task 11: Chat model selector dropdown

**Files:**
- Modify: `packages/dashboard/app/chat/page.tsx`

**Step 1: Add model dropdown to chat input**

Add state:
```typescript
const [selectedModel, setSelectedModel] = useState<string>('');
const [models, setModels] = useState<ModelInfo[]>([]);
```

Fetch models on mount:
```typescript
useEffect(() => {
  fetchModels().then(setModels).catch(() => {});
}, []);
```

Add dropdown next to the send button:
```tsx
<div className="chat-input-row">
  <textarea ... />
  <select
    className="model-selector"
    value={selectedModel}
    onChange={(e) => setSelectedModel(e.target.value)}
  >
    <option value="">Auto</option>
    {models.map((m) => (
      <option key={m.id} value={m.id}>{m.label}</option>
    ))}
  </select>
  <button ...>Envoyer</button>
</div>
```

**Step 2: Pass model to sendMessageStream**

Update the `sendMessageStream` call in chat page to include the model:
```typescript
const events = sendMessageStream(input, 'mission_control', selectedModel || undefined);
```

Update `sendMessageStream` in `api.ts` to accept optional model param:
```typescript
export async function* sendMessageStream(
  message: string,
  channel = 'mission_control',
  model?: string,
): AsyncGenerator<...> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel, model }),
  });
  // ...
}
```

**Step 3: Add CSS for model selector**

```css
.model-selector {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 0.8rem;
}
```

**Step 4: Test**

Run both servers, go to `/chat`, verify dropdown shows models, send message with different model selected.

**Step 5: Commit**

```bash
git add packages/dashboard/app/chat/page.tsx packages/dashboard/app/lib/api.ts packages/dashboard/app/globals.css
git commit -m "feat(E14): model selector dropdown in chat interface"
```

---

## Task 12: Update tasks dashboard — model column + edit

**Files:**
- Modify: `packages/dashboard/app/lib/api.ts` (add model to TaskInfo + update calls)
- Modify: `packages/dashboard/app/tasks/page.tsx` (add Modèle column)
- Modify: `packages/dashboard/app/components/recurring-task-detail.tsx` (add model dropdown)

**Step 1: Update TaskInfo interface**

In `api.ts`, add `model: string | null` to `TaskInfo` and to `updateTaskApi` fields.

**Step 2: Add model column to recurring tasks table**

In the recurring tasks page, add "Modèle" column showing `task.model ?? 'Auto'`.

**Step 3: Add model dropdown to recurring task detail panel**

In the detail panel, add a dropdown similar to the chat one:
```tsx
<div className="detail-field">
  <label>Modèle</label>
  <select value={task.model ?? ''} onChange={handleModelChange}>
    <option value="">Auto (Sonnet)</option>
    {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
  </select>
</div>
```

On change, call `updateTaskApi(task.id, { model: selectedModel })`.

**Step 4: Test**

Navigate to `/tasks`, verify model column visible. Edit a recurring task, change model, verify it persists.

**Step 5: Commit**

```bash
git add packages/dashboard/app/tasks/page.tsx packages/dashboard/app/components/recurring-task-detail.tsx packages/dashboard/app/lib/api.ts
git commit -m "feat(E14): model column + edit in recurring tasks dashboard"
```

---

## Task 13: PROGRESS.md + final verification

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Run all tests**

Run: `pnpm --filter @makilab/agent exec vitest run`
Expected: All tests PASS (existing + new pricing + llm-usage + router + client tests)

**Step 2: Manual verification**

1. Start API: `pnpm dev:api`
2. Start dashboard: `pnpm dev:dashboard`
3. Send a message in `/chat` → verify model dropdown works
4. Check `/costs` page → verify data appears after chat
5. Check `/tasks` → verify model column visible on recurring tasks
6. Edit a recurring task → change model → verify persistence
7. Check `/costs` after a few interactions → verify cost breakdown

**Step 3: Update PROGRESS.md**

Add E14 stories and mark complete. Update handoff section.

**Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "feat(E14): PROGRESS.md update — LLM Router + Cost Tracking complete"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Pricing table + cost calc | Simple |
| 2 | llm_usage SQLite table + functions | Medium |
| 3 | LLM Router (config routing) | Simple |
| 4 | LLM Client (unified interface) | Complex |
| 5 | Migrate agent-loop.ts | Medium |
| 6 | Migrate agent-loop-stream.ts | Medium |
| 7 | Migrate background calls (3 files) | Medium |
| 8 | Migrate CRON + model field on tasks | Medium |
| 9 | Cost API endpoints | Simple |
| 10 | Dashboard Costs page | Medium |
| 11 | Chat model selector | Simple |
| 12 | Tasks model column + edit | Simple |
| 13 | PROGRESS.md + verification | Simple |

**Total: 13 tasks, ~13 commits**
