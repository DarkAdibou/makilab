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
