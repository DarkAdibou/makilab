import { config } from '../config.ts';
import { getRouteForTaskType, getMemorySettings } from '../memory/sqlite.ts';

export type TaskType = 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_simple' | 'cron_moderate' | 'cron_task' | 'orchestration' | 'deep_search';

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
  cron_simple:      { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  cron_moderate:    { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  cron_task:        { provider: 'anthropic',   model: 'claude-sonnet-4-6' },
  orchestration:    { provider: 'anthropic',   model: 'claude-haiku-4-5-20251001' },
  deep_search:      { provider: 'openrouter',  model: 'perplexity/sonar-pro' },
};

/** Cached prefer_openrouter setting (avoid DB reads on every LLM call) */
let _preferOpenRouterCache: { value: boolean; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

function getPreferOpenRouter(): boolean {
  const now = Date.now();
  if (_preferOpenRouterCache && now - _preferOpenRouterCache.ts < CACHE_TTL_MS) {
    return _preferOpenRouterCache.value;
  }
  try {
    const settings = getMemorySettings();
    _preferOpenRouterCache = { value: settings.prefer_openrouter, ts: now };
    return settings.prefer_openrouter;
  } catch {
    return false;
  }
}

function inferProvider(model: string): 'anthropic' | 'openrouter' {
  if (getPreferOpenRouter() && config.openrouterApiKey) return 'openrouter';
  if (model.startsWith('claude-') || model.startsWith('anthropic/claude-')) return 'anthropic';
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
