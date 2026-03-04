---
name: facture-scanner
description: Analyse une facture ou un ticket de caisse (image envoyée dans le chat), catégorise les produits et archive les données sur Google Drive et Google Sheets. Utilise ce skill quand l'utilisateur envoie une photo de ticket/facture et dit "archive ce reçu", "scan cette facture", "utilise le skill facture", ou envoie une preuve d'achat.
---

# Facture Scanner

Transforme une facture (image dans le contexte visuel) en données structurées archivées sur Drive et Sheets.

## Étape 1 — Extraction depuis l'image

Depuis l'image reçue, extraire :
- **Enseigne** (ex: Carrefour, Lidl, Amazon)
- **Date d'achat** (format YYYY-MM-DD)
- **Montant total TTC**
- **Liste des produits** : libellé, prix unitaire, quantité

## Étape 2 — Archivage Drive

1. Chercher si le dossier `Factures` existe avec `mcp_google-workspace__search_drive_files` (query: `name = 'Factures' and mimeType = 'application/vnd.google-apps.folder'`)
2. Si absent, créer la hiérarchie avec `mcp_google-workspace__create_drive_folder` (créer `Factures`, puis `YYYY`, puis `MM` en utilisant le parentId retourné à chaque étape)
3. Uploader l'image avec `mcp_google-workspace__create_drive_file` :
   - `name` : `YYYY-MM-DD - [Enseigne] - [Total]€.jpg`
   - `parent_folder_id` : l'ID du dossier MM
   - `content` : contenu base64 de l'image
4. Obtenir le lien avec `mcp_google-workspace__get_drive_shareable_link`

## Étape 3 — Google Sheets

### Trouver ou créer le spreadsheet

Chercher avec `mcp_google-workspace__search_drive_files` (query: `name = 'Suivi Dépenses Makilab' and mimeType = 'application/vnd.google-apps.spreadsheet'`).

Si absent : créer avec `mcp_google-workspace__create_spreadsheet` (title: "Suivi Dépenses Makilab"). Mémoriser le spreadsheet ID.

### Initialiser les onglets si nécessaire

Lire avec `mcp_google-workspace__read_sheet_values` (spreadsheet_id, range: `Sheet1!A1:G1`). Si vide, écrire les headers via `mcp_google-workspace__modify_sheet_values` :

- Onglet par défaut renommé **Historique Factures** : `ID Facture | Date Achat | Enseigne | Montant Total TTC | Lien Drive | Tags`
- Créer un 2e onglet **Détails Produits** avec `mcp_google-workspace__create_sheet`, puis écrire headers : `ID Facture | Produit | Prix Unitaire | Quantité | Montant Ligne | Catégorie | Date`

### Matching catégories

Lire la colonne Catégorie existante dans Détails Produits avec `mcp_google-workspace__read_sheet_values` pour connaître les catégories déjà utilisées. Assigner chaque produit à la catégorie la plus proche, ou créer une nouvelle si aucune ne convient.

### Écrire les données

Utiliser `mcp_google-workspace__modify_sheet_values` (valueInputOption: `USER_ENTERED`) pour ajouter :

1. Une ligne dans **Historique Factures** (range: `Historique Factures!A:F`)
2. Une ligne par produit dans **Détails Produits** (range: `Détails Produits!A:G`)

L'ID Facture est `YYYY-MM-DD-[Enseigne]` (ex: `2026-03-04-Carrefour`).

## Étape 4 — Notification

Envoyer via `whatsapp__send` :
```
Analyse terminée ! 🧾 [Enseigne] ([Total]€). Facture archivée : [Lien Drive]
```

## Format de réponse final

Résumer dans le chat :
1. **Archivage Drive** : nom du fichier + lien cliquable
2. **Catégories matchées** : liste produit → catégorie
3. **Sheets** : nombre de lignes ajoutées + lien spreadsheet

## Notes importantes

- **Chaque appel MCP google-workspace requiert `user_google_email: "d4rkxbow@gmail.com"`** — sans ce paramètre, tous les appels échouent avec "Missing required argument"
- `modify_sheet_values` sert à écrire ET ajouter (pas d'outil `append` séparé) — utiliser une plage ouverte comme `Historique Factures!A:F` pour ajouter après les données existantes
- `create_drive_file` prend un `parent_folder_id` (ID, pas chemin) — toujours créer les dossiers d'abord et récupérer leur ID
- Les outils Drive write nécessitent `drive:full` dans les permissions MCP (déjà configuré)
