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

import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';
import { transcribeAudio } from './transcriber.ts';

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

// Suppress noisy non-blocking Baileys/libsignal errors (Bad MAC, session decryption)
const SUPPRESSED_PATTERNS = ['Bad MAC', 'Failed to decrypt message', 'Session error:', 'Closing session: SessionEntry', 'Closing open session'];
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk: string | Uint8Array, ...args: unknown[]): boolean {
  const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  if (SUPPRESSED_PATTERNS.some(p => str.includes(p))) return true;
  return (originalStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
} as typeof process.stderr.write;

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const joined = args.map(a => String(a ?? '')).join(' ');
  if (SUPPRESSED_PATTERNS.some(p => joined.includes(p))) return;
  originalConsoleError(...args);
};

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const joined = args.map(a => String(a ?? '')).join(' ');
  if (SUPPRESSED_PATTERNS.some(p => joined.includes(p))) return;
  originalConsoleLog(...args);
};

export class WhatsAppSessionManager {
  private state: SessionState = {
    status: 'disconnected',
    messagesCount: 0,
    retryCount: 0,
  };

  // sock exposed for sending messages from other parts of the app (e.g. Mission Control)
  private sock: ReturnType<typeof makeWASocket> | null = null;
  // Dedup: Baileys fires duplicate events (self-messages, reconnections)
  private recentMessageIds = new Set<string>();
  // Track messages currently being processed to prevent concurrent handling
  private processingMessages = new Set<string>();

  constructor(
    private readonly allowedNumber: string,
    private readonly onMessage: MessageHandler,
    private readonly onStatus?: StatusHandler,
    private readonly replyJid?: string,
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
        // Save QR as PNG and open it
        const qrPath = resolve('whatsapp-qr.png');
        await QRCode.toFile(qrPath, qr, { scale: 8 });
        console.log(`📄 QR sauvegardé: ${qrPath}`);
        // Auto-open on Windows/macOS/Linux
        const cmd = process.platform === 'win32' ? `start "" "${qrPath}"` : process.platform === 'darwin' ? `open "${qrPath}"` : `xdg-open "${qrPath}"`;
        exec(cmd, () => {});
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
        // Skip all outgoing messages (fromMe=true) — bot's own replies would re-trigger the loop
        if (msg.key.fromMe) continue;

        // Dedup: Baileys fires duplicate events with slightly different timestamps
        // Use 30s time window + text/audio content as dedup key
        const ts = msg.messageTimestamp as number;
        const tsBucket = Math.floor(ts / 30); // 30-second window
        const textPreview = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').slice(0, 50);
        const audioId = msg.message.audioMessage ? `audio:${msg.key.id}` : '';
        const dedupKey = `${tsBucket}:${textPreview || audioId}`;
        if (this.recentMessageIds.has(dedupKey) || this.processingMessages.has(dedupKey)) {
          console.log(`🔁 Message dupliqué ignoré: "${textPreview.substring(0, 30)}..."`);
          continue;
        }
        this.recentMessageIds.add(dedupKey);
        this.processingMessages.add(dedupKey);
        if (this.recentMessageIds.size > 100) {
          const first = this.recentMessageIds.values().next().value!;
          this.recentMessageIds.delete(first);
        }

        const from = msg.key.remoteJid ?? '';

        // SECURITY: strict whitelist — silently ignore unauthorized numbers
        if (from !== this.allowedNumber) {
          console.log(`🚫 Message ignoré — numéro non autorisé: ${from}`);
          return;
        }

        // Extract text — handle audio messages via Whisper transcription
        let text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!text.trim()) {
          // Check for audio/voice message
          const audioMsg = msg.message.audioMessage;
          if (audioMsg) {
            console.log('🎙️ Message vocal détecté, transcription en cours...');
            try {
              const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
              const mimetype = audioMsg.mimetype || 'audio/ogg';
              const transcribed = await transcribeAudio(buffer as Buffer, mimetype);
              if (transcribed) {
                text = transcribed;
                console.log(`🎙️ Transcription: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
              } else {
                const errorTo = this.replyJid ?? from;
                await this.sock!.sendMessage(errorTo, { text: '🎙️ Désolé, je n\'ai pas pu transcrire ce message vocal.' });
                this.processingMessages.delete(dedupKey);
                continue;
              }
            } catch (err) {
              console.error('❌ Erreur téléchargement audio:', err);
              const errorTo = this.replyJid ?? from;
              await this.sock!.sendMessage(errorTo, { text: '🎙️ Erreur lors de la transcription du message vocal.' });
              this.processingMessages.delete(dedupKey);
              continue;
            }
          } else {
            this.processingMessages.delete(dedupKey);
            continue;
          }
        }

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
          // Use replyJid override for self-messaging (LID → JID resolution)
          const sendTo = this.replyJid ?? outgoing.to;
          await this.sock!.sendMessage(sendTo, { text: outgoing.text });
          console.log(`📤 Réponse envoyée (${outgoing.text.length} chars)`);
        } catch (err) {
          console.error('❌ Erreur traitement message:', err);
          const errorTo = this.replyJid ?? from;
          await this.sock!.sendMessage(errorTo, {
            text: '❌ Une erreur est survenue. Réessaie dans un instant.',
          });
        } finally {
          this.processingMessages.delete(dedupKey);
        }
      }
    });
  }

  private updateStatus(status: ConnectionStatus): void {
    this.state.status = status;
    this.onStatus?.(status);
  }
}
