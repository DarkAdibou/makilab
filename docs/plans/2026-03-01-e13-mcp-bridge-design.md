# E13 — MCP Bridge + Tâches récurrentes Design

## Vision

Makilab devient un **client MCP** (Model Context Protocol) capable de se connecter à des serveurs MCP externes. Les tools MCP sont auto-découverts et exposés comme Anthropic tools dans la boucle agentique. Chaque nouveau serveur MCP ajouté = nouvelles capacités, sans modifier le code de Makilab.

Ajout en parallèle de **tâches récurrentes** créables via chat et gérables depuis le dashboard.

## Décisions de design

- **Architecture hybride** : MCP bridge générique + subagents manuels existants maintenus
- **Transport** : stdio pour V1 (le SDK `@modelcontextprotocol/sdk` supporte stdio et SSE)
- **Config-driven** : fichier `mcp-servers.json` à la racine du repo
- **3 serveurs MCP initiaux** : NotebookLM, Indeed, Google Calendar
- **Pas de Drive** : pas de MCP server disponible actuellement
- **Tâches récurrentes** : CRON dynamiques créées via chat, toggle on/off dans le dashboard

## Partie 1 : MCP Client Bridge

### Architecture

Un module `packages/agent/src/mcp/bridge.ts` qui :
1. Lit `mcp-servers.json` au boot
2. Pour chaque serveur : spawn le process enfant, connecte via `StdioClientTransport`
3. Appelle `client.listTools()` pour découvrir les tools disponibles
4. Convertit les tools MCP en format `Anthropic.Tool[]`
5. Les injecte dans `buildToolList()` de la boucle agentique
6. Quand Claude appelle un tool MCP : route vers `client.callTool(name, args)`
7. Au shutdown : kill propre de tous les process MCP

### Nommage des tools MCP

Format : `mcp_<server>__<tool>` (préfixe `mcp_` pour distinguer des subagents natifs)

Exemples :
- `mcp_notebooklm__notebook_query`
- `mcp_indeed__search_jobs`
- `mcp_google-calendar__gcal_list_events`

### Config (`mcp-servers.json`)

```json
{
  "notebooklm": {
    "command": "npx",
    "args": ["-y", "notebooklm-mcp"],
    "env": {}
  },
  "indeed": {
    "command": "node",
    "args": ["path/to/indeed-mcp/index.js"],
    "env": {}
  },
  "google-calendar": {
    "command": "npx",
    "args": ["-y", "@anthropic/google-calendar-mcp"],
    "env": {}
  }
}
```

Le fichier est optionnel — si absent ou vide, Makilab fonctionne normalement sans MCP.

### Intégration dans la boucle agentique

`buildToolList()` dans `agent-loop.ts` et `agent-loop-stream.ts` appelle `getMcpTools()` pour récupérer les tools MCP et les ajouter à la liste.

L'exécution d'un tool MCP dans la boucle est détectée par le préfixe `mcp_` et routée vers `callMcpTool(serverName, toolName, args)`.

### Gestion des erreurs

- Serveur MCP qui crash → log warning, tools de ce serveur retirés de la liste
- Timeout sur `callTool` → retourne erreur au LLM, ne bloque pas la boucle
- Serveur indisponible au boot → skip avec warning, les autres fonctionnent

## Partie 2 : 3 serveurs MCP initiaux

| Serveur | Package | Tools principales | Nature |
|---|---|---|---|
| NotebookLM | `notebooklm-mcp` | notebook_list, notebook_query, notebook_add_url/text, source_describe | Read + Write |
| Indeed | MCP Claude.ai | search_jobs, get_job_details, get_company_data, get_resume | Read only |
| Google Calendar | MCP Claude.ai | list_events, create_event, update_event, delete_event, find_free_time | Full CRUD |

> Note : les packages MCP exacts devront être validés au moment de l'implémentation. Les MCP servers "Claude.ai" sont fournis par Anthropic via claude.ai et leur packaging npm peut varier.

## Partie 3 : Tâches récurrentes

### Backend (SQLite)

