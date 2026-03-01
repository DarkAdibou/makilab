# E19 — WhatsApp unifié dans Fastify

**Date :** 2026-03-01
**Scope :** Fusionner le gateway WhatsApp (processus séparé) dans le serveur Fastify (processus unique)

## Problème

2 processus : Fastify (API+CRON) et WhatsApp standalone. Le WhatsApp standalone a sa propre boucle agentique avec un historique in-memory, déconnecté de SQLite, du dashboard, et des métriques LLM.

## Solution

Déplacer `WhatsAppSessionManager` dans `packages/agent`, démarré au boot Fastify si `WHATSAPP_ALLOWED_NUMBER` est configuré. Un seul processus, une seule DB, tout unifié.

## Composants

### 1. Déplacement

- `packages/whatsapp/src/session-manager.ts` → `packages/agent/src/whatsapp/session-manager.ts` (tel quel)
- Dépendances : ajouter `@whiskeysockets/baileys`, `qrcode`, `@types/qrcode`, `@hapi/boom` à `packages/agent/package.json`

### 2. Gateway (`packages/agent/src/whatsapp/gateway.ts`)

```typescript
export async function initWhatsApp(): Promise<void>;
export function getWhatsAppStatus(): { connected: boolean; messagesCount: number };
export async function sendWhatsAppMessage(text: string): Promise<void>;
```

`initWhatsApp()` :
- Crée `WhatsAppSessionManager` avec le handler qui appelle `runAgentLoop()` (comme `start-server.ts` pour le chat Mission Control)
- Historique via SQLite `getRecentMessages('whatsapp', 20)` — plus d'in-memory
- Sauvegarde messages via `saveMessage()` — visible dans le dashboard

### 3. Config

`WHATSAPP_ALLOWED_NUMBER` devient optionnel (pas de crash si absent — WhatsApp simplement désactivé).

### 4. Boot

Dans `start-server.ts`, après initMcpBridge :
```typescript
await initWhatsApp().catch(err => logger.warn(...));
```

### 5. API endpoints

- `GET /api/whatsapp/status` — `{ connected, messagesCount }`
- `POST /api/whatsapp/send` — `{ text }` → envoie via le gateway (pour notifications E14.5)

### 6. Suppression

Supprimer `packages/whatsapp/` entièrement. Mettre à jour les scripts root.

## Ce qu'on ne fait pas

- Pas de refonte de session-manager.ts
- Pas de WebSocket pour le status
- Pas de multi-numéro
