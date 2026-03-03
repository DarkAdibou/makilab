import { createLlmClient } from './client.ts';
import { scoreModelsForTask } from './catalog.ts';
import { resolveModel } from './router.ts';
import { logger } from '../logger.ts';
import type { TaskType } from './router.ts';

interface TaskClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  sensitive: boolean;
  needsTools: boolean;
}

/**
 * Classify a recurring task prompt and return the optimal model ID.
 * Uses a cheap LLM call to classify complexity, then routes to the appropriate cron_* task type.
 * An optional complexityHint (from the agent) skips the LLM classification.
 */
export async function classifyAndAssignModel(cronPrompt: string, complexityHint?: 'simple' | 'moderate' | 'complex'): Promise<string | null> {
  try {
    // If agent already classified complexity, use it directly
    if (complexityHint) {
      const taskType = complexityHint === 'complex' ? 'cron_task'
        : complexityHint === 'moderate' ? 'cron_moderate'
        : 'cron_simple';
      return resolveModel(taskType).model;
    }

    const client = createLlmClient();
    const response = await client.chat({
      taskType: 'classification',
      messages: [{ role: 'user', content: cronPrompt }],
      system: `Tu es un classificateur de tâches agentiques. Analyse ce prompt et retourne UNIQUEMENT du JSON:
{"complexity": "simple|moderate|complex", "sensitive": false, "needsTools": true}

Règles complexité:
- simple: action unique avec 1 outil (météo, rappel, timer, statut simple)
- moderate: combine 2-3 sources ou nécessite une synthèse (briefing, résumé emails, rapport court)
- complex: recherche web + analyse, multi-étapes, décision, veille (toujours prendre le niveau supérieur si doute)
- sensitive: true si données personnelles, finances, emails privés
- needsTools: true si la tâche nécessite d'appeler des APIs/outils externes (météo, web, email, domotique, etc.)`,
      maxTokens: 100,
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    // Extract JSON from response (might have markdown fences)
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      logger.warn({ text }, 'Task classification: no JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as TaskClassification;

    // Force Anthropic for sensitive tasks
    if (parsed.sensitive) return 'claude-sonnet-4-6';

    // Tasks needing tools → use configurable cron_* routes (never OpenRouter catalog scoring)
    if (parsed.needsTools) {
      if (parsed.complexity === 'complex') {
        // complex + tools → cron_task (Sonnet by default, user-configurable)
        return resolveModel('cron_task').model;
      } else if (parsed.complexity === 'moderate') {
        return resolveModel('cron_moderate').model;
      } else {
        return resolveModel('cron_simple').model;
      }
    }

    // No tools needed → score from catalog (OpenRouter ok for pure text tasks)
    let taskType: TaskType;
    if (parsed.complexity === 'complex') {
      taskType = 'conversation';
    } else {
      taskType = 'classification'; // cheapest
    }

    const scores = scoreModelsForTask(taskType, 1);
    return scores[0]?.modelId ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Task classification failed — skipping auto-model');
    return null;
  }
}
