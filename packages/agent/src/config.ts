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
  whatsappAllowedNumber: optional('WHATSAPP_ALLOWED_NUMBER', ''),

  // Agent
  agentMaxIterations: parseInt(optional('AGENT_MAX_ITERATIONS', '10'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // Database
  databaseUrl: optional('DATABASE_URL', ''),

  // Security
  webhookSecret: optional('WEBHOOK_SECRET', 'change_me_in_production'),

  // CRON — all optional, disabled if not set
  cronEnabled: optional('CRON_ENABLED', 'false') === 'true',
  cronChannel: optional('CRON_CHANNEL', 'whatsapp') as 'whatsapp' | 'cli',
  cronBriefingSchedule: optional('CRON_BRIEFING_SCHEDULE', '0 7 * * *'),
  cronEveningSchedule: optional('CRON_EVENING_SCHEDULE', '0 19 * * *'),

  // Subagents — all optional, subagent gracefully disabled if key missing
  braveSearchApiKey: optional('BRAVE_SEARCH_API_KEY', ''),
  karakeepApiUrl: optional('KARAKEEP_API_URL', 'http://localhost:3000'),
  karakeepApiKey: optional('KARAKEEP_API_KEY', ''),
  obsidianVaultPath: optional('OBSIDIAN_VAULT_PATH', ''),
  obsidianRestApiKey: optional('OBSIDIAN_REST_API_KEY', ''),
  gmailAccessToken: optional('GMAIL_ACCESS_TOKEN', ''),

  // Home Assistant
  haUrl: optional('HA_URL', ''),
  haAccessToken: optional('HA_ACCESS_TOKEN', ''),

  // Semantic Memory (E9) — optional, memory subagent disabled if missing
  qdrantUrl: optional('QDRANT_URL', ''),
  voyageApiKey: optional('VOYAGE_API_KEY', ''),

  // SearXNG (E18) — self-hosted search, replaces Brave as primary
  searxngUrl: optional('SEARXNG_URL', ''),

  // Code SubAgent (E11)
  codeRepoRoot: optional('CODE_REPO_ROOT', rootDir),
  makilabEnv: optional('MAKILAB_ENV', 'development'),
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

  if (missing.length > 0) {
    log.fatal({ missing }, 'Missing required env vars — cannot start');
    process.exit(1);
  }

  const optionalWarnings: string[] = [];
  if (!process.env['WHATSAPP_ALLOWED_NUMBER']) optionalWarnings.push('WHATSAPP_ALLOWED_NUMBER (whatsapp disabled)');
  if (!process.env['OBSIDIAN_VAULT_PATH']) optionalWarnings.push('OBSIDIAN_VAULT_PATH (obsidian fallback disabled)');
  if (!process.env['OBSIDIAN_REST_API_KEY']) optionalWarnings.push('OBSIDIAN_REST_API_KEY (obsidian REST disabled)');
  if (!process.env['BRAVE_SEARCH_API_KEY']) optionalWarnings.push('BRAVE_SEARCH_API_KEY (web search disabled)');
  if (!process.env['KARAKEEP_API_KEY']) optionalWarnings.push('KARAKEEP_API_KEY (karakeep disabled)');
  if (!process.env['HA_URL']) optionalWarnings.push('HA_URL (home assistant disabled)');
  if (!process.env['QDRANT_URL']) optionalWarnings.push('QDRANT_URL (semantic memory disabled)');
  if (!process.env['VOYAGE_API_KEY']) optionalWarnings.push('VOYAGE_API_KEY (semantic memory disabled)');

  for (const w of optionalWarnings) {
    log.warn({ missing: w }, 'Optional env var not set');
  }

  log.info({ env: config.nodeEnv }, 'Config validated');
}
