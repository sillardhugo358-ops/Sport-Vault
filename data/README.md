# Inventaire du dossier `data/`

État au 29/09/2026. Tous ces fichiers ont été ajoutés en une seule fois (commit `6224d57`). Seuls trois sont lus par le code (plus `europe-2010-2027.json.gz`, ajouté le 29/09/2026) ; les autres n'ont été ni supprimés ni modifiés en attendant une décision.

## Utilisés par l'application

| Fichiers | Contenu | Lu par |
|---|---|---|
| `footmercato_catalog_0.b64`, `_1`, `_2` | Catalogue Ligue 1 2026-2027 : **478 cartes**, JSON compressé zlib puis base64, découpé en 3 morceaux à concaténer dans l'ordre | `server.js` (`loadFootMercatoCatalog`) et `scripts/import-ligue1-2026-27.js` |

| `europe-2010-2027.json.gz` | Premier League, LaLiga, Serie A, Bundesliga, saisons 2010-2011 à 2026-2027 : **43 781 cartes**, JSON compressé gzip. Généré depuis le classeur `cartes_FIFA_2010-11_a_2026-27.xlsx` (postes convertis en codes officiels, statistiques des gardiens rangées dans les colonnes communes, codes pays convertis en noms, première nationalité seulement) | `scripts/import-europe.js`, lancé au démarrage par `ligue1-launcher.js` |

**Ne pas supprimer ni renommer** : si le chargement échoue, le serveur retombe sur 24 cartes fictives.

Import Europe : identifiants stables `fv-e-…`, relance sans doublon, import sauté tant que le fichier ne change pas (table `data_imports`). Pour publier une nouvelle version du classeur : régénérer ce fichier, pousser, redéployer.

## Non lus par le code : versions du catalogue 2026-2027 (350 cartes)

Fichiers source 2026-2027. **À conserver** (décision du 29/09/2026).

| Fichiers | Contenu constaté |
|---|---|
| `ligue1-2026-2027.excel.json` | JSON lisible, 350 cartes |
| `ligue1-2026-2027.catalog.json` | 350 cartes (champ `cards` en zlib + base64) |
| `ligue1-2026-2027.part1.b64` + `part2.v2` + `part3.v2` + `part4.v2` + `part5.v2` | 350 cartes une fois concaténés |
| `ligue1-2026-2027.part2.b64`, `part3.b64`, `part4.b64` | Première version des morceaux, non décodable telle quelle |
| `ligue1-2026-2027.v3.b64`, `ligue1-2026-2027.corrected.b64` | Non décodables en l'état (format inconnu ou incomplet) |
| `l1v4.part1.b64` à `part4.b64` | Non décodables une fois concaténés |

## Non utilisés : historique Ligue 1 2010-2025

| Fichiers | Contenu constaté |
|---|---|
| `ligue1-historical-2010-2025.b64`, `ligue1-historical-2010-2025.part0.b64` | Non décodables en l'état |
| `ligue1-historical-2010-2025.br.part01…part08` (+ sous-morceaux `01.1`–`01.4`, `01a`–`01d`, `05.1`–`05.4`) | Probablement brotli découpé ; aucune combinaison testée ne se décompresse. Les sous-morceaux ne recomposent pas `part01` à l'identique |

Aucun code ne lit ces fichiers. L'historique se charge par la route protégée `POST /api/internal/historical-import` (jeton `HISTORICAL_IMPORT_TOKEN`), qui reçoit les cartes dans le corps de la requête. Le script qui l'appelait n'est pas dans le dépôt. **Constaté dans une sauvegarde de production du 27/09/2026** : 6 938 cartes dans `catalog_cards` et 27 saisons dans `competition_seasons` — l'historique est donc déjà importé en production, indépendamment de ces fichiers.

## Décision à prendre

- Historique : les données sont déjà en base de production. Les fichiers présents semblent incomplets ; les supprimer seulement après une sauvegarde récente de la base et si la source d'origine (CSV, tableur) est conservée ailleurs.

## Import du classeur des quatre championnats

Le classeur `cartes_FIFA_2010-11_a_2026-27.xlsx` est importé par `scripts/import-europe.js` depuis `europe-2010-2027.json.gz` (voir plus haut), automatiquement au démarrage. L'ancien script manuel `scripts/import-four-leagues.js` a été retiré le 30/09/2026 : ses identifiants (`fv-pl-…`) et sa compétition `laliga` auraient dupliqué les 43 781 cartes déjà importées.

