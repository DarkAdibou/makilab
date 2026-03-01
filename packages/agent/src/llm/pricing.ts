import { getLlmModel, getLlmModels } from '../memory/sqlite.ts';

export function getModelPrice(model: string): { input: number; output: number } | null {
  const m = getLlmModel(model);
  if (!m) return null;
  return { input: m.price_input_per_m, output: m.price_output_per_m };
}

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = getModelPrice(model);
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

export function listAvailableModels(): Array<{ id: string; label: string; provider: string }> {
  return getLlmModels({ tools: true })
    .filter(m => m.modality.includes('text'))
    .map(m => ({ id: m.id, label: m.name, provider: m.provider_slug }));
}
