/**
 * karakeep.ts — SubAgent: Karakeep (bookmarks)
 *
 * Karakeep est à la fois une source ET une destination (Source=Destination pattern).
 *
 * Actions:
 *   - search   : recherche dans les bookmarks
 *   - create   : ajoute un nouveau bookmark (URL ou texte)
 *   - get      : récupère un bookmark par ID
 *   - list     : liste les derniers bookmarks
 *
 * Utilise l'API REST Karakeep (auto-hébergé).
 * URL et clé dans KARAKEEP_API_URL et KARAKEEP_API_KEY.
 *
 * Extension points:
 *   - E9: indexer les bookmarks dans Qdrant pour recherche sémantique
 *   - E5: Smart Capture → auto-bookmark via Karakeep
 */

import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';

export const karakeepSubAgent: SubAgent = {
  name: 'karakeep',
  description:
    'Gère les bookmarks dans Karakeep. Source ET destination. ' +
    'Utilise pour sauvegarder des URLs/contenus, rechercher des bookmarks existants, ou lister les dernières captures.',

  actions: [
    {
      name: 'search',
      description: 'Recherche dans les bookmarks Karakeep par mots-clés',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Mots-clés de recherche' },
          limit: { type: 'string', description: 'Nombre max de résultats (défaut: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create',
      description: 'Crée un nouveau bookmark (URL ou note texte)',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL à bookmarker (optionnel si text fourni)' },
          text: { type: 'string', description: 'Contenu texte à sauvegarder (optionnel si url fournie)' },
          title: { type: 'string', description: 'Titre du bookmark (optionnel)' },
          tags: { type: 'string', description: 'Tags séparés par des virgules (optionnel)' },
        },
        required: [],
      },
    },
    {
      name: 'list',
      description: 'Liste les derniers bookmarks',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Nombre de bookmarks à récupérer (défaut: 5)' },
        },
        required: [],
      },
    },
    {
      name: 'get',
      description: 'Récupère un bookmark par son ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID du bookmark' },
        },
        required: ['id'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    if (!config.karakeepApiKey) {
      return {
        success: false,
        text: 'Karakeep non configuré (KARAKEEP_API_KEY manquant)',
        error: 'Missing KARAKEEP_API_KEY',
      };
    }

    try {
      if (action === 'search') return await searchBookmarks(input);
      if (action === 'create') return await createBookmark(input);
      if (action === 'list') return await listBookmarks(input);
      if (action === 'get') return await getBookmark(input['id'] as string);
      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur Karakeep',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

function karakeepHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.karakeepApiKey}`,
  };
}

function karakeepUrl(path: string): string {
  return `${config.karakeepApiUrl}/api/v1${path}`;
}

async function searchBookmarks(input: Record<string, unknown>): Promise<SubAgentResult> {
  const query = input['query'] as string;
  const limit = parseInt((input['limit'] as string) ?? '10', 10);

  const response = await fetch(karakeepUrl('/bookmarks/search'), {
    method: 'POST',
    headers: karakeepHeaders(),
    body: JSON.stringify({ query, limit }),
  });

  if (!response.ok) throw new Error(`Karakeep search error: ${response.status}`);
  const data = await response.json() as KarakeepSearchResponse;
  const bookmarks = data.bookmarks ?? [];

  if (bookmarks.length === 0) {
    return { success: true, text: `Aucun bookmark trouvé pour: "${query}"`, data: [] };
  }

  const formatted = bookmarks.map((b, i) =>
    `${i + 1}. **${b.title ?? '(sans titre)'}**\n   ${b.url ?? b.content?.text ?? ''}\n   Tags: ${b.tags?.join(', ') || 'aucun'}`,
  ).join('\n\n');

  return {
    success: true,
    text: `${bookmarks.length} bookmark(s) trouvé(s) pour "${query}":\n\n${formatted}`,
    data: bookmarks,
  };
}

async function createBookmark(input: Record<string, unknown>): Promise<SubAgentResult> {
  const body: Record<string, unknown> = {};

  if (input['url']) {
    body['type'] = 'link';
    body['url'] = input['url'];
  } else if (input['text']) {
    body['type'] = 'text';
    body['text'] = input['text'];
  } else {
    return { success: false, text: 'url ou text requis pour créer un bookmark', error: 'Missing url or text' };
  }

  if (input['title']) body['title'] = input['title'];
  if (input['tags']) {
    body['tags'] = (input['tags'] as string).split(',').map((t) => t.trim()).filter(Boolean);
  }

  const response = await fetch(karakeepUrl('/bookmarks'), {
    method: 'POST',
    headers: karakeepHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Karakeep create error: ${response.status}`);
  const bookmark = await response.json() as KarakeepBookmark;

  return {
    success: true,
    text: `Bookmark créé: "${bookmark.title ?? input['url'] ?? input['text']}" (ID: ${bookmark.id})`,
    data: bookmark,
  };
}

async function listBookmarks(input: Record<string, unknown>): Promise<SubAgentResult> {
  const limit = parseInt((input['limit'] as string) ?? '5', 10);

  const response = await fetch(karakeepUrl(`/bookmarks?limit=${limit}&sort=createdAt&order=desc`), {
    headers: karakeepHeaders(),
  });

  if (!response.ok) throw new Error(`Karakeep list error: ${response.status}`);
  const data = await response.json() as KarakeepListResponse;
  const bookmarks = data.bookmarks ?? [];

  if (bookmarks.length === 0) {
    return { success: true, text: 'Aucun bookmark trouvé', data: [] };
  }

  const formatted = bookmarks.map((b, i) =>
    `${i + 1}. **${b.title ?? '(sans titre)'}** — ${b.url ?? b.content?.text?.substring(0, 80) ?? ''}`,
  ).join('\n');

  return {
    success: true,
    text: `${bookmarks.length} dernier(s) bookmark(s):\n\n${formatted}`,
    data: bookmarks,
  };
}

async function getBookmark(id: string): Promise<SubAgentResult> {
  const response = await fetch(karakeepUrl(`/bookmarks/${id}`), { headers: karakeepHeaders() });
  if (!response.ok) throw new Error(`Karakeep get error: ${response.status}`);
  const bookmark = await response.json() as KarakeepBookmark;
  return {
    success: true,
    text: `Bookmark: "${bookmark.title}" — ${bookmark.url ?? ''}`,
    data: bookmark,
  };
}

// Karakeep API types (minimal)
interface KarakeepBookmark {
  id: string;
  title?: string;
  url?: string;
  tags?: string[];
  content?: { text?: string };
}
interface KarakeepSearchResponse { bookmarks?: KarakeepBookmark[] }
interface KarakeepListResponse { bookmarks?: KarakeepBookmark[] }
