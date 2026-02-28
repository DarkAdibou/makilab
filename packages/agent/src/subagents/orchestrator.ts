/**
 * orchestrator.ts — Subagent Orchestrator
 *
 * Routes user requests to the appropriate subagent(s) via LLM reasoning.
 * Supports sequential and parallel composition of subagent calls.
 *
 * Flow:
 * 1. LLM analyzes the user message + available subagents
 * 2. LLM returns a plan: list of {subagent, action, input} calls
 * 3. Orchestrator executes the plan (sequential or parallel)
 * 4. Results are aggregated and returned as a structured context
 *
 * The plan is expressed as JSON tool calls so the LLM can reason about
 * dependencies between steps (e.g. "search web first, then save to Obsidian").
 *
 * Extension points:
 * - E3: Permission check before each execute()
 * - E6: Persist plan as a Task in PostgreSQL
 * - E14: LLM Router selects model per subagent+action cost
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { findSubAgent, getAllSubAgents, buildCapabilitiesPrompt } from './registry.ts';
import type { SubAgentResult } from './types.ts';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/** A single step in a subagent execution plan */
export interface PlanStep {
  subagent: string;
  action: string;
  input: Record<string, unknown>;
  /** If true, this step can run in parallel with other parallel steps */
  parallel?: boolean;
}

/** Result of executing an orchestrated plan */
export interface OrchestratorResult {
  /** All step results, in execution order */
  steps: Array<{ step: PlanStep; result: SubAgentResult }>;
  /** Aggregated text for injection into the final LLM call */
  context: string;
}

/**
 * Parse the user message and build an execution plan using the LLM.
 * Returns null if no subagent call is needed (pure conversation).
 */
async function buildPlan(
  userMessage: string,
  conversationContext: string,
): Promise<PlanStep[] | null> {
  const subagents = getAllSubAgents();
  if (subagents.length === 0) return null;

  const capabilitiesPrompt = buildCapabilitiesPrompt();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // Cheap model for routing decisions
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Tu es le routeur d'un agent IA personnel. Ton rôle est de décider quels subagents appeler pour répondre à la demande de l'utilisateur.

${capabilitiesPrompt}

${conversationContext ? `Contexte de la conversation:\n${conversationContext}\n` : ''}

Message de l'utilisateur: "${userMessage}"

Analyse la demande et retourne un plan JSON.

RÈGLES:
- Retourne UNIQUEMENT du JSON valide (sans markdown)
- Si aucun subagent n'est nécessaire (conversation pure, question sur toi-même...), retourne: {"needs_subagent": false}
- Si des subagents sont nécessaires, retourne: {"needs_subagent": true, "steps": [...]}
- Chaque step: {"subagent": "nom", "action": "action", "input": {}, "parallel": false}
- "parallel": true si le step peut s'exécuter en parallèle avec d'autres steps parallèles
- Préfère la simplicité : un seul subagent si possible`,
      },
    ],
  });

  const raw = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  const plan = JSON.parse(text) as { needs_subagent: boolean; steps?: PlanStep[] };
  if (!plan.needs_subagent || !plan.steps || plan.steps.length === 0) {
    return null;
  }

  return plan.steps;
}

/**
 * Execute a plan: run sequential steps one by one, parallel steps concurrently.
 * Permission checks will be added in E3 around execute().
 */
async function executePlan(
  steps: PlanStep[],
): Promise<Array<{ step: PlanStep; result: SubAgentResult }>> {
  const results: Array<{ step: PlanStep; result: SubAgentResult }> = [];

  // Separate sequential and parallel steps
  // Simple strategy: parallel steps run together, sequential steps run in order
  // A step with parallel=true groups with adjacent parallel steps
  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;

    if (step.parallel) {
      // Collect all consecutive parallel steps
      const parallelGroup: PlanStep[] = [step];
      while (i + 1 < steps.length && steps[i + 1]!.parallel) {
        i++;
        parallelGroup.push(steps[i]!);
      }

      // Execute group in parallel
      const groupResults = await Promise.all(
        parallelGroup.map(async (s) => {
          const result = await executeStep(s);
          return { step: s, result };
        }),
      );
      results.push(...groupResults);
    } else {
      // Sequential step
      const result = await executeStep(step);
      results.push({ step, result });
    }

    i++;
  }

  return results;
}

/** Execute a single step — resolves subagent and calls execute() */
async function executeStep(step: PlanStep): Promise<SubAgentResult> {
  const subagent = findSubAgent(step.subagent);
  if (!subagent) {
    return {
      success: false,
      text: `Subagent '${step.subagent}' non trouvé dans le registre`,
      error: `Unknown subagent: ${step.subagent}`,
    };
  }

  // TODO (E3): Check permissions before calling
  // const permission = await checkPermission(step.subagent, step.action);
  // if (permission === 'denied') return { success: false, text: 'Action refusée', error: 'Permission denied' };
  // if (permission === 'confirm') ... ask user

  console.log(`🔧 [${step.subagent}/${step.action}]`);
  return subagent.execute(step.action, step.input);
}

/**
 * Main orchestrator entry point.
 * Analyzes the user message, builds a plan, executes it, and returns aggregated results.
 *
 * Returns null if no subagent calls are needed (the agent loop handles pure conversation).
 */
export async function orchestrate(
  userMessage: string,
  conversationContext = '',
): Promise<OrchestratorResult | null> {
  try {
    const plan = await buildPlan(userMessage, conversationContext);
    if (!plan) return null;

    const stepResults = await executePlan(plan);

    // Aggregate results into a context string for the final LLM call
    const contextParts = stepResults.map(({ step, result }) => {
      const status = result.success ? '✅' : '❌';
      return `${status} [${step.subagent}/${step.action}]: ${result.text}`;
    });

    return {
      steps: stepResults,
      context: contextParts.join('\n'),
    };
  } catch (err) {
    console.error('⚠️  Orchestrator error:', err instanceof Error ? err.message : err);
    return null;
  }
}
