import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export interface McpServerConfig {
  // Stdio transport (existing)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP transport (new)
  transport?: 'stdio' | 'http';
  url?: string;
  headers?: Record<string, string>;
  // Common
  enabled?: boolean;
}

export type McpServersConfig = Record<string, McpServerConfig>;

const CONFIG_FILENAME = 'mcp-servers.json';

export function loadMcpServersConfig(): McpServersConfig {
  const configPath = resolve(config.codeRepoRoot, CONFIG_FILENAME);

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const servers: McpServersConfig = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('$') || key.startsWith('_')) continue;
      if (!value || typeof value !== 'object') continue;
      const cfg = value as Record<string, unknown>;

      const transport = (cfg['transport'] as string) ?? 'stdio';

      if (transport === 'http') {
        if (!cfg['url'] || typeof cfg['url'] !== 'string') continue;
        servers[key] = {
          transport: 'http',
          url: cfg['url'] as string,
          headers: (cfg['headers'] as Record<string, string>) ?? {},
          enabled: cfg['enabled'] !== false,
        };
      } else {
        if (!cfg['command'] || typeof cfg['command'] !== 'string') continue;
        servers[key] = {
          transport: 'stdio',
          command: cfg['command'] as string,
          args: (cfg['args'] as string[]) ?? [],
          env: (cfg['env'] as Record<string, string>) ?? {},
          enabled: cfg['enabled'] !== false,
        };
      }
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
