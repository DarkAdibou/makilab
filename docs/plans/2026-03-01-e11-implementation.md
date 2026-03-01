# E11 — Code SubAgent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `code` subagent that lets Makilab modify its own source code via file operations, Git, whitelisted shell commands, and service restarts — always on a dedicated branch.

**Architecture:** Single subagent `code` with 11 actions. All write operations enforce branch safety (`agent/*` prefix). Shell commands whitelisted. Service restart supports dev (kill+spawn) and prod (docker compose) modes. Uses Node.js `child_process` for Git/shell, `fs` for file operations.

**Tech Stack:** Node.js `child_process.execFile`, `fs/promises`, `node:path`, Git CLI, glob via `fs.readdir` recursive

---

### Task 1: Config + helpers module

**Files:**
- Modify: `packages/agent/src/config.ts`
- Create: `packages/agent/src/subagents/code-helpers.ts`

**Context:** The code subagent needs a repo root path and environment mode. We also need helpers for safe path resolution and Git operations that will be shared across all actions.

**Step 1: Add config entries**

In `packages/agent/src/config.ts`, add these two entries to the config object (after `voyageApiKey`):

```typescript
// Code SubAgent (E11)
codeRepoRoot: optional('CODE_REPO_ROOT', rootDir),
makilabEnv: optional('MAKILAB_ENV', 'development'),
```

`rootDir` is already defined at the top of the file (line 6: `const rootDir = resolve(fileURLToPath(import.meta.url), '../../../..');`).

**Step 2: Create helpers module**

Create `packages/agent/src/subagents/code-helpers.ts`:

