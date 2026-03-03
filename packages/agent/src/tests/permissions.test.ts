/**
 * permissions.test.ts — Tests du système de permissions + wasJustConfirmed
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// ── Helpers pour tester checkPermission/setPermission sans affecter la vraie DB ──

function makeTestDb(): DatabaseSync {
  const dbPath = join(tmpdir(), `perm-test-${randomUUID()}.db`);
  process.env['MAKILAB_DB_PATH'] = dbPath;
  return new DatabaseSync(dbPath);
}

// On importe dynamiquement après avoir positionné MAKILAB_DB_PATH
async function importSqlite() {
  // Force fresh module import avec nouveau chemin DB
  const mod = await import('../memory/sqlite.ts');
  return mod;
}

// ── Tests checkPermission / setPermission ────────────────────────────────────

describe('checkPermission', () => {
  it('retourne allowed pour une action absente de la table', async () => {
    makeTestDb();
    const { checkPermission } = await importSqlite();
    expect(checkPermission('web', 'search')).toBe('allowed');
  });

  it('retourne confirm_required pour code/git_push (seed par défaut)', async () => {
    makeTestDb();
    const { checkPermission } = await importSqlite();
    expect(checkPermission('code', 'git_push')).toBe('confirm_required');
  });

  it('retourne confirm_required pour code/restart_service (seed par défaut)', async () => {
    makeTestDb();
    const { checkPermission } = await importSqlite();
    expect(checkPermission('code', 'restart_service')).toBe('confirm_required');
  });

  it('setPermission + checkPermission round-trip', async () => {
    makeTestDb();
    const { checkPermission, setPermission } = await importSqlite();
    setPermission('obsidian', 'delete_file', 'denied');
    expect(checkPermission('obsidian', 'delete_file')).toBe('denied');
  });

  it('setPermission peut changer un niveau existant', async () => {
    makeTestDb();
    const { checkPermission, setPermission } = await importSqlite();
    expect(checkPermission('code', 'git_push')).toBe('confirm_required');
    setPermission('code', 'git_push', 'allowed');
    expect(checkPermission('code', 'git_push')).toBe('allowed');
  });

  it('getAllPermissions retourne au moins les seeds', async () => {
    makeTestDb();
    const { getAllPermissions } = await importSqlite();
    const perms = getAllPermissions();
    expect(perms.some(p => p.subagent === 'code' && p.action === 'git_push')).toBe(true);
    expect(perms.some(p => p.subagent === 'code' && p.action === 'restart_service')).toBe(true);
  });
});

// ── Tests wasJustConfirmed ────────────────────────────────────────────────────

import { wasJustConfirmed } from '../agent-loop.ts';

describe('wasJustConfirmed', () => {
  it('retourne false si messages vide', () => {
    expect(wasJustConfirmed([])).toBe(false);
  });

  it('retourne true si dernier message user est "oui"', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'assistant', content: 'Tu confirmes le push ?' },
      { role: 'user', content: 'oui' },
    ];
    expect(wasJustConfirmed(messages)).toBe(true);
  });

  it('retourne true pour "yes", "ok", "go", "confirme"', () => {
    for (const word of ['yes', 'ok', 'go', 'confirme']) {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: word },
      ];
      expect(wasJustConfirmed(messages)).toBe(true);
    }
  });

  it('retourne false si dernier message user n\'est pas affirmatif', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'non' },
    ];
    expect(wasJustConfirmed(messages)).toBe(false);
  });

  it('retourne false si dernier message user est une question ou phrase longue', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'Est-ce que tu peux faire autre chose ?' },
    ];
    expect(wasJustConfirmed(messages)).toBe(false);
  });

  it('ignore les messages tool_result-only (sans bloc text)', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'oui' },
      { role: 'assistant', content: 'Je vais push...' },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'xyz', content: 'résultat' }],
      },
    ];
    // Le dernier user est un tool_result-only → doit ignorer et remonter à "oui"
    expect(wasJustConfirmed(messages)).toBe(true);
  });

  it('retourne false si aucun message user avec texte n\'est affirmatif', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'assistant', content: 'Tu confirmes ?' },
    ];
    expect(wasJustConfirmed(messages)).toBe(false);
  });
});
