# E11 — Code SubAgent Design

## Vision

Un subagent `code` qui permet à Makilab de modifier son propre code source sur demande explicite de l'utilisateur. Toujours sur branche Git dédiée (`agent/*`), jamais sur master. Shell whitelisté pour vérifier les changements. Capacité de redémarrer les services après modification.

## Décisions de design

- **Scope** : auto-amélioration uniquement (pas de gestion de repos externes)
- **Exécution** : fichiers + Git + shell whitelisté (test, build, typecheck)
- **Git workflow** : toujours sur branche `agent/<name>`, jamais de commit direct sur master
- **Déclenchement** : demande explicite uniquement, pas de modifications proactives
- **Restart** : dual mode dev (kill+spawn) / prod (docker compose restart)

## Actions du subagent

| Action | Description | Sécurité |
|---|---|---|
| `read_file` | Lire un fichier du repo | Lecture seule |
| `write_file` | Écrire/modifier un fichier | Sur branche `agent/*` uniquement |
| `list_files` | Lister fichiers/dossiers (glob pattern) | Lecture seule |
| `search_code` | Grep/recherche dans le codebase | Lecture seule |
| `git_status` | État du repo (branch, changes, ahead/behind) | Lecture seule |
| `git_diff` | Diff des modifications en cours ou staged | Lecture seule |
| `git_branch` | Créer et switcher sur une branche `agent/<name>` | Force le préfixe `agent/` |
| `git_commit` | Commit les changements (git add + commit) | Bloqué si branche != `agent/*` |
| `git_push` | Push la branche courante vers origin | Bloqué si branche = master |
| `run_check` | Exécuter une commande whitelistée | Whitelist stricte |
| `restart_service` | Redémarrer agent et/ou dashboard | Whitelisté par service |

## Sécurité

### Invariants

1. **Écriture/commit bloqués sur master** : `write_file` et `git_commit` vérifient que la branche courante commence par `agent/`
2. **Shell whitelisté** : `run_check` n'accepte que des commandes prédéfinies
3. **Restart whitelisté** : `restart_service` n'accepte que `agent` et `dashboard`
4. **Path sandboxing** : tous les chemins fichiers résolus relativement à la racine du monorepo, `../` interdit, symlinks non suivis
5. **Demande explicite** : l'agent ne modifie jamais le code de lui-même sans instruction utilisateur

### Commandes whitelistées (run_check)

| Commande | Mapping réel |
|---|---|
| `test` | `pnpm --filter @makilab/agent test` |
| `build` | `pnpm --filter @makilab/dashboard build` |
| `typecheck` | `pnpm --filter @makilab/agent exec tsc --noEmit` |

### Matrice de permissions (du design original)

| Type de modification | Comportement |
|---|---|
| Composant UI, page dashboard | Auto → commit → notifie |
| Nouveau subagent / MCP | Auto → commit → notifie |
| Modification orchestrateur core | Diff → attend "ok" → commit |
| Config sécurité / secrets | Toujours validation manuelle |
| Push sur `main` | Toujours validation manuelle |

> Note : dans cette V1, TOUT est sur demande explicite et sur branche. La matrice sera utile en V2 quand on ajoutera la proactivité.

## Restart : dual mode

```
MAKILAB_ENV=development (défaut)
  → Détecte le PID du process sur le port (3100 pour agent, 3000 pour dashboard)
  → Kill le process
  → Spawn detached : pnpm dev:api ou pnpm dev:dashboard
  → Attend que le port réponde (health check avec retry)

MAKILAB_ENV=production
  → docker compose restart <service-name>
  → Attend que le port réponde (health check avec retry)
```

## Config

| Variable | Requis | Description |
|---|---|---|
| `CODE_REPO_ROOT` | Non | Racine du monorepo (défaut : résolu via import.meta.url) |
| `MAKILAB_ENV` | Non | `development` (défaut) ou `production` |

Le subagent est **toujours enregistré** (pas conditionnel) — il opère sur le repo local qui est toujours présent.

## Workflow typique

```
User: "Ajoute un bouton refresh sur la page tasks du dashboard"

1. code__git_branch({ name: "add-refresh-button-tasks" })
   → Crée et switch sur agent/add-refresh-button-tasks

2. code__read_file({ path: "packages/dashboard/src/app/tasks/page.tsx" })
   → Lit le fichier pour comprendre la structure

3. code__write_file({ path: "packages/dashboard/src/app/tasks/page.tsx", content: "..." })
   → Modifie le fichier

4. code__run_check({ command: "build" })
   → Vérifie que le build passe

5. code__git_commit({ message: "feat(dashboard): add refresh button on tasks page" })
   → Commit atomique

6. code__restart_service({ service: "dashboard" })
   → Relance le dashboard pour vérifier visuellement

7. code__git_push()
   → Push la branche

8. Agent: "Branche agent/add-refresh-button-tasks pushée.
   Tu peux vérifier et merger quand tu veux."
```

## Hors scope V1

- Pas de merge automatique dans master
- Pas de création de PR GitHub
- Pas de modifications proactives (attendre E12)
- Pas de gestion de repos externes
- Pas de rollback automatique (l'utilisateur peut `git checkout master`)
