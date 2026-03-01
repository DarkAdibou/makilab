import { describe, it, expect } from 'vitest';
import { resolveModel } from '../llm/router.ts';

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

  it('routes classification', () => {
    const route = resolveModel('classification');
    expect(route.provider).toBeDefined();
  });

  it('respects explicit model override', () => {
    const route = resolveModel('conversation', 'claude-opus-4-6');
    expect(route.model).toBe('claude-opus-4-6');
    expect(route.provider).toBe('anthropic');
  });

  it('infers openrouter provider for non-claude model', () => {
    const route = resolveModel('conversation', 'google/gemini-2.0-flash-001');
    expect(route.model).toBe('google/gemini-2.0-flash-001');
    expect(route.provider).toBe('openrouter');
  });
});
