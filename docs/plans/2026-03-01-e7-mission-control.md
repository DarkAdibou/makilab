# E7 — Mission Control MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter un dashboard web (Next.js 15) et une API HTTP (Fastify) pour piloter l'agent Makilab via navigateur.

**Architecture:** Fastify s'intègre dans `packages/agent` (port 3100) et expose 5 endpoints REST. Next.js 15 vit dans `packages/dashboard` (port 3000) et consomme cette API. Polling pour le chat, pas de WebSocket MVP.

**Tech Stack:** Fastify 5, Next.js 15 (App Router), vanilla CSS (dark mode, CSS vars Apex-inspired), pnpm workspace.

---

## Task 1 : Fastify server + health endpoint

**Files:**
- Create: `packages/agent/src/server.ts`
- Create: `packages/agent/src/server.test.ts`
- Modify: `packages/agent/package.json` (add fastify dep)

**Step 1: Install Fastify**

```bash
cd d:/SynologyDrive/IA\ et\ agents/makilab
pnpm --filter @makilab/agent add fastify
```

**Step 2: Write the health endpoint test**

```typescript
// packages/agent/src/tests/server.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from '../server.ts';

describe('Fastify server', () => {
  const app = buildServer();
  afterAll(() => app.close());

  it('GET /api/health returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('subagentCount');
  });
});
```

**Step 3: Run test to verify it fails**

```bash
pnpm --filter @makilab/agent test
```
Expected: FAIL — `../server.ts` doesn't exist.

**Step 4: Implement server.ts**

```typescript
// packages/agent/src/server.ts
import Fastify from 'fastify';
import { getAllSubAgents } from './subagents/registry.ts';

export function buildServer() {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    subagentCount: getAllSubAgents().length,
  }));

  return app;
}
```

**Step 5: Run test to verify it passes**

```bash
pnpm --filter @makilab/agent test
```
Expected: ALL PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/tests/server.test.ts packages/agent/package.json pnpm-lock.yaml
git commit -m "feat(E7): Fastify server + health endpoint"
```

---

## Task 2 : API endpoints (chat, messages, tasks, subagents)

**Files:**
- Modify: `packages/agent/src/server.ts` (add 4 routes)
- Modify: `packages/agent/src/tests/server.test.ts` (add tests)

**Step 1: Add tests for all 4 endpoints**

```typescript
// Ajouter dans server.test.ts

it('GET /api/subagents returns array of subagents', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/subagents' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBe(7);
  expect(body[0]).toHaveProperty('name');
  expect(body[0]).toHaveProperty('description');
  expect(body[0]).toHaveProperty('actions');
});

it('GET /api/messages returns array', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/messages?channel=mission_control&limit=10' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(Array.isArray(body)).toBe(true);
});

it('GET /api/tasks returns array', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tasks?limit=5' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(Array.isArray(body)).toBe(true);
});

it('POST /api/chat returns reply', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message: 'Quelle heure est-il ?', channel: 'mission_control' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toHaveProperty('reply');
  expect(typeof body.reply).toBe('string');
}, 30_000); // LLM call — timeout long
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @makilab/agent test
```

**Step 3: Implement the 4 routes in server.ts**

```typescript
// Ajouter dans buildServer(), après le health endpoint

import { getRecentMessages } from './memory/sqlite.ts';
import { listTasks } from './memory/sqlite.ts';
import { runAgentLoop } from './agent-loop.ts';

// GET /api/subagents
app.get('/api/subagents', async () => {
  return getAllSubAgents().map((s) => ({
    name: s.name,
    description: s.description,
    actions: s.actions.map((a) => ({
      name: a.name,
      description: a.description,
    })),
  }));
});

// GET /api/messages
app.get<{ Querystring: { channel?: string; limit?: string } }>(
  '/api/messages',
  async (req) => {
    const channel = req.query.channel ?? 'mission_control';
    const limit = parseInt(req.query.limit ?? '50', 10);
    return getRecentMessages(channel, limit);
  },
);

// GET /api/tasks
app.get<{ Querystring: { status?: string; limit?: string } }>(
  '/api/tasks',
  async (req) => {
    const status = req.query.status;
    const limit = parseInt(req.query.limit ?? '10', 10);
    return listTasks({ status, limit });
  },
);

// POST /api/chat
app.post<{ Body: { message: string; channel?: string } }>(
  '/api/chat',
  async (req) => {
    const { message, channel = 'mission_control' } = req.body;
    const history = getRecentMessages(channel, 20);
    const reply = await runAgentLoop(message, {
      channel,
      from: 'mission_control',
      history,
    });
    return { reply };
  },
);
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @makilab/agent test
```

**Step 5: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/tests/server.test.ts
git commit -m "feat(E7): API endpoints — chat, messages, tasks, subagents"
```

---

## Task 3 : CORS + server startup

**Files:**
- Modify: `packages/agent/src/server.ts` (CORS + listen)
- Create: `packages/agent/src/start-server.ts` (entrypoint)
- Modify: `packages/agent/package.json` (add `dev:api` script, add `@fastify/cors`)

**Step 1: Install @fastify/cors**

