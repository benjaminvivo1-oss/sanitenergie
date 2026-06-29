# SANITENERGIE — Générateur de devis & factures PDF

Génère de vrais fichiers PDF conformes à la réglementation française, téléchargeables immédiatement.

## Installation

```bash
cd sanitenergie-devis
npm install
npx playwright install chromium
node server.js
```

Ouvrir : http://localhost:3000

## Utilisation

1. **Nouveau document** → remplir client + lignes → cliquer "Générer le PDF" → le PDF se télécharge
2. **Historique** → liste tous les documents, re-téléchargement, conversion devis → facture en 1 clic

## Configuration entreprise

Modifier `config/entreprise.json` pour changer vos infos (nom, adresse, SIRET, TVA, etc.)
Placer un logo dans `config/logo.png` pour l'afficher dans le PDF.

## Numérotation

- Devis : `DEV-2026-0001`, `DEV-2026-0002`…
- Factures : `FAC-2026-0001`, `FAC-2026-0002`…
- Persisté dans `data/compteurs.json` — jamais de doublon ni de trou

## Fichiers générés

Les PDF sont sauvegardés dans `data/pdf/` et référencés dans `data/documents.json`.

## Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/generate` | Crée un document et renvoie le PDF |
| GET | `/api/documents` | Liste tous les documents |
| GET | `/api/document/:id/pdf` | Re-télécharge un PDF |
| POST | `/api/facture-from-devis/:id` | Convertit un devis en facture |
| GET | `/api/entreprise` | Config entreprise |
