# Makilab Agent — Progress Tracker
*SOURCE DE VÉRITÉ — mis à jour à chaque session*

---

## Statut global : 🟢 MCP HTTP transport + Google Maps + Google Workspace ✅

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
| E8 | ~~Canal Gmail entrant + Raycast webhook~~ | 🟠 Important | ❌ Caduque (Gmail via MCP Workspace) |
| E9 | Mémoire sémantique (Qdrant + embeddings) | 🟡 Moyen terme | ✅ Terminé |
| E10 | Mission Control v2 — Kanban, Streaming, Home Assistant | 🟠 Important | ✅ Terminé |
| E11 | Code SubAgent (auto-modification + Git manager) | 🟡 Moyen terme | ✅ Terminé |
| E12 | Proactivité (briefing matin, surveillance) | 🟡 Moyen terme | 🔲 Fusionné dans E6+E13 |
| E13 | MCP Bridge + Tâches récurrentes | 🟠 Important | ✅ Terminé |
| E13.5 | Dashboard : séparation Todo / Tâches récurrentes + exécution tracking | 🟠 Important | ✅ Terminé |
| E14 | LLM Router intelligent + Cost Tracking (routing par tâche, métriques, dashboard coûts) | 🟠 Important | ✅ Terminé |
| E16 | Mémoire hybride unifiée (retrieval multi-source + extraction auto de faits) | 🟡 Moyen terme | ✅ Terminé |
| E17 | Mission Control WebSocket (temps réel bidirectionnel) | 🟡 Moyen terme | 🔲 Non démarré |
| E18 | SearXNG — self-hosted search (remplace Brave primary) | 🟠 Important | ✅ Terminé |
| E14.5 | Smart Model Catalog + Notifications (catalogue OpenRouter dynamique, moteur notifs) | 🟠 Important | ✅ Terminé |
| E19 | WhatsApp unifié — fusionner gateway dans Fastify (processus unique) | 🟠 Important | ✅ Terminé |
| E15 | Migration NUC N150 / CasaOS (production) | 🟢 Long terme | 🔲 Non démarré |
| E20 | Batch : Costs++, coût/requête badge, OpenRouter full routing + toggle, Sonar deep research, Command Center sync | 🟠 Important | ✅ Terminé |

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

## E10.5 — Kanban Improvements + Activity Log + Chat UX

Design : `docs/plans/2026-03-01-e10.5-kanban-improvements-design.md`
Plan : `docs/plans/2026-03-01-e10.5-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L10.5.1 | DB migration — description + tags sur tasks, table agent_events | ✅ |
| L10.5.2 | API enrichi — CRUD tasks (description, tags, due_at), DELETE, GET tags, GET activity | ✅ |
| L10.5.3 | Agent loop — instrumentation logAgentEvent + SSE enrichi (text_delta, args, result) | ✅ |
| L10.5.4 | Kanban — TaskCard enrichi (tags, description, due_at) + FilterBar (search, tag, priorité) | ✅ |
| L10.5.5 | TaskDetailPanel — panneau slide-in édition, tags avec autocomplete, suppression | ✅ |
| L10.5.6 | NewTaskModal enrichi — description, tags, échéance | ✅ |
| L10.5.7 | Page Activity — timeline events agent avec filtres et détails dépliables | ✅ |
| L10.5.8 | Chat UX — streaming token par token + blocs tool calls dépliables | ✅ |

## E9 — Mémoire sémantique

Design : `docs/plans/2026-03-01-e9-semantic-memory-design.md`
Plan : `docs/plans/2026-03-01-e9-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L9.1 | Dependencies (voyageai + @qdrant/js-client-rest) | ✅ |
| L9.2 | Config — QDRANT_URL + VOYAGE_API_KEY | ✅ |
| L9.3 | Embeddings client — Voyage AI wrapper + tests | ✅ |
| L9.4 | Qdrant client — init, upsert, search + tests | ✅ |
| L9.5 | SubAgent memory — search + index | ✅ |
| L9.6 | Fire-and-forget indexation — conversations, summaries, facts | ✅ |
| L9.7 | Qdrant init at boot | ✅ |
| L9.8 | System prompt guidance for memory subagent | ✅ |

