# Inventaire du dossier `data/`

État au 29/09/2026. Seuls trois fichiers sont lus par le code.

## Utilisés par l'application

| Fichiers | Contenu | Lu par |
|---|---|---|
| `footmercato_catalog_0.b64`, `_1`, `_2` | Catalogue Ligue 1 2026-2027 : **478 cartes**, JSON compressé zlib puis base64, découpé en 3 morceaux à concaténer dans l'ordre | `server.js` (`loadFootMercatoCatalog`) et `scripts/import-ligue1-2026-27.js` |

**Ne pas supprimer ni renommer** : si le chargement échoue, le serveur retombe sur 24 cartes fictives.

## Supprimés le 29/09/2026

Anciennes versions du catalogue 2026-2027 (350 cartes, `ligue1-2026-2027.*`) et `l1v4.part*` : non lues par le code, remplacées par le catalogue de 478 cartes. Récupérables dans l'historique Git (commit `6224d57`).

## Non utilisés : historique Ligue 1 2010-2025

| Fichiers | Contenu constaté |
|---|---|
| `ligue1-historical-2010-2025.b64`, `ligue1-historical-2010-2025.part0.b64` | Non décodables en l'état |
| `ligue1-historical-2010-2025.br.part01…part08` (+ sous-morceaux `01.1`–`01.4`, `01a`–`01d`, `05.1`–`05.4`) | Probablement brotli découpé ; aucune combinaison testée ne se décompresse. Les sous-morceaux ne recomposent pas `part01` à l'identique |

Aucun code ne lit ces fichiers. L'historique se charge par la route protégée `POST /api/internal/historical-import` (jeton `HISTORICAL_IMPORT_TOKEN`), qui reçoit les cartes dans le corps de la requête. Le script qui l'appelait n'est pas dans le dépôt. **Constaté dans une sauvegarde de production du 27/09/2026** : 6 938 cartes dans `catalog_cards` et 27 saisons dans `competition_seasons` — l'historique est donc déjà importé en production, indépendamment de ces fichiers.

## Décision à prendre

- Historique : les données sont déjà en base de production. Les fichiers présents semblent incomplets ; les supprimer seulement après une sauvegarde récente de la base et si la source d'origine (CSV, tableur) est conservée ailleurs.
