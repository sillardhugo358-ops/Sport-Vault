'use strict';

// Les 100 missions récurrentes du document « FOOTVAULT – Succès et missions » (01/10/2026) :
// 40 quotidiennes (remise à zéro chaque jour à minuit), 45 hebdomadaires (chaque lundi à minuit),
// 15 mensuelles (chaque 1er du mois). Insérées une fois en base (period_tasks, migration
// missions-pdf-2026-10-01) ; la console admin fait foi ensuite.
// Chaque période, une sélection tournante est proposée à tous les joueurs (ROTATION).
//   [numéro, titre, description, type, objectif, palier, options]

const ROTATION = { daily: 3, weekly: 5, monthly: 5 };

const TIERS = {
  daily: { 1: { coins: 100, xp: 10 }, 2: { coins: 150, xp: 15 }, 3: { coins: 250, xp: 25 } },
  weekly: { 1: { coins: 400, xp: 40 }, 2: { coins: 650, xp: 60 }, 3: { coins: 1000, xp: 100 } },
  monthly: { 1: { coins: 1500, xp: 150 }, 2: { coins: 2500, xp: 250 }, 3: { coins: 4000, xp: 400 } }
};

const P = { pending: true };
const DAILY = [
  [1, 'PRÉSENT !', 'Connecte-toi aujourd’hui.', 'visitDays', 1, 1],
  [2, 'BONUS DU JOUR', 'Réclame ta récompense quotidienne.', 'dailyBonus', 1, 1],
  [3, 'OUVERTURE DU JOUR', 'Ouvre 1 pack.', 'packsOpened', 1, 1],
  [4, 'DOUBLE OUVERTURE', 'Ouvre 2 packs.', 'packsOpened', 2, 2],
  [5, 'TRIPLE OUVERTURE', 'Ouvre 3 packs.', 'packsOpened', 3, 3],
  [6, 'PETITE RÉCOLTE', 'Obtiens 3 cartes.', 'cardsObtained', 3, 1],
  [7, 'RÉCOLTE QUOTIDIENNE', 'Obtiens 5 cartes.', 'cardsObtained', 5, 2],
  [8, 'ÉCLAT QUOTIDIEN', 'Obtiens une carte Rare ou mieux.', 'rarePlusObtained', 1, 2],
  [9, 'ÉCLAT ÉPIQUE', 'Obtiens une carte Epic ou mieux.', 'epicPlusObtained', 1, 3],
  [10, 'TOUR DES CLUBS', 'Obtiens des cartes de 3 clubs différents.', 'distinctClubsObtained', 3, 2],
  [11, 'DERNIER REMPART', 'Obtiens un gardien.', 'gkObtained', 1, 1],
  [12, 'RENFORT OFFENSIF', 'Obtiens un attaquant.', 'attObtained', 1, 1],
  [13, 'RENFORT DÉFENSIF', 'Obtiens un défenseur.', 'defObtained', 1, 1],
  [14, 'RENFORT AU MILIEU', 'Obtiens un milieu.', 'midObtained', 1, 1],
  [15, 'BON NIVEAU', 'Obtiens une carte 75+ OVR.', 'ovr75Obtained', 1, 2],
  [16, 'HAUT NIVEAU', 'Obtiens une carte 80+ OVR.', 'ovr80Obtained', 1, 3],
  [17, 'PREMIÈRE OFFRE', 'Place une enchère.', 'bidsPlaced', 1, 1],
  [18, 'ENCHÉRISSEUR', 'Place 3 enchères.', 'bidsPlaced', 3, 2],
  [19, 'MISE EN VENTE', 'Mets une carte en vente.', 'auctionsCreated', 1, 1],
  [20, 'VENTE DU JOUR', 'Vends une carte.', 'salesDone', 1, 2],
  [21, 'ADJUGÉ !', 'Remporte une enchère.', 'auctionsWon', 1, 3],
  [22, 'PETITES DÉPENSES', 'Dépense 500 FC.', 'coinsSpent', 500, 1],
  [23, 'GROSSES DÉPENSES', 'Dépense 1 000 FC.', 'coinsSpent', 1000, 2],
  [24, 'ÉCHAUFFEMENT', 'Gagne 200 XP.', 'xpGained', 200, 2],
  [25, 'ENTRAÎNEMENT INTENSIF', 'Gagne 500 XP.', 'xpGained', 500, 3],
  [26, 'FEUILLETER L’ALBUM', 'Consulte ton album.', 'albumViews', 1, 1],
  [27, 'SCOUT', 'Ouvre la fiche détail de 3 cartes.', 'cardViews', 3, 1],
  [28, 'COMPARAISON', 'Compare-toi au classement.', 'rankingViews', 1, 1],
  [29, 'MISSION ACCOMPLIE', 'Récupère 1 mission de progression aujourd’hui.', 'fixedMissionsClaimed', 1, 2],
  [30, 'OUVERTURE MATINALE', 'Ouvre un pack avant midi.', 'packsBeforeNoon', 1, 1],
  [31, 'OUVERTURE DU SOIR', 'Ouvre un pack après 20 h.', 'packsAfter20', 1, 1],
  [32, 'NOUVEAU VISAGE', 'Obtiens une carte que tu n’avais pas.', 'newCardsObtained', 1, 1],
  [33, 'NOUVEAUX VISAGES', 'Obtiens 2 cartes que tu n’avais pas.', 'newCardsObtained', 2, 2],
  [34, 'DOUBLON', 'Obtiens un doublon.', 'duplicateObtained', 1, 1],
  [35, 'LÈCHE-VITRINE', 'Consulte le Market 3 fois.', 'marketViews', 3, 1],
  [36, 'COUP DE CŒUR', 'Ajoute une carte en favori.', 'favoritesAdded', 1, 1],
  [37, 'PARTAGE', 'Partage ta collection.', 'pending', 1, 1, P],
  [38, 'STARTER DU JOUR', 'Ouvre un Starter Pack.', 'starterOpened', 1, 1],
  [39, 'PRO DU JOUR', 'Ouvre un Pro Pack.', 'proOpened', 1, 2],
  [40, 'SANS-FAUTE', 'Complète toutes les autres missions du jour.', 'allPeriodMissions', 1, 3]
];
const WEEKLY = [
  [1, 'HABITUÉ', 'Connecte-toi 5 jours sur 7.', 'visitDays', 5, 2],
  [2, 'INCONDITIONNEL', 'Connecte-toi 7 jours sur 7.', 'visitDays', 7, 3],
  [3, 'OUVREUR DE LA SEMAINE', 'Ouvre 5 packs.', 'packsOpened', 5, 1],
  [4, 'DIX OUVERTURES', 'Ouvre 10 packs.', 'packsOpened', 10, 2],
  [5, 'QUINZE OUVERTURES', 'Ouvre 15 packs.', 'packsOpened', 15, 2],
  [6, 'VINGT OUVERTURES', 'Ouvre 20 packs.', 'packsOpened', 20, 3],
  [7, 'COLLECTE HEBDOMADAIRE', 'Obtiens 15 cartes.', 'cardsObtained', 15, 1],
  [8, 'GRANDE COLLECTE', 'Obtiens 30 cartes.', 'cardsObtained', 30, 2],
  [9, 'DUO ÉPIQUE', 'Obtiens 2 cartes Epic ou mieux.', 'epicPlusObtained', 2, 2],
  [10, 'TOUCHE DE LÉGENDE', 'Obtiens 1 carte Legendary ou mieux.', 'legendaryPlusObtained', 1, 3],
  [11, 'CHASSE AUX RARETÉS', 'Obtiens 5 cartes Rare ou mieux.', 'rarePlusObtained', 5, 1],
  [12, 'GRANDE CHASSE', 'Obtiens 10 cartes Rare ou mieux.', 'rarePlusObtained', 10, 2],
  [13, 'EXPLORATION DU TERRAIN', 'Obtiens des cartes de 8 clubs différents.', 'distinctClubsObtained', 8, 1],
  [14, 'TOUR DE FRANCE', 'Obtiens des cartes de 12 clubs différents.', 'distinctClubsObtained', 12, 2],
  [15, 'TRIO DE GARDIENS', 'Obtiens 3 gardiens.', 'gkObtained', 3, 1],
  [16, 'ATTAQUE DE FEU', 'Obtiens 5 attaquants.', 'attObtained', 5, 1],
  [17, 'DÉFENSE DE FER', 'Obtiens 5 défenseurs.', 'defObtained', 5, 1],
  [18, 'MILIEU SOLIDE', 'Obtiens 5 milieux.', 'midObtained', 5, 1],
  [19, 'ÉLITE DE LA SEMAINE', 'Obtiens une carte 85+ OVR.', 'ovr85Obtained', 1, 3],
  [20, 'CINQ OFFRES', 'Place 5 enchères.', 'bidsPlaced', 5, 1],
  [21, 'DIX OFFRES', 'Place 10 enchères.', 'bidsPlaced', 10, 2],
  [22, 'DOUBLE VICTOIRE', 'Remporte 2 enchères.', 'auctionsWon', 2, 2],
  [23, 'TRIPLE VICTOIRE', 'Remporte 3 enchères.', 'auctionsWon', 3, 3],
  [24, 'MARCHAND', 'Vends 3 cartes.', 'salesDone', 3, 2],
  [25, 'GRAND MARCHAND', 'Vends 5 cartes.', 'salesDone', 5, 3],
  [26, 'VENTE DE PRESTIGE', 'Vends une carte Rare ou mieux.', 'salesRarePlus', 1, 2],
  [27, 'DÉPENSIER', 'Dépense 2 000 FC.', 'coinsSpent', 2000, 1],
  [28, 'GROS DÉPENSIER', 'Dépense 5 000 FC.', 'coinsSpent', 5000, 2],
  [29, 'BONNES AFFAIRES', 'Gagne 1 000 FC en ventes.', 'salesEarned', 1000, 2],
  [30, 'EXCELLENTES AFFAIRES', 'Gagne 3 000 FC en ventes.', 'salesEarned', 3000, 3],
  [31, 'PROGRESSION', 'Gagne 1 000 XP.', 'xpGained', 1000, 2],
  [32, 'GRANDE PROGRESSION', 'Gagne 2 500 XP.', 'xpGained', 2500, 3],
  [33, 'RÉGULIER', 'Complète 5 missions quotidiennes.', 'dailyMissionsClaimed', 5, 1],
  [34, 'TRÈS RÉGULIER', 'Complète 10 missions quotidiennes.', 'dailyMissionsClaimed', 10, 2],
  [35, 'INFATIGABLE', 'Complète 20 missions quotidiennes.', 'dailyMissionsClaimed', 20, 3],
  [36, 'ALBUM EN PROGRÈS', 'Progresse de 10 % sur un album de club.', 'albumProgressPct', 10, 2],
  [37, 'ALBUM BOUCLÉ', 'Complète un album de club.', 'albumsCompleted', 1, 3],
  [38, 'NOUVELLES TÊTES', 'Obtiens 5 nouvelles cartes (jamais possédées).', 'newCardsObtained', 5, 1],
  [39, 'GRAND RECRUTEMENT', 'Obtiens 10 nouvelles cartes.', 'newCardsObtained', 10, 2],
  [40, 'FIDÈLE', 'Réclame ta récompense quotidienne 5 fois.', 'dailyBonus', 5, 1],
  [41, 'TRÈS FIDÈLE', 'Réclame ta récompense quotidienne 7 fois.', 'dailyBonus', 7, 2],
  [42, 'VAULT EN HAUSSE', 'Fais monter ta Vault Value de 5 000 FC.', 'vaultGain', 5000, 2],
  [43, 'VAULT EN FLÈCHE', 'Fais monter ta Vault Value de 20 000 FC.', 'vaultGain', 20000, 3],
  [44, 'CATALOGUE COMPLET', 'Ouvre un pack de chaque type.', 'allPackTypesOpened', 1, 3],
  [45, 'SEMAINE PARFAITE', 'Complète toutes les autres missions de la semaine.', 'allPeriodMissions', 1, 3]
];
const MONTHLY = [
  [1, 'MOIS D’OUVERTURES', 'Ouvre 50 packs.', 'packsOpened', 50, 1],
  [2, 'CENT OUVERTURES', 'Ouvre 100 packs.', 'packsOpened', 100, 3],
  [3, 'MOIS ÉPIQUE', 'Obtiens 5 cartes Epic ou mieux.', 'epicPlusObtained', 5, 1],
  [4, 'MOIS LÉGENDAIRE', 'Obtiens 2 cartes Legendary ou mieux.', 'legendaryPlusObtained', 2, 2],
  [5, 'ICÔNE DU MOIS', 'Obtiens 1 carte Icon.', 'iconObtained', 1, 3],
  [6, 'MARCHAND DU MOIS', 'Vends 15 cartes.', 'salesDone', 15, 2],
  [7, 'ROI DES ENCHÈRES', 'Remporte 10 enchères.', 'auctionsWon', 10, 2],
  [8, 'MOIS D’ENTRAÎNEMENT', 'Gagne 10 000 XP.', 'xpGained', 10000, 3],
  [9, 'NIVEAU SUPÉRIEUR', 'Gagne un niveau.', 'levelsGained', 1, 1],
  [10, 'DOUBLE NIVEAU', 'Gagne 2 niveaux.', 'levelsGained', 2, 2],
  [11, 'DEUX ALBUMS', 'Complète 2 albums de club.', 'albumsCompleted', 2, 3],
  [12, 'MOIS ASSIDU', 'Connecte-toi 25 jours dans le mois.', 'visitDays', 25, 2],
  // Le document dit 100 missions quotidiennes ; avec 3 missions par jour, 60 est atteignable.
  [13, 'MARATHONIEN', 'Complète 60 missions quotidiennes.', 'dailyMissionsClaimed', 60, 3],
  [14, 'HUIT SEMAINES EN UNE', 'Complète 8 missions hebdomadaires.', 'weeklyMissionsClaimed', 8, 2],
  [15, 'VAULT DU MOIS', 'Fais monter ta Vault Value de 100 000 FC.', 'vaultGain', 100000, 3]
];

