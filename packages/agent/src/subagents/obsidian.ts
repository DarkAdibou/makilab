/**
 * obsidian.ts — SubAgent: Obsidian vault
 *
 * Stratégie dual (résiliente) :
 *
 * 1. LOCAL REST API (primaire) — plugin "Local REST API" port 27123
 *    - Requires Obsidian to be open on the laptop
 *    - Full features: search, daily note, real-time read/write
 *    - Auth: OBSIDIAN_REST_API_KEY
 *
 * 2. GIT FALLBACK — lecture/écriture directe des fichiers .md
 *    - Works even when Obsidian is closed
 *    - Used on the NUC (Obsidian not running there)
 *    - Path: OBSIDIAN_VAULT_PATH (git-synced repo)
 *    - Pas de recherche full-text (grep simple)
 *
 * Actions:
 *   - read    : lit une note (REST API → fallback fichier)
 *   - create  : crée une note (REST API → fallback fichier)
 *   - append  : ajoute du contenu (REST API → fallback fichier)
 *   - search  : recherche dans le vault (REST API → fallback grep)
 *   - daily   : lit ou ajoute au journal (REST API uniquement)
 *
 * Extension points:
 *   - E9: indexer les notes dans Qdrant pour recherche sémantique
 *   - E5: Smart Capture → créer note auto selon type
 *   - E11: Code SubAgent git commit après write
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';

const OBSIDIAN_BASE = 'http://localhost:27123';

function obsidianHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.obsidianRestApiKey) {
    headers['Authorization'] = `Bearer ${config.obsidianRestApiKey}`;
  }
  return headers;
}

/** Check if Obsidian Local REST API is reachable */
async function isObsidianLive(): Promise<boolean> {
  try {
    const r = await fetch(`${OBSIDIAN_BASE}/`, {
      headers: obsidianHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const obsidianSubAgent: SubAgent = {
  name: 'obsidian',
  description:
    'Lit, crée et recherche des notes dans le vault Obsidian. Source ET destination. ' +
    'Utilise pour prendre des notes, chercher des infos dans le vault, ou écrire dans le journal quotidien. ' +
    'Fonctionne même quand Obsidian est fermé (via fichiers Git).',

  actions: [
    {
      name: 'read',
      description: "Lit le contenu d'une note par son chemin ou nom",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif depuis la racine du vault (ex: Notes/Réunion.md)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create',
      description: 'Crée une nouvelle note Markdown dans le vault',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note à créer (ex: Notes/Idée.md)' },
          content: { type: 'string', description: 'Contenu Markdown' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'append',
      description: "Ajoute du contenu à la fin d'une note existante",
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
      description: 'Recherche des notes dans le vault par mots-clés',
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
      description: "Lit ou ajoute au journal quotidien (Daily Note d'aujourd'hui)",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '"read" pour lire, "append" pour ajouter' },
          content: { type: 'string', description: 'Contenu à ajouter (si action=append)' },
        },
        required: ['action'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      const live = await isObsidianLive();

      if (action === 'read') {
        return live
          ? await apiReadNote(input['path'] as string)
          : await fileReadNote(input['path'] as string);
      }
      if (action === 'create') {
        return live
          ? await apiCreateNote(input['path'] as string, input['content'] as string)
          : await fileCreateNote(input['path'] as string, input['content'] as string);
      }
      if (action === 'append') {
        return live
          ? await apiAppendNote(input['path'] as string, input['content'] as string)
          : await fileAppendNote(input['path'] as string, input['content'] as string);
      }
      if (action === 'search') {
        return live
          ? await apiSearchVault(input['query'] as string, parseInt((input['limit'] as string) ?? '10', 10))
          : await fileSearchVault(input['query'] as string, parseInt((input['limit'] as string) ?? '10', 10));
      }
      if (action === 'daily') {
        if (!live) return { success: false, text: 'Daily Note requiert Obsidian ouvert', error: 'Obsidian not running' };
        return await apiDailyNote(input['action'] as string, input['content'] as string | undefined);
      }

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

// ── LOCAL REST API ───────────────────────────────────────────────────────────

async function apiReadNote(path: string): Promise<SubAgentResult> {
  const r = await fetch(`${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`, { headers: obsidianHeaders() });
  if (r.status === 404) return { success: false, text: `Note non trouvée: ${path}`, error: 'Not found' };
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  const content = await r.text();
  return {
    success: true,
    text: `Note "${path}" (via Obsidian):\n\n${content.substring(0, 3000)}${content.length > 3000 ? '\n…(tronqué)' : ''}`,
    data: { path, content, source: 'api' },
  };
}

async function apiCreateNote(path: string, content: string): Promise<SubAgentResult> {
  const r = await fetch(`${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
    body: content,
  });
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  return { success: true, text: `Note créée: ${path}`, data: { path, source: 'api' } };
}

async function apiAppendNote(path: string, content: string): Promise<SubAgentResult> {
  const r = await fetch(`${OBSIDIAN_BASE}/vault/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
    body: '\n' + content,
  });
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  return { success: true, text: `Contenu ajouté à: ${path}`, data: { path, source: 'api' } };
}

async function apiSearchVault(query: string, limit: number): Promise<SubAgentResult> {
  const r = await fetch(
    `${OBSIDIAN_BASE}/search/simple/?query=${encodeURIComponent(query)}&contextLength=150`,
    { headers: obsidianHeaders() },
  );
  if (!r.ok) throw new Error(`Obsidian search API ${r.status}`);
  const results = await r.json() as Array<{ filename: string; matches?: Array<{ context: string }> }>;
  const trimmed = results.slice(0, limit);
  if (trimmed.length === 0) return { success: true, text: `Aucune note trouvée pour: "${query}"`, data: [] };
  const formatted = trimmed.map((r, i) =>
    `${i + 1}. **${r.filename}**\n   …${r.matches?.[0]?.context ?? ''}…`,
  ).join('\n\n');
  return {
    success: true,
    text: `${trimmed.length} note(s) pour "${query}" (via Obsidian):\n\n${formatted}`,
    data: trimmed,
  };
}

async function apiDailyNote(action: string, content?: string): Promise<SubAgentResult> {
  if (action === 'read') {
    const r = await fetch(`${OBSIDIAN_BASE}/periodic/daily/`, { headers: obsidianHeaders() });
    if (!r.ok) throw new Error(`Obsidian daily ${r.status}`);
    const text = await r.text();
    return { success: true, text: `Journal du jour:\n\n${text.substring(0, 3000)}`, data: { content: text } };
  }
  if (action === 'append' && content) {
    const r = await fetch(`${OBSIDIAN_BASE}/periodic/daily/`, {
      method: 'POST',
      headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' },
      body: '\n' + content,
    });
    if (!r.ok) throw new Error(`Obsidian daily append ${r.status}`);
    return { success: true, text: 'Ajouté au journal du jour', data: {} };
  }
  return { success: false, text: 'action doit être "read" ou "append"', error: 'Invalid action' };
}

// ── GIT FALLBACK (fichiers directs) ─────────────────────────────────────────

function vaultPath(relativePath: string): string {
  const vaultRoot = config.obsidianVaultPath;
  if (!vaultRoot) throw new Error('OBSIDIAN_VAULT_PATH non configuré');
  return join(vaultRoot, relativePath);
}

async function fileReadNote(path: string): Promise<SubAgentResult> {
  try {
    const content = await readFile(vaultPath(path), 'utf-8');
    return {
      success: true,
      text: `Note "${path}" (via fichier):\n\n${content.substring(0, 3000)}${content.length > 3000 ? '\n…(tronqué)' : ''}`,
      data: { path, content, source: 'file' },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, text: `Note non trouvée: ${path}`, error: 'Not found' };
    }
    throw err;
  }
}

async function fileCreateNote(path: string, content: string): Promise<SubAgentResult> {
  const fullPath = vaultPath(path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  return { success: true, text: `Note créée: ${path} (via fichier)`, data: { path, source: 'file' } };
}

async function fileAppendNote(path: string, content: string): Promise<SubAgentResult> {
  const fullPath = vaultPath(path);
  const existing = await readFile(fullPath, 'utf-8').catch(() => '');
  await writeFile(fullPath, existing + '\n' + content, 'utf-8');
  return { success: true, text: `Contenu ajouté à: ${path} (via fichier)`, data: { path, source: 'file' } };
}

async function fileSearchVault(query: string, limit: number): Promise<SubAgentResult> {
  const vaultRoot = config.obsidianVaultPath;
  if (!vaultRoot) return { success: false, text: 'OBSIDIAN_VAULT_PATH non configuré', error: 'Missing config' };

  const results: Array<{ filename: string; context: string }> = [];
  const lowerQuery = query.toLowerCase();

  async function scanDir(dir: string): Promise<void> {
    if (results.length >= limit) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= limit) break;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const content = await readFile(fullPath, 'utf-8').catch(() => '');
          const idx = content.toLowerCase().indexOf(lowerQuery);
          if (idx !== -1) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(content.length, idx + 100);
            results.push({
              filename: fullPath.replace(vaultRoot, '').replace(/^[/\\]/, ''),
              context: content.substring(start, end).replace(/\n/g, ' '),
            });
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  await scanDir(vaultRoot);

  if (results.length === 0) return { success: true, text: `Aucune note trouvée pour: "${query}"`, data: [] };

  const formatted = results.map((r, i) =>
    `${i + 1}. **${r.filename}**\n   …${r.context}…`,
  ).join('\n\n');

  return {
    success: true,
    text: `${results.length} note(s) pour "${query}" (via fichiers):\n\n${formatted}`,
    data: results,
  };
}
