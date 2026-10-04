# Inventaire du dossier `data/`

État au 29/09/2026. Tous ces fichiers ont été ajoutés en une seule fois (commit `6224d57`). Seuls trois sont lus par le code (plus `europe-2010-2027.json.gz`, ajouté le 29/09/2026) ; les autres n'ont été ni supprimés ni modifiés en attendant une décision.

## Utilisés par l'application

| Fichiers | Contenu | Lu par |
|---|---|---|
| `footmercato_catalog_0.b64`, `_1`, `_2` | Catalogue Ligue 1 2026-2027 : **478 cartes**, JSON compressé zlib puis base64, découpé en 3 morceaux à concaténer dans l'ordre | `server.js` (`loadFootMercatoCatalog`) et `scripts/import-ligue1-2026-27.js` |

| `europe-2010-2027.json.gz` | Premier League, LaLiga, Serie A, Bundesliga, saisons 2010-2011 à 2026-2027 : **43 781 cartes**, JSON compressé gzip. Généré depuis le classeur `cartes_FIFA_2010-11_a_2026-27.xlsx` (postes convertis en codes officiels, statistiques des gardiens rangées dans les colonnes communes, codes pays convertis en noms, première nationalité seulement) | `scripts/import-europe.js`, lancé au démarrage par `ligue1-launcher.js` |

| `international-2026.json.gz` | Coupe du monde 1930-2026 (12 210 cartes) et Ligue des Nations, phases finales 2019-2025 (376 cartes) : **12 586 cartes**, JSON gzip. Généré par `scripts/build-international-data.py` depuis `coupes_du_monde_effectifs_notes.xlsx` et `ligue_des_nations_effectifs_notes.xlsx` (notes de la Ligue des Nations conservées ; notes de la Coupe du monde relevées par la courbe `LIFT` du script — 54→64, 66→75, 78→84, 88→90, 92→92, inchangé au-delà, ordre des joueurs conservé : médiane 66 → 75, Common 89 % → 64 %, max 98 ; gardiens rangés dans les colonnes communes ; DF/MF/FW → CB/DM-CM-AM/ST ; âge négatif → valeur absolue) | `scripts/import-international.js`, lancé au démarrage par `ligue1-launcher.js` après l'import Europe |

Import international : identifiants stables `fv-w-…` (Coupe du monde) et `fv-n-…` (Ligue des Nations), même mécanisme que l'import Europe. Ces cartes sont réservées à leurs packs dédiés et aux pools manuels (jamais dans les packs génériques, ni en cadeau de bienvenue, ni dans les cartes à la une de l'accueil). Annulation : `UPDATE catalog_cards SET is_active=false WHERE id LIKE 'fv-w-%' OR id LIKE 'fv-n-%';`

| `ldc-1991-2026.json.gz` | Ligue des Champions, saisons 1991-92 à 2025-26 : **21 446 cartes**, 160 clubs, JSON gzip. Généré par `scripts/build-ldc-data.py` depuis `LDC_Joueurs_cartes_1991-92_2023-24.xlsx` (onglets Participations et Clubs-Saisons ; notes et statistiques du classeur conservées, max 97 ; gardiens rangés dans les colonnes communes ; DF/MF/FW → CB/DM-CM-AM/ST selon le premier poste listé ; noms de clubs ramenés à un nom unique ; nationalité reprise des championnats quand le nom du joueur n'en a qu'une, sinon vide : 49 % des cartes) | `scripts/import-ldc.js`, lancé au démarrage par `ligue1-launcher.js` après l'import international |

Import Ligue des Champions : identifiants stables `fv-c-…`, saison des cartes « LDC 1991-92 » (distincte des saisons de championnat pour que l'album ne mélange pas la carte de Ligue des Champions et la carte de championnat d'un même joueur et d'un même club), rareté par le barème officiel (pas celle du classeur). Même exclusion que la Coupe du monde : ni packs génériques, ni cadeau de bienvenue, ni cartes à la une de l'accueil ; seulement le pack dédié et les pools manuels. Annulation : `UPDATE catalog_cards SET is_active=false WHERE id LIKE 'fv-c-%';`

Relèvement léger des notes (04/10/2026, choix du propriétaire) : `scripts/lift-ldc-ratings.py` relève les notes par une courbe croissante par segments (54→58, 66→70, 78→80, 88→89, 92→92 ; au-dessus de 92 rien ne bouge ; en dessous de 54, +4), ordre des joueurs conservé, statistiques mises à l'échelle (bornées 1..99). Médiane 73 → 76 ; Common 66,0 % → 55,2 %, Rare 18,5 % → 23,0 %, Epic 12,3 % → 17,4 %, Legendary 1,9 % → 2,9 %, Icon 1,4 % inchangé. 20 753 cartes montent, aucune ne baisse ; les identifiants ne dépendent pas des notes et restent identiques. La note d'origine est gardée en 15e colonne (`ovrOrig`) et la courbe dans la clé `lift` du fichier ; le script refuse de rejouer. Après une régénération depuis le classeur (`build-ldc-data.py`), relancer ce script. Annulation : `git revert` du commit qui modifie `data/ldc-1991-2026.json.gz` (les exemplaires déjà possédés suivent à l'import suivant).

Club corrigé (04/10/2026) : « FC Kosicee » (faute du classeur) est devenu « FC Košice ». L'identifiant d'une carte reste calculé avec l'ancien nom (`LEGACY_CLUB_NAMES` dans `scripts/import-ldc.js`, et `ALIAS` dans `scripts/build-ldc-data.py` pour une régénération) : les 17 cartes gardent leur identifiant, et le club déjà en base est renommé sur place par l'import (même identifiant, même logo, exemplaires resynchronisés). Annulation : `UPDATE clubs SET name='FC Kosicee' WHERE name='FC Košice';` puis `UPDATE catalog_cards SET club='FC Kosicee' WHERE club='FC Košice';` et la même chose pour `card_instances`.

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

