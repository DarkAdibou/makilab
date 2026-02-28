# Makilab Agent — Design Document
*Version 3 — Finale — 2026-02-28*

---

## 1. Vision

Un **système nerveux central personnel** — self-hosté sur NUC N150 (CasaOS), accessible depuis n'importe où via Tailscale. Il orchestre tout l'écosystème d'information : mails, notes, bookmarks, recherches, calendrier, fichiers, code.

Pas un chatbot avec des connecteurs. Un cerveau augmenté qui raisonne sur toutes tes données, agit de façon autonome sur instruction, et s'adapte à n'importe quel cas d'usage — aujourd'hui la recherche d'emploi, demain les notes de réunion, après-demain autre chose.

**Principe fondamental : Local First**
Avant d'aller sur le web, l'agent consulte toujours ses sources internes. Avant de stocker dans le cloud, il stocke en local. Chaque source de données est aussi une destination potentielle.

---

## 2. Principes de design

| Principe | Détail |
|---|---|
| **Plateforme, pas un outil** | Cas d'usages infinis — l'agent s'adapte, pas l'inverse |
| **Self-hosted first** | Tout sur le NUC N150/CasaOS. Données jamais dans le cloud sans demande explicite |
| **Local first** | Consulte Karakeep/Obsidian/mémoire avant le web. Stocke local avant cloud |
| **Subagents composables** | Chaque capacité est un subagent spécialisé, orchestrable depuis n'importe quel canal |
| **Source = Destination** | Chaque connecteur peut être consulté ET alimenté selon le contexte |
| **Canal-agnostique** | WhatsApp / Mission Control / Gmail / Raycast = même orchestrateur, même mémoire |
| **Sécurité par design** | Zéro port public, Tailscale uniquement, whitelist stricte, secrets en .env |
| **Semi-autonome** | Agit seul pour les tâches simples, demande validation pour les actions importantes |
| **Continuité de contexte** | PROGRESS.md + commits atomiques + handoff prompt en fin de session |
| **Compris ligne par ligne** | Pas de framework magique — chaque ligne est lisible et modifiable |

---

## 3. Architecture globale

```
┌──────────────────────────────────────────────────────────────────┐
│                     NUC N150 / CasaOS (always-on, Tailscale)     │
│                                                                  │
│  CANAUX D'ENTRÉE                                                 │
│  ┌──────────┐ ┌──────────────┐ ┌────────┐ ┌────────┐ ┌───────┐  │
│  │WhatsApp  │ │Mission Ctrl  │ │ Gmail  │ │Raycast │ │Future │  │
│  │(Baileys) │ │ (Next.js 15) │ │entrant │ │webhook │ │ ...   │  │
│  └────┬─────┘ └──────┬───────┘ └───┬────┘ └───┬────┘ └───┬───┘  │
│       └──────────────┼─────────────┼───────────┼──────────┘      │
│                      ▼             ▼           ▼                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    ORCHESTRATEUR (Brain)                   │   │
│  │  - Parsing intention en langage naturel                    │   │
│  │  - Smart Capture (classification + routing)               │   │
│  │  - Routing vers subagent(s) approprié(s)                  │   │
│  │  - Composition de workflows multi-subagents               │   │
│  │  - LLM Router (Anthropic / OpenRouter)                    │   │
│  │  - Gestion mémoire (contexte par canal)                   │   │
│  │  - Sécurité : validation, limites, confirmation           │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                     │
│  SUBAGENTS                  │                                     │
│  ┌─────────┐ ┌─────────┐ ┌─┴───────┐ ┌─────────┐ ┌─────────┐   │
│  │Obsidian │ │ Gmail   │ │  Web    │ │Karakeep │ │  Code   │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Indeed  │ │NtbookLM │ │  Tasks  │ │Calendar │ │  Drive  │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│                                                                  │
│  MÉMOIRE (Local First)      INFRASTRUCTURE (CasaOS Docker)       │
│  ┌──────────────────────┐   ┌────────────────────────────────┐   │
│  │ T1 SQLite + FTS5     │   │ PostgreSQL  Qdrant  Redis      │   │
│  │ T2 Qdrant (semantic) │   │ MinIO       Mission Control    │   │
│  │ T3 PostgreSQL        │   │ Uptime Kuma                    │   │
│  └──────────────────────┘   └────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Stack technique

| Couche | Technologie | Raison |
|---|---|---|
| Runtime | Node.js 22 + TypeScript strict | Typage fort, ES modules |
| WhatsApp | Baileys (numéro secondaire) | Long-polling, zéro port exposé |
| Gmail entrant | MCP Gmail (polling CRON) | Surveillance d4rkxbow@gmail.com |
| Raycast | Webhook Tailscale + Bearer token | Commandes rapides depuis n'importe où |
| LLM primaire | SDK Anthropic (Claude Sonnet/Opus) | Tâches sensibles, conversations |
| LLM économique | OpenRouter (Gemini Flash, Mistral) | Batch, résumés, extraction |
| Transcription | Whisper API OpenAI | Audio WhatsApp ($0.006/min) |
| Embeddings | Voyage AI ou Cohere API | Léger, pas de GPU requis |
| Subagents | MCP Servers (officiels + custom) | Modulaires, auditables, isolés |
| Mémoire T1 | SQLite + FTS5 | Toujours dispo, conversation + faits |
| Mémoire T2 | Qdrant (Docker/CasaOS) | Recherche sémantique self-hosté |
| Mémoire T3 | PostgreSQL (Docker/CasaOS) | Tâches, logs, config |
| File storage | MinIO (Docker/CasaOS) | Audio, pièces jointes, fichiers |
| Dashboard | Next.js 15 + vanilla CSS dark mode | Mission Control |
| Réseau | Tailscale | Accès sécurisé, zéro port public |
| Infra | Docker Compose → CasaOS NUC N150 | Dev local d'abord, migration NUC ensuite |
| Obsidian sync | Git (GitLab repo privé) | Deploy key dédiée NUC |
| Versioning agent | Git (Code SubAgent) | Commits atomiques, branches agent |

---

## 5. LLM Router

Le router choisit le modèle optimal selon la tâche. Configurable depuis Mission Control.

```
Tâche reçue
    ↓