const slug = v => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const PERIOD_WORD = { daily: ' aujourd’hui', weekly: ' cette semaine', monthly: ' ce mois-ci' };
const build = (kind, prefix, rows) => rows.map(([code, title, description, type, target, tier, opts = {}]) => ({
  kind, code, id: `${prefix}${String(code).padStart(2, '0')}-${slug(title)}`, title,
  description: /aujourd’hui|semaine|mois|7 jours sur 7|autres missions/.test(description) ? description : description.replace(/\.$/, PERIOD_WORD[kind] + '.'),
  type, target, tier, active: !opts.pending, pending: !!opts.pending, coins: TIERS[kind][tier].coins, xp: TIERS[kind][tier].xp
}));

const MISSION_CATALOG = [...build('daily', 'd', DAILY), ...build('weekly', 'w', WEEKLY), ...build('monthly', 'm', MONTHLY)];

// Sélection de la période : même tirage pour tous les joueurs, stable pendant toute la période
// (graine = type de période + clé de période), parmi les missions actives, ordre d'origine conservé.
function hashSeed(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rotationFor(kind, periodKey, tasks, count = ROTATION[kind]) {
  if (!count || tasks.length <= count) return tasks.slice();
  let seed = hashSeed(kind + ':' + periodKey) || 1;
  const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const pool = tasks.map((t, i) => ({ t, i, r: rand() })).sort((a, b) => a.r - b.r).slice(0, count);
  return pool.sort((a, b) => a.i - b.i).map(x => x.t);
}

module.exports = { MISSION_CATALOG, ROTATION, TIERS: TIERS, rotationFor };
