const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const { RARITIES, FOOTVAULT_CARDS, PACKS } = require('./lib/game-config');
const { initDb } = require('./lib/schema');

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map(), claims: new Map(), activity: [], reg: new Map(), login: new Map() };
const { hashPassword, verifyPassword, validPassword, safeUser, sessionCookie, expiryDate, findUserByEmail, getUserById, cleanupSessions, canManage, requireAdmin, currentUser, createSession, destroySession, registrationAllowed, markRegistration, loginStatus, loginFailure, loginSuccess } = require('./lib/auth').createAuth({ db: () => pool, memory });
const { publicCard, buildInstance, listPacks, createCardInstance, getUserCards, grantWelcomeCards, openPackForUser, openPoolForUser } = require('./lib/cards').createCards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, safeUser, securityEvent });
const { listMissions, isUnlocked: isMissionUnlocked, adminMissions, adminSaveMission } = require('./lib/missions').createMissions({ getPool: () => pool, adminLog: (...args) => adminLog(...args) });
const { levelProgressFromXp, applyReward, claimExists, addClaim, missionProgress, periodActivity, taskProgress, claimTask, claimDaily, claimMission, albumData } = require('./lib/rewards').createRewards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, getUserCards, publicCard, safeUser, securityEvent, listMissions });
const { settleExpiredAuctions, auctionData, withdrawAuctionParticipation, auctionHistory, createAuction, placeAuctionBid, cancelAuction, auctionBidHistory } = require('./lib/auctions').createAuctions({ getPool: () => pool, publicCard, securityEvent });
const { adminLog, adminSetAccountStatus, adminSetRole, adminAdjustResources, adminTransferCard, adminRemoveCard, adminGrantCard, adminLogs, adminOverview, adminCollections, adminSetCollection, adminPacks, adminSetPack, adminCompetitions, adminSetCompetition, adminCards, adminCreateCatalogCard, adminDeleteCatalogCard, adminUpdateCatalogCard, adminUsers, adminUserDetail, adminAuctions } = require('./lib/admin').createAdmin({ getPool: () => pool, catalog: () => CARD_CATALOG, getUserById, canManage, safeUser, securityEvent, buildInstance, createCardInstance, publicCard });
// Routes de l'API par domaine (lib/routes/) ; conditions exclusives, l'ordre est sans effet.
const apiRoutes = [
 require('./lib/routes/auth').createAuthRoutes({ createSession, currentUser, destroySession, expiryDate, findUserByEmail, getPool: () => pool, grantWelcomeCards, hashPassword, loginFailure, loginStatus, loginSuccess, markRegistration, memory, registrationAllowed, safeUser, securityEvent, sessionCookie, validPassword, verifyPassword }),
 require('./lib/routes/cards').createCardsRoutes({ catalog: () => CARD_CATALOG, currentUser, getPool: () => pool, getUserCards, listPacks, openPackForUser, openPoolForUser, safeUser }),
 require('./lib/routes/rewards').createRewardsRoutes({ listMissions, isMissionUnlocked, addClaim, albumData, applyReward, claimDaily, claimExists, claimMission, claimTask, currentUser, getPool: () => pool, getUserById, getUserCards, levelProgressFromXp, missionProgress, periodActivity, safeUser, securityEvent, taskProgress }),
 require('./lib/routes/auctions').createAuctionsRoutes({ auctionBidHistory, auctionData, auctionHistory, cancelAuction, createAuction, currentUser, placeAuctionBid, safeUser, withdrawAuctionParticipation }),
 require('./lib/routes/admin').createAdminRoutes({ adminMissions, adminSaveMission, adminAdjustResources, adminAuctions, adminCards, adminCollections, adminCompetitions, adminCreateCatalogCard, adminDeleteCatalogCard, adminGrantCard, adminLog, adminLogs, adminOverview, adminPacks, adminRemoveCard, adminSetAccountStatus, adminSetCollection, adminSetCompetition, adminSetPack, adminSetRole, adminTransferCard, adminUpdateCatalogCard, adminUserDetail, adminUsers, getPool: () => pool, requireAdmin, safeUser }),
 require('./lib/routes/internal').createInternalRoutes({ getPool: () => pool })
];

