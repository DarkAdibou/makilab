---
name: facture-scanner
description: Analyse une facture (image, PDF ou texte), catégorise les produits intelligemment et archive les données sur Google Drive et Sheets. Utilise quand l'utilisateur dit "Archive ce reçu", "Scan cette facture Carrefour" ou envoie une preuve d'achat.
---

# Facture Scanner (v4 - Ultra-Traçabilité)

Ce skill transforme une facture brute en données structurées, classées et archivées avec une traçabilité totale entre Drive et Sheets.

## 1. Déclenchement & Intent
Le skill s'active dès que l'utilisateur soumet un document d'achat (image, PDF ou texte brut) avec des phrases comme :
- "Archive ce reçu"
- "Scan cette facture Carrefour"
- "Analyse mes dépenses de hier"

## 2. Le Cerveau (Matching & Catégorisation)
Avant d'indexer les données, l'agent doit assurer la cohérence des catégories :
1. **Synchronisation du Référentiel** : Lire l'onglet "Catégories" ou la colonne "Catégorie" existante dans le Google Sheet "Suivi Dépenses Makilab" via `mcp_google-workspace__get_spreadsheet_values`.
2. **Classification Intelligente** : Pour chaque produit extrait (ex: "Choco Pops"), choisir la catégorie la plus proche du référentiel existant. Si aucune correspondance n'est trouvée, suggérer une nouvelle catégorie cohérente (ex: "Petit-Déjeuner").

## 3. Structure du Google Sheet
Le spreadsheet "Suivi Dépenses Makilab" doit comporter deux onglets :

### Onglet : Historique Factures
| ID Facture | Date Achat | Lieu d'achat (Enseigne) | Montant Total TTC | Lien Drive (Source) | Tags |
|------------|------------|-------------------------|-------------------|---------------------|------|

### Onglet : Détails Produits
| ID Facture (Lien) | Produit | Prix Unitaire | Quantité | Montant Ligne | Catégorie (Matchée) | Date |
|-------------------|---------|---------------|----------|---------------|---------------------|------|

## 4. Workflow Technique

### Étape 1 : Extraction
Extraire les métadonnées globales : Date, Enseigne, Montant Total TTC.

### Étape 2 : Archivage Drive
1. Créer le dossier : `Factures/[Année]/[Mois]/` (si inexistant).
2. Nommer le fichier : `YYYY-MM-DD - [Enseigne] - [Total]€.extension`.
3. Récupérer le **Lien de partage** (Shareable Link) via `mcp_google-workspace__get_drive_shareable_link`.

### Étape 3 : Parsing & Matching Categories
1. Extraire chaque ligne de produit (Libellé, PU, Quantité).
2. Lire le référentiel des catégories existantes dans le Sheet.
3. Assigner une catégorie à chaque produit.

### Étape 4 : Indexation Sheets
Écrire les données dans les deux onglets respectifs de "Suivi Dépenses Makilab".

### Étape 5 : Notification WhatsApp
Envoyer une confirmation via `whatsapp__send` :
"Analyse terminée ! 🧾 [Enseigne] ([Total]€). Facture archivée ici : [Lien Drive]"

## 5. Outils Utilisés
- `mcp_google-workspace` : Drive (création dossier, upload, lien shareable), Sheets (lecture catégories, écriture lignes).
- `whatsapp` : Notification finale.
- `capture__classify` : Pour la détection initiale du type "invoice".
