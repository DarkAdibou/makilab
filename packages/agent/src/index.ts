/**
 * index.ts — Agent entry point
 *
 * E2 smoke test: validates SQLite memory persistence across two messages.
 * 1. First message: introduces a fact (name + location)
 * 2. Second message: asks something that requires knowing the fact
 * → Agent should recall the fact from SQLite without it being in the message
 *
 * In E3+: replaced by full orchestrator with subagents, CRON.
 */
import { config } from './config.ts';
import { runAgentLoop } from './agent-loop.ts';
import { getCoreMemory, getRecentMessages } from './memory/sqlite.ts';

console.log(`🤖 Makilab Agent démarré (${config.nodeEnv})`);
console.log(`📍 Max iterations: ${config.agentMaxIterations}`);
console.log('');

const TEST_CHANNEL = 'cli-test';

// ── Message 1: introduce a fact ───────────────────────────────────────────────
console.log('📨 Message 1: introduction');
const reply1 = await runAgentLoop(
  "Bonjour ! Je m'appelle Adrien et je suis basé à Sydney, Australie.",
  { channel: TEST_CHANNEL, from: 'test', history: [] },
);
console.log('🤖', reply1);
console.log('');

// Small pause to let fire-and-forget fact extraction complete
await new Promise((r) => setTimeout(r, 3000));

// ── Check what facts were extracted ──────────────────────────────────────────
const facts = getCoreMemory();
console.log('🧠 Faits en mémoire:', facts);
console.log('');

// ── Message 2: use the fact without repeating it ─────────────────────────────
console.log('📨 Message 2: test de mémorisation');
const reply2 = await runAgentLoop(
  'Quelle heure est-il là où je suis en ce moment ?',
  { channel: TEST_CHANNEL, from: 'test', history: [] },
);
console.log('🤖', reply2);
console.log('');

// ── Show conversation history saved in SQLite ─────────────────────────────────
const history = getRecentMessages(TEST_CHANNEL, 10);
console.log(`📚 Historique SQLite (${history.length} messages):`);
for (const msg of history) {
  const preview = msg.content.substring(0, 80).replace(/\n/g, ' ');
  console.log(`  [${msg.role}] ${preview}${msg.content.length > 80 ? '...' : ''}`);
}
console.log('');
console.log('✅ E2 smoke test complet');
