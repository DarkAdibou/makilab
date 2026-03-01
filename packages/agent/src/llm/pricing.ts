/** Per-million-token pricing (USD) */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':             { input: 15.0,  output: 75.0 },
  'claude-sonnet-4-6':           { input: 3.0,   output: 15.0 },
  'claude-haiku-4-5-20251001':   { input: 0.80,  output: 4.0 },
  // OpenRouter
  'google/gemini-2.0-flash-001': { input: 0.10,  output: 0.40 },
  'meta-llama/llama-4-scout':    { input: 0.15,  output: 0.60 },
};

export function getModelPrice(model: string): { input: number; output: number } | null {
  return PRICING[model] ?? null;
}

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

export function listAvailableModels(): Array<{ id: string; label: string; provider: string }> {
  return [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', provider: 'anthropic' },
    { id: 'claude-opus-4-6', label: 'Claude Opus', provider: 'anthropic' },
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini Flash', provider: 'openrouter' },
  ];
}
