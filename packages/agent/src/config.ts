import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from monorepo root (works regardless of which package runs the process)
const rootDir = resolve(fileURLToPath(import.meta.url), '../../../..');
dotenvConfig({ path: resolve(rootDir, '.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  // LLM
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  openrouterApiKey: optional('OPENROUTER_API_KEY', ''),

  // WhatsApp
  whatsappAllowedNumber: required('WHATSAPP_ALLOWED_NUMBER'),

  // Agent
  agentMaxIterations: parseInt(optional('AGENT_MAX_ITERATIONS', '10'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // Database
  databaseUrl: optional('DATABASE_URL', ''),

  // Security
  webhookSecret: optional('WEBHOOK_SECRET', 'change_me_in_production'),

  // Subagents — all optional, subagent gracefully disabled if key missing
  braveSearchApiKey: optional('BRAVE_SEARCH_API_KEY', ''),
  karakeepApiUrl: optional('KARAKEEP_API_URL', 'http://localhost:3000'),
  karakeepApiKey: optional('KARAKEEP_API_KEY', ''),
  obsidianVaultPath: optional('OBSIDIAN_VAULT_PATH', ''),
  obsidianRestApiKey: optional('OBSIDIAN_REST_API_KEY', ''),
  gmailAccessToken: optional('GMAIL_ACCESS_TOKEN', ''),
} as const;

/**
 * Call at boot to validate env vars.
 * Required vars missing → logs to stderr + exit(1).
 * Optional vars missing → logs warnings (subagents degraded).
 *
 * Takes logger as param to avoid circular dependency (logger → config → logger).
 */
export function validateConfig(log: { fatal: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void }): void {
  const missing: string[] = [];
  if (!process.env['ANTHROPIC_API_KEY']) missing.push('ANTHROPIC_API_KEY');
  if (!process.env['WHATSAPP_ALLOWED_NUMBER']) missing.push('WHATSAPP_ALLOWED_NUMBER');

  if (missing.length > 0) {
    log.fatal({ missing }, 'Missing required env vars — cannot start');
    process.exit(1);
  }

  const optionalWarnings: string[] = [];
  if (!process.env['OBSIDIAN_VAULT_PATH']) optionalWarnings.push('OBSIDIAN_VAULT_PATH (obsidian fallback disabled)');
  if (!process.env['OBSIDIAN_REST_API_KEY']) optionalWarnings.push('OBSIDIAN_REST_API_KEY (obsidian REST disabled)');
  if (!process.env['BRAVE_SEARCH_API_KEY']) optionalWarnings.push('BRAVE_SEARCH_API_KEY (web search disabled)');
  if (!process.env['KARAKEEP_API_KEY']) optionalWarnings.push('KARAKEEP_API_KEY (karakeep disabled)');

  for (const w of optionalWarnings) {
    log.warn({ missing: w }, 'Optional env var not set');
  }

  log.info({ env: config.nodeEnv }, 'Config validated');
}
