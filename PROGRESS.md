# Makilab Agent — Progress Tracker
*SOURCE DE VÉRITÉ — mis à jour à chaque session*

---

## Statut global : 🟢 E10 terminé — Mission Control v2 ✅ — Prochaine étape : E8 Gmail + Raycast

---

## Epics

| Epic | Titre | Priorité | Statut |
|---|---|---|---|
| E1 | Foundation (monorepo, WhatsApp, boucle agentique) | 🔴 Critique | ✅ Terminé |
| E2 | Mémoire T1 (SQLite, faits, compaction) | 🔴 Critique | ✅ Terminé |
| E3 | Architecture subagents (registre, routing, composition) | 🔴 Critique | ✅ Terminé |
| E4 | Subagents MVP (Obsidian, Gmail, Web, Karakeep) | 🔴 Critique | ✅ Terminé |
| E5 | Smart Capture | 🔴 Critique | ✅ Terminé |
| E6 | Gestionnaire de tâches + CRON | 🟠 Important | ✅ Terminé |
| E7 | Mission Control — Chat + Connections MVP | 🟠 Important | ✅ Terminé |
| E8 | Canal Gmail entrant + Raycast webhook | 🟠 Important | 🔲 Non démarré |
| E9 | Mémoire sémantique (Qdrant + embeddings) | 🟡 Moyen terme | 🔲 Non démarré |
| E10 | Mission Control v2 — Kanban, Streaming, Home Assistant | 🟠 Important | ✅ Terminé |
| E11 | Code SubAgent (auto-modification + Git manager) | 🟡 Moyen terme | 🔲 Non démarré |
| E12 | Proactivité (briefing matin, surveillance) | 🟡 Moyen terme | 🔲 Non démarré |
| E13 | Subagents étendus (Indeed, NotebookLM, Calendar, Drive) | 🟢 Long terme | 🔲 Non démarré |
| E14 | LLM Router intelligent configurable | 🟢 Long terme | 🔲 Non démarré |
| E15 | Migration NUC N150 / CasaOS (production) | 🟢 Long terme | 🔲 Non démarré |

---

## E1 — Foundation

Plan détaillé : `docs/plans/2026-02-28-e1-foundation.md`

| Story | Titre | Statut |
|---|---|---|
| L1.1 | Init monorepo + pnpm workspaces + TypeScript | ✅ |
| L1.2 | Docker Compose (PostgreSQL + Qdrant + Redis + MinIO) | ✅ |
| L1.3 | Package shared (types communs) | ✅ |
| L1.4 | Package agent — config + types | ✅ |
| L1.5 | Boucle agentique core + outil get_time | ✅ |
| L1.6 | WhatsApp Gateway (Baileys + whitelist) | ✅ |
| L1.7 | Connexion bout-en-bout WhatsApp → Agent → WhatsApp | ✅ |

## E2 — Mémoire T1

| Story | Titre | Statut |
|---|---|---|
| L2.1 | SQLite setup + tables (core_memory, messages, summaries) | ✅ |
| L2.2 | Chargement contexte mémoire à chaque message | ✅ |
| L2.3 | Extraction automatique de faits (background) | ✅ |
| L2.4 | Compaction automatique (> 30 messages) | ✅ |

## E3 — Architecture subagents

| Story | Titre | Statut |
|---|---|---|
| L3.1 | Interface SubAgent + contrat input/output typé | ✅ |
| L3.2 | Registre des subagents | ✅ |
| L3.3 | Subagents exposés comme Anthropic tools (routing natif) | ✅ |
| L3.4 | Composition : séquentiel implicite via tool_use loop | ✅ |
| L3.5 | État subagent observable dans PostgreSQL | 🔲 (E6) |

## E4 — Subagents MVP

| Story | Titre | Statut |
|---|---|---|
| L4.1 | SubAgent Obsidian (lire, créer, modifier, rechercher) | ✅ |
| L4.2 | SubAgent Gmail (squelette — OAuth2 différé à E8) | ✅ |
| L4.3 | SubAgent Web (Brave Search + fetch + résumé) | ✅ |
| L4.4 | SubAgent Karakeep (bookmark, tag, rechercher) | ✅ |

## E4.5 — Hardening

Plan détaillé : `docs/plans/2026-02-28-e4.5-hardening.md`

| Story | Titre | Statut |
|---|---|---|
| L4.5.1 | Pino logger singleton — JSON structuré, remplace console.log partout | ✅ |
| L4.5.2 | validateConfig() — boot validation propre avec exit(1) si var critique manque | ✅ |
| L4.5.3 | 17 tests Vitest — encodePath, ROUTING_MAP, JSON strip, capabilities, sanitize | ✅ |

## E5 — Smart Capture

Plan détaillé : `docs/plans/2026-02-28-e5-smart-capture.md`

| Story | Titre | Statut |
|---|---|---|
| L5.1 | Classification LLM du contenu (type + confiance) | ✅ |
| L5.2 | Routing vers destination(s) selon type détecté | ✅ |
| L5.3 | Logique confidence (auto / propose / inbox) | ✅ |
| L5.4 | Local First : consultation Karakeep+Obsidian avant web | ✅ |