```bash
pnpm --filter @makilab/agent add @fastify/cors
```

**Step 2: Add CORS to server.ts**

```typescript
// En haut de buildServer()
import cors from '@fastify/cors';

// Dans buildServer(), avant les routes :
await app.register(cors, { origin: true });
```

Note : `buildServer()` devient `async` → mettre à jour les tests avec `await buildServer()`.

**Step 3: Create start-server.ts**

```typescript
// packages/agent/src/start-server.ts
import { config, validateConfig } from './config.ts';
import { logger } from './logger.ts';
import { buildServer } from './server.ts';
import { startCron } from './tasks/cron.ts';

validateConfig(logger);
startCron();

const server = await buildServer();
const port = parseInt(process.env['MAKILAB_API_PORT'] ?? '3100', 10);

await server.listen({ port, host: '0.0.0.0' });
logger.info(`API listening on http://0.0.0.0:${port}`);
```

**Step 4: Add script to package.json**

Ajouter dans `packages/agent/package.json` → `scripts` :
```json
"dev:api": "node --no-warnings --import tsx/esm src/start-server.ts"
```

Et dans le root `package.json` → `scripts` :
```json
"dev:api": "pnpm --filter @makilab/agent dev:api"
```

**Step 5: Test manuellement**

```bash
pnpm dev:api
# Dans un autre terminal :
curl http://localhost:3100/api/health
```
Expected: `{"status":"ok","uptime":...,"subagentCount":7}`

**Step 6: Commit**

```bash
git add packages/agent/src/server.ts packages/agent/src/start-server.ts packages/agent/package.json package.json pnpm-lock.yaml
git commit -m "feat(E7): CORS + API server entrypoint (port 3100)"
```

---

## Task 4 : Scaffold Next.js dashboard

**Files:**
- Create: `packages/dashboard/` (Next.js 15 App Router)
- Modify: root `package.json` (add `dev:dashboard` script)

**Step 1: Create Next.js app**

```bash
cd d:/SynologyDrive/IA\ et\ agents/makilab/packages
pnpm create next-app dashboard --ts --app --no-tailwind --no-eslint --no-src-dir --import-alias "@/*"
```

Note : si le CLI pose des questions interactives, créer manuellement. Voir step alternatif.

**Step 1 alternatif : Scaffold manuel**

Créer la structure minimale :
```
packages/dashboard/
├── package.json
├── tsconfig.json
├── next.config.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
└── public/
```

`packages/dashboard/package.json` :
```json
{
  "name": "@makilab/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "*"
  }
}
```

**Step 2: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

**Step 3: Configure next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy API calls to Fastify
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3100/api/:path*',
      },
    ];
  },
};

export default nextConfig;
```

**Step 4: Install deps + add root script**

```bash
cd d:/SynologyDrive/IA\ et\ agents/makilab
pnpm install
```

Root `package.json` → scripts :
```json
"dev:dashboard": "pnpm --filter @makilab/dashboard dev"
```

**Step 5: Verify Next.js starts**

```bash
pnpm dev:dashboard
```
Expected: Next.js dev server sur port 3000.

**Step 6: Commit**

```bash
git add packages/dashboard/ package.json pnpm-lock.yaml
git commit -m "feat(E7): scaffold Next.js 15 dashboard"
```

---

## Task 5 : Design system CSS + Layout (sidebar + topbar)

**Files:**
- Create: `packages/dashboard/app/globals.css` (design system complet)
- Modify: `packages/dashboard/app/layout.tsx` (sidebar + topbar + slot)

**Step 1: Write globals.css**

CSS vars (light + dark), reset, fonts (Inter via Google Fonts, JetBrains Mono), composants de base (sidebar, card, badge, button, input). Tout le design system Apex-inspired documenté dans `memory/e7-mission-control-design.md`.

Contenu complet à écrire — inclure :
- `:root` et `.dark` avec toutes les CSS vars
- Reset minimal (box-sizing, margin, font)
- `.sidebar` (240px, fixed, dark bg)
- `.sidebar-link`, `.sidebar-link.active`
- `.topbar` (height 56px, border-bottom)
- `.main-content` (margin-left 240px, padding)
- `.card` (border-radius, shadow, bg)
- `.badge` (small pill, variants)
- `.btn`, `.btn-primary`, `.btn-ghost`
- `.input`, `.textarea`
- Scrollbar styling dark

**Step 2: Write layout.tsx**

```tsx
// packages/dashboard/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from './components/sidebar';

export const metadata: Metadata = {
  title: 'Makilab — Mission Control',
  description: 'Agent dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body>
        <Sidebar />
        <main className="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}
```

**Step 3: Create Sidebar component**

```tsx
// packages/dashboard/app/components/sidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Chat', icon: '💬' },
  { href: '/connections', label: 'Connections', icon: '🔌' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-text">Makilab</span>
      </div>
      <nav className="sidebar-nav">
        <span className="sidebar-section">NAVIGATION</span>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

**Step 4: Verify visually**

```bash
pnpm dev:dashboard
```
Ouvrir http://localhost:3000 — vérifier sidebar dark, layout correct.

**Step 5: Commit**

```bash
git add packages/dashboard/app/
git commit -m "feat(E7): design system CSS + sidebar layout"
```

---

## Task 6 : Page Chat

**Files:**
- Create: `packages/dashboard/app/page.tsx` (chat page — route `/`)
- Create: `packages/dashboard/app/lib/api.ts` (fetch helpers)

**Step 1: Create API helper**

```typescript
// packages/dashboard/app/lib/api.ts
const API_BASE = '/api';

