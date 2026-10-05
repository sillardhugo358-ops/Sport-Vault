# Qualité des données du catalogue

Audit du 29/09/2026 sur la sauvegarde de production (6 938 cartes, saisons 2010-2011 à 2026-2027). Rien n'a été corrigé sans source fiable, sauf le poste LM et le verrouillage des cartes spéciales.

## Corrigé automatiquement (migration `rarity-scale-lm-2026-09-29`)

| Problème | Cartes | Action |
|---|---|---|
| Rareté hors barème | 4 (« R. Mater », Valenciennes : `fv-h-2010-2011-00652`, `fv-h-2011-2012-00463`, `fv-h-2012-2013-00523`, `fv-h-2013-2014-00398`) | Gardées comme **cartes spéciales** : `rarity_locked = true`, rareté inchangée |
| Poste `LM` hors liste officielle | 7 (Lesoimier, Rothen ×2, Darbion, Roudet ×3 ; saisons 2011 à 2014) | Converti en `LW` |

Depuis ce changement, la rareté de toute carte non spéciale est calculée par le serveur depuis la note générale (`lib/rarity.js`), à la création, à la modification et à l'import.

## À compléter (source nécessaire)

### Nationalités vides : 2 136 cartes

| Saison | Cartes | Sans nationalité |
|---|---|---|
| 2010-2011 | 683 | 480 |
| 2011-2012 | 486 | 317 |
| 2012-2013 | 551 | 316 |
| 2013-2014 | 410 | 230 |
| 2014-2015 | 356 | 295 |
| 2015-2016 | 369 | 303 |
| 2026-2027 | 478 | 195 |

Les saisons 2016-2017 à 2025-2026 sont complètes.

**Ligue des Champions (mise à jour du 05/10/2026)** : nationalités complétées depuis le classeur fourni par le propriétaire (`scripts/apply-ldc-nationalities.py`) : 10 168 cartes remplies, 701 restent vides sur 21 446 (saisons 2024-25 et 2025-26 absentes du classeur, 297 lignes « à vérifier » vides dans le classeur). 154 cartes ont une nationalité différente de celle du classeur : elles sont **gardées** et listées dans `NATIONALITES-LDC-CONFLITS.csv` pour relecture.

### Statistiques factices : 296 cartes

Suite de valeurs croissantes de 1 en 1 (ex. 74, 75, 76, 77, 78) sur les 5 premiers attributs : valeurs de remplissage, pas des statistiques réelles.

| Saison | Gardiens concernés | Joueurs de champ concernés |
|---|---|---|
| 2017-2018 | 40 / 40 | 0 |
| 2018-2019 | 39 / 39 | 0 |
| 2019-2020 | 39 / 39 | 0 |
| 2020-2021 | 42 / 42 | 0 |
| 2021-2022 | 41 / 41 | 0 |
| 2022-2023 | 2 / 41 | 22 |
| 2023-2024 | 2 / 38 | 21 |
| 2024-2025 | 0 / 37 | 21 |
| 2025-2026 | 1 / 36 | 26 |

## Extraire les listes

À lancer dans pgAdmin (outil de requête sur `defaultdb`, base Aiven) :

```sql
-- Nationalités vides
SELECT id, season, name, club, position FROM catalog_cards
WHERE is_active AND coalesce(nation, '') = '' ORDER BY season, club, name;

-- Statistiques de remplissage (suite +1)
SELECT id, season, name, club, position, pace, shooting, passing, dribbling, defending, physical
FROM catalog_cards
WHERE is_active AND shooting = pace + 1 AND passing = pace + 2 AND dribbling = pace + 3 AND defending = pace + 4
ORDER BY season, position, name;

-- Cartes spéciales (rareté manuelle)
SELECT id, season, name, rarity, ovr FROM catalog_cards WHERE rarity_locked ORDER BY season;
```

Un fichier source (tableur, CSV) permettra d'écrire un import contrôlé : colonnes, encodage, doublons, aperçu avant écriture.

## Attributs des gardiens

Les 6 attributs des gardiens réutilisent les colonnes des joueurs de champ ; seul l'affichage change (`cardStatDefinitions` dans `app.js`) :

| Attribut gardien | Colonne |
|---|---|
| PLG — Plongeon | `shooting` |
| JEU — Jeu à la main | `passing` |
| DÉG — Dégagement | `dribbling` |
| RÉF — Réflexes | `defending` |
| VIT — Vitesse | `pace` |
| POS — Placement | `physical` |
