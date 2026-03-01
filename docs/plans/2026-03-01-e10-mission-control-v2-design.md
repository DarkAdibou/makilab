# E10 — Mission Control v2 : Vues contextuelles + Streaming + Home Assistant

## Objectif

Transformer le dashboard MVP (chat + connections) en un vrai centre de commande :
kanban des tâches, page d'accueil avec stats, streaming chat temps réel, et intégration Home Assistant.

## Scope — 3 blocs

### Bloc A : Kanban Tasks + Command Center

**Kanban Tasks** — page `/tasks`
- 4 colonnes : Backlog / Todo (pending) / In Progress / Done
- Ajouter statut `backlog` au CHECK constraint SQLite (migration)
- Drag-and-drop entre colonnes → `PATCH /api/tasks/:id` pour update statut
- Carte tâche : titre, priorité (badge couleur), date, nombre de steps, created_by
- Bouton "+" pour créer une tâche → `POST /api/tasks`
- Filtres : par canal, par priorité
- Tâches `failed` et `waiting_user` affichées avec badge spécial dans leur colonne respective

**Command Center** — page `/` (remplace le chat comme page d'accueil)
- 4 stat cards en haut : Messages aujourd'hui, Tâches actives, Subagents connectés, Tâches terminées (7j)
- Section "Activité récente" : 10 derniers messages/tâches mélangés, chronologiques
- Section "Tâches en cours" : mini-kanban ou liste des in_progress
- Le chat déménage vers `/chat`

**Changements API (Fastify)** :
- `PATCH /api/tasks/:id` — update status, priority, title
- `POST /api/tasks` — créer une tâche depuis le dashboard
- `GET /api/stats` — retourne les compteurs pour le Command Center
- Migration SQLite : ajouter `backlog` au CHECK constraint de tasks.status

### Bloc B : Streaming Chat + UX Polish

**SSE Streaming** :
- Nouveau endpoint `POST /api/chat/stream` → retourne un flux SSE
- Côté agent-loop : nouveau `runAgentLoopStreaming()` qui utilise `client.messages.stream()`
- Chaque `text_delta` envoyé comme event SSE : `data: {"type":"text","content":"..."}\n\n`
- Events tool_use : `data: {"type":"tool_call","name":"obsidian__search","status":"start"}\n\n`
- Event final : `data: {"type":"done"}\n\n`
- L'ancien `POST /api/chat` reste comme fallback (WhatsApp, Raycast)

**Dashboard Chat** :
- `fetch()` + `ReadableStream` pour lire le SSE (pas EventSource car c'est un POST)
- Bubble assistant se remplit en temps réel, caractère par caractère
- Indicateur d'outil en cours : "Recherche dans Obsidian..." avec spinner
- Markdown rendering basique : **bold**, `code`, ```code blocks```, listes, liens
- Auto-resize du textarea

### Bloc C : Home Assistant SubAgent

**Architecture** :
- Nouveau subagent `homeassistant` dans `packages/agent/src/subagents/homeassistant.ts`
- Se connecte au MCP HA via Streamable HTTP (`/api/mcp` sur l'instance HA)
- Auth : long-lived access token HA (variable `HA_ACCESS_TOKEN` + `HA_URL`)

**Actions exposées** :
- `list_entities` — inventaire des entités exposées via Assist
- `get_state` — état d'une entité (lumière, capteur, thermostat...)
- `call_service` — appeler un service HA (turn_on, turn_off, set_temperature...)
- `assist` — envoyer une commande en langage naturel au pipeline Assist

**Intégration** :
- Enregistré dans le registre subagents → automatiquement exposé comme Anthropic tools
- Carte dans la page Connections
- Config optionnelle : si `HA_URL` absent, subagent désactivé gracieusement

## Décisions techniques

### Drag-and-drop Kanban
- **Bibliothèque** : `@dnd-kit/core` + `@dnd-kit/sortable` — léger, React 19 compatible, pas de jQuery
- Alternative considérée : HTML5 drag natif — trop de edge cases navigateur
- Alternative considérée : `react-beautiful-dnd` — abandonné, pas maintenu

### SSE vs WebSocket
- **SSE** choisi pour le streaming car unidirectionnel suffit (serveur → client)
- WebSocket serait nécessaire si on voulait du push bidirectionnel (notifications temps réel)
- On garde l'option WebSocket pour plus tard (notifications push)

### MCP Client pour Home Assistant
- Le MCP HA utilise Streamable HTTP (pas stdio)
- On utilise `@modelcontextprotocol/sdk` côté client pour se connecter
- Les tools MCP sont traduits en actions du subagent Makilab
- Discovery dynamique : au boot, le subagent liste les tools MCP disponibles et génère ses actions

### Migration SQLite statut `backlog`
- `ALTER TABLE` ne supporte pas la modification de CHECK constraints en SQLite
- Solution : recréer la table avec le nouveau CHECK, copier les données, swap
- Encapsulé dans une fonction `migrateTasksBacklog()` appelée au boot

## Design system — Nouveaux composants CSS

### Kanban
```
.kanban-board        — flex row, gap 16px, overflow-x auto
.kanban-column       — flex column, min-width 280px, bg muted, border-radius
.kanban-column-header — flex space-between, titre + compteur badge
.kanban-card         — card style, draggable, cursor grab
.kanban-card.dragging — opacity 0.5, shadow-lg
```

### Stat cards (Command Center)
```
.stat-grid           — grid 4 colonnes (responsive)
.stat-card           — card avec icon, valeur grande, label muted
.stat-card-value     — font-size 2rem, font-weight 600
.stat-card-label     — muted-foreground, font-size 0.875rem
```

### Markdown dans le chat
```
.chat-bubble pre     — bg muted, border-radius, padding, overflow-x auto
.chat-bubble code    — font-mono, bg muted inline
.chat-bubble a       — primary color, underline
```

## Sidebar mise à jour

```
OVERVIEW
  Command Center  (/)
  Chat            (/chat)

MANAGE
  Tasks           (/tasks)
  Connections     (/connections)
```

## Ordre d'implémentation

1. **Bloc A** — Kanban + Command Center (le plus visible, valeur immédiate)
2. **Bloc B** — Streaming + UX (améliore l'expérience existante)
3. **Bloc C** — Home Assistant (ajout indépendant)

## Ce que E10 ne fait PAS

- Auth/login (Tailscale suffit)
- CRON config UI (E12)
- Settings page (plus tard)
- Logs temps réel (plus tard)
- Notifications push WebSocket (plus tard)
- Reorder des tâches dans une colonne (v1 = juste changer de colonne)
