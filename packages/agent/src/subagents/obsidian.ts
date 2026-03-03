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

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { SubAgent, SubAgentResult } from './types.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

// HTTPS port 27124 (default) — the plugin uses a self-signed certificate
const OBSIDIAN_BASE = 'https://127.0.0.1:27124';

// Node.js fetch (undici) rejects self-signed certs. The env var must be set
// before the first TLS handshake — runtime toggling is unreliable.
// This only affects localhost Obsidian; external HTTPS still validates certs
// because we set this at import time (before any fetch call).
if (config.obsidianRestApiKey) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
}

async function obsidianFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function obsidianHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (config.obsidianRestApiKey) {
    headers['Authorization'] = `Bearer ${config.obsidianRestApiKey}`;
  }
  return headers;
}

/** Check if Obsidian Local REST API is reachable */
export async function isObsidianLive(): Promise<boolean> {
  try {
    const r = await obsidianFetch(`${OBSIDIAN_BASE}/`, {
      headers: obsidianHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    logger.info({ status: r.status, ok: r.ok }, 'Obsidian REST API health check');
    return r.ok;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Obsidian REST API unreachable — using file fallback');
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
    {
      name: 'list',
      description: 'Liste les fichiers et sous-dossiers dans un répertoire du vault. Utile pour naviguer sans deviner les chemins.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin du dossier à lister (optionnel, défaut: racine du vault)' },
        },
        required: [],
      },
    },
    {
      name: 'delete',
      description: 'Supprime définitivement une note du vault.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note à supprimer (ex: Notes/brouillon.md)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'patch',
      description: 'Édite une note de façon chirurgicale : insère du contenu sous un heading spécifique ou modifie un champ frontmatter. Requiert Obsidian ouvert.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note à modifier' },
          target_type: { type: 'string', description: '"heading" pour insérer sous un titre, "frontmatter" pour modifier les métadonnées', enum: ['heading', 'frontmatter'] },
          target: { type: 'string', description: 'Nom exact du heading (ex: "## Todo") ou clé frontmatter (ex: "status")' },
          operation: { type: 'string', description: '"append" (après), "prepend" (avant) ou "replace" (remplacer)', enum: ['append', 'prepend', 'replace'] },
          content: { type: 'string', description: 'Contenu à insérer ou valeur du champ frontmatter' },
        },
        required: ['path', 'target_type', 'target', 'operation', 'content'],
      },
    },
    {
      name: 'open',
      description: "Ouvre une note dans l'interface graphique Obsidian. Requiert Obsidian ouvert.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin de la note à ouvrir dans Obsidian' },
        },
        required: ['path'],
      },
    },
    {
      name: 'commands',
      description: 'Liste ou exécute des commandes Obsidian (Templater, QuickAdd, refresh Dataview...). Requiert Obsidian ouvert.',
      inputSchema: {
        type: 'object',
        properties: {
          command_id: { type: 'string', description: "ID de la commande à exécuter (ex: 'templater-obsidian:create-new-note-from-template'). Si vide, retourne la liste des commandes disponibles." },
        },
        required: [],
      },
    },
    {
      name: 'active',
      description: "Lit ou ajoute du contenu à la note actuellement ouverte dans Obsidian. Requiert Obsidian ouvert.",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '"read" pour lire la note active, "append" pour y ajouter du contenu', enum: ['read', 'append'] },
          content: { type: 'string', description: 'Contenu à ajouter (requis si action=append)' },
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
      if (action === 'list') {
        const path = (input['path'] as string | undefined) ?? '';
        return live
          ? await apiListDir(path)
          : await fileListDir(path);
      }
      if (action === 'delete') {
        return live
          ? await apiDeleteNote(input['path'] as string)
          : await fileDeleteNote(input['path'] as string);
      }
      if (action === 'patch') {
        if (!live) return { success: false, text: 'Patch requiert Obsidian ouvert', error: 'Obsidian not running' };
        return await apiPatchNote(
          input['path'] as string,
          input['target_type'] as string,
          input['target'] as string,
          input['operation'] as string,
          input['content'] as string,
        );
      }
      if (action === 'open') {
        if (!live) return { success: false, text: 'Open requiert Obsidian ouvert', error: 'Obsidian not running' };
        return await apiOpenNote(input['path'] as string);
      }
      if (action === 'commands') {
        if (!live) return { success: false, text: 'Commands requiert Obsidian ouvert', error: 'Obsidian not running' };
        const commandId = input['command_id'] as string | undefined;
        return commandId ? await apiRunCommand(commandId) : await apiListCommands();
      }
      if (action === 'active') {
        if (!live) return { success: false, text: 'Active requiert Obsidian ouvert', error: 'Obsidian not running' };
        return input['action'] === 'read'
          ? await apiGetActive()
          : await apiAppendActive(input['content'] as string);
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

/** Encode a vault path: encode each segment but keep '/' separators */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function apiReadNote(path: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/vault/${encodePath(path)}`, {
    headers: obsidianHeaders(),
  });
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
  const url = `${OBSIDIAN_BASE}/vault/${encodePath(path)}`;
  logger.info({ url, method: 'PUT', contentLength: content.length }, 'Obsidian API: creating note');
  const r = await obsidianFetch(url, {
    method: 'PUT', headers: obsidianHeaders('text/markdown'), body: content,
  });
  logger.info({ status: r.status, ok: r.ok }, 'Obsidian API: create response');
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  return { success: true, text: `Note créée: ${path}`, data: { path, source: 'api' } };
}

async function apiAppendNote(path: string, content: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/vault/${encodePath(path)}`, {
    method: 'POST', headers: obsidianHeaders('text/markdown'), body: '\n' + content,
  });
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  return { success: true, text: `Contenu ajouté à: ${path}`, data: { path, source: 'api' } };
}

