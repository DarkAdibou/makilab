# E1 — Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mettre en place la structure complète du projet, le WhatsApp Gateway sécurisé, la boucle agentique core et le premier échange bout-en-bout WhatsApp → Claude → WhatsApp.

**Architecture:** Monorepo TypeScript avec trois packages : `agent` (orchestrateur + boucle agentique), `whatsapp` (Baileys gateway), `shared` (types communs). Docker Compose orchestre les services. Le tout tourne sur le NUC N150.

**Tech Stack:** Node.js 22, TypeScript strict, Baileys, SDK Anthropic, Docker Compose, pnpm workspaces

---

## Task 1 : Structure du projet et tooling

**Files:**
- Create: `package.json` (racine)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/whatsapp/package.json`
- Create: `packages/whatsapp/tsconfig.json`

**Step 1: Créer la structure de dossiers**

```bash
mkdir -p packages/shared/src packages/agent/src packages/whatsapp/src logs
```

**Step 2: Créer le package.json racine**

```json
{
  "name": "makilab",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "docker compose up -d && pnpm --filter agent dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 3: Créer pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

**Step 4: Créer tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 5: Créer .env.example**

```bash
# LLM
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...

# WhatsApp
WHATSAPP_ALLOWED_NUMBER=33XXXXXXXXX@s.whatsapp.net

# Agent
AGENT_MAX_ITERATIONS=10
NODE_ENV=development
```

**Step 6: Créer .gitignore**

```
node_modules/
dist/
.env
*.db
auth_info_baileys/
logs/
.DS_Store
```

**Step 7: Créer packages/shared**

`packages/shared/package.json`:
```json
{
  "name": "@makilab/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": { "typescript": "*" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```typescript
export type Channel = 'whatsapp' | 'mission_control' | 'antigravity';

export interface IncomingMessage {
  id: string;
  channel: Channel;
  from: string;
  text: string;
  timestamp: Date;
}

export interface OutgoingMessage {
  channel: Channel;
  to: string;
  text: string;
}
```

**Step 8: Commit**

```bash
git init
git add .
git commit -m "feat: init monorepo structure with pnpm workspaces"
```

---

## Task 2 : Docker Compose (infrastructure locale)

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.override.yml` (dev overrides)

**Step 1: Créer docker-compose.yml**

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: makilab-qdrant
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: makilab-postgres
    environment:
      POSTGRES_DB: makilab
      POSTGRES_USER: makilab
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-makilab_dev}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U makilab"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  qdrant_data:
  postgres_data:
```

**Step 2: Ajouter POSTGRES_PASSWORD à .env.example**

```bash
# Database
POSTGRES_PASSWORD=makilab_dev
DATABASE_URL=postgresql://makilab:makilab_dev@localhost:5432/makilab
```

**Step 3: Démarrer les services et vérifier**

```bash
docker compose up -d
docker compose ps
```

Expected output : `makilab-qdrant` et `makilab-postgres` avec status `running`.

**Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add docker compose with qdrant and postgres"
```

---

## Task 3 : Package agent — setup et types

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/types.ts`
- Create: `packages/agent/src/config.ts`

**Step 1: Créer packages/agent/package.json**

```json
{
  "name": "@makilab/agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.36.0",
    "@makilab/shared": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "*"
  }
}
```

**Step 2: Créer packages/agent/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": {
    "paths": {
      "@makilab/shared": ["../shared/src/index.ts"]
    }
  }
}
```

**Step 3: Créer packages/agent/src/config.ts**

```typescript
import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  openrouterApiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  whatsappAllowedNumber: required('WHATSAPP_ALLOWED_NUMBER'),
  agentMaxIterations: parseInt(process.env['AGENT_MAX_ITERATIONS'] ?? '10', 10),
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
} as const;
```

**Step 4: Créer packages/agent/src/types.ts**

```typescript
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface AgentContext {
  channel: string;
  from: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}
```

**Step 5: Créer packages/agent/src/index.ts (placeholder)**

```typescript
import { config } from './config.js';

console.log(`Makilab Agent starting in ${config.nodeEnv} mode...`);
```

**Step 6: Installer les dépendances**

```bash
pnpm install
```

**Step 7: Vérifier le typecheck**

```bash
pnpm --filter agent typecheck
```

