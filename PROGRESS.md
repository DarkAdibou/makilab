# Makilab Agent — Progress Tracker
*SOURCE DE VÉRITÉ — mis à jour à chaque session*

---

## Statut global : 🟢 E2 terminé — Mémoire T1 SQLite ✅ — Docker à démarrer dès que RAM dispo

---

## Epics

| Epic | Titre | Priorité | Statut |
|---|---|---|---|
| E1 | Foundation (monorepo, WhatsApp, boucle agentique) | 🔴 Critique | ✅ Terminé |
| E2 | Mémoire T1 (SQLite, faits, compaction) | 🔴 Critique | ✅ Terminé |
| E3 | Architecture subagents (registre, routing, composition) | 🔴 Critique | 🔲 Non démarré |
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
| L3.1 | Interface SubAgent + contrat input/output typé | 🔲 |
| L3.2 | Registre des subagents | 🔲 |
| L3.3 | Routing orchestrateur → subagent(s) via LLM | 🔲 |
| L3.4 | Composition workflows (séquentiel + parallèle) | 🔲 |
| L3.5 | État subagent observable dans PostgreSQL | 🔲 |

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
**Accompli :** E2 complet — SQLite via `node:sqlite` (builtin Node 24, zéro compilation) ✅, facts auto-extraction Haiku ✅, compaction automatique ✅, smoke test persistence validé ✅
**Notes techniques :**
- `better-sqlite3` abandonné → `node:sqlite` (builtin, pas de Visual Studio requis)
- `--no-warnings` dans le script `dev` pour supprimer ExperimentalWarning
- La DB `makilab.db` est au root du monorepo
- Sur le NUC : Docker Compose ready (PostgreSQL, Qdrant, Redis, MinIO) — à lancer quand RAM dispo
**Prochaine étape :** E3 — Architecture subagents

---

## Handoff prompt

```
Je travaille sur Makilab Agent.

Contexte : système nerveux central personnel self-hosté NUC N150/CasaOS.
Architecture : orchestrateur TypeScript + subagents composables + mémoire 3 tiers.
Canaux : WhatsApp (Baileys), Mission Control (Next.js 15, Tailscale), Gmail entrant, Raycast webhook.
Stack : Node.js 24, TypeScript strict, pnpm workspaces, SDK Anthropic, OpenRouter, MCP servers, node:sqlite+Qdrant+PostgreSQL+MinIO.
Principes : Local First, Source=Destination, Smart Capture, CRON uniquement (pas de polling).

Fichiers clés :
- CLAUDE.md — contexte permanent complet
- PROGRESS.md — état des epics (source de vérité)
- docs/plans/2026-02-28-makilab-agent-design.md — design v3 complet

On reprend à : E3 — Architecture subagents (registre, routing, composition)
```
