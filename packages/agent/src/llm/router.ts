import { config } from '../config.ts';
import { getRouteForTaskType } from '../memory/sqlite.ts';

export type TaskType = 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task' | 'orchestration';

interface ModelRoute {
  provider: 'anthropic' | 'openrouter';
  model: string;
}

/** Fallback routes if DB not yet initialized */
const FALLBACK_ROUTES: Record<TaskType, ModelRoute> = {
  conversation:     { provider: 'anthropic',   model: 'claude-sonnet-4-6' },
  compaction:       { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  fact_extraction:  { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  classification:   { provider: 'openrouter',  model: 'google/gemini-2.0-flash-001' },
  cron_task:        { provider: 'anthropic',   model: 'claude-sonnet-4-6' },
  orchestration:    { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
};

function inferProvider(model: string): 'anthropic' | 'openrouter' {
  if (model.startsWith('claude-')) return 'anthropic';
  return 'openrouter';
}

export function resolveModel(taskType: TaskType, modelOverride?: string): ModelRoute {
  if (modelOverride) {
    return { provider: inferProvider(modelOverride), model: modelOverride };
  }

  // Try DB route first
  const dbModel = getRouteForTaskType(taskType);
  if (dbModel) {
    const route: ModelRoute = { provider: inferProvider(dbModel), model: dbModel };
    if (route.provider === 'openrouter' && !config.openrouterApiKey) {
      return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
    }
    return route;
  }

  // Fallback
  const fallback = FALLBACK_ROUTES[taskType];
  if (fallback.provider === 'openrouter' && !config.openrouterApiKey) {
    return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  }
  return fallback;
}