## E11 — Code SubAgent

Design : `docs/plans/2026-03-01-e11-code-subagent-design.md`
Plan : `docs/plans/2026-03-01-e11-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L11.1 | Config (CODE_REPO_ROOT, MAKILAB_ENV) + code-helpers (safePath, git utils) | ✅ |
| L11.2 | Tests code-helpers (path safety, .env blocking) | ✅ |
| L11.3 | SubAgent code — 11 actions (file ops, git, shell, restart) | ✅ |
| L11.4 | Registration + tests sécurité (whitelist, branch safety) | ✅ |

## E13 — MCP Bridge + Tâches récurrentes

Design : `docs/plans/2026-03-01-e13-mcp-bridge-design.md`
Plan : `docs/plans/2026-03-01-e13-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L13.1 | Install `@modelcontextprotocol/sdk` | ✅ |
| L13.2 | MCP config loader + `mcp-servers.json` | ✅ |
| L13.3 | MCP bridge core (connect, discover, call) | ✅ |
| L13.4 | Intégration boucle agentique + boot | ✅ |
| L13.5 | Tests MCP bridge (8 tests) | ✅ |
| L13.6 | SQLite migration (cron_expression, cron_enabled, cron_prompt) | ✅ |
| L13.7 | Dynamic CRON scheduler | ✅ |
| L13.8 | Enrichir subagent tasks (champs CRON + list_recurring) | ✅ |
| L13.9 | API endpoints tâches récurrentes | ✅ |
| L13.10 | Dashboard UI tâches récurrentes | ✅ |
| L13.11 | PROGRESS.md update | ✅ |

## E13.5 — Dashboard : séparation Todo / Tâches récurrentes

Design : `docs/plans/2026-03-01-e13.5-todo-recurring-tasks-design.md`

> ⚠️ Dépend de E13 ✅ — prêt à lancer

| Story | Titre | Statut |
|---|---|---|
| L13.5.1 | Renommage sidebar (Tâches→Todo) + déplacement Kanban vers /todo | ✅ |
| L13.5.2 | Table task_executions SQLite + migration + CRUD | ✅ |
| L13.5.3 | API endpoints (GET exécutions, POST execute, stats enrichies) | ✅ |
| L13.5.4 | Page Tâches récurrentes (vue tableau, fréquence, statut, coût) | ✅ |
| L13.5.5 | Panneau détail récurrent (config éditable, timeline, stats) | ✅ |
| L13.5.6 | Bouton "Exécuter maintenant" + feedback | ✅ |
| L13.5.7 | CRON user-friendly — sélecteur fréquence/heure + affichage lisible | ✅ |
| L13.5.8 | "Exécuter maintenant" → résultat visible (réponse agent dans historique) | ✅ |

## E14 — LLM Router intelligent + Cost Tracking

