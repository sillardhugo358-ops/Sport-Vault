# Logos des clubs

Les logos apparaissent **dans l'album** (à côté du nom du club) et **sur les cartes des joueurs** (pastille ronde à droite de la note).
Un club sans logo s'affiche comme avant (aucun trou).

## Procédure
1. Réunir les images (JPG, PNG ou WEBP) dans un dossier. **Nom du fichier = nom du club** tel qu'il figure dans
   `docs/CLUBS-LOGOS.csv` (colonne « nom »), par exemple `Paris Saint-Germain.jpg`. L'accent, la casse et la ponctuation
   n'ont pas d'importance ; un suffixe « logo » ou « (1) » est toléré. On peut aussi nommer le fichier avec l'identifiant (colonne « id »).
2. Transmettre le dossier (ou les images) à Claude, qui lance
   `DATABASE_URL=… node scripts/import-club-logos.js <dossier> --dry-run` (rapport : reconnus, non reconnus, clubs encore sans logo),
   puis sans `--dry-run` : les fichiers sont copiés vers `club-logos/<id du club>.jpg`.
3. Les images sont commitées dans le dépôt (`club-logos/`) ; au démarrage du serveur, `scripts/sync-club-logos.js` rattache chaque
   fichier à son club (`clubs.logo_url`) **seulement si le club n'a pas déjà un logo** (un logo choisi dans la console admin est conservé).
4. Pour remplacer un logo : même nom de fichier avec `--force`, ou le modifier dans la console admin.

## Conseils d'image
- Fond transparent (PNG) ou fond blanc : la pastille est blanche, le logo est affiché en entier (non rogné).
- Carré ou presque, 200 × 200 px suffisent (la pastille fait environ 17 % de la largeur d'une carte).

## Annulation
`UPDATE clubs SET logo_url=NULL WHERE logo_url LIKE 'club-logos/%';` retire tous ces logos de l'affichage (les fichiers restent dans le dépôt).
