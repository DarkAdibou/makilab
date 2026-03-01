import { describe, it, expect } from 'vitest';
import { createLlmClient } from '../llm/client.ts';

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
