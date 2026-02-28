/**
 * web.ts — SubAgent: Recherche et lecture web
 *
 * Actions:
 *   - search   : recherche via Brave Search API (résultats + snippets)
 *   - fetch    : récupère et résume le contenu d'une URL
 *
 * Brave Search API : gratuit jusqu'à 2000 req/mois, clé dans BRAVE_SEARCH_API_KEY
 *
 * Extension points:
 *   - E9: indexer les résultats dans Qdrant pour mémoire sémantique
 *   - E14: utiliser un modèle économique pour la synthèse
 */

import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';

export const webSubAgent: SubAgent = {
  name: 'web',
  description:
    'Recherche sur le web via Brave Search et récupère le contenu de pages web. ' +
    'Utilise pour répondre à des questions factuelles récentes, trouver des informations, lire des articles.',

  actions: [
    {
      name: 'search',
      description: 'Recherche sur le web et retourne les meilleurs résultats avec leurs snippets',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Requête de recherche' },
          count: { type: 'string', description: 'Nombre de résultats (défaut: 5, max: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch',
      description: 'Récupère et résume le contenu textuel d\'une URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL complète à récupérer' },
        },
        required: ['url'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      if (action === 'search') {
        return await searchWeb(
          input['query'] as string,
          parseInt((input['count'] as string) ?? '5', 10),
        );
      }

      if (action === 'fetch') {
        return await fetchUrl(input['url'] as string);
      }

      return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        text: 'Erreur lors de la recherche web',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

async function searchWeb(query: string, count = 5): Promise<SubAgentResult> {
  const apiKey = config.braveSearchApiKey;

  if (!apiKey) {
    return {
      success: false,
      text: 'Brave Search API non configurée (BRAVE_SEARCH_API_KEY manquant)',
      error: 'Missing BRAVE_SEARCH_API_KEY',
    };
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 10)));
  url.searchParams.set('result_filter', 'web');

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as BraveSearchResponse;
  const results = data.web?.results ?? [];

  if (results.length === 0) {
    return { success: true, text: `Aucun résultat trouvé pour: "${query}"`, data: [] };
  }

  const formatted = results.map((r, i) =>
    `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description ?? '(pas de description)'}`,
  ).join('\n\n');

  return {
    success: true,
    text: `Résultats pour "${query}":\n\n${formatted}`,
    data: results.map((r) => ({ title: r.title, url: r.url, description: r.description })),
  };
}

async function fetchUrl(url: string): Promise<SubAgentResult> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Makilab-Agent/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text')) {
    return { success: false, text: `Type de contenu non supporté: ${contentType}`, error: 'Non-text content' };
  }

  const html = await response.text();

  // Basic HTML → text extraction (strip tags, collapse whitespace)
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 4000); // Cap at 4000 chars for context budget

  return {
    success: true,
    text: `Contenu de ${url}:\n\n${text}`,
    data: { url, textLength: text.length },
  };
}

// Brave Search API response types
interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description?: string;
    }>;
  };
}
