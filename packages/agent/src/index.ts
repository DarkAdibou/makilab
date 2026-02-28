/**
 * index.ts — Agent entry point
 * 
 * In E1: simple test of the agent loop.
 * In E2+: replaced by full orchestrator with memory, subagents, CRON.
 */
import { config } from './config.ts';
import { runAgentLoop } from './agent-loop.ts';

console.log(`🤖 Makilab Agent démarré (${config.nodeEnv})`);
console.log(`📍 Max iterations: ${config.agentMaxIterations}`);
console.log(`🔒 Whitelist: ${config.whatsappAllowedNumber}`);

// E1 smoke test — verify agent loop + tool use works
const reply = await runAgentLoop('Quelle heure est-il à Sydney ?', {
  channel: 'antigravity',
  from: 'test',
  history: [],
});

console.log('\n✅ Réponse agent:');
console.log(reply);
