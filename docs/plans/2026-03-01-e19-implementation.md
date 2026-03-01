# E19 — WhatsApp Unified in Fastify — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the standalone WhatsApp gateway into the Fastify server for a single-process architecture.

**Architecture:** Move session-manager.ts into agent package, create gateway.ts init layer, wire into Fastify boot, add 2 API endpoints, delete standalone package.

**Tech Stack:** Baileys, Fastify, SQLite (messages), existing agent-loop

**Design doc:** `docs/plans/2026-03-01-e19-whatsapp-unified-design.md`

---

### Task 1: Add Baileys dependencies to agent package

**Files:**
- Modify: `packages/agent/package.json`

**Step 1: Add deps**

```bash
cd packages/agent
pnpm add @whiskeysockets/baileys @hapi/boom qrcode
pnpm add -D @types/qrcode
```

**Step 2: Commit**

```bash
git commit -m "chore(E19): add Baileys + qrcode deps to agent package"
```

---

### Task 2: Move session-manager.ts + create gateway.ts

**Files:**
- Create: `packages/agent/src/whatsapp/session-manager.ts` (copy from packages/whatsapp/src/)
- Create: `packages/agent/src/whatsapp/gateway.ts`

**Step 1: Copy session-manager.ts**

Copy `packages/whatsapp/src/session-manager.ts` → `packages/agent/src/whatsapp/session-manager.ts`

No changes needed — the file is self-contained. Only fix import path for `@makilab/shared` (already correct since agent depends on shared).

**Step 2: Create gateway.ts**

```typescript
import { WhatsAppSessionManager } from './session-manager.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { runAgentLoop } from '../agent-loop.ts';
import { getRecentMessages, saveMessage } from '../memory/sqlite.ts';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';
import type { Channel } from '@makilab/shared';

let manager: WhatsAppSessionManager | null = null;

export async function initWhatsApp(): Promise<void> {
  const allowedNumber = process.env['WHATSAPP_ALLOWED_NUMBER'];
  if (!allowedNumber) {
    logger.info({}, 'WhatsApp disabled (WHATSAPP_ALLOWED_NUMBER not set)');
    return;
  }

  const replyJid = process.env['WHATSAPP_REPLY_JID'];

  logger.info({ allowedNumber }, 'WhatsApp gateway starting');

  manager = new WhatsAppSessionManager(
    allowedNumber,

    async (msg: IncomingMessage): Promise<OutgoingMessage> => {
      // Load history from SQLite (same as Mission Control)
      const history = getRecentMessages('whatsapp', 20).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const reply = await runAgentLoop(msg.text, {
        channel: 'whatsapp' as Channel,
        from: msg.from,
        history,
      });

      // Save to SQLite (visible in dashboard)
      saveMessage({ channel: 'whatsapp', role: 'user', content: msg.text });
      saveMessage({ channel: 'whatsapp', role: 'assistant', content: reply });

      return { channel: 'whatsapp', to: msg.from, text: reply };
    },

    (status) => {
      logger.info({ status }, 'WhatsApp connection status');
    },

    replyJid,
  );

  await manager.start();
}

export function getWhatsAppStatus(): { connected: boolean; messagesCount: number } {
  if (!manager) return { connected: false, messagesCount: 0 };
  const state = manager.getState();
  return { connected: state.status === 'connected', messagesCount: state.messagesCount };
}

export async function sendWhatsAppMessage(text: string): Promise<void> {
  if (!manager) throw new Error('WhatsApp not initialized');
  const replyJid = process.env['WHATSAPP_REPLY_JID'] ?? process.env['WHATSAPP_ALLOWED_NUMBER'] ?? '';
  await manager.sendMessage(replyJid, text);
}
```

**Step 3: Commit**

```bash
git commit -m "feat(E19): move session-manager + create gateway.ts"
```

---

### Task 3: Make WHATSAPP_ALLOWED_NUMBER optional in config

**Files:**
- Modify: `packages/agent/src/config.ts`

**Step 1: Change from required to optional**

Change line 25:
```typescript
// Before:
whatsappAllowedNumber: required('WHATSAPP_ALLOWED_NUMBER'),
// After:
whatsappAllowedNumber: optional('WHATSAPP_ALLOWED_NUMBER', ''),
```

Remove from `validateConfig()` missing required list (line 77):
```typescript
// Remove: if (!process.env['WHATSAPP_ALLOWED_NUMBER']) missing.push('WHATSAPP_ALLOWED_NUMBER');
```

