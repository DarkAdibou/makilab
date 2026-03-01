# E16 — Mémoire hybride unifiée

## But

Rendre l'agent proactivement intelligent : il se souvient automatiquement du contexte pertinent (conversations passées, faits, notes Obsidian) sans qu'on le lui demande. Unifier les sources mémoire (SQLite, Qdrant, Obsidian) en un pipeline de retrieval unique, observable et paramétrable depuis Mission Control.

## Architecture

Approche synchrone : à chaque message entrant, avant d'appeler le LLM, le système effectue un retrieval unifié (~60ms) qui enrichit le system prompt avec des souvenirs pertinents.

### Stack mémoire après E16

```
┌─────────────────────────────────────────────────────┐
│                    Agent Loop                        │
│                                                      │
│  1. loadMemoryContext(channel)   ← SQLite T1         │
│  2. autoRetrieve(message)        ← Qdrant + Obsidian │
│  3. buildEnrichedPrompt()        → system prompt     │
│                                                      │
│  Post-response:                                      │
│  4. extractAndSaveFacts(msg, reply, toolResults)     │
│  5. indexConversation(...)       → Qdrant            │
└─────────────────────────────────────────────────────┘
```

## Composants

### 1. Auto-retrieval unifié

**Nouveau module** : `packages/agent/src/memory/retriever.ts`

```typescript
interface RetrievalResult {
  qdrantMemories: Array<{
    content: string;
    score: number;
    channel: string;
    timestamp: string;
    timeAgo: string;    // "il y a 3 jours"
    type: 'conversation' | 'summary' | 'fact';
  }>;
  obsidianNotes: Array<{
    path: string;
    content: string;    // tronqué à ~500 chars
  }>;
}

async function autoRetrieve(
  userMessage: string,
  channel: string
): Promise<RetrievalResult>
```

Flux :
1. `embedText(userMessage)` → vecteur 1024d (Voyage AI, ~2ms)
2. `semanticSearch(vector, maxResults, minScore)` → souvenirs Qdrant (local, ~10ms)
3. `fetchObsidianContextNotes()` → notes fixes + taggées `#makilab` (~50ms)
4. Retourne le contexte enrichi

**Paramètres configurables** (table `memory_settings` SQLite) :
- `auto_retrieve_enabled` : boolean (défaut: true)
- `auto_retrieve_max_results` : int (défaut: 4)
- `auto_retrieve_min_score` : float (défaut: 0.5)
- `obsidian_context_enabled` : boolean (défaut: true)
- `obsidian_context_notes` : JSON array de paths fixes (ex: ["Carrière.md", "Profil.md"])
- `obsidian_context_tag` : string (défaut: "makilab")

**Cross-channel** : la recherche Qdrant ne filtre PAS par canal — un souvenir WhatsApp enrichit une conversation Mission Control et vice-versa.

**Mémoire temporelle** : chaque souvenir inclut un timestamp relatif ("il y a 3 jours", "le 28 février") pour que l'agent ait la notion du temps.

**Graceful degradation** : si Qdrant ou Obsidian sont indisponibles, le retrieval continue avec ce qui est disponible. Jamais bloquant.

### 2. Extraction de faits enrichie

**Modification** : `fact-extractor.ts`

Signature actuelle :
```typescript
extractAndSaveFacts(userMessage, assistantReply, channel)
```

Nouvelle signature :
```typescript
extractAndSaveFacts(userMessage, assistantReply, channel, toolResults?: string[])
```

Les `toolResults` sont les contenus texte retournés par les subagents pendant la boucle (notes Obsidian lues, emails parsés, résultats web, etc.). Le prompt d'extraction est ajusté pour analyser aussi ces résultats.

### 3. Cross-channel