```typescript
/**
 * code-helpers.ts — Shared utilities for the code subagent
 *
 * Provides:
 * - Safe path resolution (sandboxed to repo root)
 * - Git command execution
 * - Current branch detection
 * - Branch safety check
 */

import { execFile } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

const REPO_ROOT = config.codeRepoRoot;
const AGENT_BRANCH_PREFIX = 'agent/';

/** Resolve a relative path to an absolute path within the repo, rejecting escapes */
export function safePath(relativePath: string): string {
  const abs = resolve(REPO_ROOT, relativePath);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith('..') || rel.startsWith(sep + sep)) {
    throw new Error(`Path escape rejected: ${relativePath}`);
  }
  // Block .env and other sensitive files
  const lower = rel.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) {
    throw new Error(`Access to .env files is forbidden`);
  }
  return abs;
}

/** Run a git command in the repo root. Returns stdout trimmed. */
export async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: REPO_ROOT,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

/** Get current branch name */
export async function currentBranch(): Promise<string> {
  return git('rev-parse', '--abbrev-ref', 'HEAD');
}

/** Check if current branch is an agent branch (starts with 'agent/') */
export async function isAgentBranch(): Promise<boolean> {
  const branch = await currentBranch();
  return branch.startsWith(AGENT_BRANCH_PREFIX);
}

/** Ensure we're on an agent branch, throw otherwise */
export async function requireAgentBranch(): Promise<string> {
  const branch = await currentBranch();
  if (!branch.startsWith(AGENT_BRANCH_PREFIX)) {
    throw new Error(
      `Opération refusée : la branche courante est "${branch}". ` +
      `Les modifications ne sont autorisées que sur les branches agent/*. ` +
      `Utilise code__git_branch pour créer une branche de travail.`
    );
  }
  return branch;
}

export { REPO_ROOT, AGENT_BRANCH_PREFIX };
```

**Step 3: Commit**

```bash
git add packages/agent/src/config.ts packages/agent/src/subagents/code-helpers.ts
git commit -m "feat(E11): config + code-helpers (path safety, git utils)"
```

---

### Task 2: Tests for code-helpers

**Files:**
- Create: `packages/agent/src/tests/code-helpers.test.ts`

**Context:** Test the safety-critical parts: path sandboxing, .env blocking.

**Step 1: Write tests**

Create `packages/agent/src/tests/code-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { safePath } from '../subagents/code-helpers.ts';

describe('code-helpers', () => {
  describe('safePath', () => {
    it('resolves a normal relative path', () => {
      const result = safePath('packages/agent/src/config.ts');
      expect(result).toContain('packages');
      expect(result).toContain('config.ts');
    });

    it('rejects path traversal with ../', () => {
      expect(() => safePath('../../etc/passwd')).toThrow('Path escape rejected');
    });

    it('rejects .env access', () => {
      expect(() => safePath('.env')).toThrow('Access to .env files is forbidden');
    });

    it('rejects .env.local access', () => {
      expect(() => safePath('.env.local')).toThrow('Access to .env files is forbidden');
    });

    it('allows nested paths that contain env in name', () => {
      // "environment.ts" should be fine, only ".env" exact match is blocked
      const result = safePath('packages/agent/src/environment.ts');
      expect(result).toContain('environment.ts');
    });
  });
});
```

**Step 2: Run tests**

```bash
pnpm --filter @makilab/agent test
```

Expected: All tests pass (existing 46 + 5 new = 51).

**Step 3: Commit**

```bash
git add packages/agent/src/tests/code-helpers.test.ts
git commit -m "test(E11): code-helpers safePath tests"
```

---

### Task 3: File operations (read_file, write_file, list_files, search_code)

**Files:**
- Create: `packages/agent/src/subagents/code.ts`

**Context:** The core subagent file. Start with the 4 read/write actions. `write_file` enforces agent branch. Uses the helpers from Task 1.

**Step 1: Create the subagent with file operations**

Create `packages/agent/src/subagents/code.ts`:

```typescript
/**
 * code.ts — SubAgent: Code (auto-modification)
 *
 * Allows Makilab to modify its own source code on demand.
 * All write operations are restricted to agent/* branches.
 *
 * Actions:
 *   - read_file     : read a file from the repo
 *   - write_file    : write/overwrite a file (agent branch only)
 *   - list_files    : list files matching a glob pattern
 *   - search_code   : grep for a pattern in the codebase
 *   - git_status    : show repo status
 *   - git_diff      : show current diff
 *   - git_branch    : create and switch to agent/<name>
 *   - git_commit    : commit staged changes (agent branch only)
 *   - git_push      : push current branch
 *   - run_check     : run a whitelisted command (test/build/typecheck)
 *   - restart_service: restart agent or dashboard
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { execFile } from 'node:child_process';
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

  // Create parent directory if needed
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

  // Limit output to avoid token explosion
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
    // git grep returns exit code 1 when no match found
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

  // Truncate large diffs
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
  // Sanitize branch name
  const sanitized = name.replace(/[^a-zA-Z0-9\-_/]/g, '-').replace(/-+/g, '-');
  const branchName = `agent/${sanitized}`;

  // Fetch latest master
  try {
    await git('fetch', 'origin', 'master');
  } catch {
    // Offline — proceed from local master
  }

  // Create branch from master and switch
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

  // Stage all changes
  await git('add', '-A');

  // Check if there's anything to commit
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
    // Truncate large output
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
      // Windows: find PID by port and kill
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
      // Unix: lsof + kill
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
  const { spawn } = await import('node:child_process');
  const child = spawn(cmd!, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();

  // Wait a bit and check if port is up
  await new Promise((r) => setTimeout(r, 3000));

  return {
    success: true,
    text: `Service ${service} redémarré sur le port ${port} (PID: ${child.pid})`,
    data: { service, port, pid: child.pid, mode: 'dev' },
  };
}
```

**Step 2: Commit**

```bash
git add packages/agent/src/subagents/code.ts
git commit -m "feat(E11): code subagent — file ops, git, shell, restart"
```

---

### Task 4: Register subagent + test file operations

**Files:**
- Modify: `packages/agent/src/subagents/registry.ts`
- Create: `packages/agent/src/tests/code.test.ts`

**Context:** Register the code subagent (always active, not conditional) and write tests for the core safety logic.

**Step 1: Register in registry.ts**

Add import at top (after memorySubAgent import):

```typescript
import { codeSubAgent } from './code.ts';
```

Add to SUBAGENTS array (after memorySubAgent conditional entry):

```typescript
codeSubAgent,
```

**Step 2: Write tests**

Create `packages/agent/src/tests/code.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safePath } from '../subagents/code-helpers.ts';

// Mock child_process to prevent actual git/shell execution
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock config
vi.mock('../config.ts', () => ({
  config: {
    codeRepoRoot: '/fake/repo',
    makilabEnv: 'development',
  },
}));

describe('code subagent', () => {
  describe('safePath', () => {
    it('resolves normal paths within repo', () => {
      const result = safePath('packages/agent/src/index.ts');
      expect(result).toContain('packages');
    });

    it('rejects path traversal', () => {
      expect(() => safePath('../../etc/passwd')).toThrow('Path escape rejected');
    });

    it('rejects .env access', () => {
      expect(() => safePath('.env')).toThrow('forbidden');
    });

    it('rejects .env.local access', () => {
      expect(() => safePath('.env.local')).toThrow('forbidden');
    });
  });

  describe('execute dispatch', () => {
    it('returns error for unknown action', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.text).toContain('inconnue');
    });
  });

  describe('run_check whitelist', () => {
    it('rejects non-whitelisted commands', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('run_check', { command: 'rm -rf /' });
      expect(result.success).toBe(false);
      expect(result.text).toContain('non autorisée');
    });
  });

  describe('restart_service validation', () => {
    it('rejects unknown service', async () => {
      const { codeSubAgent } = await import('../subagents/code.ts');
      const result = await codeSubAgent.execute('restart_service', { service: 'postgres' });
      expect(result.success).toBe(false);
      expect(result.text).toContain('inconnu');
    });
  });
});
```

**Step 3: Run tests**

```bash
pnpm --filter @makilab/agent test
```

Expected: All tests pass (existing 51 + 4 new = 55).

**Step 4: Commit**

```bash
git add packages/agent/src/subagents/registry.ts packages/agent/src/tests/code.test.ts
git commit -m "feat(E11): register code subagent + safety tests"
```

---

### Task 5: PROGRESS.md update

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Update PROGRESS.md**

Add E11 section after E9 section. Update statut global line. Update "Dernière session" section.

Add the E11 stories table:

```markdown
## E11 — Code SubAgent

Design : `docs/plans/2026-03-01-e11-code-subagent-design.md`
Plan : `docs/plans/2026-03-01-e11-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L11.1 | Config (CODE_REPO_ROOT, MAKILAB_ENV) + code-helpers (safePath, git utils) | ✅ |
| L11.2 | Tests code-helpers (path safety, .env blocking) | ✅ |
| L11.3 | SubAgent code — 11 actions (file ops, git, shell, restart) | ✅ |
| L11.4 | Registration + tests sécurité (whitelist, branch safety) | ✅ |
```

Update epic table: `E11 | Code SubAgent (auto-modification + Git manager) | 🟡 Moyen terme | ✅ Terminé |`

Update statut global: `🟢 E11 terminé — Code SubAgent (auto-modification + Git manager) ✅`

Update dernière session with date, accomplished items, test count (55), 10 subagents.

Update handoff prompt: `E1 ✅ E2 ✅ E3 ✅ E4 ✅ E5 ✅ E4.5 ✅ E6 ✅ E7 ✅ E10 ✅ E10.5 ✅ E9 ✅ E11 ✅`

**Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "chore: PROGRESS.md — E11 Code SubAgent terminé ✅"
```
