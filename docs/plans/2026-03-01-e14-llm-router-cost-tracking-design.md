# E14 — LLM Router intelligent + Cost Tracking

## Contexte

Makilab utilise actuellement Claude Sonnet pour toutes les conversations et Claude Haiku pour les tâches background (extraction de faits, compaction, classification). Tous les appels passent par le SDK Anthropic directement, sans tracking de tokens ni calcul de coûts. OpenRouter est configuré mais pas utilisé.

Inspiré par le projet Gravity Claw (routing multi-modèle par type de tâche), E14 introduit :
1. Un **client LLM unifié** qui route vers le bon provider/modèle par type de tâche
2. Un **tracking complet** de chaque appel LLM (tokens, coût, durée)
3. Une **page Coûts** dans Mission Control pour visualiser les dépenses
4. Un **sélecteur de modèle** dans le chat et sur les tâches récurrentes

## Architecture

### LLM Client unifié

```
packages/agent/src/llm/
  ├── client.ts          — LLMClient class (interface commune)
  ├── providers/
  │   ├── anthropic.ts   — AnthropicProvider (SDK Anthropic)
  │   └── openrouter.ts  — OpenRouterProvider (API OpenRouter, format OpenAI)
  ├── router.ts          — route task_type → provider + model
  ├── tracker.ts         — log usage dans SQLite (table llm_usage)
  └── pricing.ts         — table de prix par modèle
```

**Interface commune :**
```typescript
interface LLMRequest {
  taskType: TaskType;               // 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task'
  messages: Message[];
  system?: string;
  tools?: Tool[];
  maxTokens?: number;
  model?: string;                   // override explicite (dropdown chat, config tâche)
  stream?: boolean;
}

interface LLMResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    model: string;
    provider: string;
    durationMs: number;
  };
}

type TaskType = 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task' | 'orchestration';
```

### Config de routing

```typescript
// Config statique, modifiable via dashboard futur
const DEFAULT_ROUTES: Record<TaskType, { provider: string; model: string }> = {
  conversation:     { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  compaction:       { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  fact_extraction:  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  classification:   { provider: 'openrouter', model: 'google/gemini-2.0-flash-001' },
  cron_task:        { provider: 'anthropic', model: 'claude-sonnet-4-6' },  // défaut, overridable par tâche
  orchestration:    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
};
```

**Priorité de résolution du modèle :**
1. Override explicite (dropdown chat, champ model de la tâche récurrente)
2. Config de routing par task_type
3. Modèle par défaut (claude-sonnet-4-6)

### Recommandation automatique de modèle

Quand le LLM crée une tâche récurrente via `tasks__create`, il recommande un modèle optimal basé sur la complexité :
- Le subagent `tasks__create` accepte un nouveau paramètre `model`
- Le LLM principal décide en se basant sur le prompt CRON (briefing simple → gemini-flash, analyse complexe → sonnet)
- Le modèle recommandé est stocké dans la tâche et visible/éditable dans le dashboard

## Cost Tracking

### Table llm_usage (SQLite)

```sql
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,         -- 'anthropic' | 'openrouter'
  model TEXT NOT NULL,            -- 'claude-sonnet-4-6', 'google/gemini-2.0-flash-001', etc.
  task_type TEXT NOT NULL,        -- 'conversation' | 'compaction' | 'fact_extraction' | 'classification' | 'cron_task'
  channel TEXT,                   -- 'whatsapp' | 'mission_control' | 'cron' | null
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  duration_ms INTEGER,
  task_id TEXT,                   -- FK optionnel vers tasks (pour les CRON)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table de prix

```typescript
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic (par 1M tokens)
  'claude-opus-4-6':                { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6':              { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001':      { input: 0.80, output: 4.0 },
  // OpenRouter
  'google/gemini-2.0-flash-001':    { input: 0.10, output: 0.40 },
  'meta-llama/llama-4-scout':       { input: 0.15, output: 0.60 },
};
```

Mise à jour manuelle dans le code. Les prix OpenRouter incluent le markup OpenRouter.

### API endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/costs/summary?period=month\|week\|day\|year` | Coût total, nombre d'appels, tokens, breakdown par modèle et task_type |
| GET | `/api/costs/history?days=30` | Série temporelle (coût par jour) pour graphes |
| GET | `/api/costs/recent?limit=50` | Derniers appels LLM (tableau détaillé) |