Expected: aucune erreur TypeScript.

**Step 8: Commit**

```bash
git add packages/agent/
git commit -m "feat: scaffold agent package with config and types"
```

---

## Task 4 : Outil get_time et boucle agentique core

**Files:**
- Create: `packages/agent/src/tools/get-time.ts`
- Create: `packages/agent/src/tools/index.ts`
- Create: `packages/agent/src/agent-loop.ts`

**Step 1: Créer packages/agent/src/tools/get-time.ts**

```typescript
import type { Tool } from '../types.js';

export const getTimeTool: Tool = {
  name: 'get_time',
  description: 'Returns the current date and time.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    return new Date().toISOString();
  },
};
```

**Step 2: Créer packages/agent/src/tools/index.ts**

```typescript
import type { Tool } from '../types.js';
import { getTimeTool } from './get-time.js';

export const tools: Tool[] = [getTimeTool];

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}
```

**Step 3: Créer packages/agent/src/agent-loop.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { findTool, tools } from './tools/index.js';
import type { AgentContext } from './types.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `Tu es Makilab, un agent personnel semi-autonome.
Tu aides ton utilisateur avec ses tâches quotidiennes : emails, recherche, notes, etc.
Tu réponds toujours en français sauf si on te parle dans une autre langue.
Tu es concis et précis.`;

export async function runAgentLoop(
  userMessage: string,
  context: AgentContext,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...context.history,
    { role: 'user', content: userMessage },
  ];

  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  let iterations = 0;

  while (iterations < config.agentMaxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text : '';
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const tool = findTool(block.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: tool "${block.name}" not found`,
            is_error: true,
          });
          continue;
        }

        const result = await tool.execute(block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  return `Erreur : limite d'itérations atteinte (${config.agentMaxIterations}).`;
}
```

**Step 4: Typecheck**

```bash
pnpm --filter agent typecheck
```

Expected: aucune erreur.

**Step 5: Test manuel rapide**

Modifier temporairement `packages/agent/src/index.ts` :

```typescript
import { runAgentLoop } from './agent-loop.js';

const reply = await runAgentLoop("Quelle heure est-il ?", {
  channel: 'test',
  from: 'test',
  history: [],
});

console.log('Agent reply:', reply);
```

Lancer :
```bash
pnpm --filter agent dev
```

Expected: l'agent répond avec l'heure actuelle, preuve que la boucle + tool use fonctionne.

**Step 6: Commit**

```bash
git add packages/agent/src/tools/ packages/agent/src/agent-loop.ts
git commit -m "feat: add agent loop with tool use and get_time tool"
```

---

## Task 5 : WhatsApp Gateway (Baileys + whitelist)

**Files:**
- Create: `packages/whatsapp/package.json`
- Create: `packages/whatsapp/tsconfig.json`
- Create: `packages/whatsapp/src/gateway.ts`
- Create: `packages/whatsapp/src/index.ts`

**Step 1: Créer packages/whatsapp/package.json**

```json
{
  "name": "@makilab/whatsapp",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@makilab/shared": "workspace:*",
    "@whiskeysockets/baileys": "^6.7.0",
    "dotenv": "^16.0.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "*"
  }
}
```

**Step 2: Créer packages/whatsapp/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": {
    "paths": {
      "@makilab/shared": ["../shared/src/index.ts"]
    }
  }
}
```

**Step 3: Créer packages/whatsapp/src/gateway.ts**

```typescript
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';

export type MessageHandler = (msg: IncomingMessage) => Promise<OutgoingMessage>;

export async function startWhatsAppGateway(
  allowedNumber: string,
  onMessage: MessageHandler,
): Promise<void> {
  const logger = pino({ level: 'silent' });
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({ auth: state, logger });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Scanne ce QR code avec ton numéro secondaire WhatsApp:\n');
      // Le QR sera affiché dans le terminal par Baileys
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log('Reconnexion WhatsApp...');
        startWhatsAppGateway(allowedNumber, onMessage);
      } else {
        console.log('Déconnecté. Relancer manuellement.');
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp Gateway connecté');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue; // Ignore nos propres messages

      const from = msg.key.remoteJid ?? '';

      // SÉCURITÉ : whitelist stricte
      if (from !== allowedNumber) {
        console.log(`Ignored message from unauthorized number: ${from}`);
        return;
      }

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        '';

      if (!text) continue;

      const incoming: IncomingMessage = {
        id: msg.key.id ?? crypto.randomUUID(),
        channel: 'whatsapp',
        from,
        text,
        timestamp: new Date((msg.messageTimestamp as number) * 1000),
      };

      const outgoing = await onMessage(incoming);
      await sock.sendMessage(outgoing.to, { text: outgoing.text });
    }
  });
}
```

