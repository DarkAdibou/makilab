/**
 * gmail.ts — SubAgent: Gmail
 *
 * Wrapper autour des MCP Gmail tools disponibles dans l'environnement Claude.
 * En production sur le NUC, utilise directement l'API Gmail (OAuth2).
 *
 * Strategy: En dev (Claude Code session), appelle les MCP tools via spawn.
 * En prod (NUC), appelle l'API Gmail REST directement.
 *
 * Actions:
 *   - search  : recherche des emails (query Gmail standard)
 *   - read    : lit un email par ID
 *   - draft   : crée un brouillon
 *
 * Permissions (whitelist):
 *   - read   : allowed
 *   - search : allowed
 *   - send   : confirm (jamais auto)
 *   - delete : denied
 *
 * Extension points:
 *   - E8: Gmail inbound — polling CRON pour traiter les emails entrants
 *   - E14: résumé via modèle économique (Gemini Flash)
 */

import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';

export const gmailSubAgent: SubAgent = {
  name: 'gmail',
  description:
    'Recherche et lit des emails Gmail. Peut créer des brouillons (jamais envoyer sans confirmation). ' +
    'Utilise pour lire les derniers emails, chercher des mails par expéditeur/sujet, ou préparer une réponse.',

  actions: [
    {
      name: 'search',
      description: 'Recherche des emails avec la syntaxe Gmail (from:, to:, subject:, is:unread, newer_than:7d...)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Requête Gmail (ex: "from:boss@company.com is:unread")' },
          maxResults: { type: 'string', description: 'Nombre max d\'emails (défaut: 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read',
      description: 'Lit le contenu complet d\'un email par son ID',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'ID du message Gmail (obtenu via search)' },
        },
        required: ['messageId'],
      },
    },
    {
      name: 'draft',
      description: 'Crée un brouillon Gmail (ne l\'envoie PAS — requiert confirmation explicite)',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destinataire(s) séparés par des virgules' },
          subject: { type: 'string', description: 'Sujet de l\'email' },
          body: { type: 'string', description: 'Corps du message' },
          cc: { type: 'string', description: 'CC (optionnel)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'unread',
      description: 'Récupère les derniers emails non lus',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'string', description: 'Nombre max d\'emails (défaut: 5)' },
        },
        required: [],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      if (action === 'search') return await searchGmail(input);
      if (action === 'read') return await readGmail(input['messageId'] as string);
      if (action === 'draft') return await createDraft(input);
      if (action === 'unread') return await searchGmail({ query: 'is:unread', maxResults: input['maxResults'] });
      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur Gmail',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Gmail API implementation.
 * Uses OAuth2 token from GMAIL_ACCESS_TOKEN env var (refreshed by E8 CRON).
 * Falls back to a "not configured" message if token missing.
 */
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function gmailHeaders(): Record<string, string> {
  const token = config.gmailAccessToken;
  if (!token) throw new Error('GMAIL_ACCESS_TOKEN manquant — configurer OAuth2 Gmail');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function searchGmail(input: Record<string, unknown>): Promise<SubAgentResult> {
  const query = input['query'] as string;
  const maxResults = parseInt((input['maxResults'] as string) ?? '5', 10);

  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const response = await fetch(`${GMAIL_BASE}/messages?${params}`, { headers: gmailHeaders() });
  if (!response.ok) throw new Error(`Gmail search error: ${response.status}`);

  const data = await response.json() as { messages?: Array<{ id: string; threadId: string }> };
  const messages = data.messages ?? [];

  if (messages.length === 0) {
    return { success: true, text: `Aucun email trouvé pour: "${query}"`, data: [] };
  }

  // Fetch snippets for each message (batch-like: first 5 only)
  const details = await Promise.all(
    messages.slice(0, 5).map(async (m) => {
      const r = await fetch(`${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: gmailHeaders(),
      });
      if (!r.ok) return null;
      const d = await r.json() as GmailMessage;
      return d;
    }),
  );

  const formatted = details
    .filter(Boolean)
    .map((d, i) => {
      const from = d!.payload?.headers?.find((h) => h.name === 'From')?.value ?? '?';
      const subject = d!.payload?.headers?.find((h) => h.name === 'Subject')?.value ?? '(sans sujet)';
      const date = d!.payload?.headers?.find((h) => h.name === 'Date')?.value ?? '';
      return `${i + 1}. **${subject}**\n   De: ${from} | ${date}\n   ID: ${d!.id}`;
    })
    .join('\n\n');

  return {
    success: true,
    text: `${messages.length} email(s) trouvé(s) pour "${query}":\n\n${formatted}`,
    data: messages,
  };
}

async function readGmail(messageId: string): Promise<SubAgentResult> {
  const response = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, { headers: gmailHeaders() });
  if (!response.ok) throw new Error(`Gmail read error: ${response.status}`);
  const msg = await response.json() as GmailMessage;

  const from = msg.payload?.headers?.find((h) => h.name === 'From')?.value ?? '?';
  const subject = msg.payload?.headers?.find((h) => h.name === 'Subject')?.value ?? '(sans sujet)';
  const date = msg.payload?.headers?.find((h) => h.name === 'Date')?.value ?? '';

  // Extract body text
  const body = extractBody(msg.payload, msg.snippet);

  return {
    success: true,
    text: `Email de ${from} — "${subject}" (${date}):\n\n${body.substring(0, 3000)}`,
    data: { id: messageId, from, subject, date, body },
  };
}

async function createDraft(input: Record<string, unknown>): Promise<SubAgentResult> {
  const raw = [
    `To: ${input['to']}`,
    `Subject: ${input['subject']}`,
    input['cc'] ? `Cc: ${input['cc']}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    input['body'] as string,
  ].filter(Boolean).join('\r\n');

  const encoded = Buffer.from(raw).toString('base64url');
  const response = await fetch(`${GMAIL_BASE}/drafts`, {
    method: 'POST',
    headers: gmailHeaders(),
    body: JSON.stringify({ message: { raw: encoded } }),
  });
  if (!response.ok) throw new Error(`Gmail draft error: ${response.status}`);
  const draft = await response.json() as { id: string };
  return {
    success: true,
    text: `Brouillon créé (ID: ${draft.id}) — À envoyer manuellement depuis Gmail`,
    data: draft,
  };
}

function extractBody(payload: GmailPayload | undefined, snippet = ''): string {
  if (!payload) return snippet;
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  for (const part of payload.parts ?? []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  return snippet;
}
interface GmailMessage {
  id: string;
  snippet?: string;
  payload?: GmailPayload;
}
interface GmailPayload {
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
  mimeType?: string;
}
