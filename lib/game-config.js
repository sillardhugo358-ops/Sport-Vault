'use strict';

// Configuration du jeu : raretés, cartes de secours, packs, missions,
// succès par défaut, tâches quotidiennes et hebdomadaires, clubs d'album.

const RARITIES = {
  common: { label: 'COMMON', order: 1 },
  rare: { label: 'RARE', order: 2 },
  epic: { label: 'EPIC', order: 3 },
  legendary: { label: 'LEGENDARY', order: 4 },
  icon: { label: 'ICON', order: 5 }
};

const FOOTVAULT_CARDS = [
  ['Nolan Vasseur', 'GK', 'Aster FC', 'France', 'common'], ['Maël Dervin', 'GK', 'Racing Nord', 'France', 'common'],
  ['Ilyan Mercier', 'RB', 'Union Atlantique', 'France', 'common'], ['Sacha Perrin', 'LB', 'Stade Horizon', 'France', 'common'],
  ['Noé Caron', 'CB', 'Aster FC', 'Belgium', 'common'], ['Tiago Valente', 'CM', 'Racing Nord', 'Portugal', 'common'],
  ['Yanis Roux', 'CM', 'Union Atlantique', 'France', 'common'], ['Eden Marceau', 'RW', 'Stade Horizon', 'France', 'common'],
  ['Kylian Mercier', 'ST', 'Aster FC', 'France', 'common'], ['Liam Sorel', 'LW', 'Racing Nord', 'France', 'common'],
  ['Hugo Delmas', 'CB', 'Union Atlantique', 'France', 'rare'], ['Amine Bensaïd', 'DM', 'Stade Horizon', 'Morocco', 'rare'],
  ['Rayan Giraud', 'AM', 'Aster FC', 'France', 'rare'], ['Matteo Rinaldi', 'ST', 'Racing Nord', 'Italy', 'rare'],
  ['Elias Novak', 'GK', 'Union Atlantique', 'Croatia', 'rare'], ['Iker Solano', 'LW', 'Stade Horizon', 'Spain', 'rare'],
  ['Jules Ferrand', 'CB', 'Aster FC', 'France', 'epic'], ['Nassim Belkacem', 'CM', 'Union Atlantique', 'Algeria', 'epic'],
  ['Oscar Lund', 'RW', 'Racing Nord', 'Sweden', 'epic'], ['Milo Varga', 'ST', 'Stade Horizon', 'Hungary', 'epic'],
  ['Adrien Montfort', 'GK', 'Aster FC', 'France', 'legendary'], ['Sami Kader', 'AM', 'Union Atlantique', 'France', 'legendary'],
  ['Diego Aranda', 'ST', 'Racing Nord', 'Argentina', 'legendary'], ['Victor Saint-Clair', 'ST', 'Stade Horizon', 'France', 'icon']
];

const PACKS = {
  starter:{id:'starter',name:'STARTER PACK',price:100,currency:'coins',cards:5,badge:'POUR COMMENCER',description:'5 cartes FOOTVAULT',guarantee:'common'},
  pro:{id:'pro',name:'PRO PACK',price:250,currency:'coins',cards:8,badge:'LE PLUS POPULAIRE',description:'8 cartes FOOTVAULT · 1 carte RARE ou mieux garantie',guarantee:'rare'},
  legend:{id:'legend',name:'LEGEND PACK',price:500,currency:'coins',cards:5,badge:'HAUTE RARETÉ',description:'5 cartes FOOTVAULT · 1 carte EPIC ou mieux garantie',guarantee:'epic'}
};