Design : `docs/plans/2026-03-01-e14-llm-router-cost-tracking-design.md`
Plan : `docs/plans/2026-03-01-e14-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L14.1 | Pricing table + cost calculation utility | ✅ |
| L14.2 | llm_usage SQLite table + tracking functions | ✅ |
| L14.3 | LLM Router — config-based model routing | ✅ |
| L14.4 | LLM Client — unified interface + Anthropic + OpenRouter | ✅ |
| L14.5 | Migrate agent-loop.ts to LLM Client | ✅ |
| L14.6 | Migrate agent-loop-stream.ts to LLM Client | ✅ |
| L14.7 | Migrate background calls (fact-extractor, capture) | ✅ |
| L14.8 | Model param propagation (AgentContext + CRON) | ✅ |
| L14.9 | Cost API endpoints + model param on chat | ✅ |
| L14.10 | Dashboard Costs page (stats, history, breakdowns) | ✅ |
| L14.11 | Chat model selector dropdown | ✅ |
| L14.12 | Tasks model column — affichage + override modèle par tâche récurrente | ✅ |
| L14.13 | PROGRESS.md update + verification | ✅ |

## E18 — SearXNG Integration

| Story | Titre | Statut |
|---|---|---|
| L18.1 | Config SEARXNG_URL + docker-compose.yml | ✅ |
| L18.2 | SearXNG search client (JSON API) | ✅ |
| L18.3 | Fallback logic: SearXNG → Brave → error | ✅ |
| L18.4 | Tests web subagent (9 tests) | ✅ |

## E19 — WhatsApp unifié dans Fastify

Design : `docs/plans/2026-03-01-e19-whatsapp-unified-design.md`
Plan : `docs/plans/2026-03-01-e19-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L19.1 | Dépendances Baileys dans agent package | ✅ |
| L19.2 | session-manager.ts + gateway.ts dans agent | ✅ |
| L19.3 | Config WHATSAPP_ALLOWED_NUMBER optionnel | ✅ |
| L19.4 | Boot WhatsApp dans Fastify + endpoints API | ✅ |
| L19.5 | Suppression packages/whatsapp + cleanup | ✅ |

## E14.5 — Smart Model Catalog + Notifications

