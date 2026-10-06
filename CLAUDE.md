# CLAUDE.md --- FOOTVAULT / Sport Vault

Ce fichier donne à Claude Code le contexte fonctionnel du projet et les
règles à respecter lors des modifications.

## 1. Présentation du projet

**FOOTVAULT** (également appelé Sport Vault) est une plateforme de
collection de cartes à collectionner (TCG) consacrée au football et, à
terme, à d'autres sports.

Le projet permet notamment de collectionner des cartes de joueurs par
saison, de consulter des albums, d'ouvrir des packs, de participer à des
pools et de progresser grâce à des missions et des succès.

-   **Dépôt GitHub :** `sillardhugo358-ops/Sport-Vault`
-   **Site en production :** https://sport-vault.onrender.com
-   **Base de données :** PostgreSQL hébergé sur Aiven depuis le
    29/09/2026 (`DATABASE_URL`, schéma créé par `initDb()` dans
    `lib/schema.js`) — pas de Supabase dans le code actuel
-   **Hébergement actuellement utilisé :** Render
-   **Technologies front-end et organisation exacte :** à vérifier dans
    le dépôt avant toute modification. Ne pas supposer qu'un framework
    ou un gestionnaire de paquets est utilisé.

## 2. Règles de travail essentielles

1.  **Commencer par lire le code existant.** Identifier l'architecture,
    les conventions, les scripts, les dépendances et les mécanismes de
    déploiement avant d'éditer.
2.  **Préserver les fonctionnalités existantes.** Éviter les réécritures
    globales lorsqu'une modification ciblée suffit.
3.  **Ne jamais inventer le schéma de la base.** Vérifier les tables,
    colonnes, relations, contraintes et contrôles d'accès réellement
    présents.
4.  **Protéger les secrets.** Ne jamais afficher, committer ou intégrer
    dans le front-end des clés privées, mots de passe ou secrets.
    Utiliser les variables d'environnement prévues par le projet.
5.  **Respecter les données existantes.** Toute migration ou
    modification de structure doit être explicite, réversible autant que
    possible et accompagnée d'une vérification des impacts.
6.  **Éviter les doublons.** Vérifier les identifiants, les contraintes
    d'unicité et les données déjà présentes avant d'insérer ou
    d'importer des joueurs, cartes, saisons, missions ou succès.
7.  **Vérifier les changements.** Exécuter les tests et contrôles
    disponibles dans le dépôt. Signaler clairement ce qui a été testé et
    ce qui ne l'a pas été.
8.  **Ne pas déclarer un déploiement terminé sans preuve.** Distinguer
    le code modifié, le commit poussé, le déploiement lancé et la
    version effectivement disponible en production.
9.  **Privilégier une interface cohérente et responsive**, notamment sur
    mobile, en réutilisant les composants et styles existants.
10. **Expliquer les changements en français**, de manière concise, en
    mentionnant les fichiers touchés, les tests et les éventuelles
    actions manuelles nécessaires.

## 3. Fonctionnalités et règles métier connues

### Cartes de joueurs et albums

-   Les cartes sont organisées par joueur, club, compétition et saison.
-   Le projet prévoit une base historique de joueurs par saison,
    notamment pour la Ligue 1.
-   Une même carte ne doit pas être dupliquée visuellement dans une
    collection : afficher une carte et le nombre d'exemplaires possédés
    lorsque c'est le comportement attendu.
-   Les données d'un joueur peuvent inclure : nom, club, saison, numéro,
    poste, nationalité, note générale et rareté.
-   Les postes utilisés comprennent notamment : GK, RB, CB, LB, DM, CM,
    AM, RW, ST et LW.
-   Les nationalités doivent être renseignées de façon cohérente et les
    joueurs ne doivent pas être classés automatiquement comme gardiens.

### Barème officiel des raretés

La note générale détermine la rareté selon les seuils suivants :

  Note générale   Rareté
  --------------- -----------
  \< 78           Common
  78 à 83         Rare
  84 à 89         Epic
  90 à 91         Legendary
  ≥ 92            Icon

Les seuils doivent être appliqués sans chevauchement. En cas de
modification du barème, vérifier tous les endroits où la rareté est
calculée, filtrée, affichée ou enregistrée.

Implémentation : `lib/rarity.js` (`rarityFromOvr`, `RARITY_SQL`), utilisé par
le serveur, l'import 2026-2027 et l'éditeur admin (copie du barème dans
`app.js`, le serveur fait foi). Exception : cartes spéciales à rareté
manuelle (`catalog_cards.rarity_locked`).

### Attributs des cartes

**Joueurs de champ :** VIT (vitesse), TIR (tir), PAS (passe), DRI
(dribble), DÉF (défense), PHY (physique).

**Gardiens :** PLG (plongeon), JEU (jeu à la main), DÉG (dégagement),
RÉF (réflexes), VIT (vitesse), POS (placement).