// Packs thématiques (migration packs-competitions-decennies-2026-09-30) : un par
// compétition et un par décennie. Conditions lues par lib/cards.js
// (competitions : identifiants de compétition ; decades : année de début, ex. '2010').
const THEMED_PACK_BASE={price:300,cards:6,guarantee:'rare',guaranteeCount:1};
const THEMED_PACKS=[
  {id:'pack-ligue-1',name:'PACK LIGUE 1',badge:'FRANCE',description:'6 cartes Ligue 1 · 1 carte RARE ou mieux garantie',conditions:{competitions:['ligue-1']}},
  {id:'pack-premier-league',name:'PACK PREMIER LEAGUE',badge:'ANGLETERRE',description:'6 cartes Premier League · 1 carte RARE ou mieux garantie',conditions:{competitions:['premier-league']}},
  {id:'pack-la-liga',name:'PACK LA LIGA',badge:'ESPAGNE',description:'6 cartes La Liga · 1 carte RARE ou mieux garantie',conditions:{competitions:['la-liga']}},
  {id:'pack-serie-a',name:'PACK SERIE A',badge:'ITALIE',description:'6 cartes Serie A · 1 carte RARE ou mieux garantie',conditions:{competitions:['serie-a']}},
  {id:'pack-bundesliga',name:'PACK BUNDESLIGA',badge:'ALLEMAGNE',description:'6 cartes Bundesliga · 1 carte RARE ou mieux garantie',conditions:{competitions:['bundesliga']}},
  {id:'pack-coupe-du-monde',name:'PACK COUPE DU MONDE',badge:'MONDIAL',description:'6 cartes de la Coupe du monde (1930-2026) · 1 carte RARE ou mieux garantie',conditions:{competitions:['coupe-du-monde']}},
  {id:'pack-ligue-des-nations',name:'PACK LIGUE DES NATIONS',badge:'EUROPE',description:'6 cartes de la Ligue des Nations (2019-2025) · 1 carte RARE ou mieux garantie',conditions:{competitions:['ligue-des-nations']}},
  {id:'pack-ligue-des-champions',name:'PACK LIGUE DES CHAMPIONS',badge:'EUROPE',description:'6 cartes de la Ligue des Champions (1991-2026) · 1 carte RARE ou mieux garantie',conditions:{competitions:['ligue-des-champions']}},
  {id:'pack-annees-2010',name:'PACK ANNÉES 2010',badge:'2010-2019',description:'6 cartes des saisons 2010-2011 à 2019-2020 · 1 carte RARE ou mieux garantie',conditions:{decades:['2010']}},
  {id:'pack-annees-2020',name:'PACK ANNÉES 2020',badge:'2020-2029',description:'6 cartes des saisons 2020-2021 et suivantes · 1 carte RARE ou mieux garantie',conditions:{decades:['2020']}}
].map(p=>({...THEMED_PACK_BASE,...p,conditions:{standardOnly:true,...p.conditions}}));

const PACK_WEIGHTS=[['common',72],['rare',21],['epic',5],['legendary',1.8],['icon',0.2]];

const MISSIONS=[
  {id:'collect-5',order:1,title:'PREMIÈRE COLLECTION',description:'Possède au moins 5 cartes dans ton Vault.',target:5,type:'cards',reward:{coins:150,xp:25}},
  {id:'open-1',order:2,title:'PREMIÈRE OUVERTURE',description:'Ouvre ton premier pack.',target:1,type:'packs',prerequisite:'collect-5',reward:{coins:150,xp:30}},
  {id:'rare-1',order:3,title:'PREMIÈRE RARETÉ',description:'Obtiens une carte RARE ou supérieure.',target:1,type:'rarePlus',prerequisite:'open-1',reward:{coins:250,xp:40}},
  {id:'collect-15',order:4,title:'SCOUTING INTENSIF',description:'Possède au moins 15 cartes.',target:15,type:'cards',prerequisite:'rare-1',reward:{coins:300,xp:50}},
  {id:'open-3',order:5,title:'COLLECTIONNEUR ACTIF',description:'Ouvre 3 packs au total.',target:3,type:'packs',prerequisite:'collect-15',reward:{coins:350,xp:60}},
  {id:'epic-1',order:6,title:'CAP SUR L’ÉLITE',description:'Obtiens une carte EPIC ou supérieure.',target:1,type:'epicPlus',prerequisite:'open-3',reward:{coins:450,xp:75}},
  {id:'collect-25',order:7,title:'VAULT EN PLEINE CROISSANCE',description:'Possède au moins 25 cartes.',target:25,type:'cards',prerequisite:'epic-1',reward:{coins:500,xp:90}},
  {id:'clubs-4',order:8,title:'TOUR DU TERRAIN',description:'Possède des cartes provenant d’au moins 4 clubs différents.',target:4,type:'distinctClubs',prerequisite:'collect-25',reward:{coins:600,xp:110}},
  {id:'legend-1',order:9,title:'TOUCHE DE LÉGENDE',description:'Obtiens une carte LEGENDARY ou supérieure.',target:1,type:'legendaryPlus',prerequisite:'clubs-4',reward:{coins:750,xp:130}},
  {id:'open-10',order:10,title:'OUVREUR EXPÉRIMENTÉ',description:'Ouvre 10 packs au total.',target:10,type:'packs',prerequisite:'legend-1',reward:{coins:900,xp:150}},
  {id:'collect-40',order:11,title:'GRAND COLLECTIONNEUR',description:'Possède au moins 40 cartes.',target:40,type:'cards',prerequisite:'open-10',reward:{coins:1000,xp:175}},
  {id:'icon-1',order:12,title:'AU SOMMET DU VAULT',description:'Obtiens une carte ICON.',target:1,type:'iconPlus',prerequisite:'collect-40',reward:{coins:1500,xp:200}}
];