## Dashboard — Page Coûts

**Route :** `/costs` dans la sidebar MANAGE

**Sidebar mise à jour :**
```
OVERVIEW
  Command Center    /
  Activité          /activity

MANAGE
  Chat              /chat
  Todo              /todo
  Tâches            /tasks
  Coûts             /costs        ← NOUVEAU
  Connections       /connections
```

**Layout de la page :**

1. **Stats cards** (en haut) : coût du mois, nombre d'appels, tokens totaux, modèle le plus utilisé
2. **Graphe courbe** : évolution du coût sur 30 jours
3. **Deux tableaux côte à côte** : breakdown par modèle + breakdown par type de tâche
4. **Tableau scrollable** : derniers appels LLM (heure, modèle, type, coût)
5. **Filtre période** : jour / semaine / mois / année

## Chat — Sélecteur de modèle

**UI :** dropdown discret à côté du bouton "Envoyer" dans `/chat`

Modèles disponibles :
- Claude Haiku (rapide, économique)
- Claude Sonnet (par défaut)
- Claude Opus (puissant)
- Gemini Flash (ultra-rapide, via OpenRouter)

Le modèle sélectionné est envoyé au backend via le body de POST `/api/chat/stream` (nouveau champ `model`).

## Tâches récurrentes — Champ model

- Nouveau champ `model TEXT` dans la table `tasks` (migration SQLite)
- Le LLM recommande un modèle à la création
- Visible dans la colonne "Modèle" de la page `/tasks`
- Éditable dans le panneau détail (dropdown)
- Le CRON scheduler passe ce modèle au LLM Client

## OpenRouter — Provider

**Client :** API compatible OpenAI (pas de SDK dédié, juste fetch)

```typescript
// OpenRouter utilise le format OpenAI
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  headers: {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': 'https://makilab.local',
  },
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-001',
    messages: convertToOpenAIFormat(messages),
    max_tokens: maxTokens,
  }),
});
```

**Limitation :** OpenRouter ne supporte pas le format tools Anthropic natif. Pour les tâches qui utilisent des tools (conversation, cron_task), on reste sur Anthropic. OpenRouter est utilisé pour les tâches sans tools (classification, extraction, compaction, résumés).

**Règle de sécurité :** les messages marqués `sensitive: true` passent toujours par Anthropic directement, jamais OpenRouter.

## Sites d'appels à migrer

| Fichier | Appel actuel | Migration |
|---------|-------------|-----------|
| agent-loop.ts:188 | `client.messages.create()` Sonnet | `llmClient.chat({ taskType: 'conversation' })` |
| agent-loop.ts:120 | `client.messages.create()` Haiku | `llmClient.chat({ taskType: 'compaction' })` |
| agent-loop-stream.ts:124 | `client.messages.stream()` Sonnet | `llmClient.stream({ taskType: 'conversation' })` |
| fact-extractor.ts:71 | `client.messages.create()` Haiku | `llmClient.chat({ taskType: 'fact_extraction' })` |
| capture.ts:141 | `client.messages.create()` Haiku | `llmClient.chat({ taskType: 'classification' })` |
| orchestrator.ts:59 | `client.messages.create()` Haiku | `llmClient.chat({ taskType: 'orchestration' })` |
| cron.ts:118 | `runAgentLoop()` → Sonnet | Passe `task.model` au LLM Client |

## Dépendances ajoutées

- Aucune nouvelle dépendance npm (OpenRouter via fetch natif, pricing en code)
- `cron-parser` déjà ajouté en E13.5
