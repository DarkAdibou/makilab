# LLM Routing — Architecture et logique métier

> Fichier de référence pour comprendre et faire évoluer le routing LLM de Makilab.
> Dernière mise à jour : 2026-03-05

## Vue d'ensemble

Tout appel LLM passe par un point d'entrée unique : `createLlmClient()` dans `packages/agent/src/llm/client.ts`.
Le client expose `chat()` et `stream()`, qui appellent `resolveModel(taskType, modelOverride?)` pour déterminer quel provider et modèle utiliser.

## Résolution du modèle

```
resolveModel(taskType, modelOverride?)
  1. modelOverride fourni ?  → inferProvider(modelOverride) + modèle override
  2. Route DB (llm_route_config) ?  → inferProvider(dbModel) + modèle DB
  3. FALLBACK_ROUTES[taskType]  → hardcodé dans router.ts

  À chaque étape : si provider=openrouter et pas de OPENROUTER_API_KEY → fallback Haiku Anthropic
```

**Fichier** : `packages/agent/src/llm/router.ts`

## TaskTypes et modèles par défaut

| TaskType | Modèle par défaut | Provider | Utilisé par |
|----------|-------------------|----------|-------------|
| `conversation` | claude-sonnet-4-6 | Anthropic | Chat (tous canaux), agent-loop principal |
| `compaction` | claude-haiku-4-5-20251001 | Anthropic | Résumé d'historique quand >30 messages |
| `fact_extraction` | claude-haiku-4-5-20251001 | Anthropic | Extraction de faits post-échange (fire-and-forget) |
| `classification` | google/gemini-2.0-flash-001 | OpenRouter | Classification de complexité des tâches CRON, capture |
| `cron_simple` | claude-haiku-4-5-20251001 | Anthropic | Tâches CRON simples (classifiées par classify-task) |
| `cron_moderate` | claude-haiku-4-5-20251001 | Anthropic | Tâches CRON modérées + briefings matin/soir |
| `cron_task` | claude-sonnet-4-6 | Anthropic | Tâches CRON complexes (classifiées par classify-task) |
| `orchestration` | claude-haiku-4-5-20251001 | Anthropic | (Réservé, non utilisé actuellement) |
| `deep_search` | perplexity/sonar-pro | OpenRouter | Recherche approfondie via web subagent |
| `skill_creation` | claude-sonnet-4-6 | Anthropic | Création/modification de skills |

Les routes DB (table `llm_route_config`) surchargent ces valeurs. Modifiables via `/settings/llm` dans Mission Control.

## Toggle prefer_openrouter

- **Stockage** : table `memory_settings`, clé `prefer_openrouter`
- **Cache** : 5 secondes en mémoire (`getPreferOpenRouter()`)
- **Effet** : quand activé ET `OPENROUTER_API_KEY` présente, TOUS les appels passent par OpenRouter (y compris les modèles `claude-*`, convertis via `toOpenRouterModel()`)
- **Conséquence** : le prompt caching Anthropic (`cache_control: ephemeral`) est perdu car les system blocks sont aplatis en string pour OpenRouter
- **UI** : toggle dans `/settings/llm`

## Conversion des identifiants de modèles

```
toOpenRouterModel('claude-sonnet-4-6')        → 'anthropic/claude-sonnet-4.6'
toOpenRouterModel('claude-haiku-4-5-20251001') → 'anthropic/claude-haiku-4.5'  (⚠️ perte du suffixe date)
toOpenRouterModel('google/gemini-...')         → pass-through (contient déjà '/')

toAnthropicModel('anthropic/claude-sonnet-4.6') → 'claude-sonnet-4-6'
toAnthropicModel('claude-sonnet-4-6')           → pass-through (pas de préfixe 'anthropic/')
```

**Risque connu** : la conversion aller-retour perd le suffixe date (`-20251001`). Pas de bug aujourd'hui car les modèles sont stockés en format Anthropic natif en DB et la conversion retour n'est utilisée que dans le sens OpenRouter → Anthropic quand prefer_openrouter est désactivé.

## Qui appelle quoi

### Boucle principale (agent-loop.ts / agent-loop-stream.ts)
- `taskType` : `context.taskType ?? 'conversation'`
- `model` : `context.model` (override optionnel du frontend ou du CRON)
- Compaction : `taskType: 'compaction'`, pas d'override → toujours Haiku

### CRON (tasks/cron.ts)
- **Briefings matin/soir** : `taskType: 'cron_moderate'` → Haiku
- **Tâches planifiées** : `taskType: 'cron_task'` + `model: task.model` (classifié par `classify-task.ts`)
- Le classifieur utilise lui-même `taskType: 'classification'` → Gemini Flash

### Subagents avec appels LLM internes
- **capture** (classify) : `taskType: 'classification'` → Gemini Flash
- **web** (deep_research) : `taskType: 'deep_search'` → perplexity/sonar-pro

### Fact extraction et mémoire sémantique
- `taskType: 'fact_extraction'` → Haiku (fire-and-forget post-échange)
- Embeddings : Voyage AI (pas le router LLM)

## Choix du modèle dans le chat (Mission Control)

Le dropdown dans `/chat` permet de choisir un modèle pour la session :
1. Au chargement : initialisé avec la route DB `conversation` (`GET /api/models/routes`)
2. Au changement : met à jour le state local uniquement (éphémère par session)
3. À l'envoi : le modèle est transmis comme `model` override dans `POST /api/chat/stream`
4. Le model override a priorité sur la route DB dans `resolveModel()`

La route DB globale `conversation` est gérée dans `/settings/llm`, pas dans le dropdown chat.

## Catalogue de modèles

- Table SQLite `llm_models` (peuplée depuis l'API OpenRouter)
- `modelSupportsTools(orModelId)` : vérifie `supports_tools=1` avant d'envoyer des tools
- Le dropdown chat ne montre que les modèles avec `supports_tools=1`
- Si le catalogue est vide (premier démarrage sans réseau), safe default = true

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `packages/agent/src/llm/router.ts` | TaskType, FALLBACK_ROUTES, resolveModel(), inferProvider() |
| `packages/agent/src/llm/client.ts` | createLlmClient(), chat(), stream(), toOpenRouterModel(), toAnthropicModel() |
| `packages/agent/src/llm/pricing.ts` | calculateCost(), listAvailableModels() |
| `packages/agent/src/llm/catalog.ts` | Catalogue OpenRouter, scoring, modelSupportsTools() |
| `packages/agent/src/llm/classify-task.ts` | Classification complexité CRON → assignation modèle |
| `packages/agent/src/agent-loop.ts` | Boucle agentique principale + compactHistory() |
| `packages/agent/src/agent-loop-stream.ts` | Version streaming |
| `packages/agent/src/tasks/cron.ts` | Exécution tâches planifiées |
| `packages/dashboard/app/settings/llm/page.tsx` | UI routes + toggle prefer_openrouter |
| `packages/dashboard/app/chat/page.tsx` | Dropdown modèle (éphémère par session) |