**Step 4: Créer packages/whatsapp/src/index.ts**

```typescript
import 'dotenv/config';
import { startWhatsAppGateway } from './gateway.js';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';

const allowedNumber = process.env['WHATSAPP_ALLOWED_NUMBER'];
if (!allowedNumber) throw new Error('WHATSAPP_ALLOWED_NUMBER not set');

await startWhatsAppGateway(allowedNumber, async (msg: IncomingMessage): Promise<OutgoingMessage> => {
  console.log(`[WhatsApp] Message de ${msg.from}: ${msg.text}`);
  return {
    channel: 'whatsapp',
    to: msg.from,
    text: `Echo: ${msg.text}`, // Placeholder — branché sur l'agent à la Task 6
  };
});
```

**Step 5: Installer les dépendances**

```bash
pnpm install
```

**Step 6: Typecheck**

```bash
pnpm --filter @makilab/whatsapp typecheck
```

**Step 7: Commit**

```bash
git add packages/whatsapp/
git commit -m "feat: add whatsapp gateway with baileys and number whitelist"
```

---

## Task 6 : Connexion bout-en-bout WhatsApp → Agent → WhatsApp

**Files:**
- Modify: `packages/whatsapp/src/index.ts`
- Modify: `packages/agent/src/index.ts`

**Step 1: Modifier packages/whatsapp/src/index.ts pour brancher l'agent**

```typescript
import 'dotenv/config';
import { startWhatsAppGateway } from './gateway.js';
import { runAgentLoop } from '@makilab/agent/agent-loop';
import type { IncomingMessage, OutgoingMessage } from '@makilab/shared';

const allowedNumber = process.env['WHATSAPP_ALLOWED_NUMBER'];
if (!allowedNumber) throw new Error('WHATSAPP_ALLOWED_NUMBER not set');

// Historique simple en mémoire (remplacé par SQLite à l'Epic 2)
const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

await startWhatsAppGateway(allowedNumber, async (msg: IncomingMessage): Promise<OutgoingMessage> => {
  console.log(`[WhatsApp] ${msg.from}: ${msg.text}`);

  const reply = await runAgentLoop(msg.text, {
    channel: msg.channel,
    from: msg.from,
    history: history.slice(-20),
  });

  history.push({ role: 'user', content: msg.text });
  history.push({ role: 'assistant', content: reply });

  console.log(`[Agent] Réponse: ${reply}`);

  return {
    channel: 'whatsapp',
    to: msg.from,
    text: reply,
  };
});
```

**Step 2: Ajouter l'export dans packages/agent/package.json**

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./agent-loop": "./dist/agent-loop.js"
  }
}
```

**Step 3: Typecheck global**

```bash
pnpm typecheck
```

Expected: aucune erreur.

**Step 4: Test bout-en-bout**

```bash
pnpm --filter @makilab/whatsapp dev
```

- Scanner le QR code avec le numéro secondaire
- Envoyer "Quelle heure est-il ?" depuis ton numéro principal
- Expected: réponse de l'agent avec l'heure, via WhatsApp

**Step 5: Mettre à jour PROGRESS.md**

Marquer E1 entier comme ✅ Terminé. Mettre à jour le handoff prompt.

**Step 6: Commit final E1**

```bash
git add .
git commit -m "feat: E1 complete — whatsapp gateway connected to agent loop end-to-end"
```

---

## Résumé E1

À la fin de cet epic, tu as :
- Un monorepo TypeScript avec pnpm workspaces
- Docker Compose avec Qdrant + PostgreSQL
- Une boucle agentique avec tool use (Claude Sonnet)
- Un WhatsApp Gateway sécurisé (whitelist stricte)
- Un premier échange bout-en-bout fonctionnel

**Prochaine étape : E2 — Mémoire T1 (SQLite)**
