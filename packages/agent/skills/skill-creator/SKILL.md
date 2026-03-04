---
name: skill-creator
description: Crée, modifie et améliore des skills Makilab (fichiers SKILL.md). Utilise ce skill quand l'utilisateur veut créer un nouveau skill, améliorer un skill existant, documenter un workflow récurrent, ou transformer une conversation en skill réutilisable. Déclenche aussi sur "nouveau skill", "créer un skill", "ajouter une capacité", "documenter ce workflow".
---

# Skill Creator — Makilab

Crée et améliore des skills pour l'agent Makilab. Les skills sont des fichiers SKILL.md avec frontmatter YAML, stockés dans `packages/agent/skills/<name>/SKILL.md`.

## Format d'un skill

```
packages/agent/skills/<name>/
└── SKILL.md          (requis)
    ├── frontmatter YAML : name, description
    └── corps markdown : instructions pour l'agent
```

Frontmatter obligatoire :
```yaml
---
name: nom-du-skill         # identifiant kebab-case
description: Quand et pourquoi utiliser ce skill. C'est le texte qui déclenche le skill — sois précis et "pushant". Inclus les phrases typiques de l'utilisateur.
---
```

## Processus

### 1. Capturer l'intent

Si la conversation précédente contient déjà un workflow à capturer, extrais les étapes, outils utilisés et corrections de l'utilisateur — c'est ta matière première.

Sinon, pose ces questions (de manière conversationnelle, pas en liste brute) :
- Que doit faire ce skill ?
- Dans quels contextes doit-il se déclencher ? (phrases typiques de l'utilisateur)
- Format de sortie attendu ?
- Subagents nécessaires (obsidian, web, karakeep, tasks, memory, code...) ?

### 2. Rédiger le SKILL.md

**Description (frontmatter)** : c'est le mécanisme de déclenchement. Inclus :
- Ce que fait le skill
- Les contextes d'utilisation
- Des exemples de phrases utilisateur
- Sois légèrement "pushant" : si le skill peut aider, l'agent doit l'utiliser

**Corps** : instructions claires et concrètes. Préfère l'impératif. Explique le *pourquoi* plutôt que des MUST en majuscules. Utilise des exemples. Garde sous 300 lignes — si plus, décompose en fichiers references/.

### 3. Écrire le fichier

Utilise le subagent `code` avec l'action `write_file` pour créer :
- `packages/agent/skills/<name>/SKILL.md`

Puis invalide le cache en appelant `GET /api/skills` (via subagent `web` ou en informant l'utilisateur de rafraîchir la page Capabilities).

### 4. Proposer des prompts de test

Donne 2-3 phrases test réalistes que l'utilisateur pourrait dire pour déclencher le skill. Par exemple :
- "Comment faire X avec Y ?"
- "Aide-moi à Z"

Explique comment vérifier que le skill se déclenche : page Capabilities → section Skills → le skill doit apparaître activé.

## Subagents disponibles

Pour écrire le fichier : `code__write_file` avec `path: "packages/agent/skills/<name>/SKILL.md"`.
Pour lire un skill existant : `code__read_file`.
Pour lister les skills existants : `code__list_files` avec `pattern: "packages/agent/skills/*/SKILL.md"`.

## Bonnes pratiques

- **Nom** : kebab-case, court, descriptif (`facture-scanner`, `obsidian-daily`, `research-brief`)
- **Description** : 1-3 phrases. Inclus des mots-clés que l'utilisateur utiliserait naturellement
- **Corps** : commence par le résultat attendu, puis les étapes. Pas de boilerplate
- **Subagents** : cite les subagents nécessaires explicitement dans le body (l'agent sait lesquels sont disponibles)
- **Longueur** : 50-200 lignes idéalement. Au-delà, crée des fichiers references/

## Exemple minimal

```markdown
---
name: meteo-briefing
description: Donne un briefing météo pour planifier la journée ou la semaine. Utilise quand l'utilisateur demande la météo, veut savoir s'il va pleuvoir, ou planifie une activité en extérieur.
---

# Météo Briefing

Fournis un briefing météo clair et actionnable.

## Étapes

1. Utilise `web__search` pour chercher la météo de la ville demandée (ou Paris par défaut)
2. Extrait : température, précipitations, vent, UV
3. Formule une recommandation pratique (parapluie ? crème solaire ? veste ?)

## Format de réponse

**Aujourd'hui [ville]** : [temp min/max], [conditions]
→ [recommandation en une phrase]
```
