/**
 * index.ts — Agent entry point
 *
 * E3 smoke test: validates subagent routing.
 * 1. Ask for the time → should route to time__get subagent
 * 2. Ask a pure conversation question → no subagent call
 * 3. Verify subagent registry is populated
 */
import { config } from './config.ts';
import { runAgentLoop } from './agent-loop.ts';
import { getAllSubAgents } from './subagents/registry.ts';

console.log(`🤖 Makilab Agent démarré (${config.nodeEnv})`);
console.log('');

// Show registered subagents
const subagents = getAllSubAgents();
console.log(`📦 Subagents enregistrés (${subagents.length}):`);
for (const sa of subagents) {
  const actions = sa.actions.map((a) => a.name).join(', ');
  console.log(`  • ${sa.name}: ${actions}`);
}
console.log('');

const TEST_CHANNEL = 'cli-test';

// Test 1: should call time__get subagent
console.log('📨 Test 1: routing vers subagent time');
const reply1 = await runAgentLoop(
  'Quelle heure est-il à Sydney en ce moment ?',
  { channel: TEST_CHANNEL, from: 'test', history: [] },
);
console.log('🤖', reply1);
console.log('');

// Small pause for background tasks
await new Promise((r) => setTimeout(r, 2000));

// Test 2: pure conversation — no subagent needed
console.log('📨 Test 2: conversation pure (pas de subagent)');
const reply2 = await runAgentLoop(
  'Merci ! Tu fonctionnes bien.',
  { channel: TEST_CHANNEL, from: 'test', history: [] },
);
console.log('🤖', reply2);
console.log('');

console.log('✅ E3 smoke test complet');
