# E13 — MCP Bridge + Tâches récurrentes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Makilab a MCP client that auto-discovers tools from external MCP servers, and add user-defined recurring tasks (CRON) via chat + dashboard UI.

**Architecture:** A `mcp/bridge.ts` module manages MCP server connections (stdio transport). Tools are auto-discovered via `client.listTools()` and injected into the agent loop's `buildToolList()`. MCP tool calls are detected by `mcp_` prefix and routed to `client.callTool()`. Recurring tasks use 3 new SQLite columns + dynamic `node-cron` scheduling.

**Tech Stack:** `@modelcontextprotocol/sdk` (Client, StdioClientTransport), `node-cron`, SQLite migrations, Next.js dashboard components.

**Important context for implementer:**
- Monorepo at `d:/SynologyDrive/IA et agents/makilab`
- Node.js 24, TypeScript strict, ES modules, pnpm workspaces
- Agent package: `packages/agent/`
- Dashboard package: `packages/dashboard/`
- Tests: Vitest in `packages/agent/src/tests/`
- Currently 57 tests passing, 10 subagents registered
- SQLite via `node:sqlite` builtin (NOT better-sqlite3)
- Existing migration pattern: `migrateXxx()` functions in `packages/agent/src/memory/sqlite.ts`
- Existing CRON: `packages/agent/src/tasks/cron.ts` (hardcoded morning briefing + evening summary)
- Existing subagent pattern: see `packages/agent/src/subagents/karakeep.ts` for reference
- Config: `packages/agent/src/config.ts` — `optional(key, fallback)` pattern
- Registry: `packages/agent/src/subagents/registry.ts`
- Agent loops: `packages/agent/src/agent-loop.ts` (non-streaming) and `packages/agent/src/agent-loop-stream.ts` (streaming)
- Both agent loops have a `buildToolList()` function that returns `Anthropic.Tool[]`
- Tool execution in the loops detects subagent calls by `__` separator in tool name
- Boot sequence: `packages/agent/src/start-server.ts`

---

### Task 1: Install MCP SDK dependency

**Files:**
- Modify: `packages/agent/package.json`

**Step 1: Install the MCP SDK**

```bash
cd d:/SynologyDrive/IA\ et\ agents/makilab
pnpm --filter @makilab/agent add @modelcontextprotocol/sdk
```

This adds `@modelcontextprotocol/sdk` to `packages/agent/package.json` dependencies.

**Step 2: Verify installation**

```bash
pnpm --filter @makilab/agent exec node -e "import('@modelcontextprotocol/sdk/client/index.js').then(m => console.log('OK:', Object.keys(m)))"
```

Expected: prints `OK: [ 'Client' ]` or similar.

**Step 3: Commit**

```bash
git add packages/agent/package.json pnpm-lock.yaml
git commit -m "feat(E13): add @modelcontextprotocol/sdk dependency"
```

---

### Task 2: MCP config loader + server config file

**Files:**
- Create: `mcp-servers.json` (repo root)
- Create: `packages/agent/src/mcp/config.ts`

**Context:** The MCP bridge needs a config file listing which servers to connect to. The file is optional — if missing, MCP is disabled gracefully.

**Step 1: Create the MCP servers config file**

Create `mcp-servers.json` at the repo root:

```json
{
  "$schema": "./docs/mcp-servers-schema.json",
  "_comment": "MCP servers for Makilab. Each key is a server name, value is spawn config.",
  "notebooklm": {
    "command": "npx",
    "args": ["-y", "notebooklm-mcp"],
    "env": {},
    "enabled": false
  },
  "indeed": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/indeed-mcp"],
    "env": {},
    "enabled": false
  },
  "google-calendar": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/google-calendar-mcp"],
    "env": {},
    "enabled": false
  }
}
```

All servers start `enabled: false` — they get enabled individually once auth is configured.

**Step 2: Create the config loader**

Create `packages/agent/src/mcp/config.ts`:

