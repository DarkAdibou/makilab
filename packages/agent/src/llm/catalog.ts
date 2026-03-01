import { upsertLlmModel, getLlmModels, getLlmModel, getLlmModelsCount, getLlmModelLastUpdate, getRouteForTaskType, getRouteConfig, createTask, listRecurringTasks } from '../memory/sqlite.ts';
import type { LlmModelRow } from '../memory/sqlite.ts';
import { logger } from '../logger.ts';
import type { TaskType } from './router.ts';

export interface CatalogFilter {
  tools?: boolean;
  reasoning?: boolean;
  minContext?: number;
  maxPriceInput?: number;
  provider?: string;
  search?: string;
}

export interface ModelScore {
  modelId: string;
  name: string;
  score: number;
  priceInput: number;
  priceOutput: number;
}

/** Fetch OpenRouter public API and upsert all models into SQLite cache */
export async function refreshCatalog(): Promise<number> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);

  const data = await res.json() as { data: Array<{
    id: string; name: string; context_length: number;
    architecture?: { modality?: string };
    pricing: { prompt: string; completion: string };
    supported_parameters?: string[];
  }> };

  let count = 0;
  for (const m of data.data) {
    const priceIn = parseFloat(m.pricing.prompt) * 1_000_000;
    const priceOut = parseFloat(m.pricing.completion) * 1_000_000;
    if (isNaN(priceIn) || isNaN(priceOut)) continue;

    const providerSlug = m.id.split('/')[0] ?? 'unknown';
    const params = m.supported_parameters ?? [];

    upsertLlmModel({
      id: m.id,
      name: m.name,
      provider_slug: providerSlug,
      context_length: m.context_length ?? 0,
      price_input_per_m: priceIn,
      price_output_per_m: priceOut,
      supports_tools: params.includes('tools') ? 1 : 0,
      supports_reasoning: params.includes('reasoning') ? 1 : 0,
      modality: m.architecture?.modality ?? 'text->text',
      updated_at: '',
    });
    count++;
  }

  // Also seed Anthropic models (not on OpenRouter with same IDs)
  seedAnthropicModels();

  logger.info({ count }, 'Catalog refreshed');
  return count;
}

/** Seed Anthropic models with known prices (they use different IDs than OpenRouter) */
function seedAnthropicModels(): void {
  const models: Array<Omit<LlmModelRow, 'updated_at'>> = [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider_slug: 'anthropic', context_length: 200000, price_input_per_m: 15.0, price_output_per_m: 75.0, supports_tools: 1, supports_reasoning: 1, modality: 'text->text' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider_slug: 'anthropic', context_length: 200000, price_input_per_m: 3.0, price_output_per_m: 15.0, supports_tools: 1, supports_reasoning: 1, modality: 'text->text' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider_slug: 'anthropic', context_length: 200000, price_input_per_m: 1.0, price_output_per_m: 5.0, supports_tools: 1, supports_reasoning: 0, modality: 'text->text' },
  ];
  for (const m of models) {
    upsertLlmModel({ ...m, updated_at: '' });
  }
}

/** Init catalog: refresh if cache empty or stale (>24h) */
export async function initCatalog(): Promise<void> {
  const count = getLlmModelsCount();
  const lastUpdate = getLlmModelLastUpdate();

  if (count > 0 && lastUpdate) {
    const age = Date.now() - new Date(lastUpdate + 'Z').getTime();
    if (age < 24 * 60 * 60 * 1000) {
      logger.info({ count, lastUpdate }, 'Catalog cache fresh — skipping refresh');
      return;
    }
  }

  try {
    await refreshCatalog();
  } catch (err) {
    if (count > 0) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Catalog refresh failed — using stale cache');
    } else {
      // No cache at all — seed Anthropic models at minimum
      seedAnthropicModels();
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Catalog refresh failed — seeded Anthropic models only');
    }
  }

  // Seed weekly cost briefing task if not exists
  seedWeeklyCostBriefing();
}

/** Create the weekly cost briefing recurring task if it doesn't exist yet */
function seedWeeklyCostBriefing(): void {
  try {
    const existing = listRecurringTasks().find(t => t.cron_id === 'weekly_cost_briefing');
    if (existing) return;

    createTask({
      title: 'Briefing hebdo coûts LLM',
      createdBy: 'cron',
      channel: 'mission_control',
      cronId: 'weekly_cost_briefing',
      cronExpression: '0 8 * * 1',
      cronEnabled: true,
      cronPrompt: 'Génère un résumé des coûts LLM de la semaine : tokens consommés par type de tâche, modèles utilisés, coût total, et suggestions d\'optimisation. Sois concis et actionnable.',
      description: 'Briefing automatique hebdomadaire (lundi 8h) — résumé coûts et optimisations LLM',
    });
    logger.info({}, 'Seeded weekly cost briefing recurring task');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to seed weekly cost briefing — skipping');
  }
}

// Task types that require tool support
const TOOL_REQUIRED_TASKS: TaskType[] = ['conversation', 'cron_task', 'orchestration'];

/** Score models for a given task type, return top N */
export function scoreModelsForTask(taskType: TaskType, topN = 3): ModelScore[] {
  const needsTools = TOOL_REQUIRED_TASKS.includes(taskType);
  const models = getLlmModels({
    tools: needsTools || undefined,
    minContext: 32000,
  }).filter(m => {
    // Text modality only
    if (!m.modality.includes('text')) return false;
    // Skip free models (unstable)
    if (m.price_input_per_m <= 0 && m.price_output_per_m <= 0) return false;
    return true;
  });

  const scored = models.map(m => {
    let score = 1 / (m.price_input_per_m + m.price_output_per_m + 0.01);
    // Bonus for reasoning on complex tasks
    if (['conversation', 'cron_task'].includes(taskType) && m.supports_reasoning) {
      score *= 1.5;
    }
    // Bonus for large context
    if (m.context_length >= 200000) {
      score *= 1.2;
    }
    return { modelId: m.id, name: m.name, score, priceInput: m.price_input_per_m, priceOutput: m.price_output_per_m };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/** Get optimization suggestions: compare current routes vs best alternatives */
export function getOptimizationSuggestions(): Array<{
  taskType: string;
  currentModel: string;
  currentPriceIn: number;
  currentPriceOut: number;
  suggestedModel: string;
  suggestedName: string;
  suggestedPriceIn: number;
  suggestedPriceOut: number;
  savingsPercent: number;
}> {
  const routes = getRouteConfig();
  const suggestions: ReturnType<typeof getOptimizationSuggestions> = [];

  for (const route of routes) {
    const current = getLlmModel(route.model_id);
    if (!current) continue;

    const top = scoreModelsForTask(route.task_type as TaskType, 1);
    if (top.length === 0) continue;

    const best = top[0];
    if (best.modelId === route.model_id) continue;

    const currentTotal = current.price_input_per_m + current.price_output_per_m;
    const suggestedTotal = best.priceIn + best.priceOut;
    if (currentTotal <= 0) continue;

    const savings = ((currentTotal - suggestedTotal) / currentTotal) * 100;
    if (savings <= 5) continue; // Only suggest if >5% savings

    suggestions.push({
      taskType: route.task_type,
      currentModel: route.model_id,
      currentPriceIn: current.price_input_per_m,
      currentPriceOut: current.price_output_per_m,
      suggestedModel: best.modelId,
      suggestedName: best.name,
      suggestedPriceIn: best.priceInput,
      suggestedPriceOut: best.priceOutput,
      savingsPercent: Math.round(savings),
    });
  }

  return suggestions.sort((a, b) => b.savingsPercent - a.savingsPercent);
}