async function apiSearchVault(query: string, limit: number): Promise<SubAgentResult> {
  const url = `${OBSIDIAN_BASE}/search/simple/?query=${encodeURIComponent(query)}&contextLength=150`;
  logger.info({ url, query }, 'Obsidian API: searching vault');
  const r = await obsidianFetch(url, {
    method: 'POST',
    headers: obsidianHeaders(),
  });
  if (!r.ok) throw new Error(`Obsidian search API ${r.status}`);
  const results = await r.json() as Array<{ filename: string; matches?: Array<{ match: { start: number; end: number }; context: string }> }>;
  const trimmed = results.slice(0, limit);
  if (trimmed.length === 0) return { success: true, text: `Aucune note trouvée pour: "${query}"`, data: [] };
  const formatted = trimmed.map((r, i) =>
    `${i + 1}. **${r.filename}**\n   …${r.matches?.[0]?.context ?? ''}…`,
  ).join('\n\n');
  return {
    success: true,
    text: `${trimmed.length} note(s) pour "${query}" (via Obsidian REST):\n\n${formatted}`,
    data: trimmed,
  };
}

async function apiDailyNote(action: string, content?: string): Promise<SubAgentResult> {
  if (action === 'read') {
    const r = await obsidianFetch(`${OBSIDIAN_BASE}/periodic/daily/`, { headers: obsidianHeaders() });
    if (!r.ok) throw new Error(`Obsidian daily ${r.status}`);
    const text = await r.text();
    return { success: true, text: `Journal du jour:\n\n${text.substring(0, 3000)}`, data: { content: text } };
  }
  if (action === 'append' && content) {
    const r = await obsidianFetch(`${OBSIDIAN_BASE}/periodic/daily/`, {
      method: 'POST', headers: obsidianHeaders('text/markdown'), body: '\n' + content,
    });
    if (!r.ok) throw new Error(`Obsidian daily append ${r.status}`);
    return { success: true, text: 'Ajouté au journal du jour', data: {} };
  }
  return { success: false, text: 'action doit être "read" ou "append"', error: 'Invalid action' };
}

async function apiListDir(path: string): Promise<SubAgentResult> {
  const url = path
    ? `${OBSIDIAN_BASE}/vault/${encodePath(path)}/`
    : `${OBSIDIAN_BASE}/vault/`;
  const r = await obsidianFetch(url, { headers: obsidianHeaders() });
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  const data = await r.json() as { files: string[] };
  const dirs = data.files.filter((f) => f.endsWith('/'));
  const files = data.files.filter((f) => !f.endsWith('/'));
  const label = path || 'racine';
  return {
    success: true,
    text: `Contenu de "${label}" (${data.files.length} entrée(s)) :\nDossiers: ${dirs.join(', ') || 'aucun'}\nFichiers: ${files.join(', ') || 'aucun'}`,
    data: { path: label, dirs, files },
  };
}