```typescript
/**
 * mcp/config.ts — MCP server configuration loader
 *
 * Reads mcp-servers.json from the repo root.
 * Returns an empty map if the file is missing or invalid.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export type McpServersConfig = Record<string, McpServerConfig>;

const CONFIG_FILENAME = 'mcp-servers.json';

export function loadMcpServersConfig(): McpServersConfig {
  const configPath = resolve(config.codeRepoRoot, CONFIG_FILENAME);

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Filter out keys starting with $ or _ (meta fields)
    const servers: McpServersConfig = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('$') || key.startsWith('_')) continue;
      if (!value || typeof value !== 'object') continue;
      const cfg = value as Record<string, unknown>;
      if (!cfg['command'] || typeof cfg['command'] !== 'string') continue;

      servers[key] = {
        command: cfg['command'] as string,
        args: (cfg['args'] as string[]) ?? [],
        env: (cfg['env'] as Record<string, string>) ?? {},
        enabled: cfg['enabled'] !== false, // default true if not specified
      };
    }

    const enabledCount = Object.values(servers).filter((s) => s.enabled).length;
    logger.info({ total: Object.keys(servers).length, enabled: enabledCount }, 'MCP servers config loaded');
    return servers;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info('No mcp-servers.json found — MCP disabled');
    } else {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to load mcp-servers.json');
    }
    return {};
  }
}
```

**Step 3: Commit**

```bash
git add mcp-servers.json packages/agent/src/mcp/config.ts
git commit -m "feat(E13): MCP config loader + mcp-servers.json"
```

---

### Task 3: MCP Bridge — connect, discover, call

**Files:**
- Create: `packages/agent/src/mcp/bridge.ts`

**Context:** This is the core MCP module. It manages connections to MCP servers, discovers their tools, converts them to Anthropic tool format, and routes tool calls. This is the most important file of E13.

**Step 1: Create the bridge**

Create `packages/agent/src/mcp/bridge.ts`:

```typescript
/**
 * mcp/bridge.ts — MCP Client Bridge
 *
 * Connects to MCP servers defined in mcp-servers.json.
 * Auto-discovers tools and exposes them in Anthropic tool format.
 * Routes tool calls to the appropriate MCP server.
 *
 * Lifecycle:
 * 1. initMcpBridge() — called at boot from start-server.ts
 * 2. getMcpTools() — called by buildToolList() in agent loops
 * 3. callMcpTool() — called when a tool with mcp_ prefix is invoked
 * 4. shutdownMcpBridge() — called on process exit
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.ts';
import { loadMcpServersConfig, type McpServerConfig } from './config.ts';

const MCP_TOOL_PREFIX = 'mcp_';
const MCP_SEP = '__';

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  tools: Anthropic.Tool[];
}

/** Active connections, keyed by server name */
const connections = new Map<string, McpConnection>();

/**
 * Initialize the MCP bridge — connect to all enabled servers.
 * Called once at boot from start-server.ts.
 * Failures are non-fatal: a server that fails to connect is skipped.
 */
export async function initMcpBridge(): Promise<void> {
  const serversConfig = loadMcpServersConfig();
  const enabledServers = Object.entries(serversConfig).filter(([, cfg]) => cfg.enabled);

  if (enabledServers.length === 0) {
    logger.info('No enabled MCP servers — bridge inactive');
    return;
  }

  for (const [name, cfg] of enabledServers) {
    try {
      await connectServer(name, cfg);
      logger.info({ server: name, tools: connections.get(name)?.tools.length ?? 0 }, 'MCP server connected');
    } catch (err) {
      logger.warn(
        { server: name, err: err instanceof Error ? err.message : String(err) },
        'MCP server connection failed — skipping',
      );
    }
  }

  const totalTools = [...connections.values()].reduce((sum, c) => sum + c.tools.length, 0);
  logger.info({ servers: connections.size, tools: totalTools }, 'MCP bridge initialized');
}

async function connectServer(name: string, cfg: McpServerConfig): Promise<void> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: { ...process.env, ...cfg.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'makilab', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  // Discover tools with pagination
  const tools: Anthropic.Tool[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(cursor ? { cursor } : undefined);

    for (const tool of result.tools) {
      tools.push({
        name: `${MCP_TOOL_PREFIX}${name}${MCP_SEP}${tool.name}`,
        description: `[MCP:${name}] ${tool.description ?? tool.name}`,
        input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
      });
    }

    cursor = result.nextCursor;
  } while (cursor);

  connections.set(name, { client, transport, serverName: name, tools });
}

/**
 * Get all MCP tools in Anthropic format.
 * Called by buildToolList() in agent-loop.ts and agent-loop-stream.ts.
 */
export function getMcpTools(): Anthropic.Tool[] {
  const allTools: Anthropic.Tool[] = [];
  for (const conn of connections.values()) {
    allTools.push(...conn.tools);
  }
  return allTools;
}

/**
 * Check if a tool name is an MCP tool (starts with mcp_ prefix).
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
}

/**
 * Parse an MCP tool name into server name and tool name.
 * e.g. "mcp_notebooklm__notebook_query" → { server: "notebooklm", tool: "notebook_query" }
 */
export function parseMcpToolName(fullName: string): { server: string; tool: string } | null {
  if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null;
  const withoutPrefix = fullName.slice(MCP_TOOL_PREFIX.length);
  const sepIndex = withoutPrefix.indexOf(MCP_SEP);
  if (sepIndex === -1) return null;
  return {
    server: withoutPrefix.slice(0, sepIndex),
    tool: withoutPrefix.slice(sepIndex + MCP_SEP.length),
  };
}

/**
 * Call an MCP tool by its full name.
 * Returns the text result or an error message.
 */
export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; text: string }> {
  const parsed = parseMcpToolName(fullName);
  if (!parsed) {
    return { success: false, text: `Invalid MCP tool name: ${fullName}` };
  }

  const conn = connections.get(parsed.server);
  if (!conn) {
    return { success: false, text: `MCP server "${parsed.server}" not connected` };
  }

  try {
    const result = await conn.client.callTool(
      { name: parsed.tool, arguments: args },
      undefined,
      { maxTotalTimeout: 60_000 },
    );

    // Extract text from content blocks
    const textParts: string[] = [];
    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        }
      }
    }

    const text = textParts.join('\n') || JSON.stringify(result.content);
    return { success: !result.isError, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ server: parsed.server, tool: parsed.tool, err: message }, 'MCP tool call failed');
    return { success: false, text: `Erreur MCP (${parsed.server}/${parsed.tool}): ${message}` };
  }
}

/**
 * Gracefully disconnect all MCP servers.
 * Called on process shutdown.
 */
export async function shutdownMcpBridge(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      await conn.client.close();
      logger.info({ server: name }, 'MCP server disconnected');
    } catch {
      // Ignore shutdown errors
    }
  }
  connections.clear();
}
```

