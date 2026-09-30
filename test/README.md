# Tests FOOTVAULT

Tests automatiques du serveur, sans dépendance supplémentaire (`node:test`).

## Lancer

Il faut un serveur PostgreSQL **de test** (13 ou plus) autorisé à créer des bases. **Jamais la base de production.**

```bash
TEST_DATABASE_URL=postgresql://postgres:motdepasse@localhost:5432/postgres npm test
```

Sous Windows (PowerShell), avec le PostgreSQL 18 installé localement :

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:<mot de passe local>@localhost:5432/postgres"
npm test
```

Chaque fichier crée une base jetable `fv_test_…`, démarre son propre serveur, puis supprime la base à la fin. La CI GitHub fait de même avec un conteneur PostgreSQL 18.

## Contenu

| Fichier | Ce qui est vérifié |
|---|---|
| `account.test.js` | Santé du serveur, inscription (bonus de départ, limite par IP, validations), connexion, routes protégées, inscriptions simultanées |
| `packs.test.js` | Prix, nombre de cartes et garantie de rareté des 3 packs, solde insuffisant, ouvertures simultanées, tirage de pool |
| `rewards.test.js` | Bonus quotidien, missions et tâches : jamais attribués deux fois, même en rafale ; déverrouillage progressif |
| `auctions.test.js` | Durées autorisées, palier +10 %, anti-sniping, réservation des FC, règlement, annulation, retrait, enchères simultanées |
| `periods.test.js` | Minuit et lundi heure de Paris (y compris changements d'heure), calcul du palier d'enchère |
| `catalog.test.js` | Rareté imposée par le barème à la création et à la modification, cartes spéciales, migration (verrouillage, LM → LW) au redémarrage |
| `rarity.test.js` | Seuils du barème officiel |
| `client-ip.test.js` | Détermination de l'IP du client selon le réglage du proxy |
| `bootstrap.test.js` | Premier compte admin créé au démarrage (`ADMIN_EMAILS`, `ADMIN_BOOTSTRAP_PASSWORD`), promu créateur au redémarrage |
| `europe-import.test.js` | Fichier des 4 championnats (postes, barème, attributs des gardiens), import sans doublon, carte désactivée respectée, synchro Ligue 1 sans impact, résumé de l'accueil, packs par compétition et par décennie |
| `admin.test.js` | Console admin : accès refusé aux joueurs, lectures, ajout de FC et don de carte tracés, bannissement, modification d'un pack |
| `routes.test.js` | Tour de toutes les routes de l'API : réponses attendues, accès refusés, import interne protégé, chemin inconnu |
| `missions.test.js` | Missions en base (reprise à l'identique), éditeur admin : droits, identifiant généré sans doublon, modification, validation (boucle, prérequis inconnu, récompense nulle), désactivation, chaîne jamais bloquée |
| `static.test.js` | Fichiers servis : l'interface et les polices (`fonts/*.woff2`) oui ; code serveur, `lib/`, `data/`, configuration et `.git/` jamais, même avec `..` dans le chemin |
| `achievements.test.js` | Éditeur de succès : droits, identifiant généré sans écrasement, modification, nom en double, validation par champ, désactivation, suppression tracée, récompenses conservées |
| `shop.test.js` | Pack sans carte éligible : message clair (409), rien débité ; éditeur refusant un pack ou un pool impossible à tirer ; composition des pools manuels respectée au tirage |
| `nations.test.js` | Nationalités en français : correspondance, import européen, migration au redémarrage (catalogue et exemplaires), saisie admin normalisée |
| `competitions.test.js` | Compétitions, saisons et clubs : droits du Créateur, création, doublons, modification persistée, logo, rattachement aux saisons, renommage répercuté sur les cartes, suppressions tracées |
| `tasks.test.js` | Tâches quotidiennes et hebdomadaires en base : reprise à l'identique, droits, identifiant généré, récupération par un joueur, modification en cours de période sans double récompense, validation, désactivation (dernière tâche active protégée), conservation au redémarrage |
| `admin-cards.test.js` | Catalogue admin paginé : droits, pages de 50 cartes sans doublon ni oubli, page bornée, filtres combinés, recherche sans accents, caractères spéciaux, exemplaires et détenteurs, résumé, cartes désactivées exclues |
| `notifications.test.js` | Notifications : surenchère (le joueur dépassé seulement), enchère remportée, vendue, invendue (une seule fois), récompenses disponibles, lecture partielle puis totale, cloisonnement entre joueurs |
| `profile.test.js` | Profil joueur : accès connecté, identité et niveau, collection recoupée avec la base, historique lisible (bienvenue, pack, bonus, vente, achat) sans référence technique ni donnée privée, cloisonnement |
| `health.test.js` | `/api/health` : version déployée, démarrage, base joignable, aucune adresse exposée ; durée de session lue dans `SESSION_TTL_DAYS` (cookie et base), bornes |
| `leaderboard.test.js` | Classement : barème par rareté, doublons ignorés, dons de l'admin et comptes bannis exclus, classement de la semaine, égalités, accès public sans identifiant ni e-mail |
| `album-rewards.test.js` | Albums par championnat : complétion par saison et par championnat (clubs sans cartes ignorés), récompenses refusées si incomplet, versées une seule fois même en rafale, journalisées, visibles au profil |
| `ligue1-history.test.js` | Saisons historiques de Ligue 1 : migration au démarrage (saisons créées, clubs existants réutilisés via les alias, clubs manquants créés, aucun doublon), idempotence, visibles dans l'album et tirables dans le Pack Ligue 1 |
| `ledger.test.js` | Journal des FOOTCOINS : inscription, packs, bonus, ajustement admin, enchère réglée ; rien en cas de refus ; journal toujours égal au solde, même en rafale. Statistiques admin : droits, période bornée, chiffres recoupés avec la base |
| `game-config.test.js` | Cohérence de la configuration du jeu : chaîne des missions, packs, tâches, succès |

## Tests navigateur

```bash
TEST_DATABASE_URL=postgresql://postgres:motdepasse@localhost:5432/postgres npm run test:browser
```

`test/browser/ui.test.js` ouvre le site dans Chromium (`playwright-core`) à 1280, 900 et 390 px de large : les 10 pages (accueil, collection, album, packs, Vault, profil, succès, market, classement, admin) s'affichent sans erreur JavaScript ni débordement horizontal ; le menu mobile, la cloche de notifications et le renvoi vers la connexion des pages privées sont vérifiés. Chromium : variable `CHROMIUM_PATH`, sinon `npx playwright-core install chromium` (fait par la CI).

## Fichiers techniques

- `helpers.js` : base jetable, démarrage et redémarrage du serveur, client HTTP avec cookie de session. Chaque joueur de test a sa propre IP (en-tête `X-Forwarded-For`), car le serveur limite les inscriptions par IP.
