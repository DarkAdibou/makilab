/**
 * index.ts — WhatsApp Gateway entry point
 *
 * Connects the WhatsApp session to the agent loop.
 * In E1: uses in-memory history (replaced by SQLite in E2).
 *
 * To run: pnpm dev:whatsapp
 * First run: scan the QR code with your secondary WhatsApp number.
 */

import 'dotenv/config';
import { WhatsAppSessionManager } from './session-manager.ts';
import { runAgentLoop } from '@makilab/agent/agent-loop';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';

const allowedNumber = process.env['WHATSAPP_ALLOWED_NUMBER'];
if (!allowedNumber) {
  console.error('❌ WHATSAPP_ALLOWED_NUMBER manquant dans .env');
  console.error('   Format: LID ou 33XXXXXXXXX@s.whatsapp.net');
  process.exit(1);
}
// Optional: force reply JID for self-messaging (LID doesn't deliver to self)
const replyJid = process.env['WHATSAPP_REPLY_JID'];

console.log('🤖 Makilab WhatsApp Gateway démarrage...');
console.log(`🔒 Numéro autorisé: ${allowedNumber}`);

// In-memory conversation history (E1 only — replaced by SQLite in E2)
// Bounded to last 40 messages to prevent unbounded growth
const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

const manager = new WhatsAppSessionManager(
  allowedNumber,

  async (msg: IncomingMessage): Promise<OutgoingMessage> => {
    // Run the agent loop with conversation history
    const reply = await runAgentLoop(msg.text, {
      channel: msg.channel,
      from: msg.from,
      history: history.slice(-20), // Last 20 messages as context
    });

    // Update in-memory history
    history.push({ role: 'user', content: msg.text });
    history.push({ role: 'assistant', content: reply });

    // Keep history bounded (40 = 20 exchanges)
    while (history.length > 40) history.shift();

    return { channel: 'whatsapp', to: msg.from, text: reply };
  },

  // Status handler — log connection state changes
  (status) => {
    const emoji = {
      connecting: '🔄',
      connected: '✅',
      disconnected: '⚠️',
      banned: '❌',
    }[status];
    console.log(`${emoji} WhatsApp: ${status}`);
  },

  // Reply JID override for self-messaging
  replyJid,
);

await manager.start();
