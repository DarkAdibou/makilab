# Makilab Agent — Progress Tracker
*SOURCE DE VÉRITÉ — mis à jour à chaque session*

---

## Statut global : 🟢 E3 terminé — Architecture subagents ✅ — Docker à démarrer dès que RAM dispo

---

## Epics

| Epic | Titre | Priorité | Statut |
|---|---|---|---|
| E1 | Foundation (monorepo, WhatsApp, boucle agentique) | 🔴 Critique | ✅ Terminé |
| E2 | Mémoire T1 (SQLite, faits, compaction) | 🔴 Critique | ✅ Terminé |
| E3 | Architecture subagents (registre, routing, composition) | 🔴 Critique | ✅ Terminé |
| E4 | Subagents MVP (Obsidian, Gmail, Web, Karakeep) | 🔴 Critique | 🔲 Non démarré |
| E5 | Smart Capture | 🔴 Critique | 🔲 Non démarré |
| E6 | Gestionnaire de tâches + CRON | 🟠 Important | 🔲 Non démarré |
| E7 | Mission Control — Chat + Command Center + Tasks + Logs | 🟠 Important | 🔲 Non démarré |
| E8 | Canal Gmail entrant + Raycast webhook | 🟠 Important | 🔲 Non démarré |
| E9 | Mémoire sémantique (Qdrant + embeddings) | 🟡 Moyen terme | 🔲 Non démarré |
| E10 | Mission Control — Vues contextuelles dynamiques | 🟡 Moyen terme | 🔲 Non démarré |
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
| L4.1 | SubAgent Obsidian (lire, créer, modifier, rechercher) | 🔲 |
| L4.2 | SubAgent Gmail (lire, chercher, résumer) | 🔲 |
| L4.3 | SubAgent Web (Brave Search + fetch + résumé) | 🔲 |
| L4.4 | SubAgent Karakeep (bookmark, tag, rechercher) | 🔲 |

## E5 — Smart Capture

| Story | Titre | Statut |
|---|---|---|
| L5.1 | Classification LLM du contenu (type + confiance) | 🔲 |
| L5.2 | Routing vers destination(s) selon type détecté | 🔲 |
| L5.3 | Logique confidence (auto / propose / inbox) | 🔲 |
| L5.4 | Local First : consultation Karakeep+Obsidian avant web | 🔲 |

## E6 — Tâches + CRON

| Story | Titre | Statut |
|---|---|---|
| L6.1 | PostgreSQL + table tasks + schéma steps | 🔲 |
| L6.2 | SubAgent Tasks (CRUD) | 🔲 |
| L6.3 | Exécution workflows multi-étapes | 🔲 |
| L6.4 | CRON scheduler + création de tâches automatiques | 🔲 |
| L6.5 | Notifications canal sur changement statut | 🔲 |

## E7 — Mission Control

| Story | Titre | Statut |
|---|---|---|
| L7.1 | Next.js 15 + design system + sidebar + Cmd+K | 🔲 |
| L7.2 | Chat — bulles + panneau latéral live | 🔲 |
| L7.3 | Command Center — activity feed + stat cards | 🔲 |
| L7.4 | Tasks — vue tâches agentiques temps réel | 🔲 |
| L7.5 | Logs — stream temps réel | 🔲 |
| L7.6 | Connections — statut subagents + MCP | 🔲 |
| L7.7 | CRON — config + lancement manuel | 🔲 |
| L7.8 | Settings — LLM Router + Subagents + Canaux + Sécurité | 🔲 |

---

## Dernière session

**Date :** 2026-02-28
**Accompli :**
- E1 ✅ Foundation (monorepo, WhatsApp Gateway, agent loop)
- E2 ✅ Mémoire T1 SQLite (node:sqlite builtin, facts, compaction)
- E3 ✅ Architecture subagents (types, registre, routing via Anthropic tools)
- E4 🔄 En cours — web.ts ✅, karakeep.ts ✅, Obsidian et Gmail restent à faire

**État du code :**
- GitHub : https://github.com/DarkAdibou/makilab.git (branch: master, 4 commits)
- Dernier commit : `feat(E4-partial): subagents Web + Karakeep (WIP)`
- `pnpm dev:agent` fonctionne et valide le routing subagent

**Ce qui reste pour finir E4 :**
1. `packages/agent/src/subagents/obsidian.ts` — utiliser plugin "Local REST API" Obsidian (port 27123)
2. `packages/agent/src/subagents/gmail.ts` — wrapper Gmail MCP ou API Gmail directe
3. Enregistrer les 4 subagents dans `registry.ts` (web, karakeep, obsidian, gmail)
4. Smoke test avec vraies clés dans `.env`

**Variables .env à ajouter :**
```
BRAVE_SEARCH_API_KEY=...        # https://brave.com/search/api/ (gratuit 2000 req/mois)
KARAKEEP_API_URL=http://localhost:3000
KARAKEEP_API_KEY=...            # Karakeep → Settings → API Keys
OBSIDIAN_VAULT_PATH=d:/SynologyDrive/#Obsidian/obsidian-perso
```

**Notes techniques clés :**
- `node:sqlite` builtin (Node 24) — pas de better-sqlite3, pas de compilation native
- Subagents = Anthropic tools natifs (format `subagent__action` — ex: `web__search`)
- `--no-warnings` dans scripts Node pour ExperimentalWarning SQLite
- DB `makilab.db` au root du monorepo

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

Statut : E1 ✅ E2 ✅ E3 ✅ E4 🔄
On reprend à : E4 — finir Obsidian + Gmail subagents, les enregistrer dans registry.ts, smoke test
```