Add to optional warnings:
```typescript
if (!process.env['WHATSAPP_ALLOWED_NUMBER']) optionalWarnings.push('WHATSAPP_ALLOWED_NUMBER (whatsapp disabled)');
```

**Step 2: Commit**

```bash
git commit -m "refactor(E19): WHATSAPP_ALLOWED_NUMBER now optional"
```

---

### Task 4: Wire WhatsApp into Fastify boot + API endpoints

**Files:**
- Modify: `packages/agent/src/start-server.ts`
- Modify: `packages/agent/src/server.ts`

**Step 1: Add initWhatsApp to boot**

In `start-server.ts`, after initMcpBridge block:
```typescript
import { initWhatsApp } from './whatsapp/gateway.ts';

// After initMcpBridge:
await initWhatsApp().catch((err) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'WhatsApp init failed');
});
```

Add to graceful shutdown:
```typescript
// No explicit shutdown needed — Baileys handles its own cleanup
```

**Step 2: Add API endpoints in server.ts**

```typescript
import { getWhatsAppStatus, sendWhatsAppMessage } from './whatsapp/gateway.ts';

// GET /api/whatsapp/status
app.get('/api/whatsapp/status', async () => {
  return getWhatsAppStatus();
});

// POST /api/whatsapp/send
app.post<{ Body: { text: string } }>('/api/whatsapp/send', async (req) => {
  const { text } = req.body;
  if (!text) return { error: 'text required' };
  try {
    await sendWhatsAppMessage(text);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});
```

**Step 3: Commit**

```bash
git commit -m "feat(E19): WhatsApp boot in Fastify + /api/whatsapp endpoints"
```

---

### Task 5: Delete standalone package + update scripts

**Files:**
- Delete: `packages/whatsapp/` (entire directory, keep auth_info_baileys)
- Modify: `package.json` (root) — remove dev:whatsapp script if it exists
- Modify: `pnpm-workspace.yaml` — keep as-is (glob pattern)

**Step 1: Move auth_info_baileys to root**

```bash
mv packages/whatsapp/auth_info_baileys ./auth_info_baileys 2>/dev/null || true
```

The session-manager.ts uses `useMultiFileAuthState('auth_info_baileys')` which resolves relative to CWD. Since start-server.ts runs from monorepo root, this will work.

**Step 2: Delete packages/whatsapp**

```bash
rm -rf packages/whatsapp/src packages/whatsapp/package.json packages/whatsapp/tsconfig.json packages/whatsapp/whatsapp-qr.png
rmdir packages/whatsapp 2>/dev/null || true
```

**Step 3: Update root package.json**

Remove `dev:whatsapp` script, update dev script to just `dev:api`:
```json
"dev:whatsapp": // DELETE this line
```

**Step 4: Run pnpm install to clean workspace**

```bash
pnpm install
```

**Step 5: Test**

Run: `pnpm --filter @makilab/agent test` — all existing tests pass
Run: `pnpm --filter @makilab/dashboard build` — builds OK

**Step 6: Commit**

```bash
git commit -m "chore(E19): delete standalone WhatsApp package — unified in Fastify"
```

---

### Task 6: PROGRESS.md + verification

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Add E19 stories**

```markdown
## E19 — WhatsApp unifié dans Fastify

| Story | Titre | Statut |
|---|---|---|
| L19.1 | Dépendances Baileys dans agent package | ✅ |
| L19.2 | session-manager.ts + gateway.ts dans agent | ✅ |
| L19.3 | Config WHATSAPP_ALLOWED_NUMBER optionnel | ✅ |
| L19.4 | Boot WhatsApp dans Fastify + endpoints API | ✅ |
| L19.5 | Suppression packages/whatsapp + cleanup | ✅ |
```

Mark E19 as ✅ Terminé in epics table.

**Step 2: Commit**

```bash
git commit -m "docs(E19): PROGRESS.md — WhatsApp unified ✅"
```

---

## Execution Summary

| Task | Description | Effort |
|---|---|---|
| 1 | Add Baileys deps to agent | 2 min |
| 2 | Move session-manager + create gateway | 5 min |
| 3 | Make WHATSAPP_ALLOWED_NUMBER optional | 2 min |
| 4 | Wire into Fastify boot + API endpoints | 5 min |
| 5 | Delete standalone package + cleanup | 3 min |
| 6 | PROGRESS.md | 2 min |
