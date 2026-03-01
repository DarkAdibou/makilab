import { describe, it, expect } from 'vitest';
import { logLlmUsage, getLlmUsageSummary, getLlmUsageHistory, getRecentLlmUsage } from '../memory/sqlite.ts';

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

  it('returns history', () => {
    const history = getLlmUsageHistory(30);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty('date');
    expect(history[0]).toHaveProperty('cost');
  });
});