Les attributs des gardiens réutilisent les colonnes communes (PLG =
`shooting`, JEU = `passing`, DÉG = `dribbling`, RÉF = `defending`,
VIT = `pace`, POS = `physical`) ; l'affichage est dans
`cardStatDefinitions` (`app.js`).

Ne pas modifier les règles de calcul de la note générale sans retrouver
et vérifier leur implémentation actuelle.

### Packs et pools

-   Les **packs** et les **pools** sont deux systèmes distincts : ne pas
    les fusionner.
-   Les packs servent à obtenir des cartes via une ouverture.
-   Les pools peuvent définir un ensemble de cartes et leur répartition
    par rareté.
-   Exemple de composition déjà envisagé : pool de 250 cartes comprenant
    3 spéciales, 10 rares et 237 communes. Il s'agit d'un exemple de
    configuration, pas d'une règle universelle.
-   Lors d'une modification, vérifier la création, l'achat, l'ouverture,
    les tirages, les stocks, les erreurs serveur et l'affichage des
    cartes.
-   Les animations d'ouverture doivent rester maîtrisées et ne pas
    révéler/retourner toutes les cartes automatiquement si l'interface
    attend une action de l'utilisateur.

### Missions, succès et progression

-   Le projet comprend des missions, des récompenses et un système de
    succès/trophées.
-   Les missions quotidiennes se réinitialisent à minuit ; les missions
    hebdomadaires se réinitialisent le lundi à minuit.
-   Les missions peuvent être déverrouillées progressivement.
-   Une zone dédiée aux missions terminées est prévue.
-   Le moteur de progression et les succès existent déjà : examiner leur
    code avant toute extension.
-   Pour les récompenses, vérifier les risques de double attribution,
    les limites et la persistance en base.

### Enchères et monnaie virtuelle

Règles précédemment définies pour le système d'enchères :

-   Durées possibles : 10 min, 30 min, 1 h, 3 h, 6 h, 12 h ou 24 h.
-   Une enchère reçue dans les 30 dernières secondes prolonge la vente
    d'une minute.
-   Le palier minimal d'enchère est de 10 % du prix actuel.
-   L'historique des enchères, le solde de monnaie virtuelle et l'icône
    de monnaie font partie des besoins fonctionnels.

Vérifier les règles réellement implémentées avant de les modifier,
notamment les calculs côté serveur et la concurrence entre
enchérisseurs.

## 4. Administration et interface

Le projet comporte des interfaces d'administration pour gérer des
éléments du jeu, notamment les succès.

Pour les formulaires d'administration : - privilégier une ouverture
claire du formulaire au clic sur « Créer » ou « Modifier » ; - ne pas
demander à l'utilisateur de saisir un identifiant technique lorsqu'il
peut être généré de manière sûre ; - conserver l'identifiant existant
lors d'une modification ; - valider les champs et afficher des erreurs
compréhensibles ; - empêcher les doubles soumissions et confirmer les
sauvegardes uniquement après succès réel ; - prévoir une annulation et
un retour à la liste sans perte involontaire de données.

Ces indications décrivent le comportement souhaité ; vérifier le code
actuel avant de supposer qu'il est entièrement en place.

## 5. Données, sécurité et fiabilité

-   Toute action sensible (achats, récompenses, soldes, enchères, droits
    administrateur) doit être vérifiée côté serveur ou par des règles de
    sécurité adaptées, pas seulement dans l'interface.
-   Contrôler les vérifications d'accès côté serveur (session, rôle
    admin) pour chaque table et route concernée.
-   Ne jamais faire confiance à un prix, un solde, une rareté ou une
    récompense calculés uniquement par le client.
-   Prévoir des opérations idempotentes lorsque des achats ou
    récompenses peuvent être relancés.
-   Gérer les erreurs réseau et serveur avec un message clair, sans
    masquer l'échec.
-   Ne pas supprimer ou réinitialiser des données réelles pour tester.
-   Pour les imports CSV : contrôler l'encodage, les colonnes, les
    valeurs obligatoires et les doublons avant écriture.

## 6. Méthode recommandée pour chaque tâche

1.  Reformuler brièvement l'objectif et repérer les zones du code
    concernées.
2.  Inspecter les fichiers et le schéma de données utiles.
3.  Définir une modification minimale et compatible avec l'existant.
4.  Implémenter en respectant les conventions du dépôt.
5.  Vérifier les cas normaux, les erreurs, les permissions et le rendu
    mobile.
6.  Exécuter les tests ou contrôles disponibles.
7.  Résumer les fichiers modifiés, les vérifications effectuées et les
    limites restantes.

## 7. Priorités produit identifiées

Pistes d'amélioration évoquées pour la suite du projet :

-   finaliser l'éditeur de succès (ergonomie, aperçu, validation,
    filtres) ;
-   développer ou améliorer l'éditeur de missions ;
-   approfondir les récompenses et la progression des joueurs ;
-   enrichir le tableau de bord statistique ;
-   poursuivre la fiabilisation des packs, pools et systèmes de
    récompenses.