const DEFAULT_ACHIEVEMENTS=[
{id:'ach-first-card',name:'Première carte',category:'Collection',description:'Possède au moins 1 carte.',type:'cards',target:1,coins:50,xp:10,icon:'▤',active:true},
{id:'ach-collector-10',name:'Collectionneur',category:'Collection',description:'Possède 10 cartes.',type:'cards',target:10,coins:100,xp:25,icon:'▤',active:true},
{id:'ach-collector-50',name:'Passionné',category:'Collection',description:'Possède 50 cartes.',type:'cards',target:50,coins:250,xp:60,icon:'▤',active:true},
{id:'ach-rare',name:'Première rare',category:'Raretés',description:'Possède une carte Rare ou supérieure.',type:'rarePlus',target:1,coins:75,xp:20,icon:'◆',active:true},
{id:'ach-epic',name:'Première épique',category:'Raretés',description:'Possède une carte Epic ou supérieure.',type:'epicPlus',target:1,coins:150,xp:35,icon:'✦',active:true},
{id:'ach-legendary',name:'Première légende',category:'Raretés',description:'Possède une carte Legendary ou supérieure.',type:'legendaryPlus',target:1,coins:250,xp:60,icon:'♛',active:true},
{id:'ach-icon',name:'Première icône',category:'Raretés',description:'Possède une carte Icon.',type:'iconPlus',target:1,coins:500,xp:120,icon:'✧',active:true},
{id:'ach-clubs-4',name:'Tour du terrain',category:'Diversité',description:'Possède des cartes de 4 clubs différents.',type:'distinctClubs',target:4,coins:200,xp:50,icon:'♧',active:true},
{id:'ach-packs-10',name:'Ouvreur confirmé',category:'Packs',description:'Ouvre 10 packs.',type:'packs',target:10,coins:150,xp:40,icon:'⬡',active:true}
];

const DAILY_TASKS=[
  {id:'open-1',title:'OUVERTURE DU JOUR',description:'Ouvre au moins 1 pack aujourd’hui.',target:1,type:'packsOpened',reward:{coins:100,xp:10}},
  {id:'cards-5',title:'RÉCOLTE QUOTIDIENNE',description:'Obtiens au moins 5 cartes aujourd’hui.',target:5,type:'cardsObtained',reward:{coins:150,xp:15}},
  {id:'rare-1',title:'ÉCLAT QUOTIDIEN',description:'Obtiens au moins 1 carte RARE ou supérieure aujourd’hui.',target:1,type:'rarePlusObtained',reward:{coins:200,xp:20}},
  {id:'clubs-2',title:'TOUR DES CLUBS',description:'Obtiens des cartes provenant d’au moins 2 clubs différents aujourd’hui.',target:2,type:'distinctClubsObtained',reward:{coins:250,xp:25}}
];

const WEEKLY_TASKS=[
  {id:'open-5',title:'OUVREUR DE LA SEMAINE',description:'Ouvre au moins 5 packs cette semaine.',target:5,type:'packsOpened',reward:{coins:400,xp:35}},
  {id:'cards-15',title:'COLLECTE HEBDOMADAIRE',description:'Obtiens au moins 15 cartes cette semaine.',target:15,type:'cardsObtained',reward:{coins:500,xp:40}},
  {id:'rare-3',title:'CHASSE AUX RARETÉS',description:'Obtiens au moins 3 cartes RARE ou supérieures cette semaine.',target:3,type:'rarePlusObtained',reward:{coins:650,xp:50}},
  {id:'clubs-4',title:'EXPLORATION DU TERRAIN',description:'Obtiens des cartes provenant d’au moins 4 clubs différents cette semaine.',target:4,type:'distinctClubsObtained',reward:{coins:750,xp:60}}
];

// Récompenses de l'album : club complet, saison complète (tous ses clubs), championnat entier (toutes ses saisons).
// Récompenses du classement de la semaine (lib/leaderboard.js), par tranche de rang (ex æquo : même récompense).
const LEADERBOARD_REWARDS=[{from:1,to:1,coins:5000,xp:500},{from:2,to:2,coins:3000,xp:300},{from:3,to:3,coins:2000,xp:200},{from:4,to:10,coins:1000,xp:100},{from:11,to:50,coins:300,xp:30}];
const ALBUM_REWARDS={club:{coins:250,xp:25},season:{coins:2000,xp:200},competition:{coins:25000,xp:2500}};

const ALBUM_CLUBS=[['aster-fc','Aster FC','AST'],['racing-nord','Racing Nord','RN'],['union-atlantique','Union Atlantique','UA'],['stade-horizon','Stade Horizon','SH']].map(([id,name,tag])=>({id,name,tag}));

module.exports = { RARITIES, FOOTVAULT_CARDS, PACKS, THEMED_PACKS, PACK_WEIGHTS, MISSIONS, DEFAULT_ACHIEVEMENTS, DAILY_TASKS, WEEKLY_TASKS, ALBUM_CLUBS, ALBUM_REWARDS, LEADERBOARD_REWARDS };
