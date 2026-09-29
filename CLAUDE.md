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