Ces pistes sont une feuille de route indicative, pas une liste de tâches
déjà réalisées.

## 8. Points à confirmer dans le dépôt

Avant toute intervention, vérifier : - la structure exacte des fichiers
et le point d'entrée de l'application ; - les commandes de lancement, de
test et de build ; - les versions et bibliothèques réellement utilisées
; - les tables PostgreSQL et leurs relations ; - les variables
d'environnement nécessaires ; - la configuration Render et le processus
de déploiement ; - l'état réel des fonctionnalités listées ci-dessus.

**Principe général :** comprendre l'existant, préserver les données et
livrer des changements vérifiables, sans inventer de fonctionnalités, de
schémas ou de résultats de test.

## 9. Mémoire de travail et reprise de session (mise à jour le 06/10/2026)

Contexte détaillé : **`docs/REPRISE.md`** (état exact, décisions, pièges, reste à faire) et **`docs/PROMPT-REPRISE.md`** (message de démarrage). Rapports : `docs/FOOTVAULT_Rapport_*.pdf`. Ce qui suit est le résumé à toujours appliquer.

**État.** `main` est à jour avec les PR #84 à #112 (accessibilité, mobile, série de connexion quotidienne, découpage de l'interface Q0–Q5, diagnostic TLS, sets thématiques G2, échanges de cartes G3) ; reste Q3 à Q5. Point ouvert : le certificat Aiven. La variable était mal nommée `DATABASE_CA_SERT` ; la renommer en `DATABASE_CA_CERT` a **fait tomber le site de 19 h 53 à 20 h 02 UTC le 06/10** (la vérification complète du certificat échoue au démarrage, cause exacte inconnue) ; retour arrière fait, site rétabli. **Ne jamais redemander ce renommage sans suivre la procédure sûre de `docs/REPRISE.md` §7** (certificat = « CA certificate » du service Aiven, test `openssl` préalable, surveillance de `/api/health`, retour arrière immédiat).

**Règles de collaboration (consignes permanentes du propriétaire).**
- Répondre en français, concis ; dire ce qui a été testé et ce qui ne l'a pas été.
- Ne jamais écrire « en ligne » sans la ligne exacte `En ligne : <sha12> — main : <sha12>` lue dans le journal de `production.yml`.
- « Fusionne la PR dès que la CI est verte » : squash avec `expectedHeadSha` complet (40 caractères) quand les deux contrôles `check` sont verts, puis désabonnement, branche de travail remise sur `origin/main` (`--force-with-lease`), contrôle de production programmé (≈ 6 minutes) puis lecture de la ligne de version.
- Une PR par tâche, sur la branche de travail imposée par la session. Le fichier de plan ne doit contenir que le programme de modifications de la demande en cours.

**Architecture du front (Q0 à Q5, terminée).** Ordre des scripts : `fv-core.js` (socle) → `fv-cards.js` → `app.js` (routeur, `render`, `bind`) → `fv-pages.js` → `fv-admin.js`, `fv-market.js`, `fv-trades.js`… ; `window.FVC` expose `FVC.core` (aides partagées), `FVC.pages` (une fonction par page, enregistrée par son module), `FVC.ui` (actions des pages appelées par `bind()`), `FVC.admin`, `FVC.market`. Feuilles de style `styles.css` à `styles-6.css` : ordre = cascade. Tout nouveau script : l'ajouter à `PUBLIC_SCRIPTS` (`server.js`) et à `index.html` avec un `?v=`, à la bonne place. Pour déplacer du code : analyser les dépendances (acorn), ne rien réécrire, vérifier `no-undef`, tests navigateur (détails : `docs/REPRISE.md` §4).

**Tests.** `npm run check`, `npm test` (241), `npm run test:browser` (36), `npm run test:a11y` (4, base de défauts connus qui ne doit jamais augmenter). Base de test locale PostgreSQL à (re)démarrer dans la même commande que les tests (elle s'arrête entre deux appels) ; des échecs en masse = base tombée, pas un bug.

**Série de connexion (barème validé).** 150 FC + 10 XP au jour 1, +10 FC par jour de série (plafond +100 FC), +500 FC au 7ᵉ jour, +2000 FC au 30ᵉ ; un jour manqué remet la série à 1, record conservé (`lib/daily-streak.js`, `DAILY_STREAK`).

**Reste à faire.** Vérifications en ligne connectées (compte jetable à autoriser) ; feuille de route de découpage terminée. Règles métier validées : sets = 500/2 000/5 000 FC selon la taille, plafond 10 000 FC/jour qui bloque sans rien consommer, jamais de seconde récompense ; échanges = option C, Legendary et Icon non échangeables (`docs/REPRISE.md` §6). Actions du propriétaire en attente : changer le mot de passe Aiven puis `DATABASE_URL`, relire `docs/NATIONALITES-LDC-CONFLITS.csv`, fournir les nationalités 2024-25 et 2025-26 (701 cartes) et les logos de FC Košice et Lierse SK, décider pour UptimeRobot (« Keyword »).

