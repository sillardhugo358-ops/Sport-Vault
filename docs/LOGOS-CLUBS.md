# Logos des clubs

Les logos apparaissent **dans l'album** (à côté du nom du club) et **sur les cartes des joueurs** (pastilles rondes de part et d'autre de la note : drapeau à gauche, club à droite).
Un club sans logo s'affiche comme avant (aucun trou).

## Carte (mise en page du 05/10/2026)
- **Bandeau en haut** : la compétition (Ligue 1, Premier League, Serie A, Bundesliga, La Liga, Ligue des Champions, Coupe du monde, Ligue des Nations) et la saison, en grand ; le poste à droite.
- **Rangée centrale** : **drapeau rond du pays à gauche**, note au centre, **logo rond du club à droite**. Un emplacement sans image reste vide (la note reste centrée).
  Pour les sélections (Coupe du monde, Ligue des Nations), seul le drapeau est affiché.
- Plus de numéro de maillot en filigrane ni de texte de nationalité ; « FOOTVAULT » reste en petit en bas à droite.
- La compétition est **déduite** de la saison et du club (le serveur envoie dans `/api/club-logos` la table `leagues` : club → championnat ; saison « LDC … » = Ligue des Champions, année seule = Coupe du monde, AAAA-AAAA d'une sélection = Ligue des Nations). Un club inconnu n'affiche que la saison.
- **Drapeaux** : fichiers `club-logos/selection-<pays en français>.png` (ronds, 128 × 128, source flag-icons, licence MIT), 165 au total (dont Aruba, Bahreïn et Royaume-Uni ajoutés le 05/10/2026 pour les nationalités de la Ligue des Champions ; seules les Antilles néerlandaises, 2 cartes, n'ont pas de drapeau libre). Le serveur envoie `flags` (pays → fichier) et `nations` (noms anglais et codes → nom français, d'après `lib/nations.js`). Un pays sans drapeau n'affiche rien (jamais de drapeau inventé). Pour en ajouter un : un fichier `selection-<pays>.png` suffit, et une ligne dans `docs/CLUBS-LOGOS.csv`.

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