export async function fetchMessages(channel = 'mission_control', limit = 50) {
  const res = await fetch(`${API_BASE}/messages?channel=${channel}&limit=${limit}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
}

export async function sendMessage(message: string, channel = 'mission_control') {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, channel }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ reply: string }>;
}
```

**Step 2: Create Chat page**

```tsx
// packages/dashboard/app/page.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { fetchMessages, sendMessage } from './lib/api';

type Message = { role: 'user' | 'assistant'; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages().then(setMessages).catch(console.error);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const { reply } = await sendMessage(text);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: '❌ Erreur de communication avec l\'agent.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>Chat</h1>
        <span className="badge badge-primary">mission_control</span>
      </div>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="chat-bubble-content">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <div className="chat-bubble-content chat-typing">En train de réfléchir…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          className="textarea chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Envoyer un message…"
          rows={2}
          disabled={loading}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Add chat-specific CSS to globals.css**

Ajouter les styles pour `.chat-container`, `.chat-messages`, `.chat-bubble`, `.chat-bubble.user`, `.chat-bubble.assistant`, `.chat-input-area`, `.chat-typing` (animation pulse).

**Step 4: Test end-to-end**

Démarrer les deux serveurs :
```bash
# Terminal 1
pnpm dev:api
# Terminal 2
pnpm dev:dashboard
```

Ouvrir http://localhost:3000, envoyer "Quelle heure est-il ?", vérifier la réponse.

**Step 5: Commit**

```bash
git add packages/dashboard/app/
git commit -m "feat(E7): chat page — send messages + display history"
```

---

## Task 7 : Page Connections

**Files:**
- Create: `packages/dashboard/app/connections/page.tsx`
- Modify: `packages/dashboard/app/lib/api.ts` (add fetchSubagents)

**Step 1: Add API helper**

```typescript
// Ajouter dans api.ts
export type SubAgentInfo = {
  name: string;
  description: string;
  actions: Array<{ name: string; description: string }>;
};

export async function fetchSubagents() {
  const res = await fetch(`${API_BASE}/subagents`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<SubAgentInfo[]>;
}
```

**Step 2: Create Connections page**

```tsx
// packages/dashboard/app/connections/page.tsx
'use client';
import { useState, useEffect } from 'react';
import { fetchSubagents, type SubAgentInfo } from '../lib/api';

export default function ConnectionsPage() {
  const [subagents, setSubagents] = useState<SubAgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubagents().then(setSubagents).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="connections-container">
      <div className="connections-header">
        <h1>Connections</h1>
        <span className="badge badge-muted">{subagents.length} subagents</span>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <div className="connections-grid">
        {subagents.map((sa) => (
          <div key={sa.name} className="card connection-card">
            <div className="connection-card-header">
              <h3>{sa.name}</h3>
              <span className="badge badge-success">connected</span>
            </div>
            <p className="connection-description">{sa.description}</p>
            <div className="connection-actions">
              {sa.actions.map((a) => (
                <span key={a.name} className="badge badge-outline" title={a.description}>
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Add connections CSS to globals.css**

Styles pour `.connections-grid` (CSS grid, auto-fill 320px), `.connection-card`, `.connection-card-header`, `.connection-actions`, `.badge-success`, `.badge-outline`.

**Step 4: Test end-to-end**

```bash
# Avec les deux serveurs démarrés
```
Ouvrir http://localhost:3000/connections — vérifier 7 cards de subagents.

**Step 5: Commit**

```bash
git add packages/dashboard/app/
git commit -m "feat(E7): connections page — subagent cards"
```

---

## Task 8 : Smoke test + PROGRESS.md + push

**Files:**
- Modify: `PROGRESS.md`

**Step 1: Smoke test complet**

```bash
# Terminal 1
pnpm dev:api
# Terminal 2
pnpm dev:dashboard
```

Vérifier :
- [ ] http://localhost:3100/api/health → JSON OK
- [ ] http://localhost:3000 → sidebar visible, dark mode
- [ ] Chat : envoyer message, recevoir réponse
- [ ] http://localhost:3000/connections → 7 cards

**Step 2: Run all tests**

```bash
pnpm --filter @makilab/agent test
```
Expected: tous les tests passent (26 existants + nouveaux server tests).

**Step 3: Typecheck**

```bash
pnpm --filter @makilab/agent typecheck
pnpm --filter @makilab/dashboard build
```

**Step 4: Update PROGRESS.md**

Ajouter section E7 avec toutes les stories marquées ✅.

**Step 5: Commit + push**

```bash
git add PROGRESS.md
git commit -m "chore: PROGRESS.md — E7 Mission Control MVP terminé ✅"
git push
```