**Step 2: Commit**

```bash
git add packages/agent/src/mcp/bridge.ts
git commit -m "feat(E13): MCP bridge — connect, discover, call tools"
```

---

### Task 4: Integrate MCP bridge into agent loops

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/src/agent-loop-stream.ts`
- Modify: `packages/agent/src/start-server.ts`

**Context:** The agent loops need to include MCP tools in their tool list and route MCP tool calls to the bridge. The boot sequence needs to init the bridge.

**Step 1: Modify agent-loop.ts**

Add import at top (after existing imports):

```typescript
import { getMcpTools, isMcpTool, callMcpTool } from './mcp/bridge.ts';
```

In `buildToolList()` function, after the legacy tools loop (around line 97), add before the `return`:

```typescript
  // MCP tools (auto-discovered from connected servers)
  anthropicTools.push(...getMcpTools());
```

In the tool execution section (inside the `for (const block of response.content)` loop, around line 203), the current code checks `block.name.includes(SUBAGENT_SEP)` for subagent calls. Add an MCP check BEFORE the subagent check:

```typescript
        // MCP tool call (name starts with mcp_)
        if (isMcpTool(block.name)) {
          logger.info({ tool: block.name }, 'MCP tool call');
          const result = await callMcpTool(block.name, block.input as Record<string, unknown>);
          resultContent = result.text;
          if (!result.success) {
            resultContent = `Erreur: ${result.text}`;
          }
        } else if (block.name.includes(SUBAGENT_SEP)) {
```

This means the `if (block.name.includes(SUBAGENT_SEP))` becomes `else if`.

**Step 2: Modify agent-loop-stream.ts**

Same changes as agent-loop.ts:

Add import at top:

```typescript
import { getMcpTools, isMcpTool, callMcpTool } from './mcp/bridge.ts';
```

In `buildToolList()`, add after legacy tools:

```typescript
  anthropicTools.push(...getMcpTools());
```

In the tool execution section (around line 155 where `const isSubagent = block.name.includes(SUBAGENT_SEP)` is), change to:

```typescript
          const isMcp = isMcpTool(block.name);
          const isSubagent = !isMcp && block.name.includes(SUBAGENT_SEP);
```

Then add MCP handling before the subagent block (around line 169):

```typescript
          if (isMcp) {
            logger.info({ tool: block.name }, 'MCP tool call');
            const mcpResult = await callMcpTool(block.name, block.input as Record<string, unknown>);
            resultContent = mcpResult.text;
            success = mcpResult.success;
          } else if (isSubagent) {
```

And update the `logAgentEvent` call to handle MCP tools:

```typescript
          const [subagentName, ...actionParts] = isSubagent ? block.name.split(SUBAGENT_SEP) : [undefined];
          const actionName = isSubagent ? actionParts.join(SUBAGENT_SEP) : block.name;
```

becomes:

```typescript
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
```

**Step 3: Modify start-server.ts**

Add import at top:

```typescript
import { initMcpBridge, shutdownMcpBridge } from './mcp/bridge.ts';
```

After the `initCollections()` call, add:

```typescript
// Initialize MCP bridge (no-op if no enabled servers in mcp-servers.json)
await initMcpBridge().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'MCP bridge init failed');
});
```

Before `await server.listen(...)`, add graceful shutdown:

```typescript
// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, 'Shutting down...');
    await shutdownMcpBridge();
    await server.close();
    process.exit(0);
  });
}
```

**Step 4: Run tests**

```bash
pnpm --filter @makilab/agent test
```

Expected: All 57 existing tests still pass (MCP bridge is no-op when no servers configured).

**Step 5: Commit**

```bash
git add packages/agent/src/agent-loop.ts packages/agent/src/agent-loop-stream.ts packages/agent/src/start-server.ts
git commit -m "feat(E13): integrate MCP bridge into agent loops + boot"
```

---

### Task 5: MCP bridge tests

**Files:**
- Create: `packages/agent/src/tests/mcp-bridge.test.ts`

**Context:** Test the pure functions (parseMcpToolName, isMcpTool) and the config loader.

**Step 1: Create tests**

Create `packages/agent/src/tests/mcp-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock config
vi.mock('../config.ts', () => ({
  config: {
    codeRepoRoot: process.platform === 'win32' ? 'C:\\temp\\fakerepo' : '/tmp/fakerepo',
  },
}));

