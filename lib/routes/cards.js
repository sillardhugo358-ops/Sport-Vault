'use strict';

// Catalogue, collection, packs et pools.
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');
const { RARITIES } = require('../game-config');
const fs = require('node:fs');
const path = require('node:path');
const { clubKey, normName, CLUB_ALIASES } = require('../club-key');
const { NATION_FR } = require('../nations');

// Fichiers du dossier club-logos/ : clé du club déduite du nom de fichier (« ldc- » et « selection- » retirés), pour
// qu'un logo présent s'affiche même si le club de la base a un autre identifiant ou un logo cassé.
const CLUB_LOGOS_DIR = process.env.CLUB_LOGOS_DIR || path.join(__dirname, '..', '..', 'club-logos');
function logoFileNames() {
  try { return fs.readdirSync(CLUB_LOGOS_DIR).filter(f => !f.startsWith('.') && /\.(png|webp|jpe?g)$/i.test(f)).sort(); } catch { return []; }
}
function clubLogoFiles() {
  const out = {};
  for (const f of logoFileNames()) {
    const k = clubKey(f.replace(/\.\w+$/, '').replace(/^(ldc|selection)-/, ''));
    if (k && !out[k]) out[k] = 'club-logos/' + f;
  }
  return out;
}
// Drapeaux (fichiers selection-<pays>) : clé = nom français normalisé (sans alias de clubs), pour la pastille de nationalité.
function flagFiles() {
  const out = {};
  for (const f of logoFileNames()) {
    if (!f.startsWith('selection-')) continue;
    const k = normName(f.replace(/\.\w+$/, '').replace(/^selection-/, ''));
    if (k && !out[k]) out[k] = 'club-logos/' + f;
  }
  return out;
}
// Variantes d'un nom de pays (anglais, codes) → nom français, clés normalisées ; seulement celles qui diffèrent.
const NATION_ALIASES = (() => {
  const out = {};
  for (const [from, to] of Object.entries(NATION_FR)) { const a = normName(from), b = normName(to); if (a && a !== b) out[a] = b; }
  return out;
})();
// Compétitions de championnat de chaque club (clé de club → identifiant), hors Ligue des Champions et sélections :
// aucun club n'appartient à deux championnats ; la compétition d'une carte se déduit de son club et de sa saison.
const NATIONAL_LEAGUES_SQL = "SELECT DISTINCT c.name,cs.competition_id FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id NOT IN ('ligue-des-champions','coupe-du-monde','ligue-des-nations') ORDER BY cs.competition_id,c.name";

