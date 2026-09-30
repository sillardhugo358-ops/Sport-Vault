# FOOTVAULT — Point de départ et feuille de route

*État des lieux établi à partir du dépôt au 29/09/2026 (commit `4a2c8e3`). Les points marqués « à vérifier » n'ont pas pu être confirmés depuis le code seul.*

## 1. Carte d'identité technique

| Élément | Réalité dans le dépôt |
|---|---|
| Serveur | Node.js ≥ 18, module `http` natif, **sans framework** — `server.js` (~168 Ko) |
| Front-end | SPA en JavaScript vanilla, navigation par hash — `index.html`, `app.js` (~192 Ko), `styles.css` (~282 Ko), `achievement-admin-editor.js`, `mission-admin-editor.js` |
| Dépendances | Une seule : `pg` |
| Base de données | **PostgreSQL hébergé sur Aiven** (Render jusqu'au 29/09/2026), connexion par la variable `DATABASE_URL` saisie dans Render. Pas de Supabase dans le code. Mode mémoire en local si `DATABASE_URL` est absente (refusé en production). |
| Schéma | Créé automatiquement au démarrage par `initDb()` dans `server.js` (23 tables : `users`, `sessions`, `catalog_cards`, `card_instances`, `pack_definitions`, `pack_pools`, `auctions`, `auction_bids`, `auction_withdrawals`, `achievements`, `reward_claims`, `clubs`, `competitions`, `competition_seasons`, `competition_clubs`, `season_clubs`, `card_collections`, `card_collection_cards`, `admin_logs`, `security_events`, `login_limits`, `registration_limits`, `app_migrations`) |
| Démarrage | `npm start` → `ligue1-launcher.js` lance `server.js` (préchargé avec `security-bootstrap.js`) puis `scripts/import-ligue1-2026-27.js` dès que les tables existent |
| Déploiement | Service web sur Render (plan **free**, Francfort), base sur Aiven, health check `/api/health` |
| CI | `.github/workflows/check.yml` : uniquement `node --check server.js` et `node --check app.js` |
| Tests | **Aucun** |

## 2. Inventaire des fonctionnalités

| Domaine | Statut | Détail |
|---|---|---|
| Comptes & sessions | ✅ | Inscription, connexion, déconnexion, limites anti-abus (`login_limits`, `registration_limits`) |
| Catalogue | ✅ | 478 cartes Ligue 1 2026-2027 (`data/footmercato_catalog_*.b64`), fallback de 24 cartes fictives |
| Collection & album | ✅ | Collection persistante, album par club avec récompense, logos de clubs |
| Packs | ✅ | Starter / Pro / Legend, tirages côté serveur avec garanties de rareté |
| Pools | 🟡 | Table `pack_pools` et route `/api/pools/open` présentes — fiabilité (stocks, répartition) à vérifier |
| Missions | 🟡 | Chaîne de 12 missions déverrouillables + tâches quotidiennes/hebdomadaires (heure de Paris). Pas d'éditeur de missions en admin |
| Succès / progression | 🟡 | Moteur en place, page Succès, éditeur admin récemment simplifié — ergonomie/aperçu/filtres à finaliser |
| Enchères | ✅ | Création, enchère, annulation, retrait, historique ; palier +10 % et prolongation d'1 min si enchère dans les 30 dernières secondes |
| Admin | ✅ | Utilisateurs, cartes, compétitions/clubs, packs, marché, journaux, succès |
| Barème de rareté | ✅ | *Phase 2 :* rareté calculée depuis la note par `lib/rarity.js` (création, modification, import) ; cartes spéciales à rareté manuelle (`rarity_locked`) |
| Attributs gardiens | ✅ | Affichés PLG, JEU, DÉG, RÉF, VIT, POS ; stockés dans les 6 colonnes communes (correspondance dans [QUALITE-DONNEES.md](QUALITE-DONNEES.md)). *Constat initial erroné corrigé en phase 2.* |
| Historique Ligue 1 2010-2025 | 🟡 | Données présentes dans `data/` et route d'import protégée par jeton — état réel en production à vérifier |
| Tableau de bord statistique | 🟡 | Vue d'ensemble admin (`/api/admin/overview`) à enrichir |

## 3. Dettes et risques (par priorité)

1. **Risque de perte de données** — *Traité en phase 0 :* sauvegarde de production faite le 29/09/2026 (23 tables, 3 utilisateurs, 334 cartes possédées, 6 938 cartes au catalogue), base migrée de Render free (expiration le 15/10/2026) vers Aiven (gratuit, sans expiration). **Reste :** Aiven gratuit n'a pas de sauvegarde automatique → sauvegardes manuelles régulières ([SAUVEGARDE.md](SAUVEGARDE.md)), à automatiser plus tard.
2. **Aucun test automatisé** — *Traité en phase 1 :* 45 tests (`npm test`, lancés par la CI). Bugs trouvés et corrigés :
   - fin d'enchère : le gagnant recevait la carte **sans être débité** (FOOTCOINS créés de rien) ; aucune vente réglée en production au 29/09/2026 ;
   - palier d'enchère faux par erreur d'arrondi (100 → 111 au lieu de 110 ; 50 → 56 ; 200 → 221), côté serveur et interface ;
   - blocage à partir de 5 inscriptions ou ouvertures de packs simultanées (connexions à la base épuisées → erreur 500) ;
   - jours de changement d'heure : début de journée des tâches décalé d'une heure.
3. **Documentation incohérente** — `CLAUDE.md` mentionnait Supabase et le `README.md` parlait de 24 cartes. *Corrigé en phase 0.*
4. **Fichiers monolithiques** — `server.js`, `app.js` et `styles.css` sont très gros avec des lignes très longues, ce qui rend les revues et les corrections risquées.
5. **Dossier `data/` encombré** — ~40 fichiers base64 avec plusieurs versions (`v2`, `v3`, `corrected`, `part…`) ; *Phase 0 : inventaire fait ([data/README.md](../data/README.md)) — seuls 3 fichiers sont lus ; suppression des anciennes versions en attente de décision.*
6. **Configuration de session** — `render.yaml` définit `SESSION_TTL_DAYS`, mais cette variable n'est lue nulle part : la durée est codée en dur (`SESSION_DAYS = 2/24`, soit 2 h).
7. **Règles métier non centralisées** — *Traité en phase 2 :* barème centralisé. **Reste :** 2 136 nationalités vides et 296 cartes aux statistiques de remplissage, à compléter depuis une source fiable ([QUALITE-DONNEES.md](QUALITE-DONNEES.md)).
8. **Import Ligue 1 cassé sur base neuve** — `scripts/import-ligue1-2026-27.js` créait la saison avec un paramètre manquant (erreur `bind message supplies 1 parameters`). Sans effet sur la prod où la saison existe déjà, mais bloquant pour une réinstallation. *Corrigé en phase 0.*

## 4. Frise chronologique

```mermaid
timeline
    title Feuille de route FOOTVAULT (~12 semaines)
    section Consolider
        S1 - Fondations : Sauvegarde de la base : Vérification du plan Render : README à jour : Inventaire de data/
        S2-S3 - Filet de sécurité : Tests node test sur packs, récompenses, enchères, missions : CI qui exécute les tests
    section Fiabiliser
        S4-S5 - Données et règles métier : Barème de rareté centralisé : Attributs gardiens : Import historique contrôlé
        S6-S7 - Découpage du code : server.js en modules : Aucun changement de comportement
    section Développer
        S8-S9 - Progression : Éditeur de succès finalisé : Éditeur de missions : Zone missions terminées
        S10-S11 - Économie et stats : Packs et pools fiabilisés : Concurrence des enchères : Tableau de bord statistique
    section Ouvrir
        S12+ - Lancement : Hébergement et sauvegardes durables : Monitoring : Autres championnats et sports
```

### Détail des phases

| Phase | Période | Objectif | Terminé quand… |
|---|---|---|---|
| **0 — Fondations** | S1 | Sécuriser l'existant | Une sauvegarde de la base est faite et restaurable ; le statut du plan Render est connu ; README et CLAUDE.md décrivent la réalité ; les fichiers actifs de `data/` sont identifiés |
| **1 — Filet de sécurité** | S2-S3 | Pouvoir modifier sans casser | Des tests `node:test` (sans nouvelle dépendance) couvrent : tirages de packs et garanties, anti-double récompense, règles d'enchères (+10 %, anti-snipe), réinitialisation quotidienne/hebdomadaire ; la CI les exécute avec un smoke test sur `/api/health` |
| **2 — Données & règles métier** | S4-S5 | Un catalogue juste | Une fonction unique calcule la rareté selon le barème officiel et les 478 cartes sont auditées ; les gardiens ont leurs 6 attributs ; l'import historique 2010-2025 est contrôlé (doublons, nationalités, postes) |
| **3 — Découpage du code** | S6-S7 | Maintenabilité | `server.js` est découpé progressivement (base, auth, packs, missions, enchères, admin) sans changement de comportement, tests toujours verts |
| **4 — Progression** | S8-S9 | Priorités produit | Éditeur de succès finalisé (aperçu, validation, filtres) ; éditeur de missions en admin ; zone des missions terminées ; resets quotidien/hebdo vérifiés |
| **5 — Économie & stats** | S10-S11 | Fiabiliser l'économie | Packs et pools robustes (stocks, erreurs, idempotence) ; enchères testées en concurrence ; tableau de bord statistique enrichi |
| **6 — Lancement & suite** | S12+ | Ouvrir le projet | Hébergement et sauvegardes automatiques durables ; monitoring des erreurs ; préparation d'autres championnats puis d'autres sports |

## 5. Prochaine action concrète

**Phase 0 terminée le 29/09/2026.** Base sauvegardée et migrée sur Aiven.

**Phase 1 terminée le 29/09/2026.** 45 tests automatiques, 4 bugs corrigés (voir § 3).

**Phase 2 terminée le 29/09/2026** pour le code : barème des raretés appliqué partout, 4 cartes spéciales verrouillées, poste LM converti, libellés gardiens alignés. Données à compléter en attente d'une source.

**Phase 3 terminée le 30/09/2026.** Étape 1 : modules sans état extraits dans `lib/` (configuration du jeu, périodes, règles d'enchères, barème, IP client) ; `server.js` passe de 1 121 à 1 015 lignes. Étapes suivantes : accès à la base, comptes et sessions, packs, missions et succès, enchères, administration, routeur.

Étape 2 : schéma, données de départ et migrations dans `lib/schema.js` (`initDb`) ; `server.js` à 905 lignes. Bug corrigé au passage : sur une base neuve, la création du premier admin (`ADMIN_BOOTSTRAP_PASSWORD`) échouait (table `card_instances` pas encore créée) et le serveur retombait en mode mémoire.

Étape 3 : comptes et sessions dans `lib/auth.js` (mots de passe, cookies, sessions, limites de connexion, rôles). Nouveau contrôle `npm run check` (CI) : tout identifiant non déclaré est signalé ; il a trouvé `utcDayKey`, inexistant, qui faisait planter le bonus quotidien en mode mémoire (corrigé).

Étape 4 : cartes et packs dans `lib/cards.js` (instances, tirages, packs, pools, cartes de bienvenue) ; nouveau test du tirage de pool.

Étape 5 : récompenses et progression dans `lib/rewards.js` (niveaux, bonus quotidien, missions, tâches, album) ; `server.js` à 714 lignes. Les succès, gérés directement dans les routes, suivront avec le routeur.

Hors phase, le 30/09/2026 : catalogue étendu à Premier League, La Liga, Serie A et Bundesliga (43 781 cartes, `scripts/import-europe.js`) ; site accéléré (cache du catalogue, compression) ; packs par compétition et par décennie.

Étape 6 : enchères dans `lib/auctions.js` (création, offres, anti-sniping, règlement, annulation, retrait, historique) ; `server.js` à 556 lignes.

Étape 7 : administration dans `lib/admin.js` (comptes, ressources, cartes des joueurs, catalogue, compétitions, collections, packs, journaux, vue d'ensemble) ; nouveau `test/admin.test.js` ; `server.js` à 329 lignes.

Étape 8 : routeur découpé par domaine dans `lib/routes/` (comptes, cartes et packs, progression et succès, enchères, administration, import interne) ; `json` et `readBody` dans `lib/http.js` ; nouveau `test/routes.test.js` (tour de toutes les routes, passant aussi sur l'ancien routeur). `server.js` : **1 121 → 59 lignes** (démarrage, fichiers statiques, santé, `securityEvent`).

**Phase 4 en cours.** Étape 1 : missions en base (table `missions`, reprise des 12 missions d'origine, récompenses déjà validées conservées) et éditeur de missions dans la console admin (onglet « Succès & missions ») : création avec identifiant généré, modification, activation, prérequis contrôlés (pas de boucle, jamais de chaîne bloquée), aperçu joueur. La zone des missions terminées existait déjà.

Étape 2 : éditeur de succès refait sur le modèle des missions (`lib/achievements.js`, `achievement-admin-editor.js`) : identifiant créé par le serveur (plus d'écrasement possible), erreurs par champ, aperçu joueur, filtres (statut, catégorie, condition), activation, suppression confirmée et tracée ; ancien `success-admin-editor.js` retiré.

Rapport complet du 30/09/2026 : `docs/FOOTVAULT_Rapport_30_septembre_2026.pdf` (état de départ, travaux, reste à faire, plan en 5 étapes, propositions).

**Plan, étape 1 — fiabilité de la boutique (P0).** Pack ou pool sans carte éligible : message clair (409), transaction annulée, rien débité ; l'éditeur refuse un pack ou un pool actif impossible à tirer. Pools manuels : tirage uniforme parmi les cartes sélectionnées, la composition (spéciales / rares / communes) est donc respectée. Nationalités en français partout (`lib/nations.js`, migration `nations-fr-2026-09-30` sur le catalogue et les exemplaires, import et saisie admin normalisés).

**Plan, étape 2 — identité visuelle.** Cartes v4 selon la spec (`cards-v4.css`, `cardMarkup` dans `app.js`) : 6 attributs sur la carte (libellés gardien), couleurs et motifs par rareté, holo et bordure animée Icon, filigrane du numéro masqué s'il manque, attributs masqués sous 160 px. Numéro de maillot désormais enregistré sur les exemplaires (migration `instances-jersey-2026-09-30`). Polices hébergées par le site (Barlow Condensed, Inter, Oswald ; Google Fonts était bloqué par la CSP) ; logos d'autres sites autorisés (images uniquement). Tests compétitions/clubs ; contrôle Angers/Brest 2026-2027 fait sur la sauvegarde de production (un club chacun, 22 cartes).

**Plan, étape 3 — pilotage (1/3).** Journal des FOOTCOINS (`coin_ledger`, `lib/ledger.js`) : une ligne par gain ou dépense (inscription, récompenses, packs, pools, enchères, ajustements admin), écrite dans la même transaction que le mouvement. Tableau de bord statistique dans la console (`/api/admin/stats`, `lib/stats.js`, `admin-stats.js`) : joueurs actifs 24 h / 7 j / 30 j, inscriptions, packs ouverts, flux de FC par jour et par motif, packs les plus ouverts, raretés tirées, marché, plus gros dépensiers ; période 7, 14, 30 ou 90 jours. Les soldes antérieurs au 30/09/2026 ne figurent pas dans le journal.

**Plan, étape 3 — pilotage (2/3).** Tâches quotidiennes et hebdomadaires en base (table `period_tasks`, migration `period-tasks-2026-09-30` qui reprend les 8 tâches avec leurs identifiants) et éditeur admin (`lib/tasks.js`, `task-admin-editor.js`, onglet « Succès & missions ») : création, modification, activation, aperçu joueur, nombre de récupérations. L'identifiant ne change jamais : une tâche modifiée en cours de période ne peut pas être récupérée deux fois.

**Plan, étape 3 — pilotage (3/3).** Catalogue admin paginé côté serveur (`/api/admin/cards/page`, 50 cartes par page, filtres et recherche sans accents en SQL) et résumé (`/api/admin/cards/summary` : chiffres et listes des filtres). L'ouverture de la console ne télécharge plus les 50 719 cartes (environ 30 Ko au lieu du catalogue complet) ; le catalogue complet n'est chargé qu'à l'ouverture de l'éditeur de pools, qui affiche au plus 200 cartes à la fois.

Suite du plan : étape 3 (tableau de bord, tâches éditables, pagination admin), étape 4 (mobile, profil, notifications), étape 5 (exploitation). Sauvegarde manuelle chaque semaine en attendant son automatisation.
