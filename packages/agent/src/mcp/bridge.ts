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
  connected: boolean;
}

const connections = new Map<string, McpConnection>();

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

  const conn: McpConnection = { client, transport, serverName: name, tools, connected: true };
  connections.set(name, conn);

  // Watch for transport close — remove tools if server crashes
  transport.onclose = () => {
    logger.warn({ server: name }, 'MCP server process closed — removing tools');
    conn.connected = false;
    conn.tools = [];
  };

  transport.onerror = (err) => {
    logger.warn({ server: name, err: err instanceof Error ? err.message : String(err) }, 'MCP server transport error');
    conn.connected = false;
    conn.tools = [];
  };
}

/** Get the status of all MCP connections for monitoring */
export function getMcpStatus(): Array<{ server: string; connected: boolean; tools: string[] }> {
  return [...connections.values()].map((conn) => ({
    server: conn.serverName,
    connected: conn.connected,
    tools: conn.tools.map((t) => t.name),
  }));
}

export function getMcpTools(): Anthropic.Tool[] {
  const allTools: Anthropic.Tool[] = [];
  for (const conn of connections.values()) {
    if (!conn.connected) continue;
    allTools.push(...conn.tools);
  }
  return allTools;
}

export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
}

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

export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; text: string }> {
  const parsed = parseMcpToolName(fullName);
  if (!parsed) {
    return { success: false, text: `Invalid MCP tool name: ${fullName}` };
  }

  const conn = connections.get(parsed.server);
  if (!conn || !conn.connected) {
    return { success: false, text: `MCP server "${parsed.server}" not connected` };
  }

  try {
    const result = await conn.client.callTool(
      { name: parsed.tool, arguments: args },
      undefined,
      { maxTotalTimeout: 60_000 },
    );

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