// Mock logger
vi.mock('../logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('MCP bridge', () => {
  describe('parseMcpToolName', () => {
    it('parses a valid MCP tool name', async () => {
      const { parseMcpToolName } = await import('../mcp/bridge.ts');
      const result = parseMcpToolName('mcp_notebooklm__notebook_query');
      expect(result).toEqual({ server: 'notebooklm', tool: 'notebook_query' });
    });

    it('parses MCP tool with dashes in server name', async () => {
      const { parseMcpToolName } = await import('../mcp/bridge.ts');
      const result = parseMcpToolName('mcp_google-calendar__gcal_list_events');
      expect(result).toEqual({ server: 'google-calendar', tool: 'gcal_list_events' });
    });

    it('returns null for non-MCP tool', async () => {
      const { parseMcpToolName } = await import('../mcp/bridge.ts');
      expect(parseMcpToolName('tasks__create')).toBeNull();
    });

    it('returns null for malformed MCP tool (no separator)', async () => {
      const { parseMcpToolName } = await import('../mcp/bridge.ts');
      expect(parseMcpToolName('mcp_notseparated')).toBeNull();
    });
  });

  describe('isMcpTool', () => {
    it('returns true for MCP tools', async () => {
      const { isMcpTool } = await import('../mcp/bridge.ts');
      expect(isMcpTool('mcp_indeed__search_jobs')).toBe(true);
    });

    it('returns false for subagent tools', async () => {
      const { isMcpTool } = await import('../mcp/bridge.ts');
      expect(isMcpTool('tasks__create')).toBe(false);
    });

    it('returns false for legacy tools', async () => {
      const { isMcpTool } = await import('../mcp/bridge.ts');
      expect(isMcpTool('get_time')).toBe(false);
    });
  });

  describe('getMcpTools', () => {
    it('returns empty array when no servers connected', async () => {
      const { getMcpTools } = await import('../mcp/bridge.ts');
      expect(getMcpTools()).toEqual([]);
    });
  });
});
```

**Step 2: Run tests**

```bash
pnpm --filter @makilab/agent test
```

Expected: All tests pass (57 existing + 7 new = 64).

**Step 3: Commit**

```bash
git add packages/agent/src/tests/mcp-bridge.test.ts
git commit -m "test(E13): MCP bridge tests — parseMcpToolName, isMcpTool"
```

---

### Task 6: SQLite migration — recurring tasks columns

**Files:**
- Modify: `packages/agent/src/memory/sqlite.ts`

**Context:** Add 3 columns to the `tasks` table for recurring task support. Follow the existing migration pattern (see `migrateTasksAddBacklog` and `migrateTasksAddDescriptionTags` already in sqlite.ts).

**Step 1: Add migration function**

In `packages/agent/src/memory/sqlite.ts`, find the existing migration functions (search for `migrateTasksAdd`). Add a new function after the last one:

```typescript
function migrateTasksAddCronFields(): void {
  runMigration('tasks_add_cron_fields', () => {
    db().exec(`ALTER TABLE tasks ADD COLUMN cron_expression TEXT`);
    db().exec(`ALTER TABLE tasks ADD COLUMN cron_enabled INTEGER NOT NULL DEFAULT 0`);
    db().exec(`ALTER TABLE tasks ADD COLUMN cron_prompt TEXT`);
  });
}
```

Then in the `initSchema()` function, add a call to this migration after the existing migrations:

```typescript
migrateTasksAddCronFields();
```

**Step 2: Update createTask to accept cron fields**

Find the `createTask()` function. Add `cronExpression`, `cronEnabled`, and `cronPrompt` to its parameter type and INSERT statement.

Current parameters likely include `cronId`. Add:

```typescript
export function createTask(params: {
  title: string;
  createdBy: 'user' | 'agent' | 'cron';
  channel: string;
  priority?: string;
  context?: Record<string, unknown>;
  dueAt?: string;
  cronId?: string;
  description?: string;
  tags?: string[];
  cronExpression?: string;
  cronEnabled?: boolean;
  cronPrompt?: string;
}): string {
```

Add the columns to the INSERT:

```sql
INSERT INTO tasks (id, title, status, created_by, channel, priority, context, due_at, cron_id, description, tags, cron_expression, cron_enabled, cron_prompt)
VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And add the corresponding values:

```typescript
params.cronExpression ?? null,
params.cronEnabled ? 1 : 0,
params.cronPrompt ?? null,
```

**Step 3: Update updateTask to accept cron fields**

Find the `updateTask()` function. Add `cron_expression`, `cron_enabled`, `cron_prompt` to the allowed fields:

```typescript
export function updateTask(
  id: string,
  fields: {
    status?: string;
    title?: string;
    priority?: string;
    description?: string;
    tags?: string[];
    due_at?: string;
    cron_expression?: string | null;
    cron_enabled?: boolean;
    cron_prompt?: string | null;
  },
): TaskRow | null {
```

In the field-building loop, handle cron fields:

```typescript
if (fields.cron_expression !== undefined) { setClauses.push('cron_expression = ?'); values.push(fields.cron_expression); }
if (fields.cron_enabled !== undefined) { setClauses.push('cron_enabled = ?'); values.push(fields.cron_enabled ? 1 : 0); }
if (fields.cron_prompt !== undefined) { setClauses.push('cron_prompt = ?'); values.push(fields.cron_prompt); }
```

**Step 4: Add listRecurringTasks function**

Add a new exported function:

```typescript
/** List all tasks with cron_enabled = 1 */
export function listRecurringTasks(): TaskRow[] {
  const stmt = db().prepare('SELECT * FROM tasks WHERE cron_enabled = 1 ORDER BY created_at DESC');
  return [...stmt.all()] as TaskRow[];
}
```

**Step 5: Update TaskRow interface**

Find the `TaskRow` interface and add:

```typescript
export interface TaskRow {
  // ... existing fields ...
  cron_expression: string | null;
  cron_enabled: number; // 0 or 1
  cron_prompt: string | null;
}
```

**Step 6: Run tests**

```bash
pnpm --filter @makilab/agent test
```

Expected: All tests pass (existing tests should still work — new columns have defaults).

**Step 7: Commit**

```bash
git add packages/agent/src/memory/sqlite.ts
git commit -m "feat(E13): SQLite migration — cron_expression, cron_enabled, cron_prompt on tasks"
```

---

### Task 7: Dynamic CRON scheduler

**Files:**
- Modify: `packages/agent/src/tasks/cron.ts`

**Context:** The current CRON scheduler is hardcoded with 2 jobs. We need to add dynamic scheduling from the database. The existing hardcoded jobs stay as-is.

**Step 1: Add dynamic task scheduling**

Read the current `packages/agent/src/tasks/cron.ts` first.

Add import:

```typescript
import { listRecurringTasks } from '../memory/sqlite.ts';
```

Add a map to track active CRON jobs:

```typescript
import type { ScheduledTask } from 'node-cron';

const dynamicJobs = new Map<string, ScheduledTask>();
```

Add a function to sync CRON jobs from the database:

```typescript
/** Load recurring tasks from DB and schedule them */
export function syncRecurringTasks(): void {
  // Stop all existing dynamic jobs
  for (const [id, job] of dynamicJobs) {
    job.stop();
    dynamicJobs.delete(id);
  }

  const tasks = listRecurringTasks();
  for (const task of tasks) {
    if (!task.cron_expression || !task.cron_prompt) continue;

    try {
      const job = cron.schedule(task.cron_expression, async () => {
        logger.info({ taskId: task.id, title: task.title }, 'Running recurring task');
        try {
          await runAgentLoop(task.cron_prompt!, {
            channel: (task.channel as Channel) ?? 'cli',
            from: 'cron',
            history: [],
          });
        } catch (err) {
          logger.error({ taskId: task.id, err: err instanceof Error ? err.message : String(err) }, 'Recurring task failed');
        }
      });

      dynamicJobs.set(task.id, job);
      logger.info({ taskId: task.id, cron: task.cron_expression, title: task.title }, 'Scheduled recurring task');
    } catch (err) {
      logger.warn({ taskId: task.id, cron: task.cron_expression, err: err instanceof Error ? err.message : String(err) }, 'Invalid cron expression — skipping');
    }
  }

  logger.info({ count: dynamicJobs.size }, 'Dynamic CRON jobs synced');
}
```

Call `syncRecurringTasks()` at the end of the existing `startCron()` function:

```typescript
export function startCron(): void {
  if (!config.cronEnabled) {
    logger.info('CRON disabled');
    return;
  }

  // ... existing hardcoded jobs ...

  // Dynamic recurring tasks from database
  syncRecurringTasks();
}
```

Also export `syncRecurringTasks` so it can be called when a task is created/updated via the API.

**Step 2: Run tests**

```bash
pnpm --filter @makilab/agent test
```

**Step 3: Commit**

```bash
git add packages/agent/src/tasks/cron.ts
git commit -m "feat(E13): dynamic CRON scheduler from recurring tasks"
```

---

### Task 8: Enrich tasks subagent with CRON fields

**Files:**
- Modify: `packages/agent/src/subagents/tasks.ts`

**Context:** The tasks subagent needs to accept `cron_expression`, `cron_enabled`, and `cron_prompt` when creating/updating tasks, so the LLM can create recurring tasks from chat.

**Step 1: Update create action schema**

In the `tasks.ts` subagent, find the `create` action's `inputSchema.properties`. Add:

```typescript
cron_expression: { type: 'string', description: 'Expression CRON pour tâches récurrentes (ex: "0 8 * * 1" = lundi 8h). Laisser vide pour une tâche ponctuelle.' },
cron_prompt: { type: 'string', description: 'Le prompt à exécuter quand le CRON se déclenche' },
```

**Step 2: Update the create handler**

In the function that handles `create`, pass the new fields to `createTask()`:

```typescript
cronExpression: input['cron_expression'] as string | undefined,
cronEnabled: !!(input['cron_expression']),  // auto-enable if expression provided
cronPrompt: input['cron_prompt'] as string | undefined,
```

After creating the task, if it has a CRON expression, call `syncRecurringTasks()`:

```typescript
import { syncRecurringTasks } from '../tasks/cron.ts';

// After createTask():
if (input['cron_expression']) {
  syncRecurringTasks();
}
```

**Step 3: Update the update handler**

Similarly, when a task is updated with CRON fields, sync:

```typescript
if (input['cron_expression'] !== undefined || input['cron_enabled'] !== undefined) {
  syncRecurringTasks();
}
```

**Step 4: Add list_recurring action**

Add a new action to the tasks subagent:

```typescript
{
  name: 'list_recurring',
  description: 'Liste toutes les tâches récurrentes (activées et désactivées)',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
},
```

And handle it in execute:

```typescript
if (action === 'list_recurring') return await listRecurring();
```

```typescript
async function listRecurring(): Promise<SubAgentResult> {
  const tasks = listRecurringTasks();
  if (tasks.length === 0) {
    return { success: true, text: 'Aucune tâche récurrente configurée.' };
  }
  const formatted = tasks.map((t) => {
    const status = t.cron_enabled ? '✅ Activée' : '⏸️ Désactivée';
    return `- **${t.title}** — ${t.cron_expression} — ${status}\n  Prompt: ${t.cron_prompt ?? '(aucun)'}`;
  }).join('\n');
  return { success: true, text: `${tasks.length} tâche(s) récurrente(s):\n\n${formatted}`, data: tasks };
}
```

**Step 5: Run tests**

```bash
pnpm --filter @makilab/agent test
```

**Step 6: Commit**

```bash
git add packages/agent/src/subagents/tasks.ts
git commit -m "feat(E13): tasks subagent — create/update recurring tasks + list_recurring"
```

---

### Task 9: API endpoints for recurring tasks

**Files:**
- Modify: `packages/agent/src/server.ts`

**Context:** The dashboard needs API endpoints to toggle recurring tasks on/off. The existing PATCH `/api/tasks/:id` already supports field updates, but needs to handle `cron_enabled`, `cron_expression`, `cron_prompt`. Also need a GET endpoint for recurring tasks.

**Step 1: Read server.ts first**

Read `packages/agent/src/server.ts` to understand the current API structure.

**Step 2: Add GET /api/tasks/recurring endpoint**

Add a new route (BEFORE the parameterized `/api/tasks/:id` route to avoid conflicts):

```typescript
server.get('/api/tasks/recurring', async (_request, reply) => {
  const tasks = listRecurringTasks();
  return reply.send(tasks);
});
```

Import `listRecurringTasks` from sqlite.ts.

**Step 3: Update PATCH /api/tasks/:id**

The existing PATCH handler likely builds a fields object from the request body. Add support for:

```typescript
if (body.cron_expression !== undefined) fields.cron_expression = body.cron_expression;
if (body.cron_enabled !== undefined) fields.cron_enabled = body.cron_enabled;
if (body.cron_prompt !== undefined) fields.cron_prompt = body.cron_prompt;
```

After the `updateTask()` call, sync CRON if cron fields changed:

```typescript
if (body.cron_expression !== undefined || body.cron_enabled !== undefined) {
  syncRecurringTasks();
}
```

Import `syncRecurringTasks` from `./tasks/cron.ts`.

**Step 4: Update POST /api/tasks**

The existing POST handler creates tasks. Add cron fields support:

```typescript
cronExpression: body.cron_expression,
cronEnabled: !!body.cron_expression,
cronPrompt: body.cron_prompt,
```

And sync after creation if recurring:

```typescript
if (body.cron_expression) {
  syncRecurringTasks();
}
```

**Step 5: Run tests**

```bash
pnpm --filter @makilab/agent test
```

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts
git commit -m "feat(E13): API — GET /api/tasks/recurring + CRON fields in PATCH/POST"
```

---

### Task 10: Dashboard — recurring task UI in Kanban

**Files:**
- Modify: `packages/dashboard/src/app/tasks/page.tsx` (or wherever TaskCard is defined)
- Modify: the TaskDetailPanel component
- Modify: the NewTaskModal component

**Context:** Add visual indicators and controls for recurring tasks in the Kanban board. Read the existing dashboard components first to understand the structure.

**Step 1: Read existing components**

Read the relevant files in `packages/dashboard/src/` to understand:
- Where TaskCard is defined (likely `app/tasks/` or `components/`)
- Where TaskDetailPanel lives
- Where NewTaskModal lives
- How they call the API

**Step 2: Add recurring badge to TaskCard**

In the TaskCard component, check if the task has `cron_expression`. If yes, add a badge:

```tsx
{task.cron_expression && (
  <span className="badge badge-recurring">
    {task.cron_enabled ? '🔄' : '⏸️'} {humanCron(task.cron_expression)}
  </span>
)}
```

Create a helper `humanCron(expr)` that converts CRON expressions to French:
- `0 8 * * 1` → "Chaque lundi à 8h"
- `0 7 * * *` → "Tous les jours à 7h"
- `0 */2 * * *` → "Toutes les 2h"
- Default: show raw expression

**Step 3: Add toggle in TaskDetailPanel**

In the TaskDetailPanel (the slide-in panel), add a section for recurring tasks:

```tsx
{task.cron_expression && (
  <div className="recurring-section">
    <h4>Tâche récurrente</h4>
    <label>
      <input
        type="checkbox"
        checked={task.cron_enabled}
        onChange={() => toggleCronEnabled(task.id, !task.cron_enabled)}
      />
      {task.cron_enabled ? 'Activée' : 'Désactivée'}
    </label>
    <p>Fréquence: {humanCron(task.cron_expression)}</p>
    <p>Prompt: {task.cron_prompt}</p>
  </div>
)}
```

`toggleCronEnabled` calls `PATCH /api/tasks/:id` with `{ cron_enabled: newValue }`.

**Step 4: Add CRON fields to NewTaskModal**

Add an optional "Tâche récurrente" toggle in the NewTaskModal. When enabled, show:
- A CRON expression input (with common presets: "Tous les jours", "Chaque lundi", "Chaque 1er du mois")
- A prompt textarea

**Step 5: Add CSS for recurring badges**

Style the recurring badge and toggle to match the existing dashboard design (dark mode, Linear/Vercel style).

**Step 6: Test manually**

Start `pnpm dev:dashboard` and `pnpm dev:api`, verify:
- Tasks with `cron_expression` show the badge
- Toggle on/off works
- Creating a new recurring task from modal works

**Step 7: Commit**

```bash
git add packages/dashboard/
git commit -m "feat(E13): dashboard — recurring task badges, toggle, creation"
```

---

### Task 11: PROGRESS.md update

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Update PROGRESS.md**

Add E13 section. Update epic table. Update handoff prompt.

E13 stories:

```markdown
## E13 — MCP Bridge + Tâches récurrentes

Design : `docs/plans/2026-03-01-e13-mcp-bridge-design.md`
Plan : `docs/plans/2026-03-01-e13-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L13.1 | Dependency @modelcontextprotocol/sdk | ✅ |
| L13.2 | MCP config loader + mcp-servers.json | ✅ |
| L13.3 | MCP bridge — connect, discover, call | ✅ |
| L13.4 | Integration agent loops + boot | ✅ |
| L13.5 | MCP bridge tests | ✅ |
| L13.6 | SQLite migration — cron fields on tasks | ✅ |
| L13.7 | Dynamic CRON scheduler | ✅ |
| L13.8 | Tasks subagent — recurring tasks support | ✅ |
| L13.9 | API endpoints — recurring tasks | ✅ |
| L13.10 | Dashboard — recurring task UI | ✅ |
```

Update epic table: `E13 | MCP Bridge + Tâches récurrentes | 🟢 Long terme | ✅ Terminé |`

Update statut global, dernière session, handoff prompt.

**Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "chore: PROGRESS.md — E13 MCP Bridge + Tâches récurrentes terminé ✅"
```

---

## Dependencies between tasks

```
Task 1 (SDK install) → Task 2 (config) → Task 3 (bridge) → Task 4 (integration) → Task 5 (tests)
                                                                    ↓
Task 6 (SQLite migration) → Task 7 (CRON scheduler) → Task 8 (tasks subagent) → Task 9 (API) → Task 10 (dashboard)
                                                                    ↓
                                                              Task 11 (PROGRESS.md)
```

Tasks 1-5 (MCP bridge) and Task 6 (migration) are independent — they can be done in parallel.
Tasks 7-10 depend on Task 6.
Task 11 is last.

## Notes for implementer

- **Windows platform**: The repo is on `d:/SynologyDrive/IA et agents/makilab`. Use forward slashes in Node.js paths. `StdioClientTransport` on Windows may need `shell: true` — test and adjust.
- **MCP servers are all `enabled: false`** initially. The bridge works but does nothing until a server is enabled. This is intentional — focus is on the infrastructure, not individual server auth.
- **Individual MCP server auth** will be configured later per-server. Each one has its own auth mechanism (OAuth for Calendar, headless Chrome for NotebookLM, session token for Indeed).
- **The `humanCron()` helper** should handle the most common patterns. For exotic expressions, fall back to showing the raw CRON string.
- **`syncRecurringTasks()`** should be called every time a task's CRON fields change. This is a full resync (stop all dynamic jobs, reload from DB).
- **Existing tests must not break**. The MCP bridge is a no-op when no servers are configured, and the CRON changes add new behavior without removing existing.