Design : `docs/plans/2026-03-01-e14.5-smart-catalog-notifications-design.md`
Plan : `docs/plans/2026-03-01-e14.5-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L14.5.1 | SQLite migrations — llm_models, llm_route_config, notifications, notification_settings | ✅ |
| L14.5.2 | catalog.ts — fetch OpenRouter API, cache SQLite, scoring, suggestions | ✅ |
| L14.5.3 | Refactor pricing.ts + router.ts → lecture dynamique SQLite | ✅ |
| L14.5.4 | Notification engine — store, dispatch multi-canal, quiet hours | ✅ |
| L14.5.5 | CRON catalog refresh (3h) + boot init | ✅ |
| L14.5.6 | API endpoints (12 nouveaux : catalog, routes, suggestions, notifications, settings) | ✅ |
| L14.5.7 | classify-task.ts — classification LLM + auto-assignation modèle optimal | ✅ |
| L14.5.8 | Dashboard NotificationBell — badge + dropdown | ✅ |
| L14.5.9 | Page /models — suggestions, routing config, catalogue complet | ✅ |
| L14.5.10 | Page /costs — refonte avec section savings | ✅ |
| L14.5.11 | Page /settings/notifications — toggles canaux, types, quiet hours | ✅ |
| L14.5.12 | Cost emitter + seed briefing hebdo récurrent | ✅ |

## E16 — Mémoire hybride unifiée

Design : `docs/plans/2026-03-02-e16-unified-memory-design.md`
Plan : `docs/plans/2026-03-02-e16-implementation.md`

| Story | Titre | Statut |
|---|---|---|
| L16.1 | SQLite migrations — memory_settings, memory_retrievals, FTS5 messages | ✅ |
| L16.2 | Auto-retriever module — Qdrant semantic + Obsidian context | ✅ |
| L16.3 | Intégration auto-retrieval dans agent loops (sync + stream) | ✅ |
| L16.4 | Enrichissement extraction de faits (tool results) | ✅ |
| L16.5 | SubAgent memory — forget + search_text actions | ✅ |
| L16.6 | API endpoints mémoire (facts, search, settings, stats, retrievals) | ✅ |
| L16.7 | Dashboard /memory — faits, recherche, settings, stats | ✅ |

---

## E20 — Batch : Costs++, OpenRouter routing, Sonar, Command Center sync

| Story | Titre | Statut |
|---|---|---|
| L20.1 | Command Center sync — visibilitychange re-fetch | ✅ |
| L20.2 | Costs page — réordonnancement + accordéon contexte + pagination | ✅ |
| L20.3 | Coût/requête badge — runAgentLoop retourne costUsd, StreamEvent cost, badge chat | ✅ |
| L20.4 | Sonar deep research — web__deep_research via perplexity/sonar-pro (OpenRouter) | ✅ |
| L20.5 | OpenRouter full routing — toggle prefer_openrouter (DB + cache 60s) | ✅ |
| L20.6 | callOpenRouter + streamOpenRouter avec tool calling complet (format OpenAI) | ✅ |
| L20.7 | Model ID bidirectionnel — toOpenRouterModel + toAnthropicModel | ✅ |
| L20.8 | modelSupportsTools() — check catalogue avant envoi tools | ✅ |
| L20.9 | inferProvider() — reconnaît anthropic/claude-* | ✅ |
| L20.10 | Chat badge model — cost event inclut model résolu, affiché dans badge | ✅ |
| L20.11 | Kanban drag-and-drop — kanbanCollision pointerWithin + rectIntersection | ✅ |
| L20.12 | Chat dropdown — synced avec route conversation DB bidirectionnel | ✅ |
| L20.13 | /settings/llm page + sidebar link | ✅ |

## Session fixes (post-E20)

| Fix | Description | Statut |
|---|---|---|
| F1 | WhatsApp double réponse — `if (msg.key.fromMe) continue` dans session-manager.ts | ✅ |
| F2 | CRON tâches polluant WhatsApp — `safeCronChannel()` redirige vers mission_control | ✅ |
| F2b | dispatchToChannels — passage de safeCronChannel (fix skip WhatsApp notify) | ✅ |
| F3 | Coût négatif OpenRouter — guard tokens > 0 dans client.ts + pricing.ts | ✅ |
| F4 | Subagent `whatsapp__send` — nouveau subagent conditionnel WHATSAPP_ALLOWED_NUMBER | ✅ |
| F5 | Models page — Fragment key prop (React warning) | ✅ |
| F6 | CRON verbeux — cronSection dans system prompt (`from === 'cron'`) | ✅ |
| F7 | Costs page — camembert SVG + ModelBreakdown drill-down par task type | ✅ |
| F8 | Badges modèle persistants — migration messages_add_model + saveMessage(model?) | ✅ |

## Session 9-10 fixes

| Fix | Description | Statut |
|---|---|---|
| F9 | bodyLimit Fastify 20MB — images base64 dépassaient la limite 1MB | ✅ |
| F10 | Images injectées dans contexte Anthropic — content array [image, text] | ✅ |
| F11 | OCR retiré du champ input chat — redondant avec injection image | ✅ |
| F12 | drive:full + sheets:full — permissions MCP workspace jamais commitées | ✅ |
| F13 | user_google_email auto-injecté — injectServerDefaults dans bridge.ts | ✅ |
| F14 | capture__save_temp — image base64 → fichier temp → fileUrl file:// | ✅ |
| F15 | Skill facture-scanner — vrais outils MCP, upload image, catégories fines | ✅ |
| F16 | skill-creator — confirmation obligatoire, jamais de branches git | ✅ |
| F17 | GET /api/skills — invalidateSkillsCache pour F5 refresh | ✅ |

---

## Dernière session

**Date :** 2026-03-05 (session 10)
**Accompli :**
- Images dans contexte Anthropic : agent-loop + agent-loop-stream injectent les images base64 comme content array [image_block, text_block]
- Fastify bodyLimit 20MB (était 1MB → crash silencieux pour images base64)
- OCR retiré du champ input chat (redondant maintenant que l'agent voit l'image)
- Google Workspace MCP : drive:readonly → drive:full + sheets:full dans mcp-servers.json
- Auto-injection user_google_email dans bridge.ts (injectServerDefaults) via GOOGLE_WORKSPACE_EMAIL env var
- capture__save_temp : sauve image base64 en fichier temporaire, retourne fileUrl file:// pour upload Drive
- Skill facture-scanner refondu : vrais noms outils workspace-mcp v1.14.2, upload image originale (pas Google Doc), colonne Lien Facture dans Détails Produits, taxonomie catégories fine + services + création libre
- Skills system : skill-creator SKILL.md corrigé (confirmation avant écriture, jamais de branches git)
- GET /api/skills invalide le cache (F5 recharge les skills)
- compactHistory exporté + appelé dans agent-loop-stream
- router.ts : skill_creation task type + TTL cache 5s
- cron.ts : taskType cron_moderate pour briefings
- orchestrator.ts supprimé

**Fichiers modifiés (session 10) :**
- `packages/agent/src/agent-loop.ts` : images dans contexte, export compactHistory, resolvedModel
- `packages/agent/src/agent-loop-stream.ts` : images dans contexte, compactHistory
- `packages/agent/src/server.ts` : bodyLimit 20MB, invalidateSkillsCache dans GET /api/skills
- `packages/agent/src/mcp/bridge.ts` : injectServerDefaults (user_google_email)
- `packages/agent/src/config.ts` : googleWorkspaceEmail
- `packages/agent/src/subagents/capture.ts` : action save_temp
- `packages/agent/src/llm/router.ts` : skill_creation, TTL 5s
- `packages/agent/src/memory/sqlite.ts` : section Skills dans prompt agent
- `packages/agent/src/tasks/cron.ts` : taskType cron_moderate
- `packages/agent/skills/facture-scanner/SKILL.md` : refonte complète
- `packages/agent/skills/skill-creator/SKILL.md` : confirmation obligatoire
- `packages/dashboard/app/chat/page.tsx` : retrait OCR input + import cleanup
- `mcp-servers.json` : drive:full + sheets:full
- `.gitignore` : *.db-shm + *.db-wal

**État du code :**
- GitHub : https://github.com/DarkAdibou/makilab.git (branch: master)
- `pnpm dev:api` : API Fastify port 3100 (40+ endpoints)
- `pnpm dev:dashboard` : Next.js 15 port 3000 (14 pages)
- 11 subagents : time, web, karakeep, obsidian, gmail, capture, tasks, homeassistant, memory, code, whatsapp (conditionnel)
- 2 skills : facture-scanner, skill-creator

**Prochaines étapes :**
- Tester facture-scanner end-to-end (image → Drive + Sheets)
- E17 — Mission Control WebSocket (temps réel)
- E15 — Migration NUC N150 / CasaOS (production)

---

## Handoff prompt (copier-coller pour nouvelle session)

```
Je travaille sur Makilab Agent — mon système nerveux central personnel.