Router analyse : type + sensibilité + complexité + coût estimé
    ↓
Propose le modèle optimal (si nouveau type de tâche)
    ↓
Exécute + log coût réel dans PostgreSQL
```

| Type de tâche | Modèle | Coût |
|---|---|---|
| Conversation directe (WhatsApp, chat) | Claude Sonnet | API Anthropic |
| Raisonnement complexe, décision | Claude Opus | API Anthropic |
| Tâches sensibles (mails perso, notes) | Claude Haiku | API Anthropic |
| Batch CRON, résumés, extraction | Gemini Flash / Mistral | OpenRouter |
| Transcription audio | Whisper API | OpenAI |
| Embeddings | Voyage AI / Cohere | API légère |
| Code generation | Claude Sonnet | API Anthropic |

**Règles sécurité du router :**
- Flag `sensitive: true` → force Anthropic (données perso jamais vers OpenRouter)
- Budget par modèle configurable (alerte si dépassement)
- Log coût de chaque appel dans `cost_log` PostgreSQL
- Suggestion explicite quand nouveau type de tâche détecté

---

## 6. Smart Capture

Tu dumps n'importe quoi, n'importe où — l'agent classe et range intelligemment.

```
Dump reçu (WhatsApp / Mission Control / Antigravity / Raycast)
    ↓
LLM analyse : type + entités + confiance
    ↓
Confiance haute (>80%)  → Range + notifie brièvement
Confiance moyenne       → Propose hypothèse + attend "ok"
Confiance basse (<50%)  → Range dans 00_Boite_de_reception/ + notifie
```

| Type détecté | Destination principale | Destination secondaire |
|---|---|---|
| Entreprise / opportunité emploi | Obsidian `Entreprises/` | Karakeep #emploi |
| Contact / personne | Obsidian `CRM_networking/` | — |
| URL / article | Karakeep (toujours) | Résumé Obsidian si pertinent |
| Prompt / instruction IA | Obsidian `Ressources/Prompts/` | Karakeep #prompts |
| Snippet de code | Obsidian `Ressources/Tech/` | Karakeep #code |
| Idée / réflexion | Obsidian `00_Boite_de_reception/` | — |
| Note de réunion | Obsidian `05_Journal/` | Extraction contacts → CRM |
| Tâche / todo | PostgreSQL tasks | Notification canal |
| Citation / référence | Karakeep | Obsidian si approfondi |

---

## 7. Modèle Source = Destination

Chaque connecteur peut être consulté ET alimenté selon le contexte.

| Connecteur | Comme source | Comme destination |
|---|---|---|
| **Karakeep** | Recherche avant le web | Sauvegarde toute URL pertinente |
| **Obsidian** | Contexte, fiches, profil, historique | Notes, fiches, dumps rangés |
| **Gmail** | Alertes emploi, mails importants | Réponses rédigées (avec confirmation) |
| **NotebookLM** | Interroge notebooks existants | Crée sources depuis contenu |
| **Google Drive** | Lit docs, CV, présentations | Crée/modifie documents |
| **Indeed** | Offres, données entreprises | Lecture seule |
| **Web** | Recherche, scraping, enrichissement | → Karakeep si URL pertinente |
| **PostgreSQL** | Historique tâches, logs, config | Nouvelles tâches, logs |

**Ordre de consultation (Local First) :**
```
1. SQLite (faits, conversations récentes)
2. Qdrant (recherche sémantique — tout le contenu indexé)
3. Karakeep (bookmarks)
4. Obsidian (vault)
5. → Web + NotebookLM si rien de satisfaisant
   → Proposer d'ajouter à Karakeep si URL trouvée
