import { describe, it, expect } from 'vitest';
import { calculateCost, getModelPrice, listAvailableModels } from '../llm/pricing.ts';

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

  it('lists available models', () => {
    const models = listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0]).toHaveProperty('label');
    expect(models[0]).toHaveProperty('provider');
  });
});
