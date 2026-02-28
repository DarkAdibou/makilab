/**
 * obsidian.ts — SubAgent: Obsidian vault
 *
 * Utilise le plugin "Local REST API" d'Obsidian (port 27123 par défaut).
 * Requiert le plugin installé et activé dans Obsidian.
 * https://github.com/coddingtonbear/obsidian-local-rest-api
 *
 * Actions:
 *   - read    : lit le contenu d'une note par nom ou chemin
 *   - create  : crée une nouvelle note
 *   - append  : ajoute du contenu à une note existante
 *   - search  : recherche full-text dans le vault
 *   - daily   : lit ou ajoute au journal quotidien
 *
 * Extension points:
 *   - E9: indexer les notes dans Qdrant pour recherche sémantique
 *   - E5: Smart Capture → créer note auto selon type de contenu
 */

import type { SubAgent, SubAgentResult } from './types.ts';

// Obsidian Local REST API — runs locally, no auth by default in dev mode
const OBSIDIAN_BASE = 'http://localhost:27123';

// Optional API key (set in Obsidian plugin settings)
function obsidianHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env['OBSIDIAN_REST_API_KEY'];
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

export const obsidianSubAgent: SubAgent = {
  name: 'obsidian',
  description:
    'Lit, crée et recherche des notes dans le vault Obsidian. ' +
    'Source ET destination. Utilise pour prendre des notes, chercher des informations dans le vault, ou écrire dans le journal.',

  actions: [
    {
      name: 'read',
      description: 'Lit le contenu d\'une note (par nom ou chemin relatif)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif depuis la racine du vault (ex: Notes/Réunion.md) ou nom de fichier' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create',
      description: 'Crée une nouvelle note dans le vault',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note à créer (ex: Notes/Idée.md)' },
          content: { type: 'string', description: 'Contenu Markdown de la note' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'append',
      description: 'Ajoute du contenu à la fin d\'une note existante',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note' },
          content: { type: 'string', description: 'Contenu à ajouter' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'search',
      description: 'Recherche full-text dans le vault Obsidian',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termes de recherche' },
          limit: { type: 'string', description: 'Nombre max de résultats (défaut: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'daily',
      description: 'Lit ou ajoute du contenu au journal quotidien (Daily Note)',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '"read" pour lire, "append" pour ajouter' },
          content: { type: 'string', description: 'Contenu à ajouter (requis si action=append)' },
        },
        required: ['action'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      // Verify Obsidian is reachable
      const ping = await fetch(`${OBSIDIAN_BASE}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (!ping || !ping.ok) {
        return {
          success: false,
          text: 'Obsidian non accessible (plugin Local REST API non démarré ?)',
          error: 'Obsidian Local REST API unreachable on localhost:27123',
        };
      }

      if (action === 'read') return await readNote(input['path'] as string);
      if (action === 'create') return await createNote(input['path'] as string, input['content'] as string);
      if (action === 'append') return await appendNote(input['path'] as string, input['content'] as string);
      if (action === 'search') return await searchVault(input['query'] as string, parseInt((input['limit'] as string) ?? '10', 10));
      if (action === 'daily') return await dailyNote(input['action'] as string, input['content'] as string | undefined);

      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur Obsidian',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

async function readNote(path: string): Promise<SubAgentResult> {
  const encoded = encodeURIComponent(path);
  const response = await fetch(`${OBSIDIAN_BASE}/vault/${encoded}`, { headers: obsidianHeaders() });
  if (response.status === 404) return { success: false, text: `Note non trouvée: ${path}`, error: 'Note not found' };
  if (!response.ok) throw new Error(`Obsidian read error: ${response.status}`);
  const content = await response.text();
  return {
    success: true,
    text: `Note "${path}":\n\n${content.substring(0, 3000)}${content.length > 3000 ? '\n...(tronqué)' : ''}`,
    data: { path, content },
  };
}

async function createNote(path: string, content: string): Promise<SubAgentResult> {
  const encoded = encodeURIComponent(path);
  const response = await fetch(`${OBSIDIAN_BASE}/vault/${encoded}`, {
    method: 'PUT',
    headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
    body: content,
  });
  if (!response.ok) throw new Error(`Obsidian create error: ${response.status}`);
  return { success: true, text: `Note créée: ${path}`, data: { path } };
}

async function appendNote(path: string, content: string): Promise<SubAgentResult> {
  const encoded = encodeURIComponent(path);
  const response = await fetch(`${OBSIDIAN_BASE}/vault/${encoded}`, {
    method: 'POST',
    headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
    body: '\n' + content,
  });
  if (!response.ok) throw new Error(`Obsidian append error: ${response.status}`);
  return { success: true, text: `Contenu ajouté à: ${path}`, data: { path } };
}

async function searchVault(query: string, limit: number): Promise<SubAgentResult> {
  const response = await fetch(`${OBSIDIAN_BASE}/search/simple/?query=${encodeURIComponent(query)}&contextLength=100`, {
    headers: obsidianHeaders(),
  });
  if (!response.ok) throw new Error(`Obsidian search error: ${response.status}`);
  const results = await response.json() as ObsidianSearchResult[];
  const trimmed = results.slice(0, limit);
  if (trimmed.length === 0) return { success: true, text: `Aucune note trouvée pour: "${query}"`, data: [] };
  const formatted = trimmed.map((r, i) =>
    `${i + 1}. **${r.filename}**\n   ...${r.matches?.[0]?.context ?? ''}...`,
  ).join('\n\n');
  return {
    success: true,
    text: `${trimmed.length} note(s) trouvée(s) pour "${query}":\n\n${formatted}`,
    data: trimmed,
  };
}

async function dailyNote(action: string, content?: string): Promise<SubAgentResult> {
  if (action === 'read') {
    const response = await fetch(`${OBSIDIAN_BASE}/periodic/daily/`, { headers: obsidianHeaders() });
    if (!response.ok) throw new Error(`Obsidian daily read error: ${response.status}`);
    const text = await response.text();
    return { success: true, text: `Journal du jour:\n\n${text.substring(0, 3000)}`, data: { content: text } };
  }
  if (action === 'append' && content) {
    const response = await fetch(`${OBSIDIAN_BASE}/periodic/daily/`, {
      method: 'POST',
      headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
      body: '\n' + content,
    });
    if (!response.ok) throw new Error(`Obsidian daily append error: ${response.status}`);
    return { success: true, text: `Ajouté au journal du jour`, data: {} };
  }
  return { success: false, text: 'action doit être "read" ou "append"', error: 'Invalid daily action' };
}

interface ObsidianSearchResult {
  filename: string;
  matches?: Array<{ context: string }>;
}
