/**
 * types.ts — Subagent interface contract
 *
 * Every subagent in Makilab implements this interface.
 * The orchestrator calls subagents through this contract — never directly.
 *
 * Design principles:
 * - Input/output always typed (never `any`)
 * - Each subagent is independently testable
 * - Actions are string-based (matches the permissions table in PostgreSQL)
 * - Subagents declare their own capabilities via `actions`
 *
 * Extension points:
 * - E3: Permission check wraps execute() in the registry
 * - E9: SubAgent results can be embedded into Qdrant
 * - E14: LLM Router selects the model per subagent+action
 */

import type { SubAgentName } from '@makilab/shared';

/**
 * JSON Schema property definition (subset of draft-07).
 * Supports string, number, boolean, arrays, enums, and nested objects.
 */
export type JsonSchemaProperty =
  | { type: 'string'; description: string; enum?: string[]; default?: string }
  | { type: 'number'; description: string; default?: number }
  | { type: 'boolean'; description: string; default?: boolean }
  | { type: 'array'; description: string; items: JsonSchemaProperty }
  | { type: 'object'; description: string; properties: Record<string, JsonSchemaProperty>; required?: string[] };

/**
 * A single capability exposed by a subagent.
 * Maps directly to a row in the `permissions` table.
 */
export interface SubAgentAction {
  /** Action name — must match permissions table (e.g. 'read', 'create', 'search') */
  name: string;
  /** Human-readable description — used by the LLM router to understand what this does */
  description: string;
  /** JSON Schema for the input parameters (subset of JSON Schema draft-07) */
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
}

/**
 * Result returned by every subagent action.
 * Text is always included so the orchestrator can inject it into the LLM context.
 */
export interface SubAgentResult {
  success: boolean;
  /** Human-readable summary — injected into LLM context */
  text: string;
  /** Structured data for programmatic use (e.g. further processing) */
  data?: unknown;
  /** Error message (only when success=false) */
  error?: string;
}

/**
 * The core interface every subagent must implement.
 */
export interface SubAgent {
  /** Unique identifier — matches SubAgentName in shared types */
  name: SubAgentName;
  /** Short description — used by the LLM router to decide which subagent to call */
  description: string;
  /** List of all supported actions */
  actions: SubAgentAction[];
  /**
   * Execute an action.
   * @param action - Action name (must be in `actions`)
   * @param input - Parameters validated against the action's inputSchema
   * @returns Result with text summary and optional structured data
   * @throws Never — errors are caught and returned as SubAgentResult{success:false}
   */
  execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult>;
}
