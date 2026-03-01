import { config } from '../config.ts';

export type TaskType = 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task' | 'orchestration';

interface ModelRoute {
  provider: 'anthropic' | 'openrouter';
  model: string;
}

const DEFAULT_ROUTES: Record<TaskType, ModelRoute> = {
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

/**
 * Resolve which provider + model to use for a given task type.
 *
 * Priority:
 * 1. Explicit model override (from chat dropdown or task config)
 * 2. Default route for the task type
 * 3. Falls back to anthropic if openrouter key missing
 */
export function resolveModel(taskType: TaskType, modelOverride?: string): ModelRoute {
  if (modelOverride) {
    return { provider: inferProvider(modelOverride), model: modelOverride };
  }

  const route = DEFAULT_ROUTES[taskType];

  if (route.provider === 'openrouter' && !config.openrouterApiKey) {
    return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  }

  return route;
}
