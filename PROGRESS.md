# Makilab Agent — Progress Tracker
*SOURCE DE VÉRITÉ — mis à jour à chaque session*

---

## Statut global : 🟢 E4.5 terminé — Hardening ✅ — Prochaine étape : E6 Tâches + CRON

---

## Epics

| Epic | Titre | Priorité | Statut |
|---|---|---|---|
| E1 | Foundation (monorepo, WhatsApp, boucle agentique) | 🔴 Critique | ✅ Terminé |
| E2 | Mémoire T1 (SQLite, faits, compaction) | 🔴 Critique | ✅ Terminé |
| E3 | Architecture subagents (registre, routing, composition) | 🔴 Critique | ✅ Terminé |
| E4 | Subagents MVP (Obsidian, Gmail, Web, Karakeep) | 🔴 Critique | ✅ Terminé |
| E5 | Smart Capture | 🔴 Critique | ✅ Terminé |
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
| L7.6 | Connections — statut subagents + capabilities listing | 🔲 |
| L7.7 | CRON — config + lancement manuel | 🔲 |
| L7.8 | Settings — LLM Router + Subagents + Canaux + Sécurité | 🔲 |

---

## Dernière session

**Date :** 2026-02-28
**Accompli :**
- E1 ✅ Foundation (monorepo, WhatsApp Gateway, agent loop)
- E2 ✅ Mémoire T1 SQLite (node:sqlite builtin, facts, compaction)
- E3 ✅ Architecture subagents (types, registre, routing via Anthropic tools)
- E4 ✅ Subagents MVP — web ✅, karakeep ✅, obsidian ✅ (dual REST+file), gmail ✅ (squelette)
- E5 ✅ Smart Capture — classify (Haiku) + route (Obsidian + Karakeep) + fix encodePath
- E4.5 ✅ Hardening — Pino logger + validateConfig() + 17 tests Vitest

**État du code :**
- GitHub : https://github.com/DarkAdibou/makilab.git (branch: master)
- Dernier commit : `test(E4.5): 14 tests Vitest — encodePath, routing, JSON strip, capabilities`
- `pnpm dev:agent` fonctionne : logs JSON Pino, validateConfig() au boot, 6 subagents
- `pnpm --filter @makilab/agent test` : 17 tests ✅ en 783ms
- 6 subagents : time, web, karakeep, obsidian, gmail, **capture**

**E4.5 Hardening — Détails techniques :**
- `logger.ts` singleton Pino : JSON structuré stdout, `{ service: 'makilab-agent', level, time }`
- `validateConfig(log)` : prend le logger en paramètre (évite dépendance circulaire logger↔config)
- Pino remplace tous les `console.log/error` dans `agent-loop.ts` et `fact-extractor.ts`
- 17 tests Vitest dans `packages/agent/src/tests/hardening.test.ts` :
  - `encodePath` (4) — encode segments, préserve `/`
  - `buildCapabilitiesPrompt` (2) — liste tous les subagents et leurs actions
  - `JSON fence stripping` (4) — strip ```json``` avant parse
  - `capture ROUTING_MAP` (4) — coverage complète de tous les CaptureType
  - `buildObsidianPath sanitization` (3) — forbidden chars, truncation, clean title

**Architecture subagent capture (E5) :**
- `capture.ts` — 2 actions :
  - `classify` : Haiku analyse le contenu → type + confiance + destinations + entities
  - `route` : écrit dans Obsidian (toujours) + Karakeep (si URL/company)
- Logique confiance : > 0.8 auto, 0.5-0.8 Claude propose, < 0.5 inbox
- Routing par type : url→karakeep+obsidian, idea/snippet/quote→obsidian seulement
- Frontmatter YAML automatique : type, captured, tags, url, name
- Fix `encodePath()` dans obsidian.ts : encode chaque segment séparément (pas les `/`)

**Notes techniques clés :**
- `node:sqlite` builtin (Node 24) — pas de better-sqlite3, pas de compilation native
- Subagents = Anthropic tools natifs (format `subagent__action` — ex: `capture__classify`)
- `--no-warnings` dans scripts Node pour ExperimentalWarning SQLite
- DB `makilab.db` au root du monorepo
- tsconfig : `allowImportingTsExtensions: true` + `noEmit: true` (imports .ts)
- `encodePath(path)` = `path.split('/').map(encodeURIComponent).join('/')` — critique pour sous-dossiers
- `validateConfig(log)` — pattern paramètre pour éviter circular dep (logger imports config)

**Variables .env configurées :**
```
OBSIDIAN_VAULT_PATH=d:/SynologyDrive/#Obsidian/obsidian-perso
OBSIDIAN_REST_API_KEY=c18b1022a3fc15106299f94abfeaede9ac585478f39d2d48c370b11f24839cf0
BRAVE_SEARCH_API_KEY=    # à remplir — https://brave.com/search/api/
KARAKEEP_API_KEY=         # à remplir — Karakeep → Settings → API Keys
GMAIL_ACCESS_TOKEN=       # à remplir à E8 (OAuth2)
```

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

Statut : E1 ✅ E2 ✅ E3 ✅ E4 ✅ E5 ✅ E4.5 ✅
On reprend à : E6 — Gestionnaire de tâches + CRON (PostgreSQL, SubAgent Tasks, workflows multi-étapes)
```