function loadFootMercatoCatalog(){
  const base=path.join(ROOT,'data');
  const encoded=[0,1,2].map(i=>fs.readFileSync(path.join(base,'footmercato_catalog_'+i+'.b64'),'utf8').trim()).join('');
  const seed=JSON.parse(zlib.inflateSync(Buffer.from(encoded,'base64')).toString('utf8'));
  return seed.rows.map((line,i)=>{
    const v=line.split('|');
    const club=seed.clubs[Number(v[0])],name=v[1],position=seed.positions[Number(v[2])];
    const nation=Number(v[3])<0?'':seed.nations[Number(v[3])],rarity=seed.rarities[Number(v[4])].toLowerCase(),jersey=Number(v[5]);
    return {id:'fv-ligue-1-2026-2027-'+String(i+1).padStart(3,'0'),season:'2026-2027',name,position,jerseyNumber:jersey<0?null:jersey,club,nation,rarity,rarityLabel:RARITIES[rarity]?.label||rarity,ovr:Number(v[6]),pace:Number(v[7]),shooting:Number(v[8]),passing:Number(v[9]),dribbling:Number(v[10]),defending:Number(v[11]),physical:Number(v[12]),distributionType:'STANDARD',isLimited:false,maxSupply:null,order:i};
  });
}
let CARD_CATALOG;
try{CARD_CATALOG=loadFootMercatoCatalog();if(CARD_CATALOG.length!==478)throw new Error('Catalogue Foot Mercato invalide: '+CARD_CATALOG.length+' cartes.');console.log('[FOOTVAULT] Catalogue Foot Mercato chargé: '+CARD_CATALOG.length+' cartes.');}
catch(error){console.error('[FOOTVAULT] Impossible de charger le catalogue Foot Mercato:',error.message);CARD_CATALOG=FOOTVAULT_CARDS.map(([name, position, club, nation, rarity], i) => ({ id:`fv-${String(i+1).padStart(3,'0')}`, season:'2026', name, position, club, nation, rarity, rarityLabel:RARITIES[rarity].label, distributionType:'STANDARD', isLimited:false, maxSupply:null, ovr:({common:72,rare:78,epic:84,legendary:91,icon:96}[rarity]||72), order:i+1 }));}

const { json } = require('./lib/http');

async function securityEvent(userId,ip,event,details={},client=null){const db=client||pool;if(!db)return;
 // Inside a transaction, a failed INSERT would abort it and turn the caller's
 // COMMIT into a silent ROLLBACK: isolate the write in a savepoint.
 if(client)await client.query('SAVEPOINT security_event');
 try{await db.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[userId||null,ip||null,event,JSON.stringify(details)]);if(client)await client.query('RELEASE SAVEPOINT security_event');}
 catch(e){console.error('SPORT VAULT security event error:',e.message);if(client)await client.query('ROLLBACK TO SAVEPOINT security_event');}}

// Fichiers publics : uniquement à la racine du dépôt, pages, styles et images, plus les
// scripts de l'interface listés ci-dessous. Jamais le code serveur, lib/, data/, .git/ ni la configuration.
const PUBLIC_SCRIPTS=new Set(['app.js','success-admin-editor.js','mission-admin-editor.js','manifest.json']);
const PUBLIC_EXTENSIONS=new Set(['.html','.css','.svg','.png','.ico','.webp']);
function isPublicFile(name){return !name.startsWith('.')&&(PUBLIC_SCRIPTS.has(name)||PUBLIC_EXTENSIONS.has(path.extname(name)));}
function staticFile(req,res){let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{return json(res,400,{error:'Chemin invalide.'});}if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,path.normalize(pathname));if(path.dirname(file)!==ROOT||!isPublicFile(path.basename(file))||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);}

(async()=>{let dbReady=false;let dbMode='starting';const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'&&!dbReady)return json(res,503,{error:'Base de données en cours de démarrage.'});
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:dbReady,ready:dbReady,version:'0.3.0',storage:pool?'postgres':dbMode,universe:'FOOTVAULT',cards:CARD_CATALOG.length,packs:Object.keys(PACKS),timestamp:new Date().toISOString()});
 for(const route of apiRoutes)if(await route(req,res,url))return;
 return staticFile(req,res);
}catch(error){console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',async()=>{console.log(`SPORT VAULT running on ${PORT}`);try{const db=await initDb({getCatalog:()=>CARD_CATALOG,setCatalog:c=>{CARD_CATALOG=c},setPool:p=>{pool=p},grantWelcomeCards,hashPassword,loadFootMercatoCatalog});dbMode=db.mode;dbReady=true;console.log(`SPORT VAULT startup: storage=${db.mode}`);if(pool){setInterval(settleExpiredAuctions,30_000);setInterval(cleanupSessions,5*60_000);}}catch(e){console.error('SPORT VAULT startup database error:',e.message);dbMode='unavailable';}});})();