Migration : ajouter sur la table `tasks` :
- `cron_expression TEXT` — expression CRON (ex: `0 8 * * 1` = lundi 8h)
- `cron_enabled INTEGER DEFAULT 0` — toggle on/off
- `cron_prompt TEXT` — le prompt à envoyer à l'agent quand le CRON fire

### Task Runner enrichi

Le scheduler CRON existant (E6, `tasks/cron.ts`) est étendu pour :
1. Au boot : charger toutes les tâches avec `cron_enabled = 1`
2. Scheduler chaque tâche avec `node-cron`
3. Quand le CRON fire : envoyer `cron_prompt` à `runAgentLoop()` sur le canal configuré
4. L'agent exécute et peut créer/modifier des sous-tâches

### Subagent Tasks enrichi

Nouvelles actions ou paramètres sur `tasks__create` et `tasks__update` :
- `cron_expression` : expression CRON
- `cron_enabled` : true/false
- `cron_prompt` : texte du prompt

L'agent comprend "tous les lundis fais X" → crée une tâche avec `cron_expression: "0 8 * * 1"`, `cron_prompt: "X"`.

### Dashboard

- Badge "récurrent" sur les TaskCards avec expression humaine ("Chaque lundi à 8h")
- Toggle on/off directement sur la carte
- Édition de la fréquence et du prompt dans le TaskDetailPanel
- API endpoints : PATCH `/api/tasks/:id` (déjà existant, à enrichir)

### Chat

L'agent peut :
- Créer : "tous les lundis, cherche des offres data engineer sur Indeed"
- Désactiver : "désactive la tâche de recherche Indeed"
- Modifier : "change la recherche Indeed à tous les mercredis"
- Lister : "quelles sont mes tâches récurrentes ?"

## Sécurité

- Les serveurs MCP tournent en process enfants isolés
- Pas d'accès aux secrets de Makilab (sauf via `env` dans la config)
- Les tools MCP destructifs (delete, create) passent par le LLM qui demande confirmation selon le system prompt
- `mcp-servers.json` ne doit PAS contenir de secrets — utiliser des références à des env vars

## Hors scope V1

- Transport SSE (stdio suffit)
- Migration des subagents existants vers MCP
- Google Drive (pas de MCP disponible)
- Auto-discovery de serveurs MCP (config manuelle)
- Permissions granulaires par tool MCP (le system prompt suffit pour V1)

## Évolutions futures (à rediscuter)

Ces idées ont été identifiées pendant le brainstorming et méritent d'être explorées dans de futurs epics :

### Court terme
- **MCP SSE transport** : permettrait de connecter des serveurs MCP distants (ex: sur le NUC) via HTTP plutôt que stdio. Utile quand Makilab et les serveurs MCP ne sont pas sur la même machine.
- **Google Drive MCP** : si un MCP server Drive apparaît, l'ajouter serait trivial grâce au bridge.
- **Indexation des design docs** : faire en sorte que Makilab indexe automatiquement ses propres design docs (PROGRESS.md, plans/) dans la mémoire sémantique Qdrant, pour qu'il ait connaissance des décisions architecturales prises dans les sessions Claude Code.

### Moyen terme
- **Migration subagents → MCP** : transformer les subagents natifs (karakeep, obsidian) en serveurs MCP. Avantage : réutilisables par d'autres agents. Inconvénient : overhead process + perte de la logique métier intégrée.
- **MCP marketplace** : interface dans Mission Control pour browse/installer/configurer des serveurs MCP depuis un catalogue.
- **Auto-discovery MCP** : scanner un répertoire pour trouver des serveurs MCP installés automatiquement.

### Long terme
- **Multi-agent MCP** : Makilab pourrait exposer ses propres capabilities en tant que serveur MCP, permettant à d'autres agents de l'utiliser.
- **MCP resources** : utiliser le protocole MCP resources (pas juste tools) pour exposer des données (fichiers, DB) aux serveurs MCP.
- **Conversations Claude Code → Makilab** : bridge pour que les décisions prises dans Claude Code soient automatiquement résumées et indexées dans la mémoire de Makilab.
