# FOOTVAULT — Fichier de reprise (état au 06/10/2026, 23 h Paris)

Ce fichier permet de reprendre le travail dans une **nouvelle session** sans perdre d'information. À lire avec `CLAUDE.md` (règles du projet) et `docs/PROMPT-REPRISE.md` (message de démarrage). Source de vérité du code : le dépôt (`main`) ; ici, le contexte, les décisions, les pièges et le reste à faire.

## 1. Où en est-on (en dix lignes)
- `main` = `361d333c152c` (PR #108). Preuves en ligne : `0573bfa13ea5` (Q2, run n°68) et `6f7c6e35e76f` (#106 + #107, run n°69, lignes « En ligne : … — main : … » lues dans le journal). **#108 (échanges) : `361d333c152c` (run n°70, ligne « En ligne : 361d333c152c — main : 361d333c152c »)** ; `/api/trades` renvoie 401 hors connexion, `fv-trades.js` 200.
- Faits depuis le rapport du 6 octobre : #104 (code d'erreur de connexion à la base), #105 **Q2** (`fv-market.js`), #106 (accessibilité : « Créer un compte » 44 px, `h1` et titre sur une page refusée), #107 **G2 sets thématiques**, #108 **G3 échanges de cartes** (détails §6).
- **Point ouvert n°1 — certificat TLS de la base** : `databaseTls = "unverified"`, variable toujours nommée `DATABASE_CA_SERT` (faute de frappe). Le renommage en `DATABASE_CA_CERT` a fait tomber le site (19 h 53–20 h 02 UTC le 06/10). **Ne jamais le refaire sans la procédure du §7.**
- **Vérifications en ligne faites (06/10, Chromium sans interface, hors connexion)** : lien d'évitement au clavier, titres, pas de débordement, `fv-admin.js` servi, 390 px. **Jamais faites (connexion requise)** : page Administration et éditeurs, Vault (bonus 150 FC, « SÉRIE : 1 JOUR »), sets et échanges avec de vrais comptes, modales au clavier connecté. Je n'ai pas créé de compte sur la production sans autorisation ; l'administration demande un compte admin fourni par le propriétaire.
- Prochaine étape : **Q3 à Q5** (découpage), puis vérifications en ligne connectées si le propriétaire autorise un compte jetable.
- Le réseau est ouvert : `curl https://sport-vault.onrender.com/api/health` fonctionne depuis la session.

## 2. Règles de travail avec ce propriétaire (à respecter strictement)
1. **Répondre en français**, concis : fichiers touchés, tests lancés, actions manuelles nécessaires, limites.
2. **Ne jamais écrire « en ligne »** sans la ligne exacte lue dans le journal de `production.yml` (étape « Version déployée ») : `En ligne : <sha12> — main : <sha12>`. Distinguer : code modifié / commit poussé / PR / fusionné / déployé / en ligne.
3. **Consigne permanente : « Fusionne la PR dès que la CI est verte »** : vérifier que les **deux** contrôles `check` de la PR sont `success`, puis fusionner (squash, avec `expectedHeadSha` = SHA **complet de 40 caractères** de la tête de la PR ; un SHA tronqué est refusé), se désabonner de la PR, remettre la branche de travail sur `origin/main` (`git checkout -B <branche> origin/main` puis `git push --force-with-lease`), programmer un contrôle de production (`send_later` ≈ 6 minutes) et lancer `production.yml` (workflow_dispatch, ref `main`).
4. **Une PR par tâche**, branche de travail imposée par la session (la dernière : `claude/elegant-davinci-6c5z4w`) (ne jamais pousser ailleurs). Jamais de PR sans demande ; ici la demande est permanente pour la feuille de route. Description de PR dans le style des précédentes (Résumé / Vérifications / Annulation) + attribution demandée par la session (pied de page « Generated with Claude Code » et lien de session).
5. **Plan** : le propriétaire veut que le fichier de plan ne contienne **que le programme de modifications de la demande en cours** (pas d'historique). Le mode plan se réactive souvent : écrire le plan (une page : contexte, modifications par fichier, vérification, annulation) puis `ExitPlanMode` avant toute écriture.
6. **Preuves d'abord, pas d'hypothèse** : lire le code avant de modifier, ne pas inventer le schéma, ne pas affirmer ce qui n'a pas été mesuré. Dire ce qui n'a **pas** été vérifié (rendu sur vrais appareils, etc.).
7. **Sécurité** : aucun secret dans le dépôt ni dans le navigateur ; ne jamais afficher une valeur de `DATABASE_URL` ni de mot de passe ; aucune donnée réelle supprimée ou réinitialisée pour tester ; migrations additives, idempotentes (`app_migrations`) et annulables.
8. **Ne pas** créer de PR « docs » sans nécessité, **ne pas** spéculer sur un déploiement : lancer `production.yml` et lire.
9. Le propriétaire fournit des **fichiers/images** (classeurs xlsx, drapeaux, logos) : toujours les lire en entier avant usage ; si une image arrive « en ligne » sans fichier, demander de la renvoyer en pièce jointe.

## 3. Environnement de travail (session cloud)
- Dépôt local : `/home/user/Sport-Vault` ; scratchpad de session : `/tmp/claude-0/-home-user-Sport-Vault/<id>/scratchpad` (éphémère).
- **GitHub** : outils `mcp__github__*` (recharger avec `ToolSearch select:<noms>` ; ils se déconnectent/reconnectent souvent). Pas de CLI `gh` complète. Lecture des journaux : `actions_list list_workflow_runs` → `list_workflow_jobs` → `get_job_logs` (`return_content:true`, `tail_lines` ≈ 200 pour voir l'étape de santé ; au-delà de ~1 500 lignes le résultat est trop gros et sauvegardé dans un fichier).
- **Base de test locale** (PostgreSQL 16, port 55432) : elle **s'arrête entre deux appels Bash**. Toujours la (re)démarrer dans la même commande que les tests :
  ```bash
  rm -f /var/lib/pgtest/postmaster.pid; su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgtest -o '-p 55432 -k /tmp -c fsync=off' -l /tmp/pg.log start"; sleep 4
  export TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postgres
  ```
  Si de nombreux tests échouent d'un coup (`ECONNREFUSED 127.0.0.1:55432`, `net::ERR_CONNECTION_REFUSED`), c'est la base qui est tombée : relancer, ne pas chercher de bug.
- **Commandes** : `npm run check` (identifiants non déclarés côté serveur), `npm test` (**222** tests), `npm run test:browser` (**32** tests Playwright/Chromium `/opt/pw-browsers/chromium`), `npm run test:a11y` (**4** tests). Un job CI peut échouer sur `Unable to deserialize cloned data` (erreur interne de Node, sans assertion) : relancer **une** fois (`rerun_failed_jobs`).
- Contrôle des variables non définies côté navigateur (hors dépôt) : ESLint global (`/opt/node22/lib/node_modules/eslint`) avec une config `no-undef` et les globales du navigateur ; `acorn` (dépendance de développement du dépôt) sert à analyser `app.js`.
- Attribution des commits : suivre le rappel de la session (lignes `Co-Authored-By` et `Claude-Session`). Ne jamais mentionner le modèle dans les commits/PR autrement que par ces lignes.

## 4. Architecture (à connaître avant de modifier)
- **Serveur** : Node ≥ 18 sans framework. `ligue1-launcher.js` (démarrage : import des données puis `server.js`), `server.js` (routes, `PUBLIC_SCRIPTS`, `/api/health`), `security-bootstrap.js` (en-têtes, limites de débit, vérification d'Origin, cookie `Secure`), `lib/` (≈ 4 000 lignes : `auth`, `cards`, `rewards`, `daily-streak`, `game-config`, `periods`, `rarity`, `nations`, `db-ssl`, `schema`, `ledger`, `club-key`, `http`…), `lib/routes/*.js`.
- **Base** : PostgreSQL (Aiven en production, `DATABASE_URL`), schéma créé par `initDb()` (`lib/schema.js`) avec migrations gardées par la table `app_migrations`. Imports de données au démarrage (checksum dans `data_imports`) : `scripts/import-*.js`, fichiers `data/*.json.gz`.
- **Front** : SPA sans bundler. `index.html` charge `fonts.css`, `styles.css`, `cards-v4.css` puis les scripts, chacun avec un `?v=` à changer à chaque modification (cache long `immutable`). `app.js` (IIFE `FV`, routeur par hash, `render()`, `bind()`) + **espace de noms `window.FVC`** :
  - `FVC.pages` : une fonction par page (`home, collection, packs, vault, profil, classement, successes, album, card, auth, market, admin`) ; `render()` appelle `FVC.pages[route]`, lien inconnu = accueil ;
  - `FVC.core` : aides partagées (`state, $, app, esc, money, initials, api, render, toast, setModal, closeModal, cardMarkup, auctionDialog, cardStatDefinitions`) ;
  - `fv-admin.js` (Q1, 93 Ko) : page admin + éditeurs cartes/packs/pools/compétitions/saisons/clubs/joueurs ; expose `FVC.admin.*` à `bind()` ;
  - autres scripts : `market-insights.js`, `notifications-bell.js`, `admin-stats.js`, `achievement-admin-editor.js`, `mission-admin-editor.js`, `task-admin-editor.js`, `challenge-admin-editor.js` (montés par `window.mountX` depuis `bind()`).
  - **Tout nouveau script** : ajouter son nom dans `PUBLIC_SCRIPTS` (`server.js`) **et** une balise `<script>` dans `index.html` (après `app.js`, avant les scripts qui l'utilisent), avec `?v=`.
- **Tests** : `test/*.test.js` (serveur, base jetable `fv_test_…` par fichier, helpers dans `test/helpers.js`), `test/browser/*.test.js` (UI), `test/browser/a11y-rules.js` + `a11y-baseline.json` (cliquet : le nombre de défauts ne peut pas augmenter ; mise à jour par `A11Y_UPDATE=1`, **uniquement base active**, sinon la base écrite est vide ; règle des cibles tactiles tolérante à 10 %).
- **Rareté** : `lib/rarity.js` (`rarityFromOvr`, `RARITY_SQL`) — < 78 Common, 78–83 Rare, 84–89 Epic, 90–91 Legendary, ≥ 92 Icon ; exception `catalog_cards.rarity_locked`. Attributs gardiens réutilisent les colonnes communes (voir `CLAUDE.md`).
- **Hébergement** : Render offre gratuite (512 Mo, mise en veille, démarrage à froid ≈ 1 minute), `render.yaml` (`DATABASE_URL` et `DATABASE_CA_CERT` en `sync:false`). Mémoire mesurée en ligne : 182–183 Mo (run n°49), 102 Mo (run n°64).
- **`/api/health`** : `ok, ready, version, commit, startedAt, uptimeSeconds, storage, database{ok,latencyMs}, databaseTls, databaseTlsDiagnostic (si non verified), universe, cards, packs, memory{rss,heapUsed,heapTotal,external}, timestamp`. `etat.html` est la page publique « état du site ».
- **`production.yml`** (« Production (surveillance) », toutes les 6 h et à la demande) : étape « Santé du serveur et de la base » (attend 5 min max le serveur et la base ; journalise base, catalogue, TLS, diagnostic, mémoire), « Pages et fichiers protégés », « Version déployée » (ligne `En ligne : …`).

## 5. Données du catalogue (repères)
- **84 751 cartes** actives : Europe (championnats, 43 781 cartes dans le fichier), Ligue des Champions 1991-92 → 2025-26 (**21 446** cartes, ids `fv-c-…`), Coupe du monde (**12 210**, ids `fv-w-…`, 1930 → 2026, notes relevées par une courbe « moyenne », médiane 66 → 75), Ligue des Nations (**376**, ids `fv-n-…`). Les cartes internationales et LDC n'entrent **pas** dans les packs génériques ni le cadeau de bienvenue (anti-dilution) : packs dédiés seulement.
- **Notes LDC** relevées légèrement (#78 : médiane 73 → 76, notes ≥ 92 intactes) ; script `scripts/lift-ldc-ratings.py`.
- **Nationalités LDC** (#90) : 10 168 renseignées depuis le classeur du propriétaire (`scripts/apply-ldc-nationalities.py <xlsx> [--dry-run]`), seulement les vides, noms français via `lib/nations.js` ; **154 conflits** gardés tels quels (`docs/NATIONALITES-LDC-CONFLITS.csv`, à relire par le propriétaire) ; reste **701 cartes (2024-25, 2025-26)** et 297 lignes « à vérifier » sans nationalité.
- **Logos et drapeaux** : dossier `club-logos/` (PNG 128 px détourés, ≈ 375 fichiers dont 166 drapeaux `selection-<slug>.png`) ; `/api/club-logos` renvoie logos, drapeaux, noms de pays équivalents et compétition par club ; liste `docs/CLUBS-LOGOS.csv`. Outils : `scripts/import-club-logos.js`, `scripts/sync-club-logos.js`. Drapeaux : pipeline flag-icons → cercle 128×128 (recadrage carré centré), plus les images officielles fournies par le propriétaire (URSS, Yougoslavie, Serbie-et-Monténégro, Zaïre, Allemagne de l'Est, Antilles néerlandaises). Clubs sans logo : **FC Košice** et **Lierse SK** (à fournir).
- 4 clubs fictifs d'origine retirés (#73, migration archivée, restauration documentée dans `docs/EXPLOITATION.md`). « FC Kosicee » renommé « FC Košice » sur place (#75).

## 6. Historique des modifications fusionnées (depuis le rapport du 4 octobre)
Rapports PDF dans `docs/` : `FOOTVAULT_Rapport_30_septembre_2026.pdf`, `FOOTVAULT_Feuille_de_route_2_octobre_2026.pdf`, `FOOTVAULT_Rapport_4_octobre_2026.pdf` (#71–#83), `FOOTVAULT_Rapport_6_octobre_2026.pdf` (#84–#102, détail et preuves).

| N° | Objet | Preuve de mise en ligne (run) |
|---|---|---|
| #84 | Bouton « Ouvrir un autre pack » | n°46 (147a6fd) |
| #85 | Cartes épurées (bandeau compétition+saison, drapeau, club), 72 drapeaux | n°47 (e8631c9) |
| #86 | Drapeau officiel de l'URSS | non relue |
| #87 | Postes RB/LB/RW/LW pour 167 joueurs CDM/LN | non relue |
| #88 | Sécurité (400/413, jeton à temps constant), mémoire dans /api/health, page état du site, audit | n°49 (44f7023) |
| #89 | Docs : inventaire des fonctionnalités | — |
| #90 | Nationalités LDC (10 168) + drapeaux dont Antilles néerlandaises | n°50 (c93c599) |
| #91 | `DATABASE_CA_CERT` : vérification TLS (inactive par défaut) | non relue |
| #92 | 4 drapeaux officiels | n°51–53 ; confirmé par le propriétaire |
| #93 (A1) | Test d'accessibilité + base des défauts connus | n°54 réussi |
| #94 (A2) | Lien d'évitement, titre par page, focus au changement de page | n°54 réussi |
| #95 (A3) | Fenêtres modales accessibles (dialog, focus piégé, Échap, inert) | n°55 réussi |
| #96 (A4) | Étiquettes des champs, menu `aria-expanded`, un seul h1 au Vault | n°56 (a07f159) |
| #97 (A5) | Cibles tactiles ≥ 44 px, `safe-area-inset` (123 → 4 défauts) | n°57 (64c4f6f) |
| #98 (G1) | Série de connexion quotidienne | n°58 (945d004) |
| #99 (Q0) | Espace de noms `FVC`, table des pages, lien inconnu = accueil | n°60 (7644c94) |
| #100 (Q1) | Administration dans `fv-admin.js` (`app.js` 236 → 142 Ko) | n°61 (d1a4981) |
| #101 | Mode TLS de la base annoncé (`databaseTls`) | n°64 (2854355) : « unverified » |
| #102 | Diagnostic du certificat (`databaseTlsDiagnostic`) | n°65 (9426ba7) : a révélé la faute de frappe `DATABASE_CA_SERT` |
| #103 | Fichier de reprise, prompt, mémoire de travail | — |
| #104 | Code d'erreur de connexion à la base au démarrage (`databaseStartError`), mode TLS toujours annoncé | contrôle réussi (santé : `commit 0c151e97e5fb`) |
| #105 (Q2) | Marché et enchères dans `fv-market.js` (12 déclarations, `FVC.market`) | **n°68 : 0573bfa13ea5** |
| #106 | « Créer un compte » 44 px ; `h1` et titre d'une page refusée | **n°69 : 6f7c6e35e76f** |
| #107 (G2) | Sets thématiques | **n°69 : 6f7c6e35e76f** |
| #108 (G3) | Échanges de cartes | **n°70 : 361d333c152c** |

- **Sets thématiques (#107, G2)** — décisions du propriétaire : récompense unique selon la taille (≤ 10 cartes = 500 FC, 11–25 = 2 000 FC, ≥ 26 = 5 000 FC ; XP 25/75/150 proposés, à confirmer), **plafond 10 000 FC de sets par joueur et par jour de Paris** qui **bloque** la récupération sans rien consommer, **jamais de seconde récompense** (même si le set est modifié). Code : `lib/card-sets.js`, `SET_TIERS`/`SET_DAILY_CAP_COINS` (`lib/game-config.js`), tables `card_sets`/`card_set_cards` (sans lien avec `card_collections`), claim `set:<id>` dans `reward_claims`, plafond lu dans `coin_ledger` (réf. `set:%`), verrou `users … FOR UPDATE`. Interface : section du Vault + éditeur `set-admin-editor.js` (onglet Succès & missions). Aucun set n'existe tant que l'admin n'en crée pas.
- **Échanges (#108, G3)** — décisions : **option C** (cartes reçues comptent, limite par jour) ; **Legendary et Icon non échangeables**. Valeurs proposées (non contestées) : 5 offres ouvertes par joueur, 10 reçues, 10 échanges conclus par jour, 1 à 3 cartes par côté, validité 7 jours (`TRADE`, `lib/game-config.js`). Joueurs désignés par un **code d'échange** (`users.trade_code`, 8 caractères). Code : `lib/trades.js`, `lib/routes/trades.js`, tables `trade_offers`/`trade_offer_cards` (index unique partiel `trade_open_give_idx` : une carte dans une seule offre ouverte), `fv-trades.js` (page `#trades`). **Pas de nouveau statut de carte** : une carte offerte reste `owned` ; `createAuction` refuse les cartes engagées. Une carte reçue garde `acquired_at` et `source` (compte pour classement/albums, pas comme « nouvelle » pour tâches/défis). 4 notifications (`trade_*`).
- **Tests actuels** : `npm test` 240, `npm run test:browser` 36, `npm run test:a11y` 4 (page `trades` ajoutée à la mesure). **Piège CI** : l'étape « Navigateur de test (Chromium) » peut durer ≈ 9 minutes (téléchargement) ; ce n'est pas un blocage.
- **Piège outils** : `actions_list list_workflow_runs` renvoie des dizaines de runs (très verbeux) si on lui passe `per_page` ; le paramètre qui marche s'appelle **`perPage`** (`perPage: 1`). Pour le sha déployé : `curl /api/health`, puis `list_workflow_jobs` du run voulu et `get_job_logs` avec `tail_lines` ≈ 24 pour lire la ligne « En ligne : … ».

Détails utiles :
- **Série de connexion (#98)** — barème **validé par le propriétaire** : 150 FC + 10 XP au jour 1 ; +10 FC par jour de série (plafond +100 FC) ; palier +500 FC au 7ᵉ jour, +2000 FC au 30ᵉ ; jour manqué = retour à 1 (record `best_streak` conservé). Code : `DAILY_STREAK` (`lib/game-config.js`), `lib/daily-streak.js` (`previousDayKey` sans « −24 h », sûr aux changements d'heure ; `currentStreak`, `nextStreak`, `streakReward`), `claimDaily` (`lib/rewards.js`, sous `FOR UPDATE`), colonnes `users.daily_streak/best_streak` (`ADD COLUMN IF NOT EXISTS`), `/api/progression` → `daily{claimed, reward, streak, bestStreak}`, affichage dans le Vault.
- **Accessibilité** : modales via `setModal`/`closeModal` (rôle `dialog`, `aria-modal`, `aria-labelledby` = premier titre, `inert` sur le fond, focus piégé, Échap clique `#siteConfirmCancel,#auctionDialogCancel` sinon `.modal-close`, retour du focus au déclencheur). Base a11y actuelle : **2 entrées / 4 défauts** (3 liens du Profil, 1 bouton « 7 j » d'admin) ; objectif final : base vide et test bloquant.
- **Q1** : extraction **automatique** par analyse `acorn` (déclarations de premier niveau de l'IIFE `FV`, fermeture des dépendances, rien réécrit) ; contrôle `no-undef` ; si le contrôle de production ne couvre pas l'administration, vérifier à la main que `fv-admin.js` se charge (voir §8).

## 7. Point ouvert : certificat TLS (procédure sûre)
**Historique du 06/10** : variable mal nommée `DATABASE_CA_SERT` (run n°65) ; renommée en `DATABASE_CA_CERT` → panne 19 h 53–20 h 02 UTC (vérification complète du certificat qui échoue) ; retour arrière → site rétabli (run n°67). La vérification TLS complète n'est donc **pas** active aujourd'hui.
Procédure pour réessayer **sans risque** :
1. S'assurer que #104 est fusionnée et déployée (`/api/health` doit contenir `databaseTls` même base indisponible, et `databaseStartError` en cas d'échec). Lancer `production.yml`, lire « En ligne : <sha12> ».
2. Vérifier avec le propriétaire que la valeur est bien le **« CA certificate »** du service PostgreSQL Aiven (fichier `ca.pem`, onglet *Overview* → *CA certificate* → Download), PEM complet de `-----BEGIN CERTIFICATE-----` à `-----END CERTIFICATE-----`, sans guillemets. Tester d'abord hors site si le réseau est ouvert : `openssl s_client -connect <hôte>:<port> -CAfile ca.pem -servername <hôte>` (le propriétaire fournit hôte et port, **jamais** le mot de passe) → « Verification: OK » attendu.
3. Seulement alors, renommer la variable en `DATABASE_CA_CERT` sur Render et redéployer ; **surveiller `/api/health` pendant 2 minutes** : `databaseTls:"verified"` + `ok:true` = succès ; `ok:false` + `databaseStartError` = échec → **retour arrière immédiat** (renommer en `DATABASE_CA_SERT`), lire le code d'erreur (`SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`, `ECONNREFUSED`…) et corriger.
4. Interprétation : `unverified` + `caCertChars:0` → variable absente/vide pour le processus (regarder `nearbyNames`) ; `unverified` + `caCertChars>0` → anomalie dans `lib/db-ssl.js` (`caCertificate()` exige un PEM ; `\n` littéraux acceptés).
5. Rappeler au propriétaire : changer le mot de passe Aiven puis mettre à jour `DATABASE_URL` (pas encore fait).
Idée à proposer : nouvelle tentative automatique de connexion à la base au démarrage (aujourd'hui une panne de base au démarrage laisse le serveur « unavailable » jusqu'au redémarrage).

## 8. Reste à faire
Ordre décidé avec le propriétaire : A1–A5 ✔, G1 ✔, Q0–Q2 ✔, **G2 ✔, G3 ✔** ; reste **Q3 → Q4 → Q5**.
- **Q3 — `fv-core.js` + `fv-cards.js`** (état, aides, `cardMarkup`, logos) : le plus risqué (`FVC.core` est lu par tous les modules). Méthode des Q1/Q2 : analyse `acorn` (graines, fermeture, références inverses), `no-undef`, tests navigateur, `?v=` et `PUBLIC_SCRIPTS`.
- **Q4** — `fv-pages.js` (une page à la fois : `home`, `collection`, `packs`, `vault`, `profil`…).
- **Q5** — `styles.css` en sections (ordre des `<link>` et `?v=` conservés) ; `server.js` en dernier (gain faible, tout est déjà dans `lib/`).
- **Vérifications en ligne connectées** (jamais faites) : voir §1 ; demander au propriétaire l'autorisation d'un compte jetable (et un compte admin pour l'administration).
- **A5 (suite)** : harmoniser les points de rupture `@media`, tables d'admin lisibles à 390 px, `dvh`, indice de défilement des filtres ; base a11y vide et test bloquant. La mesure d'accessibilité ne couvre pas les pages hors connexion (la page de connexion avait un bouton trop petit).
- **Idées** : saisons de classement ; nouvelle tentative automatique de connexion à la base au démarrage ; XP des sets à confirmer ; échanges : limite de valeur ou de rareté par échange si de l'abus apparaît.

## 9. Actions en attente côté propriétaire
1. Certificat Aiven : voir §7 (vérifié par lui ; en cours d'analyse).
2. **Changer le mot de passe de la base Aiven** puis mettre à jour `DATABASE_URL` sur Render (un mot de passe figure dans un fichier de configuration local).
3. Relire `docs/NATIONALITES-LDC-CONFLITS.csv` (154 cas ; reporté à sa demande).
4. Fournir : nationalités des saisons 2024-25 et 2025-26 (701 cartes) ; logos de FC Košice et Lierse SK.
5. Décider pour UptimeRobot en mode « Keyword » (ouvert depuis le 4/10).
6. Vérifier sur téléphone : cibles tactiles (boutons, menu, cloche), série de connexion dans le Vault, page Administration.

## 10. Pièges déjà rencontrés (ne pas les revivre)
- `expectedHeadSha` raccourci → refus ; utiliser `git rev-parse origin/<branche>` (40 caractères).
- Base locale qui tombe → échecs en masse trompeurs (voir §3). Un `A11Y_UPDATE=1` lancé base arrêtée **écrase la base a11y avec un contenu vide**.
- Mesures a11y instables : attendre `document.fonts.ready` + 300 ms ; règle des cibles tactiles tolérante à 10 % ; le lien d'évitement ne doit pas avoir de transition (position −60 mesurée).
- Une règle a11y a été faussée par `main#app tabindex=-1` (un ancêtre « natif » neutralisait la règle des éléments cliquables) : liste d'ancêtres séparée.
- Pour retirer du code d'`app.js` : toujours passer par l'analyse des dépendances (`fmtDate` est local à une fonction, pas global : l'exposer dans `FVC.core` provoque `ReferenceError`).
- Audit précédent erroné : `:focus-visible` et `prefers-reduced-motion` étaient déjà en place ; mesurer avant d'affirmer.
- Sous-agents : échecs 429 (limite de débit) → réessayer.
- Le contrôle de production lancé **juste après** une fusion lit souvent l'ancienne version (déploiement Render ≈ 5 min) : attendre ou programmer `send_later`.
- Les images « collées » dans la conversation arrivent parfois sans fichier : demander la pièce jointe.
