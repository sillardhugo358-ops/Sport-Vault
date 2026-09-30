# FOOTVAULT — SPORT VAULT

**COLLECT THE GAME.**

Plateforme de cartes à collectionner consacrée au football : collection par saison, albums par club, ouverture de packs, enchères, missions et succès. Interface unique, mobile-first.

Production : https://sport-vault.onrender.com

## Fonctionnalités

- Comptes et sessions côté serveur, avec limites anti-abus à l'inscription et à la connexion
- 1 000 FOOTCOINS + 50 GEMS à la création du compte, cartes de bienvenue
- Catalogue : Ligue 1 (2010-2011 à 2026-2027), Premier League, LaLiga, Serie A et Bundesliga (2010-2011 à 2026-2027) — **50 719 cartes**, 5 raretés (Common, Rare, Epic, Legendary, Icon)
- Collection personnelle et album par club, avec récompense d'album
- Packs Starter, Pro et Legend, packs par compétition (Ligue 1, Premier League, La Liga, Serie A, Bundesliga) et par décennie (années 2010, années 2020) : tirages et garanties de rareté côté serveur ; pools de cartes
- Missions déverrouillables (éditables dans la console admin), tâches quotidiennes et hebdomadaires (heure de Paris), bonus quotidien
- Succès et progression (XP, niveaux)
- Market : enchères avec palier minimal de +10 % et prolongation d'une minute pour une enchère dans les 30 dernières secondes
- Console d'administration : utilisateurs, cartes, compétitions et clubs, packs, marché, journaux, succès

## Architecture

| Élément | Détail |
|---|---|
| Serveur | Node.js ≥ 18, module `http` natif, sans framework — `server.js` (démarrage, fichiers statiques), `lib/routes/` (routes de l'API par domaine), `lib/` (configuration du jeu, périodes, règles d'enchères, barème des raretés, IP client, schéma de la base, comptes et sessions, cartes et packs, récompenses et progression, enchères, administration, réponses HTTP) |
| Interface | SPA en JavaScript vanilla, navigation par hash — `index.html`, `app.js`, `styles.css` |
| Base | PostgreSQL hébergé sur Aiven (voir [SAUVEGARDE.md](docs/SAUVEGARDE.md)). Tables, données de départ et migrations au démarrage : `lib/schema.js` (`initDb`) |
| Démarrage | `ligue1-launcher.js` lance `server.js` puis synchronise le catalogue : Ligue 1 2026-2027 (`scripts/import-ligue1-2026-27.js`), puis les 4 championnats européens (`scripts/import-europe.js`, sauté si déjà à jour) |

Le navigateur n'est jamais la source de vérité : soldes, sessions, cartes et récompenses sont gérés par le serveur. Sans `DATABASE_URL`, le serveur fonctionne en mémoire (données perdues à l'arrêt) ; en production il refuse de démarrer sans base.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000.

Variables d'environnement utiles :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL (sinon mode mémoire). Pour Aiven, terminer par `?sslmode=no-verify` |
| `PORT` | Port HTTP (3000 par défaut) |
| `ADMIN_EMAILS` | E-mails des comptes administrateurs, séparés par des virgules |
| `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD` | Création du premier compte administrateur |
| `HISTORICAL_IMPORT_TOKEN` | Jeton de la route d'import de l'historique Ligue 1 |
| `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` | Détermination de l'IP réelle du joueur derrière le proxy (limites d'inscription et de débit). En production : `CLIENT_IP_HEADER=cf-connecting-ip` (Cloudflare devant Render). Sans réglage, un client peut falsifier son IP. Voir `lib/client-ip.js` et la route admin `/api/admin/ip-debug` |

## Contrôles

La CI GitHub (`.github/workflows/check.yml`) vérifie la syntaxe de `server.js` et `app.js`, signale tout identifiant non déclaré (`npm run check`), puis lance `npm test` : 98 tests sur une base PostgreSQL jetable (comptes, packs, récompenses, enchères, périodes, import du catalogue). Mode d'emploi : [test/README.md](test/README.md).

## Documentation

- [Point de départ et feuille de route](docs/POINT-DE-DEPART.md)
- [Sauvegarde et restauration de la base](docs/SAUVEGARDE.md)
- [Inventaire du dossier data/](data/README.md)
- [Qualité des données du catalogue](docs/QUALITE-DONNEES.md)
