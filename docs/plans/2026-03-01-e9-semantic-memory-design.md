# E9 — Mémoire sémantique (Qdrant + Voyage AI)

## Contexte

La mémoire T1 (SQLite) stocke les faits durables, les 20 derniers messages et les résumés compactés. Mais elle ne permet pas de retrouver un échange passé par similarité sémantique — seulement par canal et ordre chronologique. Quand l'utilisateur demande "qu'est-ce qu'on avait dit sur X il y a 3 semaines ?", l'agent n'a aucun moyen de retrouver cette information si elle a été compactée.

E9 ajoute une couche T2 de mémoire sémantique : chaque échange, résumé et fait est embeddé via Voyage AI et indexé dans Qdrant. L'agent peut ensuite chercher par sens, pas par mots-clés.

## Architecture

### Stack

- **Qdrant** — base vectorielle self-hosted (Docker sur NUC, ~200MB RAM)
- **Voyage AI** (`voyage-3`) — embeddings multilingues, excellent français, 200M tokens gratuits/mois

### Collections Qdrant

| Collection | Contenu | Quand indexé |
|---|---|---|
| `conversations` | Chaque échange user+assistant concaténé | Fire-and-forget après chaque message |
| `knowledge` | Résumés compactés + faits core_memory | À la compaction + à l'extraction de faits |

### Payload des points

```typescript
// conversations
{
  id: uuid,
  vector: float[1024],  // voyage-3 dimension
  payload: {
    channel: string,     // "whatsapp", "mission_control"
    role: "exchange",
    user_message: string,
    assistant_message: string,
    timestamp: string,   // ISO 8601
  }
}

// knowledge
{
  id: uuid,
  vector: float[1024],
  payload: {
    type: "summary" | "fact",
    channel?: string,    // pour les summaries
    key?: string,        // pour les facts (ex: "user_name")
    content: string,
    timestamp: string,
  }
}
```

## SubAgent `memory`

Exposé comme outil Anthropic natif (pattern existant). L'agent décide quand chercher — pas automatique à chaque message.

### Actions

| Action | Description |
|---|---|
| `memory__search` | Recherche sémantique cross-collection. Input: query (string), limit (int, default 5). Output: résultats triés par score, filtrés > 0.3. |
| `memory__index` | Indexation manuelle d'un texte dans `knowledge`. Usage rare (debug, injection manuelle). |

### Guidage system prompt

L'agent est guidé dans son system prompt pour utiliser `memory__search` quand :
- L'utilisateur fait référence à un sujet passé ("qu'est-ce qu'on avait dit sur...")
- L'utilisateur mentionne une conversation antérieure
- L'agent manque de contexte sur un sujet déjà discuté
- En cas de doute, l'agent peut demander à l'utilisateur s'il veut qu'il cherche dans sa mémoire

## Pipeline d'indexation (fire-and-forget)

### Après chaque échange (agent-loop-stream.ts)

```
saveMessage(channel, 'user', userMsg)
saveMessage(channel, 'assistant', reply)
extractAndSaveFacts(...)           // existant
embedAndIndex(channel, userMsg, reply)  // NOUVEAU — fire-and-forget
```

### À la compaction (sqlite.ts)

```
compactMessages(channel)  // existant — génère résumé, supprime vieux messages
embedSummary(channel, summary)  // NOUVEAU — indexe le résumé dans knowledge
```

### À l'extraction de faits (fact-extractor.ts)

```
setFact(key, value)       // existant
embedFact(key, value)     // NOUVEAU — indexe le fait dans knowledge
```

## Config conditionnelle

Comme Home Assistant : si `QDRANT_URL` ou `VOYAGE_API_KEY` manquent, le subagent `memory` n'est pas enregistré et l'indexation est silencieusement skip. Pas de crash, pas de warning en boucle.

Variables d'environnement :
- `QDRANT_URL` — ex: `http://localhost:6333` (dev) ou `http://nuc:6333` (prod)
- `VOYAGE_API_KEY` — clé API Voyage AI

## Fichiers

| Fichier | Action |
|---|---|
| `memory/embeddings.ts` | **Créer** — Client Voyage AI (embed texte → vecteur float[1024]) |
| `memory/qdrant.ts` | **Créer** — Client Qdrant (init collections, upsert, search) |
| `subagents/memory.ts` | **Créer** — SubAgent memory (search, index) |
| `config.ts` | **Modifier** — Ajouter QDRANT_URL, VOYAGE_API_KEY |
| `memory/sqlite.ts` | **Modifier** — Appeler embedSummary après compaction |
| `memory/fact-extractor.ts` | **Modifier** — Appeler embedFact après setFact |
| `agent-loop-stream.ts` | **Modifier** — Appeler embedAndIndex fire-and-forget |
| `agent-loop.ts` | **Modifier** — Même indexation fire-and-forget |
| `subagents/index.ts` | **Modifier** — Enregistrer memory subagent (conditionnel) |

## Seuil de pertinence

Score minimum Qdrant : **0.3** (comme Gravity Claw). En dessous, les résultats ne sont pas retournés. Top K = 5 par défaut.

## Estimation volumétrie

Usage perso (~30-50 messages/jour) :
- ~25-50 embeddings/jour (conversations)
- ~1-2 résumés/jour (compaction)
- ~2-5 faits/jour (extraction)
- Total : ~30-60 embeddings/jour ≈ 1000-2000/mois
- Qdrant : quelques milliers de points → négligeable en RAM
