import { createLlmClient } from './client.ts';
import { scoreModelsForTask } from './catalog.ts';
import { logger } from '../logger.ts';
import type { TaskType } from './router.ts';

interface TaskClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  sensitive: boolean;
  needsTools: boolean;
}

/**
 * Classify a recurring task prompt and return the optimal model ID.
 * Uses a cheap LLM call to classify complexity, then the catalog scorer picks the best model.
 */
export async function classifyAndAssignModel(cronPrompt: string): Promise<string | null> {
  try {
    const client = createLlmClient();
    const response = await client.chat({
      taskType: 'classification',
      messages: [{ role: 'user', content: cronPrompt }],
      system: `Tu es un classificateur de tâches. Analyse ce prompt de tâche récurrente et retourne UNIQUEMENT du JSON:
{"complexity": "simple|moderate|complex", "sensitive": false, "needsTools": true}

Règles:
- simple: rappels, résumés, vérifications de statut, extractions courtes
- moderate: analyses, raisonnement multi-étapes, rédaction moyenne
- complex: raisonnement profond, contenu long, créativité
- sensitive: true si données personnelles, finances, emails
- needsTools: true si la tâche nécessite d'appeler des APIs/outils externes`,
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

    // Map complexity + tools to task type for scoring
    let taskType: TaskType;
    if (parsed.complexity === 'complex') {
      taskType = 'conversation';
    } else if (parsed.needsTools) {
      taskType = 'orchestration';
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
