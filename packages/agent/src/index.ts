/**
 * index.ts — Agent entry point / smoke test E4
 *
 * Teste les subagents avec de vraies données :
 * 1. time/get → heure Sydney
 * 2. obsidian/search → recherche dans le vault réel
 */
import { config, validateConfig } from './config.ts';
import { logger } from './logger.ts';
import { runAgentLoop } from './agent-loop.ts';
import { getAllSubAgents } from './subagents/registry.ts';
import { startCron } from './tasks/cron.ts';

validateConfig(logger);
startCron();

console.log(`🤖 Makilab Agent (${config.nodeEnv})`);
console.log(`📂 Vault: ${config.obsidianVaultPath || '(non configuré)'}`);
console.log('');

const subagents = getAllSubAgents();
console.log(`📦 Subagents (${subagents.length}): ${subagents.map((s) => s.name).join(', ')}`);
console.log('');

const CHANNEL = 'cli';

// Test 1 — heure (toujours fonctionnel)
console.log('📨 Test 1: heure Sydney');
const r1 = await runAgentLoop('Quelle heure il est à Sydney ?', { channel: CHANNEL, from: 'test', history: [] });
console.log('🤖', r1.reply);
console.log('');

await new Promise((r) => setTimeout(r, 1000));

// Test 2 — Obsidian search (vault réel)
console.log('📨 Test 2: recherche dans le vault Obsidian');
const r2 = await runAgentLoop('Cherche dans mon vault Obsidian des notes sur "makilab" ou "agent"', { channel: CHANNEL, from: 'test', history: [] });
console.log('🤖', r2.reply);
console.log('');

console.log('✅ E5 smoke test complet');
