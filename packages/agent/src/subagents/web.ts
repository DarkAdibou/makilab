/**
 * web.ts — SubAgent: Recherche et lecture web
 *
 * Actions:
 *   - search   : recherche via SearXNG (primary) ou Brave Search API (fallback)
 *   - fetch    : récupère et résume le contenu d'une URL
 *
 * SearXNG : self-hosted, illimité, configuré via SEARXNG_URL
 * Brave Search API : 2000 req/mois gratuit, clé dans BRAVE_SEARCH_API_KEY
 */

import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';
import { createLlmClient } from '../llm/client.ts';

export const webSubAgent: SubAgent = {
  name: 'web',
  description:
    'Recherche sur le web via SearXNG ou Brave Search et récupère le contenu de pages web. ' +
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
    // Deep research via Perplexity Sonar (requires OpenRouter)
    ...(config.openrouterApiKey ? [{
      name: 'deep_research',
      description: 'Recherche approfondie via Perplexity Sonar. Retourne un résumé structuré avec sources. Utilise pour les questions complexes nécessitant une synthèse de plusieurs sources.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'Question ou sujet de recherche approfondie' },
        },
        required: ['query'],
      },
    }] : []),
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

      if (action === 'deep_research') {
        return await deepResearch(input['query'] as string);
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
  // SearXNG primary, Brave fallback
  if (config.searxngUrl) {
    try {
      return await searchSearxng(query, count);
    } catch {
      // Fallback to Brave if SearXNG fails
      if (config.braveSearchApiKey) {
        return await searchBrave(query, count);
      }
      throw new Error('SearXNG indisponible et Brave Search non configuré');
    }
  }

  if (config.braveSearchApiKey) {
    return await searchBrave(query, count);
  }

  return {
    success: false,
    text: 'Aucun moteur de recherche configuré (SEARXNG_URL ou BRAVE_SEARCH_API_KEY requis)',
    error: 'No search engine configured',
  };
}

function truncate(text: string | undefined, max: number): string {
  if (!text) return '(pas de description)';
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

// --- SearXNG ---

interface SearxngResult {
  title: string;
  url: string;
  content?: string;
}

interface SearxngResponse {
  results: SearxngResult[];
}

export async function searchSearxng(query: string, count = 5): Promise<SubAgentResult> {
  const url = new URL('/search', config.searxngUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', 'general');

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as SearxngResponse;
  const results = (data.results ?? []).slice(0, Math.min(count, 10));

  if (results.length === 0) {
    return { success: true, text: `Aucun résultat trouvé pour: "${query}"`, data: [] };
  }

  const formatted = results.map((r, i) => {
    const snippet = truncate(r.content, 200);
    return `${i + 1}. **${r.title}**\n   ${r.url}\n   ${snippet}`;
  }).join('\n\n');

  return {
    success: true,
    text: `Résultats pour "${query}" (SearXNG):\n\n${formatted}`,
    data: results.map((r) => ({ title: r.title, url: r.url, description: truncate(r.content, 200) })),
  };
}

// --- Brave Search ---

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description?: string;
    }>;
  };
}

export async function searchBrave(query: string, count = 5): Promise<SubAgentResult> {
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
    `${i + 1}. **${r.title}**\n   ${r.url}\n   ${truncate(r.description, 200)}`,
  ).join('\n\n');

  return {
    success: true,
    text: `Résultats pour "${query}" (Brave):\n\n${formatted}`,
    data: results.map((r) => ({ title: r.title, url: r.url, description: truncate(r.description, 200) })),
  };
}

// --- Fetch URL ---

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

// --- Deep Research via Perplexity Sonar ---

const SONAR_MODEL = 'perplexity/sonar-pro';

async function deepResearch(query: string): Promise<SubAgentResult> {
  if (!config.openrouterApiKey) {
    return { success: false, text: 'Deep research indisponible (OPENROUTER_API_KEY requis)', error: 'No OpenRouter key' };
  }

  const llm = createLlmClient();
  const response = await llm.chat({
    taskType: 'classification',
    model: SONAR_MODEL,
    messages: [{ role: 'user', content: query }],
    system: 'Tu es un assistant de recherche. Fournis une réponse structurée, détaillée et sourcée. Cite tes sources avec des URLs.',
    maxTokens: 4096,
  });

  const text = response.content
    .filter((b): b is { type: 'text'; text: string; citations: undefined } => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  return {
    success: true,
    text: `Recherche approfondie (Sonar) pour "${query}":\n\n${text}`,
    data: { model: SONAR_MODEL, tokensIn: response.usage.tokensIn, tokensOut: response.usage.tokensOut },
  };
}
