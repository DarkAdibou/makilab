import { getLlmModel, getLlmModels } from '../memory/sqlite.ts';
import { scoreModelsForTask } from '../llm/catalog.ts';
import type { TaskType } from './router.ts';

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

export function listAvailableModels(taskType?: TaskType): Array<{ id: string; label: string; provider: string; recommended: boolean }> {
  const models = getLlmModels({ tools: true })
    .filter(m => m.modality.includes('text'))
    .map(m => ({ id: m.id, label: m.name, provider: m.provider_slug, recommended: false }));

  if (taskType) {
    const topIds = scoreModelsForTask(taskType, 3).map(s => s.modelId);
    const ranked = models.map(m => ({ ...m, recommended: topIds.includes(m.id), _rank: topIds.indexOf(m.id) }));
    return ranked
      .sort((a, b) => {
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        if (a.recommended && b.recommended) return a._rank - b._rank;
        return a.label.localeCompare(b.label);
      })
      .map(({ _rank, ...m }) => m);
  }

  return models.sort((a, b) => a.label.localeCompare(b.label));
}
