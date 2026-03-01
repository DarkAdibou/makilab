import { describe, it, expect } from 'vitest';
import { safePath } from '../subagents/code-helpers.ts';

describe('code-helpers', () => {
  describe('safePath', () => {
    it('resolves a normal relative path', () => {
      const result = safePath('packages/agent/src/config.ts');
      expect(result).toContain('packages');
      expect(result).toContain('config.ts');
    });

    it('rejects path traversal with ../', () => {
      expect(() => safePath('../../etc/passwd')).toThrow('Path escape rejected');
    });

    it('rejects .env access', () => {
      expect(() => safePath('.env')).toThrow('Access to .env files is forbidden');
    });

    it('rejects .env.local access', () => {
      expect(() => safePath('.env.local')).toThrow('Access to .env files is forbidden');
    });

    it('allows nested paths that contain env in name', () => {
      const result = safePath('packages/agent/src/environment.ts');
      expect(result).toContain('environment.ts');
    });
  });
});
