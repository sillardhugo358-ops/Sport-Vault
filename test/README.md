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
| `static.test.js` | Fichiers servis : l'interface oui ; code serveur, `lib/`, `data/`, configuration et `.git/` jamais, même avec `..` dans le chemin |
| `achievements.test.js` | Éditeur de succès : droits, identifiant généré sans écrasement, modification, nom en double, validation par champ, désactivation, suppression tracée, récompenses conservées |
| `shop.test.js` | Pack sans carte éligible : message clair (409), rien débité ; éditeur refusant un pack ou un pool impossible à tirer ; composition des pools manuels respectée au tirage |
| `nations.test.js` | Nationalités en français : correspondance, import européen, migration au redémarrage (catalogue et exemplaires), saisie admin normalisée |
| `game-config.test.js` | Cohérence de la configuration du jeu : chaîne des missions, packs, tâches, succès |

## Fichiers techniques

- `helpers.js` : base jetable, démarrage et redémarrage du serveur, client HTTP avec cookie de session. Chaque joueur de test a sa propre IP (en-tête `X-Forwarded-For`), car le serveur limite les inscriptions par IP.