```

---

## 8. Obsidian Sync (GitLab)

```
Laptop Obsidian          Mobile Obsidian
    ↓ push auto              ↓ push à fermeture
       GitLab repo privé (deploy key dédiée NUC)
            ↓ pull toutes les 5 min
         NUC N150 — copie locale vault
            ↓
    Subagent Obsidian (pull avant écriture, timestamp unique)
            ↓ commit + push
       GitLab repo privé
            ↓ pull auto
    Laptop + Mobile (sync retour)
```

**Règles anti-conflit :**
- Pull systématique avant toute écriture
- Nouvelles notes = nom unique avec timestamp
- Jamais de modification d'une note éditée dans les 5 dernières minutes

---

## 9. Gestionnaire de tâches agentiques

```typescript
interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'waiting_user' | 'done' | 'failed';
  created_by: 'user' | 'agent' | 'cron';
  channel: 'whatsapp' | 'mission_control' | 'gmail' | 'antigravity' | 'raycast';
  priority: 'low' | 'medium' | 'high';
  due_at?: Date;
  steps: TaskStep[];
  context: Record<string, unknown>;
  git_branch?: string;
  cron_id?: string;
}

interface TaskStep {
  id: number;
  subagent: string;
  action: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  requires_confirmation?: boolean;
  model_used?: string;
  cost_usd?: number;
}
```

---

## 10. CRON — Proactivité maîtrisée

Pas de polling continu. CRON uniquement — configurable depuis Mission Control.

```
CRON déclenché (schedule défini)
    ↓
Crée une tâche dans PostgreSQL
    ↓
Exécute les subagents nécessaires
    ↓
Notifie sur le canal approprié (WhatsApp ou Mission Control)
```

Exemples de CRON :
- `0 7 * * *` — Briefing matin (mails + agenda + relances emploi)
- `0 */2 * * *` — Surveillance alertes emploi Gmail
- `0 19 * * *` — Résumé fin de journée

---

## 11. Sécurité (non-négociable)

### Réseau
- Zéro port exposé publiquement — tout derrière Tailscale
- Mission Control accessible uniquement via Tailscale IP
- Raycast webhook : Bearer token obligatoire
- Baileys : long-polling, pas de webhook

### Canaux
- Whitelist stricte WhatsApp — silence total pour les autres
- Whitelist Gmail — seuls certains expéditeurs déclenchent des actions
- Mission Control : session auth (cookie signé)

### Agent
- Max 10 itérations sur la boucle agentique
- Confirmation obligatoire : envoi email, suppression fichier, push git
- Audit log complet dans PostgreSQL
- Secrets dans `.env` uniquement
- Flag `sensitive: true` → force Anthropic (jamais OpenRouter)

### Code SubAgent
| Modification | Comportement |
|---|---|
| Composant UI, page dashboard | Auto → commit → notifie |
| Nouveau subagent / MCP | Auto → commit → notifie |
| Modification orchestrateur core | Diff → attend "ok" → commit |
| Config sécurité / secrets | Toujours validation manuelle |
| Push sur `main` | Toujours validation manuelle |

### Obsidian
- Deploy key SSH dédiée NUC (révocable indépendamment)
- Subagent ne modifie jamais une note éditée dans les 5 dernières minutes

---

## 12. Mission Control — Navigation & Design

### Structure navigation
```
Sidebar gauche (260px, resizable)
├── [Cmd+K] Recherche / Actions...
├── ▼ AGENT
│      💬 Chat (hybride : bulles + panneau latéral live)
│      ⚡ Command Center
│      📋 Tasks
│      📡 Logs
├── ▼ VUES
│      🔍 Recherche Emploi
│      + Ajouter une vue...
└── ▼ SYSTÈME
       🔌 Connections
       🧠 Second Brain
       ⏱  CRON
       ⚙️  Settings
          ├── LLM Router
          ├── Subagents
          ├── Canaux
          ├── Sécurité
          └── System Prompt
```

### Design system
- Inspiration : Linear / Vercel — propre, fonctionnel, dense sans être surchargé
- Dark mode élévation (`#0D0D0D` sidebar → `#1E1E1E` cards)
- Accents : orange `#E5850F`, bleu `#5A9CF5`, vert `#2ECC8F`, rouge `#D95555`
- Vanilla CSS — pas de Tailwind
- Lucide React pour les icônes
- Tabs horizontaux pour les sous-vues dans chaque section
- Breadcrumb en haut de chaque page
- Density : dense (Linear-style) — beaucoup d'info par ligne