let clubLogosCache=null;
const CLUB_LOGOS_CACHE_MS=Number(process.env.CLUB_LOGOS_CACHE_MS??(process.env.NODE_ENV==='test'?0:30000))||0;
function createCardsRoutes({ catalog, currentUser, getPool, getUserCards, listPacks, openPackForUser, openPoolForUser, safeUser }) {
 return async function cardsRoutes(req, res, url) {
// Résumé du catalogue pour l'accueil : évite de télécharger toutes les cartes (plus de 50 000).
// Logos des clubs pour les cartes : { logos: { <clé du club>: url }, flags, nations, leagues, aliases } ; la clé est celle de l'album (lib/club-key.js),
// le navigateur applique les mêmes alias. Quelques secondes de cache : la table change rarement.
if(req.method==='GET'&&url.pathname==='/api/club-logos'){
 if(!getPool())return json(res,200,{logos:{},fallback:{},flags:{},nations:{},leagues:{},aliases:CLUB_ALIASES});
 if(!clubLogosCache||Date.now()-clubLogosCache.at>=CLUB_LOGOS_CACHE_MS){
  const rows=(await getPool().query("SELECT name,logo_url FROM clubs WHERE logo_url IS NOT NULL AND logo_url<>'' ORDER BY sort_order,id")).rows,logos={};
  const fallback=clubLogoFiles();
  for(const r of rows){const k=clubKey(r.name);if(!logos[k])logos[k]=r.logo_url;}
  // Logo de la base prioritaire (choix d'un administrateur) ; sinon le fichier du dossier.
  for(const k of Object.keys(fallback))if(!logos[k])logos[k]=fallback[k];
  const leagues={};
  for(const r of (await getPool().query(NATIONAL_LEAGUES_SQL)).rows){const k=clubKey(r.name);if(!leagues[k])leagues[k]=r.competition_id;}
  clubLogosCache={at:Date.now(),logos,fallback,flags:flagFiles(),leagues};
 }
 return json(res,200,{logos:clubLogosCache.logos,fallback:clubLogosCache.fallback,flags:clubLogosCache.flags,nations:NATION_ALIASES,leagues:clubLogosCache.leagues,aliases:CLUB_ALIASES});
}
if(req.method==='GET'&&url.pathname==='/api/catalog/summary'){const pick=c=>({id:c.id,season:c.season,name:c.name,position:c.position,jerseyNumber:c.jersey_number??c.jerseyNumber??null,club:c.club,nation:c.nation,rarity:c.rarity,rarityLabel:String(c.rarity||'').toUpperCase(),ovr:Number(c.ovr||0),pace:Number(c.pace||0),shooting:Number(c.shooting||0),passing:Number(c.passing||0),dribbling:Number(c.dribbling||0),defending:Number(c.defending||0),physical:Number(c.physical||0)});if(getPool()){const [t,f]=await Promise.all([getPool().query('SELECT count(*)::int AS cards,count(DISTINCT club)::int AS clubs FROM catalog_cards WHERE is_active=true'),getPool().query('SELECT * FROM (SELECT DISTINCT ON (name) id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,card_order FROM catalog_cards WHERE is_active=true AND id !~ \'^fv-[wnc]-\' ORDER BY name,ovr DESC,card_order,id) best ORDER BY ovr DESC,card_order,id LIMIT 3')]);return json(res,200,{cards:t.rows[0].cards,clubs:t.rows[0].clubs,featured:f.rows.map(pick)});}return json(res,200,{cards:catalog().length,clubs:new Set(catalog().map(c=>c.club).filter(Boolean)).size,featured:[...catalog()].sort((a,b)=>Number(b.ovr||0)-Number(a.ovr||0)).slice(0,3).map(pick)});}
if(req.method==='GET'&&url.pathname==='/api/cards'){const rows=getPool()?(await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true ORDER BY card_order,id')).rows:catalog();const cards=getPool()?rows.map(row=>({id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr||72),pace:Number(row.pace||72),shooting:Number(row.shooting||72),passing:Number(row.passing||72),dribbling:Number(row.dribbling||72),defending:Number(row.defending||72),physical:Number(row.physical||72),distributionType:row.distribution_type,isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply),order:Number(row.card_order||0),rarityLabel:RARITIES[row.rarity]?.label||row.rarity})):rows;return json(res,200,{universe:'FOOTVAULT',season:'2026-2027',cards});}
if(req.method==='GET'&&url.pathname.startsWith('/api/cards/')){const cardId=decodeURIComponent(url.pathname.slice('/api/cards/'.length));const row=getPool()?(await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0]:catalog().find(c=>c.id===cardId);if(!row)return json(res,404,{error:'Carte introuvable.'});const c=getPool()?{id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr||72),pace:Number(row.pace||72),shooting:Number(row.shooting||72),passing:Number(row.passing||72),dribbling:Number(row.dribbling||72),defending:Number(row.defending||72),physical:Number(row.physical||72),distributionType:row.distribution_type,isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply),order:Number(row.card_order||0),rarityLabel:RARITIES[row.rarity]?.label||row.rarity}:row;return json(res,200,{card:c});}
if(req.method==='GET'&&url.pathname==='/api/packs')return json(res,200,{universe:'FOOTVAULT',season:'2026',...(await listPacks())});
if(req.method==='GET'&&url.pathname==='/api/collection'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);return json(res,200,{user:safeUser(user),cards,count:cards.length});}
if(req.method==='POST'&&url.pathname==='/api/packs/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPackForUser(user.id,String(body.packId||''));return json(res,result.error?result.status||400:200,result);}
if(req.method==='POST'&&url.pathname==='/api/pools/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPoolForUser(user.id,String(body.poolId||''));return json(res,result.error?result.status||400:200,result);}
  return false;
 };
}

module.exports = { createCardsRoutes };
