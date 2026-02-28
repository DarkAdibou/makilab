# E7 — Mission Control MVP Design

## Décisions

| Question | Décision |
|---|---|
| Scope | MVP : L7.1 (shell + design system) + L7.2 (Chat) + L7.6 (Connections) |
| Communication dashboard↔agent | API HTTP interne (Fastify port 3100) |
| Framework HTTP | Fastify |
| Temps réel chat | Polling MVP, WebSocket à terme (E10) |
| CSS | Vanilla CSS, CSS vars Apex-inspired, dark mode par défaut |
| Auth | Pas d'auth MVP — Tailscale suffit (réseau privé) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  packages/dashboard (Next.js 15)  — port 3000       │
│  ┌──────────┬──────────────────────────────────┐    │
│  │ Sidebar  │  Main content                    │    │
│  │ (240px)  │  ┌────────────────────────────┐  │    │
│  │ Chat     │  │  Page active (Chat /       │  │    │
│  │ Connect. │  │  Connections)              │  │    │
│  │          │  └────────────────────────────┘  │    │
│  └──────────┴──────────────────────────────────┘    │
│                    │ fetch()                         │
└────────────────────┼────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────┐
│  packages/agent (Fastify API)  — port 3100          │
│  POST /api/chat     → runAgentLoop()                │
│  GET  /api/messages  → getRecentMessages()          │
│  GET  /api/tasks    → listTasks()                   │
│  GET  /api/subagents → getAllSubAgents()             │
│  GET  /api/health   → { status, uptime, subagents } │
│  + WhatsApp Gateway + CRON scheduler                │
│  + SQLite makilab.db                                │
└─────────────────────────────────────────────────────┘
```

## API Endpoints

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/health` | GET | `{ status: 'ok', uptime, subagentCount }` |
| `/api/chat` | POST | `{ message, channel }` → `runAgentLoop()` → `{ reply }` |
| `/api/messages` | GET | `?channel=mission_control&limit=50` → historique messages |
| `/api/tasks` | GET | `?status=pending&limit=10` → liste tâches |
| `/api/subagents` | GET | Liste subagents + actions + description |

## Design System

- Fonts : Inter (UI) + JetBrains Mono (code/logs)
- Colors : primary=#5423e7, accent=#ffc233, dark bg=#121217
- Dark mode par défaut (`class="dark"` sur `<html>`)
- CSS vars complètes : voir `memory/e7-mission-control-design.md`
- Composants : sidebar, card, badge, input, button — tout en vanilla CSS

## Pages MVP

### Chat (`/chat` — page par défaut)
- Zone messages (bulles user/assistant, scroll auto)
- Input textarea + bouton envoyer
- POST /api/chat au submit, réponse complète (pas de streaming)
- Channel = `mission_control`
- Historique chargé via GET /api/messages

### Connections (`/connections`)
- Cards des 7 subagents avec nom, description, actions listées
- Statut basique (connected/available)
- Données via GET /api/subagents

## Ce que E7 MVP ne fait PAS (YAGNI)
- Command Center (stat cards, activity feed) — E7.3+
- Vue Tasks — E7.4+
- Logs temps réel — E7.5+
- CRON config UI — E7.7+
- Settings — E7.8+
- WebSocket/SSE — E10
- Auth session — Tailscale suffit
