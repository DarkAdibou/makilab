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
} as const;
