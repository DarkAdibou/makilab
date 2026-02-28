# Makilab Agent — Contexte projet permanent

## Vision
Système nerveux central personnel self-hosté sur NUC N150 (CasaOS).
Orchestrateur TypeScript + subagents composables + mémoire 3 tiers.
Même cerveau, mêmes capacités sur tous les canaux.

## Canaux
- WhatsApp (Baileys, numéro secondaire, whitelist stricte)
- Mission Control (Next.js 15, Tailscale uniquement)
- Gmail entrant (d4rkxbow@gmail.com, CRON polling)
- Raycast (webhook Tailscale + Bearer token)
- Antigravity (Claude Code — sessions de build)

## Stack
- Runtime : Node.js 22 + TypeScript strict + ES modules + pnpm workspaces
- LLM primaire : SDK Anthropic (tâches sensibles, conversations)
- LLM économique : OpenRouter (batch, résumés, extraction)
- Transcription : Whisper API OpenAI
- Embeddings : Voyage AI ou Cohere API
- Mémoire T1 : SQLite + FTS5
- Mémoire T2 : Qdrant (Docker/CasaOS)
- Mémoire T3 : PostgreSQL (Docker/CasaOS)
- File storage : MinIO (Docker/CasaOS)
- Dashboard : Next.js 15 + vanilla CSS dark mode (Linear/Vercel style)
- Réseau : Tailscale (zéro port public)
- Obsidian sync : GitLab repo privé (deploy key dédiée NUC)

## Fichiers clés
- `PROGRESS.md` — état exact de chaque epic/story (SOURCE DE VÉRITÉ)
- `docs/plans/2026-02-28-makilab-agent-design.md` — design complet v3
- `docs/plans/2026-02-28-e1-foundation.md` — plan implémentation E1
- `docker-compose.yml` — infra locale

## Règles non-négociables (sécurité)
1. Whitelist WhatsApp — silence total pour les autres numéros
2. Zéro port exposé publiquement — Tailscale uniquement
3. Secrets dans `.env` uniquement — jamais dans code, logs, mémoire
4. Max 10 itérations boucle agentique
5. Flag `sensitive: true` → force Anthropic (jamais OpenRouter)
6. Confirmation avant : envoi email, suppression fichier, push git
7. Jamais de push sur `main` sans validation humaine
8. Deploy key SSH dédiée NUC pour GitLab vault Obsidian
9. Subagent Obsidian : pull avant écriture, jamais modifier note < 5 min

## Principes architecture
- Local First : Karakeep → Obsidian → Qdrant → Web (dans cet ordre)
- Source = Destination : chaque connecteur peut être lu ET alimenté
- Smart Capture : confidence haute → auto, moyenne → propose, basse → inbox
- CRON uniquement pour la proactivité (pas de polling continu)
- Subagents composables : input/output typé, état observable Mission Control

## NUC N150 / CasaOS
- 8-10GB RAM total, ~4-5GB disponibles pour Makilab
- Pas de GPU → pas d'Ollama, pas de Whisper local
- Services Docker : PostgreSQL, Qdrant, Redis, MinIO, Mission Control, Uptime Kuma
- Dev sur machine locale d'abord, migration NUC ensuite

## Style de code
- TypeScript strict, ES modules, pnpm workspaces
- Pas de `any`, pas de commentaires évidents
- Fonctions courtes et focalisées
- Errors explicites, pas de catch vides
- Commits atomiques avec message descriptif

## Workflow de session
1. Lire PROGRESS.md — trouver la prochaine story
2. Travailler story par story
3. Marquer ✅ dans PROGRESS.md dès qu'une story est terminée
4. Commit atomique après chaque story
5. Mettre à jour le handoff prompt en fin de session
