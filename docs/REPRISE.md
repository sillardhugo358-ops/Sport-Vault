# FOOTVAULT — Fichier de reprise (état au 06/10/2026, 21 h Paris)

Ce fichier permet de reprendre le travail dans une **nouvelle session** sans perdre d'information. À lire avec `CLAUDE.md` (règles du projet) et `docs/PROMPT-REPRISE.md` (message de démarrage). Source de vérité du code : le dépôt (`main`) ; ici, le contexte, les décisions, les pièges et le reste à faire.

## 1. Où en est-on (en dix lignes)
- `main` = `9426ba79c6ba` (PR #102 fusionnée). Dernière version **prouvée en ligne** : `2854355094c9` (#101, run n°64 de `production.yml`). Le déploiement de `9426ba7` (#102) reste à contrôler.
- **Point ouvert n°1 — certificat TLS de la base : CAUSE TROUVÉE (run n°65, `9426ba79c6ba` en ligne)** : `databaseTlsDiagnostic` = `{"caCertChars":0,"caFileSet":false,"nearbyNames":["DATABASE_CA_SERT","DATABASE_URL"]}` → la variable a été créée sur Render sous le nom **`DATABASE_CA_SERT`** (S au lieu de C). Le propriétaire doit la **renommer en `DATABASE_CA_CERT`** (même valeur) et redéployer ; ensuite relancer `production.yml` et attendre « TLS de la base : verified » (le champ `databaseTlsDiagnostic` disparaît alors). Historique : au run n°64, `databaseTls` = `unverified` ; le propriétaire pensait avoir tout vérifié.
- Prochaine étape de la feuille de route : **Q2** (marché et enchères dans `fv-market.js`), puis G2, Q3–Q5, G3.
- Le propriétaire a **ouvert tous les domaines** du réseau de l'environnement cloud : une nouvelle session doit pouvoir lire `https://sport-vault.onrender.com` directement (vérifier d'abord avec `curl`). Avant, l'accès était bloqué (`CONNECT 403`, `EGRESS_BLOCKED`).

## 2. Règles de travail avec ce propriétaire (à respecter strictement)
1. **Répondre en français**, concis : fichiers touchés, tests lancés, actions manuelles nécessaires, limites.
2. **Ne jamais écrire « en ligne »** sans la ligne exacte lue dans le journal de `production.yml` (étape « Version déployée ») : `En ligne : <sha12> — main : <sha12>`. Distinguer : code modifié / commit poussé / PR / fusionné / déployé / en ligne.
3. **Consigne permanente : « Fusionne la PR dès que la CI est verte »** : vérifier que les **deux** contrôles `check` de la PR sont `success`, puis fusionner (squash, avec `expectedHeadSha` = SHA **complet de 40 caractères** de la tête de la PR ; un SHA tronqué est refusé), se désabonner de la PR, remettre la branche de travail sur `origin/main` (`git checkout -B <branche> origin/main` puis `git push --force-with-lease`), programmer un contrôle de production (`send_later` ≈ 6 minutes) et lancer `production.yml` (workflow_dispatch, ref `main`).
4. **Une PR par tâche**, branche de travail imposée : `claude/wizardly-goldberg-4wdxqm` (ne jamais pousser ailleurs). Jamais de PR sans demande ; ici la demande est permanente pour la feuille de route. Description de PR dans le style des précédentes (Résumé / Vérifications / Annulation) + attribution demandée par la session (pied de page « Generated with Claude Code » et lien de session).
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
| #102 | Diagnostic du certificat (`databaseTlsDiagnostic`) | **à contrôler** (9426ba7) |