Repo GitHub : https://github.com/DarkAdibou/makilab.git
Répertoire local : d:/SynologyDrive/IA et agents/makilab

Contexte : self-hosté NUC N150/CasaOS, canaux WhatsApp+Mission Control+Gmail+Raycast.
Stack : Node.js 24, TypeScript strict, pnpm workspaces, SDK Anthropic, node:sqlite, subagents comme Anthropic tools.
Principes : Local First, Source=Destination, Smart Capture, CRON uniquement, Cost-Conscious.

Fichiers clés :
- CLAUDE.md — contexte et règles permanentes
- PROGRESS.md — état exact (source de vérité)
- packages/agent/src/llm/ — LLM Router + Client unifié
- packages/agent/src/subagents/ — architecture subagents
- packages/agent/src/memory/ — SQLite T1 + Qdrant T2
- packages/agent/src/whatsapp/ — WhatsApp Baileys gateway (unifié dans Fastify)
- packages/dashboard/ — Next.js 15 Mission Control

Statut : E1-E7 ✅ E9-E11 ✅ E13-E14.5 ✅ E16 ✅ E18-E20 ✅ + session fixes (WhatsApp, badges, coûts, CRON)
11 subagents : time, web, karakeep, obsidian, gmail, capture, tasks, homeassistant, memory, code, whatsapp (conditionnel)
Prochaine étape : E8 (Gmail entrant + Raycast) ou E17 (WebSocket)
```
