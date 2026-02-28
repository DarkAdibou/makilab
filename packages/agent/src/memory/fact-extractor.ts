/**
 * fact-extractor.ts
 *
 * Background fact extraction after each conversation exchange.
 * Runs as fire-and-forget — never blocks the user's response.
 *
 * Uses a cheap/fast LLM (Haiku or economic model) to scan the exchange
 * and extract durable facts worth remembering about the user.
 *
 * Examples of extracted facts:
 *   - name: Adrien
 *   - location: Sydney, Australie
 *   - timezone: Australia/Sydney
 *   - job_search_target: sustainability / tech / Sydney
 *   - obsidian_vault: GitLab repo privé
 *
 * Extension points:
 *   - E14: Route to economic model via LLM Router (OpenRouter)
 *   - E9: Also embed facts into Qdrant for semantic search
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { setFact, getCoreMemory } from './sqlite.ts';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const EXTRACTION_PROMPT = `Tu analyses un échange entre un utilisateur et son agent IA personnel.
Extrait tous les faits durables et personnels sur l'utilisateur qui méritent d'être mémorisés.

Retourne UNIQUEMENT un objet JSON valide (sans markdown) avec les faits extraits.
Format: {"clé": "valeur", "autre_clé": "autre_valeur"}

Règles:
- Seulement les faits durables (nom, localisation, préférences, projets, habitudes...)
- Pas les faits temporaires (heure actuelle, météo du jour...)
- Clés en snake_case, courtes et descriptives
- Si aucun fait à extraire, retourne {}
- Ne répète pas les faits déjà connus listés ci-dessous`;

/**
 * Extract facts from a conversation exchange and persist them.
 * Fire-and-forget — errors are caught and logged, never thrown.
 *
 * @param userMessage - The user's message
 * @param assistantReply - The agent's response
 * @param channel - Which channel the exchange happened on
 */
export async function extractAndSaveFacts(
  userMessage: string,
  assistantReply: string,
  channel: string,
): Promise<void> {
  try {
    const existingFacts = getCoreMemory();
    const existingFactsStr = Object.entries(existingFacts)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const prompt = `${EXTRACTION_PROMPT}

Faits déjà connus:
${existingFactsStr || '(aucun)'}

Échange à analyser:
USER: ${userMessage}
AGENT: ${assistantReply}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Cheap model for background tasks
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content.find((b) => b.type === 'text')?.text ?? '{}';

    // Strip markdown code fences if the model wraps the JSON (e.g. ```json ... ```)
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    // Parse and save extracted facts
    const facts = JSON.parse(text) as Record<string, string>;
    for (const [key, value] of Object.entries(facts)) {
      if (typeof key === 'string' && typeof value === 'string' && key && value) {
        setFact(key, value);
      }
    }

    const count = Object.keys(facts).length;
    if (count > 0) {
      console.log(`🧠 ${count} fait(s) extrait(s) depuis [${channel}]`);
    }
  } catch (err) {
    // Never let fact extraction break the main flow
    console.error('⚠️  Fact extraction failed (non-critical):', err instanceof Error ? err.message : err);
  }
}
