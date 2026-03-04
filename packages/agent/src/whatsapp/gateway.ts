import { WhatsAppSessionManager } from './session-manager.ts';
import { logger } from '../logger.ts';
import { runAgentLoop } from '../agent-loop.ts';
import { getRecentMessages } from '../memory/sqlite.ts';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';
import type { Channel } from '@makilab/shared';

let manager: WhatsAppSessionManager | null = null;

export async function initWhatsApp(): Promise<void> {
  const allowedNumber = process.env['WHATSAPP_ALLOWED_NUMBER'];
  if (!allowedNumber) {
    logger.info({}, 'WhatsApp disabled (WHATSAPP_ALLOWED_NUMBER not set)');
    return;
  }

  const replyJid = process.env['WHATSAPP_REPLY_JID'];

  logger.info({ allowedNumber }, 'WhatsApp gateway starting');

  manager = new WhatsAppSessionManager(
    allowedNumber,

    async (msg: IncomingMessage): Promise<OutgoingMessage> => {
      // Load cross-channel history for shared context (WhatsApp + Mission Control)
      const history = getRecentMessages('all', 30).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const attachments = msg.attachments
        ?.filter((a) => a.base64)
        .map((a) => ({ type: a.type as string, base64: a.base64!, mimeType: a.mimeType }));

      const result = await runAgentLoop(msg.text, {
        channel: 'whatsapp' as Channel,
        from: msg.from,
        history,
        attachments: attachments?.length ? attachments : undefined,
      });

      // agent-loop.ts already saves messages to SQLite
      return { channel: 'whatsapp', to: msg.from, text: result.reply };
    },

    (status) => {
      logger.info({ status }, 'WhatsApp connection status');
    },

    replyJid,
  );

  await manager.start();
}

export function getWhatsAppStatus(): { connected: boolean; messagesCount: number } {
  if (!manager) return { connected: false, messagesCount: 0 };
  const state = manager.getState();
  return { connected: state.status === 'connected', messagesCount: state.messagesCount };
}

export async function sendWhatsAppMessage(text: string): Promise<void> {
  if (!manager) throw new Error('WhatsApp not initialized');
  const replyJid = process.env['WHATSAPP_REPLY_JID'] ?? process.env['WHATSAPP_ALLOWED_NUMBER'] ?? '';
  await manager.sendMessage(replyJid, text);
}
