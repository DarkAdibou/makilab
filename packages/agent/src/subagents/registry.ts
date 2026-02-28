/**
 * registry.ts — Subagent registry
 *
 * Central registry of all available subagents.
 * The orchestrator uses this to:
 * 1. Tell the LLM what subagents exist (capabilities prompt)
 * 2. Resolve a subagent by name before executing
 * 3. List all subagents for Mission Control status page
 *
 * Adding a new subagent:
 * 1. Create packages/agent/src/subagents/<name>.ts implementing SubAgent
 * 2. Import and register it here
 * 3. Add default permissions in packages/agent/src/memory/schema.sql
 *
 * Extension points:
 * - E3: Permission check hooked in here (wraps execute)
 * - E6: Registry could be dynamic (loaded from DB) for Mission Control toggling
 */

import type { SubAgent } from './types.ts';
import { getTimeSubAgent } from './get-time.ts';

/** All registered subagents — add new ones here */
const SUBAGENTS: SubAgent[] = [
  getTimeSubAgent,
  // obsidianSubAgent,   // E4
  // gmailSubAgent,      // E4
  // webSubAgent,        // E4
  // karakeepSubAgent,   // E4
];

/** Get a subagent by name — returns undefined if not registered */
export function findSubAgent(name: string): SubAgent | undefined {
  return SUBAGENTS.find((sa) => sa.name === name);
}

/** Get all registered subagents */
export function getAllSubAgents(): SubAgent[] {
  return SUBAGENTS;
}

/**
 * Build the capabilities section for the orchestrator's system prompt.
 * Lists all subagents and their actions so the LLM can route correctly.
 */
export function buildCapabilitiesPrompt(): string {
  if (SUBAGENTS.length === 0) return '';

  const lines: string[] = ['## Subagents disponibles\n'];

  for (const sa of SUBAGENTS) {
    lines.push(`### ${sa.name}`);
    lines.push(sa.description);
    lines.push('Actions :');
    for (const action of sa.actions) {
      const params = action.inputSchema.required.length > 0
        ? ` (paramètres: ${action.inputSchema.required.join(', ')})`
        : ' (aucun paramètre)';
      lines.push(`- **${action.name}**${params} — ${action.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