## E6 — Tâches + CRON

Plan détaillé : `docs/plans/2026-02-28-e6-tasks-cron.md`

| Story | Titre | Statut |
|---|---|---|
| L6.1 | SQLite tasks + task_steps tables + CRUD functions | ✅ |
| L6.2 | SubAgent Tasks (create, list, get, update) | ✅ |
| L6.3 | Task Runner — exécution workflows multi-étapes séquentiels | ✅ |
| L6.4 | CRON scheduler — briefing matin + résumé soir (node-cron) | ✅ |
| L6.5 | 9 tests Vitest — CRUD tasks, steps, workflow structure | ✅ |

## E7 — Mission Control MVP

Design : `docs/plans/2026-03-01-e7-mission-control-design.md`
Plan : `docs/plans/2026-03-01-e7-mission-control.md`

| Story | Titre | Statut |
|---|---|---|
| L7.1 | Fastify API (health, subagents, messages, tasks, chat) — port 3100 | ✅ |
| L7.2 | Next.js 15 + design system CSS + sidebar layout — port 3000 | ✅ |
| L7.3 | Chat page — envoi messages + historique | ✅ |
| L7.4 | Connections page — cards subagents + actions | ✅ |
| L7.5 | CORS + server entrypoint + API proxy (rewrites) | ✅ |

## E10 — Mission Control v2

Design : `docs/plans/2026-03-01-e10-mission-control-v2-design.md`
Plan : `docs/plans/2026-03-01-e10-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L10.1 | SQLite migration — ajout statut backlog + table _migrations | ✅ |
| L10.2 | API endpoints — POST/PATCH tasks + GET stats | ✅ |
| L10.3 | Kanban Tasks page — drag-and-drop @dnd-kit, 4 colonnes | ✅ |
| L10.4 | Command Center page — stat cards + activité récente | ✅ |
| L10.5 | Agent loop streaming — AsyncGenerator + SSE endpoint | ✅ |
| L10.6 | Chat streaming + markdown rendering (react-markdown) | ✅ |
| L10.7 | SubAgent Home Assistant — list, state, service, assist | ✅ |

---

## Dernière session

**Date :** 2026-03-01
**Accompli :**
- Fix Obsidian REST API (search GET→POST, headers nettoyés)
- E10 ✅ Mission Control v2 — Kanban, streaming chat, command center, Home Assistant subagent

**État du code :**
- GitHub : https://github.com/DarkAdibou/makilab.git (branch: master)
- `pnpm dev:api` : API Fastify port 3100 (9 endpoints : health, subagents, messages, tasks, POST tasks, PATCH tasks/:id, stats, chat, chat/stream)
- `pnpm dev:dashboard` : Next.js 15 port 3000 (5 pages : /, /chat, /tasks, /connections, /_not-found)
- `pnpm --filter @makilab/agent test` : 35 tests ✅ (17 hardening + 10 tasks + 8 server)
- 8 subagents : time, web, karakeep, obsidian, gmail, capture, tasks, homeassistant (conditionnel)

**E10 Mission Control v2 — Détails techniques :**
- Kanban : @dnd-kit/core + sortable, 4 colonnes (Backlog/Todo/In Progress/Done), drag-and-drop optimiste
- Command Center : 4 stat cards, tâches en cours, activité récente
- Chat streaming : SSE via POST /api/chat/stream, AsyncGenerator, react-markdown
- Sidebar : sections OVERVIEW (Command Center, Chat) + MANAGE (Tasks, Connections)
- Home Assistant : API REST HA directe, 4 actions (list_entities, get_state, call_service, assist)
- Migration SQLite : table _migrations, backlog status ajouté aux tasks

---

## Handoff prompt (copier-coller pour nouvelle session)

```
Je travaille sur Makilab Agent — mon système nerveux central personnel.

Repo GitHub : https://github.com/DarkAdibou/makilab.git
Répertoire local : d:/SynologyDrive/IA et agents/makilab

Contexte : self-hosté NUC N150/CasaOS, canaux WhatsApp+Mission Control+Gmail+Raycast.
Stack : Node.js 24, TypeScript strict, pnpm workspaces, SDK Anthropic, node:sqlite, subagents comme Anthropic tools.
Principes : Local First, Source=Destination, Smart Capture, CRON uniquement.

Fichiers clés :
- CLAUDE.md — contexte et règles permanentes
- PROGRESS.md — état exact (source de vérité)
- packages/agent/src/subagents/ — architecture subagents
- packages/agent/src/memory/ — SQLite T1
- packages/dashboard/ — Next.js 15 Mission Control

Statut : E1 ✅ E2 ✅ E3 ✅ E4 ✅ E5 ✅ E4.5 ✅ E6 ✅ E7 ✅ E10 ✅
On reprend à : E8 — Canal Gmail entrant + Raycast webhook
```