- `loadMemoryContext(channel)` continue de charger les 20 derniers messages du canal courant (pas de changement — l'historique par canal reste pertinent)
- L'auto-retrieval Qdrant est cross-channel (déjà le cas dans le design actuel)
- Le résumé de compaction mentionne le canal source

### 4. Oubli actif

Nouvelle action subagent : `memory__forget`

Input : `{ topic: string }`

Comportement :
1. Recherche sémantique Qdrant avec le topic → récupère les IDs des vecteurs pertinents (score > 0.5)
2. Supprime ces vecteurs de Qdrant (conversations + knowledge)
3. Cherche dans `core_memory` les faits contenant le topic → supprime
4. Retourne un résumé de ce qui a été purgé

### 5. FTS5 Full-Text Search

**Migration SQLite** : ajout d'un index FTS5 sur la table `messages`.

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);
```

Triggers pour synchroniser FTS5 avec les INSERT/DELETE sur `messages`.

**Nouvelle fonction** :
```typescript
searchMessagesFullText(query: string, limit?: number): MessageRow[]
```

**Nouvelle action subagent** : `memory__search_text` — recherche par mots-clés (complémentaire à `memory__search` qui est sémantique).

### 6. Page /memory (Dashboard)

4 sections :

**Section 1 — Faits** :
- Liste de tous les faits `core_memory` (clé/valeur)
- Edit inline, delete, bouton "Ajouter un fait"
- API : GET/POST/DELETE /api/memory/facts

**Section 2 — Recherche** :
- Barre de recherche avec toggle "Sémantique / Texte"
- Sémantique → embed + Qdrant search
- Texte → FTS5 SQLite
- Résultats : score, canal, date, extrait (200 chars)
- API : GET /api/memory/search?q=...&mode=semantic|text

**Section 3 — Auto-retrieval** :
- Toggle on/off
- Sliders : max résultats (1-10), seuil score (0.3-0.8)
- Log des dernières injections (quels souvenirs ont été injectés, pour quel message, avec score)
- API : GET/PATCH /api/memory/settings

**Section 4 — Notes Obsidian** :
- Liste des notes de contexte configurées (fixes + taggées)
- Ajout/suppression de notes fixes
- Champ pour modifier le tag
- Preview du contenu de chaque note
- API : GET/PATCH /api/memory/settings (même endpoint)

### 7. Coût et observabilité

- Les tokens input ajoutés par l'auto-retrieval sont trackés dans `llm_usage` avec un flag ou metadata identifiable
- La page /costs affiche le surcoût de l'auto-retrieval séparément
- Chaque injection est loggée dans une table `memory_retrievals` :
  ```sql
  CREATE TABLE memory_retrievals (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    user_message_preview TEXT,
    memories_injected INTEGER,
    obsidian_notes_injected INTEGER,
    total_tokens_added INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```

## Endpoints API (nouveaux)

| Méthode | Path | Description |
|---------|------|-------------|
| GET | /api/memory/facts | Liste tous les faits core_memory |
| POST | /api/memory/facts | Ajouter un fait (key, value) |
| DELETE | /api/memory/facts/:key | Supprimer un fait |
| GET | /api/memory/search | Recherche sémantique ou FTS5 |
| GET | /api/memory/settings | Paramètres auto-retrieval + Obsidian |
| PATCH | /api/memory/settings | Modifier les paramètres |
| GET | /api/memory/stats | Stats (nb vecteurs, nb faits, dernière indexation) |
| GET | /api/memory/retrievals | Log des derniers auto-retrievals |

## Fichiers impactés

### Nouveaux
- `packages/agent/src/memory/retriever.ts` — Auto-retrieval unifié
- `packages/dashboard/app/memory/page.tsx` — Page /memory
- `packages/agent/src/tests/retriever.test.ts` — Tests auto-retrieval

### Modifiés
- `packages/agent/src/memory/sqlite.ts` — FTS5, memory_settings, memory_retrievals tables
- `packages/agent/src/memory/fact-extractor.ts` — toolResults param
- `packages/agent/src/agent-loop.ts` — intégration autoRetrieve
- `packages/agent/src/agent-loop-stream.ts` — intégration autoRetrieve
- `packages/agent/src/subagents/memory.ts` — actions forget + search_text
- `packages/agent/src/server.ts` — 8 nouveaux endpoints
- `packages/dashboard/app/components/sidebar.tsx` — lien Memory
- `packages/dashboard/app/lib/api.ts` — helpers API memory
- `packages/dashboard/app/globals.css` — styles page memory

## Contraintes

- **Latence** : l'auto-retrieval doit rester < 100ms total
- **Graceful degradation** : Qdrant down → skip, Obsidian down → skip, jamais bloquant
- **Voyage AI free tier** : 200M tokens/mois, largement suffisant (~50 tokens/message)
- **Obsidian REST API** : HTTPS port 27124, `NODE_TLS_REJECT_UNAUTHORIZED=0`
- **FTS5** : disponible nativement dans node:sqlite (Node.js 22+)
