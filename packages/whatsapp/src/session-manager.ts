/**
 * session-manager.ts
 *
 * WhatsApp session management using Baileys.
 *
 * Handles:
 * - QR code display on first launch
 * - Session persistence (auth_info_baileys/)
 * - Automatic reconnection with exponential backoff
 * - Strict number whitelist (security — non-negotiable)
 * - Connection status tracking
 * - Error handling and ban detection
 *
 * Extension points:
 * - E2: Log session state to PostgreSQL (whatsapp_sessions table)
 * - E6: Push status updates to Mission Control via WebSocket
 *
 * Security:
 * - Only allowedNumber can interact with the agent
 * - All other numbers are silently ignored and logged
 * - auth_info_baileys/ must be in .gitignore (never commit credentials)
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';

export type MessageHandler = (msg: IncomingMessage) => Promise<OutgoingMessage>;
export type StatusHandler = (status: ConnectionStatus) => void;
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'banned';

interface SessionState {
  status: ConnectionStatus;
  connectedAt?: Date;
  messagesCount: number;
  retryCount: number;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 3000;

export class WhatsAppSessionManager {
  private state: SessionState = {
    status: 'disconnected',
    messagesCount: 0,
    retryCount: 0,
  };

  // sock exposed for sending messages from other parts of the app (e.g. Mission Control)
  private sock: ReturnType<typeof makeWASocket> | null = null;

  constructor(
    private readonly allowedNumber: string,
    private readonly onMessage: MessageHandler,
    private readonly onStatus?: StatusHandler,
  ) {}

  /** Current session state (read-only snapshot) */
  getState(): Readonly<SessionState> {
    return { ...this.state };
  }

  /** Start the WhatsApp session */
  async start(): Promise<void> {
    await this.connect();
  }

  /**
   * Send a message to any JID (used for proactive notifications).
   * Only works when connected.
   */
  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock || this.state.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    await this.sock.sendMessage(to, { text });
  }

  private async connect(): Promise<void> {
    this.updateStatus('connecting');

    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: true,
      generateHighQualityLinkPreview: false,
      // Reduce unnecessary traffic
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\n📱 Scanne ce QR code avec ton numéro WhatsApp secondaire');
        console.log('   (Le QR expire dans 60 secondes)\n');
      }

      if (connection === 'open') {
        this.state.retryCount = 0;
        this.state.connectedAt = new Date();
        this.updateStatus('connected');
        console.log('✅ WhatsApp Gateway connecté');
        console.log(`🔒 Numéro autorisé: ${this.allowedNumber}`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isBanned = statusCode === DisconnectReason.loggedOut;

        if (isBanned) {
          this.updateStatus('banned');
          console.error('❌ Session WhatsApp invalide ou numéro banni.');
          console.error('   Supprime le dossier auth_info_baileys/ et relance pour re-scanner le QR.');
          return;
        }

        this.updateStatus('disconnected');

        if (this.state.retryCount < MAX_RETRIES) {
          this.state.retryCount++;
          // Exponential backoff: 3s, 6s, 12s, 24s, 48s
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, this.state.retryCount - 1);
          console.log(`🔄 Reconnexion dans ${delay / 1000}s (tentative ${this.state.retryCount}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          await this.connect();
        } else {
          console.error(`❌ ${MAX_RETRIES} tentatives échouées. Relance le processus manuellement.`);
        }
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue; // Ignore our own messages

        const from = msg.key.remoteJid ?? '';

        // SECURITY: strict whitelist — silently ignore unauthorized numbers
        if (from !== this.allowedNumber) {
          console.log(`🚫 Message ignoré — numéro non autorisé: ${from}`);
          // TODO (E2): Log to activity_log with status 'denied'
          return;
        }

        const text =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          '';

        if (!text.trim()) continue;

        this.state.messagesCount++;
        const timestamp = new Date((msg.messageTimestamp as number) * 1000);
        console.log(`📨 [${timestamp.toISOString()}] "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

        const incoming: IncomingMessage = {
          id: msg.key.id ?? crypto.randomUUID(),
          channel: 'whatsapp',
          from,
          text: text.trim(),
          timestamp,
        };

        try {
          const outgoing = await this.onMessage(incoming);
          await this.sock!.sendMessage(outgoing.to, { text: outgoing.text });
          console.log(`📤 Réponse envoyée (${outgoing.text.length} chars)`);
        } catch (err) {
          console.error('❌ Erreur traitement message:', err);
          // Send error message to user — never let errors be silent
          await this.sock!.sendMessage(from, {
            text: '❌ Une erreur est survenue. Réessaie dans un instant.',
          });
        }
      }
    });
  }

  private updateStatus(status: ConnectionStatus): void {
    this.state.status = status;
    this.onStatus?.(status);
  }
}
