import { describe, it, expect, vi } from 'vitest';

// Mock child_process to prevent actual execution
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
    if (cb) cb(null, { stdout: '', stderr: '' });
  }),
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    pid: 12345,
  })),
}));

// Mock config with a temp directory as repo root
vi.mock('../config.ts', () => ({
  config: {
    codeRepoRoot: process.platform === 'win32' ? 'C:\\temp\\fakerepo' : '/tmp/fakerepo',
    makilabEnv: 'development',
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

describe('code subagent', () => {
  describe('execute dispatch', () => {
    it('returns error for unknown action', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.text).toContain('inconnue');
    });

    it('has 11 actions declared', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      expect(codeSubAgent.actions).toHaveLength(11);
    });

    it('has name "code"', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      expect(codeSubAgent.name).toBe('code');
    });
  });

  describe('run_check whitelist', () => {
    it('rejects non-whitelisted commands', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('run_check', { command: 'rm' });
      expect(result.success).toBe(false);
      expect(result.text).toContain('non autorisée');
    });
  });

  describe('restart_service validation', () => {
    it('rejects unknown service', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('restart_service', { service: 'postgres' });
      expect(result.success).toBe(false);
      expect(result.text).toContain('inconnu');
    });
  });

  describe('git_push safety', () => {
    it('blocks push on master', async () => {
      // Mock currentBranch to return 'master'
      vi.doMock('../subagents/code-helpers.ts', async (importOriginal) => {
        const original = await importOriginal() as Record<string, unknown>;
        return {
          ...original,
          currentBranch: vi.fn().mockResolvedValue('master'),
        };
      });
      // Re-import to pick up mock
      vi.resetModules();
      const { codeSubAgent: freshSubAgent } = await import('../subagents/code.ts');
      const result = await freshSubAgent.execute('git_push', {});
      expect(result.success).toBe(false);
      expect(result.text).toContain('interdit');
    });
  });
});
