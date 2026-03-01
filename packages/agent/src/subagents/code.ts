/**
 * code.ts — SubAgent: Code (auto-modification)
 *
 * Allows Makilab to modify its own source code on demand.
 * All write operations are restricted to agent/* branches.
 *
 * Actions:
 *   - read_file      : read a file from the repo
 *   - write_file     : write/overwrite a file (agent branch only)
 *   - list_files     : list files matching a glob pattern
 *   - search_code    : grep for a pattern in the codebase
 *   - git_status     : show repo status
 *   - git_diff       : show current diff
 *   - git_branch     : create and switch to agent/<name>
 *   - git_commit     : commit staged changes (agent branch only)
 *   - git_push       : push current branch
 *   - run_check      : run a whitelisted command (test/build/typecheck)
 *   - restart_service: restart agent or dashboard
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { SubAgent, SubAgentResult } from './types.ts';
import { safePath, git, currentBranch, requireAgentBranch, REPO_ROOT } from './code-helpers.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

const execFileAsync = promisify(execFile);

export const codeSubAgent: SubAgent = {
  name: 'code',
  description:
    'Modifie le code source de Makilab sur demande. ' +
    'Peut lire/écrire des fichiers, gérer Git (branches, commits, push), ' +
    'lancer des vérifications (test, build, typecheck) et redémarrer les services. ' +
    'Toutes les modifications se font sur une branche agent/* dédiée, jamais sur master.',

  actions: [
    {
      name: 'read_file',
      description: 'Lit le contenu d\'un fichier du repo',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif depuis la racine du repo' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Écrit ou remplace le contenu d\'un fichier (branche agent/* uniquement)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif depuis la racine du repo' },
          content: { type: 'string', description: 'Contenu complet du fichier' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'list_files',
      description: 'Liste les fichiers dans un répertoire (récursif optionnel)',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du répertoire (défaut: racine)' },
          recursive: { type: 'boolean', description: 'Lister récursivement (défaut: false)' },
        },
        required: [],
      },
    },
    {
      name: 'search_code',
      description: 'Recherche un pattern dans le codebase (grep)',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern de recherche (regex supporté)' },
          path: { type: 'string', description: 'Sous-répertoire à chercher (défaut: tout le repo)' },
          max_results: { type: 'number', description: 'Nombre max de résultats (défaut: 20)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'git_status',
      description: 'Affiche l\'état du repo Git (branche, fichiers modifiés, ahead/behind)',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'git_diff',
      description: 'Affiche le diff des modifications en cours',
      inputSchema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Afficher le diff staged uniquement (défaut: false)' },
        },
        required: [],
      },
    },
    {
      name: 'git_branch',
      description: 'Crée et switch sur une branche agent/<name> depuis master',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom de la branche (sans le préfixe agent/)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'git_commit',
      description: 'Stage tous les changements et commit (branche agent/* uniquement)',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message de commit' },
        },
        required: ['message'],
      },
    },
    {
      name: 'git_push',
      description: 'Push la branche courante vers origin (bloqué sur master)',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'run_check',
      description: 'Lance une commande de vérification whitelistée (test, build, typecheck)',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Commande à exécuter: test, build, ou typecheck',
            enum: ['test', 'build', 'typecheck'],
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'restart_service',
      description: 'Redémarre un service Makilab (agent ou dashboard)',
      inputSchema: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'Service à redémarrer: agent ou dashboard',
            enum: ['agent', 'dashboard'],
          },
        },
        required: ['service'],
      },
    },
  ],

  async execute(action: string, input: Record<string, unknown>): Promise<SubAgentResult> {
    try {
      switch (action) {
        case 'read_file': return await doReadFile(input);
        case 'write_file': return await doWriteFile(input);
        case 'list_files': return await doListFiles(input);
        case 'search_code': return await doSearchCode(input);
        case 'git_status': return await doGitStatus();
        case 'git_diff': return await doGitDiff(input);
        case 'git_branch': return await doGitBranch(input);
        case 'git_commit': return await doGitCommit(input);
        case 'git_push': return await doGitPush();
        case 'run_check': return await doRunCheck(input);
        case 'restart_service': return await doRestartService(input);
        default:
          return { success: false, text: `Action inconnue: ${action}`, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ action, err: message }, 'Code subagent error');
      return { success: false, text: `Erreur: ${message}`, error: message };
    }
  },
};

// ── File operations ──────────────────────────────────────────────────────────

async function doReadFile(input: Record<string, unknown>): Promise<SubAgentResult> {
  const filePath = safePath(input['path'] as string);
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').length;
  return {
    success: true,
    text: `Fichier ${input['path']} (${lines} lignes):\n\n${content}`,
    data: { path: input['path'], lines },
  };
}

async function doWriteFile(input: Record<string, unknown>): Promise<SubAgentResult> {
  await requireAgentBranch();
  const relPath = input['path'] as string;
  const filePath = safePath(relPath);
  const content = input['content'] as string;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  const lines = content.split('\n').length;
  return {
    success: true,
    text: `Fichier écrit: ${relPath} (${lines} lignes)`,
    data: { path: relPath, lines },
  };
}

async function doListFiles(input: Record<string, unknown>): Promise<SubAgentResult> {
  const relPath = (input['path'] as string) ?? '.';
  const dirPath = safePath(relPath);
  const recursive = (input['recursive'] as boolean) ?? false;

  const entries = await readdir(dirPath, { withFileTypes: true, recursive });
  const files = entries
    .filter((e) => !e.name.startsWith('.git'))
    .filter((e) => !e.name.includes('node_modules'))
    .map((e) => {
      const entryPath = e.parentPath
        ? relative(dirPath, `${e.parentPath}/${e.name}`)
        : e.name;
      return e.isDirectory() ? `${entryPath}/` : entryPath;
    })
    .sort();

  const maxEntries = 200;
  const truncated = files.length > maxEntries;
  const shown = truncated ? files.slice(0, maxEntries) : files;

  return {
    success: true,
    text: `${files.length} entrée(s) dans ${relPath}${truncated ? ` (tronqué à ${maxEntries})` : ''}:\n\n${shown.join('\n')}`,
    data: { count: files.length, truncated },
  };
}

async function doSearchCode(input: Record<string, unknown>): Promise<SubAgentResult> {
  const pattern = input['pattern'] as string;
  const subPath = (input['path'] as string) ?? '.';
  const maxResults = (input['max_results'] as number) ?? 20;
  const searchDir = safePath(subPath);

  try {
    const { stdout } = await execFileAsync('git', [
      'grep', '-n', '-I', '--max-count', String(maxResults), pattern, '--', searchDir,
    ], {
      cwd: REPO_ROOT,
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    return {
      success: true,
      text: `${lines.length} résultat(s) pour "${pattern}":\n\n${lines.join('\n')}`,
      data: { count: lines.length },
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 1) {
      return { success: true, text: `Aucun résultat pour "${pattern}"`, data: { count: 0 } };
    }
    throw err;
  }
}

// ── Git operations ───────────────────────────────────────────────────────────

async function doGitStatus(): Promise<SubAgentResult> {
  const branch = await currentBranch();
  const status = await git('status', '--short');
  const log = await git('log', '--oneline', '-5');

  let tracking = '';
  try {
    const ahead = await git('rev-list', '--count', `origin/${branch}..${branch}`);
    const behind = await git('rev-list', '--count', `${branch}..origin/${branch}`);
    tracking = `\nAhead: ${ahead}, Behind: ${behind}`;
  } catch {
    tracking = '\n(pas de branche remote trackée)';
  }

  return {
    success: true,
    text: `Branche: ${branch}${tracking}\n\nFichiers modifiés:\n${status || '(aucun)'}\n\nDerniers commits:\n${log}`,
    data: { branch },
  };
}

async function doGitDiff(input: Record<string, unknown>): Promise<SubAgentResult> {
  const staged = (input['staged'] as boolean) ?? false;
  const args = staged ? ['diff', '--staged'] : ['diff'];
  const diff = await git(...args);

  if (!diff) {
    return { success: true, text: staged ? 'Aucun changement staged' : 'Aucun changement non-staged' };
  }

  const maxLength = 8000;
  const truncated = diff.length > maxLength;
  const shown = truncated ? diff.slice(0, maxLength) + '\n\n... (tronqué)' : diff;

  return {
    success: true,
    text: `Diff${staged ? ' (staged)' : ''}:\n\n${shown}`,
    data: { truncated },
  };
}

async function doGitBranch(input: Record<string, unknown>): Promise<SubAgentResult> {
  const name = input['name'] as string;
  const sanitized = name.replace(/[^a-zA-Z0-9\-_/]/g, '-').replace(/-+/g, '-');
  const branchName = `agent/${sanitized}`;

  try {
    await git('fetch', 'origin', 'master');
  } catch {
    // Offline — proceed from local master
  }

  await git('checkout', '-b', branchName, 'master');

  return {
    success: true,
    text: `Branche créée et activée: ${branchName}`,
    data: { branch: branchName },
  };
}

async function doGitCommit(input: Record<string, unknown>): Promise<SubAgentResult> {
  const branch = await requireAgentBranch();
  const message = input['message'] as string;

  await git('add', '-A');

  const status = await git('status', '--porcelain');
  if (!status) {
    return { success: true, text: 'Rien à commiter (aucun changement)' };
  }

  await git('commit', '-m', message);
  const hash = await git('rev-parse', '--short', 'HEAD');

  logger.info({ branch, hash, message }, 'Code subagent committed');
  return {
    success: true,
    text: `Commit ${hash} sur ${branch}: "${message}"`,
    data: { hash, branch, message },
  };
}

async function doGitPush(): Promise<SubAgentResult> {
  const branch = await currentBranch();
  if (branch === 'master' || branch === 'main') {
    return {
      success: false,
      text: `Push sur ${branch} interdit. Utilise une branche agent/*.`,
      error: `Push to ${branch} is forbidden`,
    };
  }

  await git('push', '-u', 'origin', branch);
  return {
    success: true,
    text: `Branche ${branch} pushée vers origin`,
    data: { branch },
  };
}

// ── Shell commands ───────────────────────────────────────────────────────────

const WHITELISTED_COMMANDS: Record<string, string[]> = {
  test: ['pnpm', '--filter', '@makilab/agent', 'test'],
  build: ['pnpm', '--filter', '@makilab/dashboard', 'build'],
  typecheck: ['pnpm', '--filter', '@makilab/agent', 'exec', 'tsc', '--noEmit'],
};

async function doRunCheck(input: Record<string, unknown>): Promise<SubAgentResult> {
  const command = input['command'] as string;
  const cmdArgs = WHITELISTED_COMMANDS[command];

  if (!cmdArgs) {
    return {
      success: false,
      text: `Commande non autorisée: ${command}. Autorisées: ${Object.keys(WHITELISTED_COMMANDS).join(', ')}`,
      error: `Command not whitelisted: ${command}`,
    };
  }

  const [cmd, ...args] = cmdArgs;
  try {
    const { stdout, stderr } = await execFileAsync(cmd!, args, {
      cwd: REPO_ROOT,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const output = (stdout + '\n' + stderr).trim();
    const maxLength = 5000;
    const truncated = output.length > maxLength;
    const shown = truncated ? output.slice(0, maxLength) + '\n\n... (tronqué)' : output;

    return {
      success: true,
      text: `✅ ${command} passé:\n\n${shown}`,
      data: { command, truncated },
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = ((error.stdout ?? '') + '\n' + (error.stderr ?? '')).trim();
    const maxLength = 5000;
    const shown = output.length > maxLength ? output.slice(0, maxLength) + '\n\n... (tronqué)' : output;

    return {
      success: false,
      text: `❌ ${command} échoué:\n\n${shown}`,
      error: error.message ?? 'Command failed',
    };
  }
}

// ── Service restart ──────────────────────────────────────────────────────────

const SERVICE_PORTS: Record<string, number> = {
  agent: 3100,
  dashboard: 3000,
};

const SERVICE_COMMANDS: Record<string, string[]> = {
  agent: ['pnpm', 'dev:api'],
  dashboard: ['pnpm', 'dev:dashboard'],
};

async function doRestartService(input: Record<string, unknown>): Promise<SubAgentResult> {
  const service = input['service'] as string;

  if (!SERVICE_PORTS[service]) {
    return {
      success: false,
      text: `Service inconnu: ${service}. Autorisés: ${Object.keys(SERVICE_PORTS).join(', ')}`,
      error: `Unknown service: ${service}`,
    };
  }

  const port = SERVICE_PORTS[service]!;
  const isProd = config.makilabEnv === 'production';

  if (isProd) {
    return await restartDocker(service);
  }

  return await restartDev(service, port);
}

async function restartDocker(service: string): Promise<SubAgentResult> {
  try {
    await execFileAsync('docker', ['compose', 'restart', service], {
      cwd: REPO_ROOT,
      timeout: 60_000,
    });
    return {
      success: true,
      text: `Service ${service} redémarré via docker compose`,
      data: { service, mode: 'docker' },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, text: `Erreur docker restart: ${message}`, error: message };
  }
}

async function restartDev(service: string, port: number): Promise<SubAgentResult> {
  // Kill existing process on port
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do @echo %a`], {
        timeout: 10_000,
      });
      const pids = stdout.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        try {
          await execFileAsync('taskkill', ['/PID', pid.trim(), '/F'], { timeout: 5_000 });
        } catch { /* process may already be dead */ }
      }
    } else {
      try {
        const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`], { timeout: 5_000 });
        const pids = stdout.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            await execFileAsync('kill', ['-9', pid.trim()], { timeout: 5_000 });
          } catch { /* process may already be dead */ }
        }
      } catch { /* no process on port */ }
    }
  } catch {
    // Failed to kill — maybe nothing was running
  }

  // Spawn new process detached
  const [cmd, ...args] = SERVICE_COMMANDS[service]!;
  const child = spawn(cmd!, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();

  // Wait a bit for startup
  await new Promise((r) => setTimeout(r, 3000));

  return {
    success: true,
    text: `Service ${service} redémarré sur le port ${port} (PID: ${child.pid})`,
    data: { service, port, pid: child.pid, mode: 'dev' },
  };
}