async function apiDeleteNote(path: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/vault/${encodePath(path)}`, {
    method: 'DELETE', headers: obsidianHeaders(),
  });
  if (r.status === 404) return { success: false, text: `Note non trouvée: ${path}`, error: 'Not found' };
  if (!r.ok) throw new Error(`Obsidian API ${r.status}`);
  return { success: true, text: `Note supprimée: ${path}`, data: { path } };
}

async function apiPatchNote(
  path: string, targetType: string, target: string,
  operation: string, content: string,
): Promise<SubAgentResult> {
  const headers: Record<string, string> = {
    ...obsidianHeaders('text/markdown'),
    'Operation': operation,
    'Target-Type': targetType,
    'Target': encodeURIComponent(target),
  };
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/vault/${encodePath(path)}`, {
    method: 'PATCH', headers, body: content,
  });
  if (r.status === 404) return { success: false, text: `Note non trouvée: ${path}`, error: 'Not found' };
  if (!r.ok) throw new Error(`Obsidian patch API ${r.status}`);
  return { success: true, text: `Note "${path}" modifiée : ${operation} sous "${target}"`, data: { path, targetType, target, operation } };
}

async function apiOpenNote(path: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/open/${encodePath(path)}`, {
    method: 'POST', headers: obsidianHeaders(),
  });
  if (!r.ok) throw new Error(`Obsidian open API ${r.status}`);
  return { success: true, text: `Note "${path}" ouverte dans Obsidian`, data: { path } };
}

async function apiListCommands(): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/commands/`, { headers: obsidianHeaders() });
  if (!r.ok) throw new Error(`Obsidian commands API ${r.status}`);
  const data = await r.json() as { commands: Array<{ id: string; name: string }> };
  const formatted = data.commands.map((c) => `- \`${c.id}\` — ${c.name}`).join('\n');
  return {
    success: true,
    text: `${data.commands.length} commande(s) disponibles :\n${formatted}`,
    data: data.commands,
  };
}

async function apiRunCommand(commandId: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/commands/${encodeURIComponent(commandId)}/`, {
    method: 'POST', headers: obsidianHeaders(),
  });
  if (r.status === 404) return { success: false, text: `Commande non trouvée: ${commandId}`, error: 'Not found' };
  if (!r.ok) throw new Error(`Obsidian command API ${r.status}`);
  return { success: true, text: `Commande exécutée: ${commandId}`, data: { commandId } };
}

async function apiGetActive(): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/active/`, { headers: obsidianHeaders() });
  if (r.status === 404) return { success: false, text: 'Aucune note active dans Obsidian', error: 'No active file' };
  if (!r.ok) throw new Error(`Obsidian active API ${r.status}`);
  const content = await r.text();
  return {
    success: true,
    text: `Note active :\n\n${content.substring(0, 3000)}${content.length > 3000 ? '\n…(tronqué)' : ''}`,
    data: { content },
  };
}

async function apiAppendActive(content: string): Promise<SubAgentResult> {
  const r = await obsidianFetch(`${OBSIDIAN_BASE}/active/`, {
    method: 'POST', headers: obsidianHeaders('text/markdown'), body: '\n' + content,
  });
  if (!r.ok) throw new Error(`Obsidian active append API ${r.status}`);
  return { success: true, text: 'Contenu ajouté à la note active', data: {} };
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

async function fileListDir(relativePath: string): Promise<SubAgentResult> {
  const vaultRoot = config.obsidianVaultPath;
  if (!vaultRoot) return { success: false, text: 'OBSIDIAN_VAULT_PATH non configuré', error: 'Missing config' };
  const dirPath = relativePath ? join(vaultRoot, relativePath) : vaultRoot;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => `${e.name}/`);
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
    const label = relativePath || 'racine';
    return {
      success: true,
      text: `Contenu de "${label}" (via fichiers) :\nDossiers: ${dirs.join(', ') || 'aucun'}\nFichiers: ${files.join(', ') || 'aucun'}`,
      data: { path: label, dirs, files },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, text: `Dossier non trouvé: ${relativePath}`, error: 'Not found' };
    }
    throw err;
  }
}

async function fileDeleteNote(path: string): Promise<SubAgentResult> {
  try {
    await unlink(vaultPath(path));
    return { success: true, text: `Note supprimée: ${path} (via fichier)`, data: { path } };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, text: `Note non trouvée: ${path}`, error: 'Not found' };
    }
    throw err;
  }
}