Détails utiles :
- **Série de connexion (#98)** — barème **validé par le propriétaire** : 150 FC + 10 XP au jour 1 ; +10 FC par jour de série (plafond +100 FC) ; palier +500 FC au 7ᵉ jour, +2000 FC au 30ᵉ ; jour manqué = retour à 1 (record `best_streak` conservé). Code : `DAILY_STREAK` (`lib/game-config.js`), `lib/daily-streak.js` (`previousDayKey` sans « −24 h », sûr aux changements d'heure ; `currentStreak`, `nextStreak`, `streakReward`), `claimDaily` (`lib/rewards.js`, sous `FOR UPDATE`), colonnes `users.daily_streak/best_streak` (`ADD COLUMN IF NOT EXISTS`), `/api/progression` → `daily{claimed, reward, streak, bestStreak}`, affichage dans le Vault.
- **Accessibilité** : modales via `setModal`/`closeModal` (rôle `dialog`, `aria-modal`, `aria-labelledby` = premier titre, `inert` sur le fond, focus piégé, Échap clique `#siteConfirmCancel,#auctionDialogCancel` sinon `.modal-close`, retour du focus au déclencheur). Base a11y actuelle : **2 entrées / 4 défauts** (3 liens du Profil, 1 bouton « 7 j » d'admin) ; objectif final : base vide et test bloquant.
- **Q1** : extraction **automatique** par analyse `acorn` (déclarations de premier niveau de l'IIFE `FV`, fermeture des dépendances, rien réécrit) ; contrôle `no-undef` ; si le contrôle de production ne couvre pas l'administration, vérifier à la main que `fv-admin.js` se charge (voir §8).

## 7. Point ouvert : certificat TLS (cause trouvée ; procédure de conclusion)
**Constat du 06/10 à 19 h 46 UTC : la variable s'appelle `DATABASE_CA_SERT` sur Render (faute de frappe).** Action : la renommer en `DATABASE_CA_CERT`, redéployer, puis appliquer la procédure ci-dessous pour confirmer `verified`.
1. Lancer `production.yml` (ref `main`), lire (`get_job_logs`, `tail_lines` ≈ 200) la ligne « Prêt après … TLS de la base : <mode>. Diagnostic TLS : {…} » et « En ligne : <sha12> — main : <sha12> » (attendu `9426ba79c6ba`, relancer 3 min plus tard si le déploiement est en cours).
2. Si accès réseau ouvert : `curl -s https://sport-vault.onrender.com/api/health | jq` donne la même chose.
3. Interpréter :
   - `verified` → certificat bien utilisé ✔ (rien d'autre à faire ; mettre à jour la doc si besoin) ;
   - `unverified` + `caCertChars: 0` → la variable est absente/vide **pour le processus** : regarder `nearbyNames` (faute de frappe : `DATABASE_CA_CERTIFICATE`, `DATABASE_CA_CERT ` avec espace, variable sur un autre service ou dans un groupe d'environnement non lié…) et le dire au propriétaire ;
   - `unverified` + `caCertChars > 0` → anomalie dans `lib/db-ssl.js` (`caCertificate()` : exige un PEM `-----BEGIN CERTIFICATE-----…-----END CERTIFICATE-----` ; les `\n` littéraux sont acceptés) : investiguer le code, ne pas accuser la configuration ;
   - serveur qui ne démarre pas → certificat invalide : retour arrière en supprimant la variable (`docs/SAUVEGARDE.md`).
4. Rappeler au propriétaire : changer le mot de passe Aiven puis mettre à jour `DATABASE_URL` (pas encore fait).

## 8. Reste à faire (feuille de route validée)
Ordre décidé avec le propriétaire (« nouvelles fonctionnalités de jeu », « qualité du code », « mobile et accessibilité ») : A1–A5 ✔, G1 ✔, Q0 ✔, Q1 ✔, **Q2 →** G2 → Q3 → Q4 → Q5 → G3.
- **Q2 — `fv-market.js`** (marché et enchères) : déplacer `market, loadAuctionHistory, showBidHistory, siteConfirmDialog, auctionDialog, bidAuction, withdrawAuction, cancelAuction, createAuction` (9 déclarations, ≈ 13,7 Ko). Dépendances à lire dans `FVC.core` : `$, api, cardMarkup, closeModal, esc, money, rarityOrder, render, setModal, state, toast, viewHero` (ajouter `rarityOrder` et `viewHero` à `FVC.core`, **retirer `auctionDialog` de `FVC.core`** et le lire depuis `FVC.market` dans `fv-admin.js` au moment de l'appel). `bind()` et la table `FVC.pages` (entrée `market`) référencent ces fonctions. Méthode : script `acorn` (sélection des graines, fermeture, dépendances, références inverses), puis `no-undef`, puis tests navigateur du marché (filtres, création d'enchère, historique) + `PUBLIC_SCRIPTS` + `index.html`. Attention au couplage avec `market-insights.js` (`window.fvMarketTab`, `mountMarketInsights`).
- **Vérifications en ligne à faire si l'accès réseau est ouvert** (jamais faites sur de vrais appareils) : page Administration + un éditeur (pack, club) ; Vault (série de connexion : bonus 150 FC, « SÉRIE : 1 JOUR ») ; lien d'évitement et modales au clavier ; rendu mobile 390 px (cibles ≥ 44 px) avec Chromium sans interface.
- **A5 (suite)** : harmoniser les points de rupture `@media`, tables d'admin lisibles à 390 px, `dvh`, indice de défilement des filtres ; puis base a11y vide et test bloquant.
- **G2 sets thématiques** : colonnes `reward_coins, reward_xp, kind` sur `card_collections`, complétion calculée à la volée (modèle `albumCounts`), claim `set:<id>` dans `reward_claims`, plafond par set et par jour — **budget de FOOTCOINS à fixer avec le propriétaire avant de coder** ; éditeur admin sur le modèle de `challenge-admin-editor.js`.
- **Q3–Q5** : `fv-core.js` + `fv-cards.js` (état, aides, `cardMarkup`, logos) — le plus risqué ; `fv-pages.js` (une page à la fois) ; `styles.css` en sections (ordre des `<link>` et `?v=` conservés) ; `server.js` en dernier (gain faible, tout est déjà dans `lib/`).
- **G3 échanges de cartes** (effort L) : table `trade_offers`, statut `'trade'` propagé (classement, tâches, défis excluent `source='trade'`), verrouillage par ordre d'uuid, plafond d'offres ouvertes, 3 types de notification, `securityEvent` à chaque étape — **règle anti-triche (classement) à valider avec le propriétaire avant tout code**.
- Idée ultérieure : saisons de classement (après G2).

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
