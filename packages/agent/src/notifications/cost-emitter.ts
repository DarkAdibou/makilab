import { getOptimizationSuggestions } from '../llm/catalog.ts';
import { notify } from './engine.ts';

/** Check for cost optimizations and emit notification if significant savings found */
export async function checkCostOptimizations(): Promise<void> {
  const suggestions = getOptimizationSuggestions();
  const significant = suggestions.filter(s => s.savingsPercent >= 30);

  if (significant.length === 0) return;

  const body = significant.map(s =>
    `${s.taskType}: ${s.currentModel} → ${s.suggestedModel} (-${s.savingsPercent}%)`
  ).join('\n');

  await notify({
    type: 'cost_optimization',
    severity: 'info',
    title: `${significant.length} optimisation(s) de coûts disponible(s)`,
    body,
    link: '/models',
  });
}
