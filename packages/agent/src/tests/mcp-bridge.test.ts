import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.ts', () => ({
  config: {
    codeRepoRoot: process.platform === 'win32' ? 'C:\\temp\\fakerepo' : '/tmp/fakerepo',
  },
}));

vi.mock('../logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn() };
});

describe('MCP bridge', () => {
  describe('loadMcpServersConfig', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('parses HTTP transport config', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'google-maps': {
            transport: 'http',
            url: 'https://mapstools.googleapis.com/mcp',
            headers: { 'X-Goog-Api-Key': 'test-key' },
            enabled: true,
          },
        }),
      );
      const { loadMcpServersConfig } = await import('../mcp/config.ts');
      const result = loadMcpServersConfig();
      expect(result['google-maps']).toMatchObject({
        transport: 'http',
        url: 'https://mapstools.googleapis.com/mcp',
        headers: { 'X-Goog-Api-Key': 'test-key' },
        enabled: true,
      });
    });

    it('skips HTTP config without url', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'bad-http': {
            transport: 'http',
            enabled: true,
          },
        }),
      );
      const { loadMcpServersConfig } = await import('../mcp/config.ts');
      const result = loadMcpServersConfig();
      expect(result['bad-http']).toBeUndefined();
    });

    it('defaults to stdio transport for existing configs', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'my-server': {
            command: 'npx',
            args: ['-y', 'some-mcp'],
            enabled: true,
          },
        }),
      );
      const { loadMcpServersConfig } = await import('../mcp/config.ts');
      const result = loadMcpServersConfig();
      expect(result['my-server']).toMatchObject({
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'some-mcp'],
        enabled: true,
      });
    });
  });

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