### Chat
- Bulles de conversation (gauche = agent, droite = toi)
- Panneau latéral live : détail de chaque action en temps réel (subagent actif, ce qu'il lit/écrit, résultats intermédiaires)

### Editabilité en live
Tout est modifiable depuis Mission Control sans redémarrage :
- Règles LLM Router (type tâche → modèle, budgets)
- Subagents (activer/désactiver, périmètre, confirmation requise)
- CRON (schedules, activer/désactiver, lancer manuellement)
- Canaux (whitelists)
- Sécurité (actions nécessitant confirmation, max itérations)
- System prompt

Chaque modification → loggée dans activity_log + réversible (historique configs PostgreSQL).

---

## 13. Infrastructure NUC N150 (CasaOS)

**Contrainte : 8-10GB RAM avec services existants → ~4-5GB disponibles**

```
Services Docker sur CasaOS          RAM estimée
✅ PostgreSQL                         ~150MB
✅ Qdrant                             ~200MB
✅ Redis                              ~50MB
✅ MinIO                              ~128MB
✅ Mission Control (Next.js)          ~150MB
✅ Agent + subagents                  ~300MB
✅ Uptime Kuma                        ~50MB
────────────────────────────────────────────
Total                                ~1GB ✅

Abandonné (trop lourd pour NUC)
❌ Ollama — 8GB minimum
❌ Whisper local — 3GB
❌ Grafana/Prometheus — 500MB+
❌ n8n — 500MB+
```

**Conséquence :** Le NUC = stockage + orchestration. Le compute IA reste dans le cloud (Anthropic, OpenRouter, Whisper API). Coûts pay-per-use, NUC jamais surchargé.

---

## 14. Roadmap — Epics

| Epic | Titre | Priorité |
|---|---|---|
| **E1** | Foundation (monorepo, WhatsApp, boucle agentique) | 🔴 Critique |
| **E2** | Mémoire T1 (SQLite, faits, compaction) | 🔴 Critique |
| **E3** | Architecture subagents (registre, routing, composition) | 🔴 Critique |
| **E4** | Subagents MVP (Obsidian, Gmail, Web, Karakeep) | 🔴 Critique |
| **E5** | Smart Capture | 🔴 Critique |
| **E6** | Gestionnaire de tâches + CRON | 🟠 Important |
| **E7** | Mission Control — Chat + Command Center + Tasks + Logs | 🟠 Important |
| **E8** | Canal Gmail entrant + Raycast webhook | 🟠 Important |
| **E9** | Mémoire sémantique (Qdrant + embeddings) | 🟡 Moyen terme |
| **E10** | Mission Control — Vues contextuelles dynamiques | 🟡 Moyen terme |
| **E11** | Code SubAgent (auto-modification + Git manager) | 🟡 Moyen terme |
| **E12** | Proactivité (briefing matin, surveillance continue) | 🟡 Moyen terme |
| **E13** | Subagents étendus (Indeed, NotebookLM, Calendar, Drive) | 🟢 Long terme |
| **E14** | LLM Router intelligent configurable | 🟢 Long terme |
| **E15** | Migration NUC N150 / CasaOS (production) | 🟢 Long terme |

---

## 15. Structure du repo

```
makilab/
├── CLAUDE.md                    # Contexte permanent pour Antigravity
├── PROGRESS.md                  # État des epics (source de vérité)
├── .env                         # Secrets (jamais committé)
├── .env.example
├── .gitignore
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
├── packages/
│   ├── shared/                  # Types communs (IncomingMessage, OutgoingMessage, Tool...)
│   ├── agent/                   # Orchestrateur + boucle agentique
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config.ts
│   │       ├── agent-loop.ts
│   │       ├── llm-router.ts
│   │       ├── smart-capture.ts
│   │       ├── memory/
│   │       │   ├── sqlite.ts
│   │       │   ├── qdrant.ts
│   │       │   └── postgres.ts
│   │       ├── subagents/
│   │       │   ├── registry.ts
│   │       │   ├── obsidian.ts
│   │       │   ├── gmail.ts
│   │       │   ├── web.ts
│   │       │   ├── karakeep.ts
│   │       │   └── tasks.ts
│   │       └── tools/
│   ├── whatsapp/                # Gateway Baileys
│   ├── gmail-watcher/           # Surveillance Gmail entrant (CRON)
│   ├── raycast-webhook/         # Endpoint webhook Tailscale pour Raycast
│   └── mission-control/         # Next.js 15 dashboard
└── docs/
    └── plans/
```
