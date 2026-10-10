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
const { hashPassword, verifyPassword, validPassword, safeUser, sessionCookie, expiryDate, findUserByEmail, getUserById, cleanupSessions, canManage, requireAdmin, currentUser: authCurrentUser, createSession, destroySession, registrationAllowed, markRegistration, loginStatus, loginFailure, loginSuccess } = require('./lib/auth').createAuth({ db: () => pool, memory });
const { publicCard, configuredPackCards, buildInstance, listPacks, createCardInstance, getUserCards, grantWelcomeCards, openPackForUser, openPoolForUser, warmCatalog, activeCatalogCards } = require('./lib/cards').createCards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, setCatalog: c => { CARD_CATALOG = c; }, getUserById, safeUser, securityEvent });
const { listMissions, isUnlocked: isMissionUnlocked, adminMissions, adminSaveMission } = require('./lib/missions').createMissions({ getPool: () => pool, adminLog: (...args) => adminLog(...args) });
const { listChallenges, claimChallenge, adminChallenges, adminSaveChallenge } = require('./lib/challenges').createChallenges({ getPool: () => pool, adminLog: (...args) => adminLog(...args), applyReward: (...args) => applyReward(...args), securityEvent: (...args) => securityEvent(...args) });
const { listSets, claimSet, adminSets, adminSaveSet } = require('./lib/card-sets').createCardSets({ getPool: () => pool, adminLog: (...args) => adminLog(...args), applyReward: (...args) => applyReward(...args), securityEvent: (...args) => securityEvent(...args) });
const { info: tradeInfo, lookupPlayer: tradeLookupPlayer, myTradeableCards: tradeMyCards, createOffer: tradeCreateOffer, listOffers: tradeListOffers, cancelOffer: tradeCancelOffer, declineOffer: tradeDeclineOffer, acceptOffer: tradeAcceptOffer, ensureCode: tradeEnsureCode } = require('./lib/trades').createTrades({ getPool: () => pool, securityEvent: (...args) => securityEvent(...args) });
const { rankOf, leaderboard, settleLastWeek, myRewards: myLeaderboardRewards, claimLeaderboardReward, claimSeasonReward, adminSeasonPrizes, adminSetSeasonPrize } = require('./lib/leaderboard').createLeaderboard({ getPool: () => pool, applyReward: (...args) => applyReward(...args), securityEvent: (...args) => securityEvent(...args), adminLog: (...args) => adminLog(...args),
  // Carte exclusive de saison : instance créée dans la transaction de la récupération (numéro de série géré pour les cartes LIMITED).
  grantCard: async (client, userId, cardId, source) => {
    // Lue en base (pas dans le catalogue en mémoire) : une carte créée après le démarrage est utilisable tout de suite.
    const row = (await client.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,max_supply FROM catalog_cards WHERE id=$1 AND is_active=true', [cardId])).rows[0];
    if (!row) throw new Error('Carte introuvable au catalogue.');
    const card = { id: row.id, season: row.season, name: row.name, position: row.position, jerseyNumber: row.jersey_number == null ? null : Number(row.jersey_number), club: row.club, nation: row.nation, rarity: row.rarity, ovr: Number(row.ovr), pace: Number(row.pace), shooting: Number(row.shooting), passing: Number(row.passing), dribbling: Number(row.dribbling), defending: Number(row.defending), physical: Number(row.physical), isLimited: Boolean(row.is_limited), maxSupply: row.max_supply == null ? null : Number(row.max_supply) };
    const instance = await buildInstance(card, userId, source, client); await createCardInstance(instance, client); return instance;
  } });
const { playerProfile } = require('./lib/profile').createProfile({ getPool: () => pool, levelProgressFromXp: (...args) => levelProgressFromXp(...args) });
const { listNotifications, markNotificationsRead } = require('./lib/notifications').createNotifications({ getPool: () => pool });
const push = require('./lib/push').createPush({ getPool: () => pool });
const { checkProgress } = require('./lib/progress-notify').createProgressNotify({ getPool: () => pool });
const { listTasks, adminTasks, adminSaveTask } = require('./lib/tasks').createTasks({ getPool: () => pool, adminLog: (...args) => adminLog(...args) });
const { adminStats } = require('./lib/stats').createStats({ getPool: () => pool });
const { adminAchievements, adminSaveAchievement } = require('./lib/achievements').createAchievements({ getPool: () => pool, adminLog: (...args) => adminLog(...args) });
const { levelProgressFromXp, applyReward, claimExists, addClaim, missionProgress, periodActivity, taskProgress, claimTask, claimDaily, claimMission, albumData } = require('./lib/rewards').createRewards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, getUserCards, publicCard, safeUser, securityEvent, listMissions, listTasks, periodMissions: (...args) => periodMissions(...args) });
const { settleExpiredAuctions, auctionData, withdrawAuctionParticipation, auctionHistory, createAuction, placeAuctionBid, cancelAuction, auctionBidHistory } = require('./lib/auctions').createAuctions({ getPool: () => pool, publicCard, securityEvent });
const { userAchievementStats, achievementProgress, progressSnapshot } = require('./lib/achievement-stats').createAchievementStats({ getPool: () => pool, levelProgressFromXp: (...args) => levelProgressFromXp(...args), listMissions: (...args) => listMissions(...args) });
const { periodMissions, recordVisit, recordPageView } = require('./lib/mission-stats').createMissionStats({ getPool: () => pool, progressSnapshot: (...args) => progressSnapshot(...args), listMissions: (...args) => listMissions(...args), listTasks: (...args) => listTasks(...args) });
const { listFavorites, setFavorite } = require('./lib/favorites').createFavorites({ getPool: () => pool, publicCard });
const { stats: collectionStats } = require('./lib/collection-stats').createCollectionStats({ getPool: () => pool, albumData: (...args) => albumData(...args) });
const economy = require('./lib/economy').createEconomy({ getPool: () => pool, securityEvent, buildInstance, createCardInstance, activeCatalogCards, safeUser, getUserById });
const wishlist = require('./lib/wishlist').createWishlist({ getPool: () => pool });
const team = require('./lib/team').createTeam({ getPool: () => pool });
const friends = require('./lib/friends').createFriends({ getPool: () => pool, ensureCode: tradeEnsureCode, listFavorites, levelProgressFromXp: (...args) => levelProgressFromXp(...args), rankOf, publicTeam: team.publicTeam });
const { cardMarket, recentSales, listAlerts, setAlert, deleteAlert } = require('./lib/market').createMarket({ getPool: () => pool, publicCard, settleExpiredAuctions });
const { adminLog, adminSetAccountStatus, adminSetRole, adminAdjustResources, adminTransferCard, adminRemoveCard, adminGrantCard, adminLogs, adminOverview, adminCollections, adminSetCollection, adminPacks, adminSetPack, adminCompetitions, adminSetCompetition, adminCards, adminCardsPage, adminCardsSummary, adminCreateCatalogCard, adminDeleteCatalogCard, adminUpdateCatalogCard, adminUsers, adminUserDetail, adminAuctions } = require('./lib/admin').createAdmin({ getPool: () => pool, catalog: () => CARD_CATALOG, getUserById, canManage, safeUser, securityEvent, buildInstance, createCardInstance, publicCard, configuredPackCards });
// Joueur connecté de la requête ; chaque visite compte pour les missions « Connecte-toi » (lib/mission-stats.js).
async function currentUser(req) { const user = await authCurrentUser(req); if (user) recordVisit(user.id); return user; }
// Routes de l'API par domaine (lib/routes/) ; conditions exclusives, l'ordre est sans effet.
const apiRoutes = [
 require('./lib/routes/auth').createAuthRoutes({ createSession, currentUser, destroySession, expiryDate, findUserByEmail, getPool: () => pool, grantWelcomeCards, hashPassword, loginFailure, loginStatus, loginSuccess, markRegistration, memory, registrationAllowed, safeUser, securityEvent, sessionCookie, validPassword, verifyPassword }),
 require('./lib/routes/cards').createCardsRoutes({ catalog: () => CARD_CATALOG, currentUser, getPool: () => pool, getUserCards, listPacks, openPackForUser, openPoolForUser, safeUser }),
 require('./lib/routes/rewards').createRewardsRoutes({ settleLastWeek, myLeaderboardRewards, claimLeaderboardReward, claimSeasonReward, checkProgress, periodMissions, recordPageView, userAchievementStats, achievementProgress, listFavorites, setFavorite, listChallenges, claimChallenge, listSets, claimSet, leaderboard, playerProfile, listNotifications, markNotificationsRead, listTasks, listMissions, isMissionUnlocked, addClaim, albumData, applyReward, claimDaily, claimExists, claimMission, claimTask, currentUser, getPool: () => pool, getUserById, getUserCards, levelProgressFromXp, missionProgress, periodActivity, safeUser, securityEvent, taskProgress }),
 require('./lib/routes/auctions').createAuctionsRoutes({ cardMarket, recentSales, listAlerts, setAlert, deleteAlert, auctionBidHistory, auctionData, auctionHistory, cancelAuction, createAuction, currentUser, placeAuctionBid, safeUser, withdrawAuctionParticipation }),
 require('./lib/routes/admin').createAdminRoutes({ adminSeasonPrizes, adminSetSeasonPrize, adminChallenges, adminSaveChallenge, adminSets, adminSaveSet, adminCardsPage, adminCardsSummary, adminTasks, adminSaveTask, adminStats, adminAchievements, adminSaveAchievement, adminMissions, adminSaveMission, adminAdjustResources, adminAuctions, adminCards, adminCollections, adminCompetitions, adminCreateCatalogCard, adminDeleteCatalogCard, adminGrantCard, adminLog, adminLogs, adminOverview, adminPacks, adminRemoveCard, adminSetAccountStatus, adminSetCollection, adminSetCompetition, adminSetPack, adminSetRole, adminTransferCard, adminUpdateCatalogCard, adminUserDetail, adminUsers, getPool: () => pool, requireAdmin, safeUser }),
 require('./lib/routes/trades').createTradesRoutes({ currentUser, tradeInfo, tradeLookupPlayer, tradeMyCards, tradeCreateOffer, tradeListOffers, tradeCancelOffer, tradeDeclineOffer, tradeAcceptOffer }),
 require('./lib/routes/friends').createFriendsRoutes({ currentUser, friends }),
 require('./lib/routes/collection-stats').createCollectionStatsRoutes({ currentUser, collectionStats }),
 require('./lib/routes/team').createTeamRoutes({ currentUser, team }),
 require('./lib/routes/economy').createEconomyRoutes({ currentUser, economy }),
 require('./lib/routes/wishlist').createWishlistRoutes({ currentUser, wishlist }),
 require('./lib/routes/push').createPushRoutes({ currentUser, push }),
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
const PUBLIC_SCRIPTS=new Set(['fv-core.js','fv-cards.js','app.js','fv-pages.js','fv-admin.js','fv-market.js','fv-trades.js','market-insights.js','challenge-admin-editor.js','set-admin-editor.js','notifications-bell.js','fv-push.js','fv-friends.js','fv-wishlist.js','fv-stats.js','fv-team.js','fv-workshop.js','sw.js','admin-stats.js','task-admin-editor.js','achievement-admin-editor.js','mission-admin-editor.js','manifest.json']);
const PUBLIC_EXTENSIONS=new Set(['.html','.css','.svg','.png','.ico','.webp']);
function isPublicFile(name){return !name.startsWith('.')&&(PUBLIC_SCRIPTS.has(name)||PUBLIC_EXTENSIONS.has(path.extname(name)));}
// Polices hébergées par le site : fonts/*.woff2 uniquement.
const FONTS_DIR=path.join(ROOT,'fonts');
// Logos des clubs (club-logos/<id du club>.jpg|png|webp), fournis par le propriétaire : images uniquement.
const CLUB_LOGOS_DIR=path.join(ROOT,'club-logos');
function staticFile(req,res){let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{return json(res,400,{error:'Chemin invalide.'});}if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,path.normalize(pathname));const dir=path.dirname(file),isFont=dir===FONTS_DIR&&path.extname(file)==='.woff2'&&!path.basename(file).startsWith('.'),isClubLogo=dir===CLUB_LOGOS_DIR&&/\.(jpe?g|png|webp)$/i.test(file)&&!path.basename(file).startsWith('.');if((dir!==ROOT||!isPublicFile(path.basename(file)))&&!isFont&&!isClubLogo||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'}[path.extname(file).toLowerCase()]||'application/octet-stream';const entry=staticEntry(file,mime),headers={'Content-Type':mime,'ETag':entry.etag,'Vary':'Accept-Encoding','Cache-Control':isFont||/[?&]v=/.test(req.url)?'public, max-age=31536000, immutable':mime.startsWith('text/html')?'no-cache':'public, max-age=3600'};if(req.headers['if-none-match']===entry.etag){res.writeHead(304,headers);return res.end();}const gzip=entry.gz&&/\bgzip\b/.test(String(req.headers['accept-encoding']||''));res.writeHead(200,{...headers,...(gzip?{'Content-Encoding':'gzip'}:{}),'Content-Length':(gzip?entry.gz:entry.raw).length});res.end(req.method==='HEAD'?undefined:(gzip?entry.gz:entry.raw));}
// Fichiers de l'interface gardés en mémoire (lus et compressés une fois, relus s'ils changent sur le disque) :
// ETag pour les réponses 304, gzip pour les fichiers texte.
const staticCache=new Map();
function staticEntry(file,mime){const st=fs.statSync(file),hit=staticCache.get(file);if(hit&&hit.mtimeMs===st.mtimeMs&&hit.size===st.size)return hit;const raw=fs.readFileSync(file),text=/^(text\/|application\/(javascript|json)|image\/svg)/.test(mime);const entry={mtimeMs:st.mtimeMs,size:st.size,raw,gz:text&&raw.length>1024?zlib.gzipSync(raw,{level:9}):null,etag:'"'+st.size.toString(36)+'-'+Math.floor(st.mtimeMs).toString(36)+'"'};staticCache.set(file,entry);return entry;}

// Version déployée (Render fournit RENDER_GIT_COMMIT) et état de la base, pour la surveillance
// (/api/health, .github/workflows/production.yml). La base est interrogée au plus toutes les 30 s.
const STARTED_AT=new Date().toISOString(),COMMIT=String(process.env.RENDER_GIT_COMMIT||process.env.GIT_COMMIT||'').slice(0,12)||null;
// Mémoire du processus en Mo (rss = mémoire réellement occupée, comparée à la limite de l'offre Render) : visible dans /api/health, la page etat.html et le journal de production.yml.
function memoryMb(){const m=process.memoryUsage(),mb=v=>Math.round(v/1048576);return{rss:mb(m.rss),heapUsed:mb(m.heapUsed),heapTotal:mb(m.heapTotal),external:mb(m.external)};}
let dbProbe={at:0,value:null};
async function probeDatabase(){if(!pool)return null;if(Date.now()-dbProbe.at<30000&&dbProbe.value)return dbProbe.value;const t=Date.now();let value;try{await Promise.race([pool.query('SELECT 1'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('délai dépassé')),3000))]);value={ok:true,latencyMs:Date.now()-t};}catch(e){value={ok:false,error:String(e.message||e).slice(0,120)};}dbProbe={at:Date.now(),value};return value;}
(async()=>{let dbReady=false;let dbMode='starting';let dbStartError=null;const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'&&!dbReady)return json(res,503,{error:'Base de données en cours de démarrage.'});
 if(req.method==='GET'&&url.pathname==='/api/health'){const dbSsl=require('./lib/db-ssl'),healthTls={mode:dbSsl.tlsMode()};if(healthTls.mode!=='verified')healthTls.diagnostic=dbSsl.tlsDiagnostic();return json(res,200,{ok:dbReady,ready:dbReady,version:'0.3.0',commit:COMMIT,startedAt:STARTED_AT,uptimeSeconds:Math.round(process.uptime()),storage:pool?'postgres':dbMode,database:dbReady?await probeDatabase():null,databaseTls:healthTls.mode,databaseStartError:dbMode==='unavailable'?dbStartError:undefined,databaseTlsDiagnostic:healthTls.diagnostic,universe:'FOOTVAULT',cards:CARD_CATALOG.length,packs:Object.keys(PACKS),memory:memoryMb(),timestamp:new Date().toISOString()});}
 for(const route of apiRoutes)if(await route(req,res,url))return;
 return staticFile(req,res);
}catch(error){if(error&&error.expose&&error.status<500)return json(res,error.status,{error:error.message});console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',async()=>{console.log(`SPORT VAULT running on ${PORT}`);try{const db=await initDb({activeCatalogCards,getCatalog:()=>CARD_CATALOG,setCatalog:c=>{CARD_CATALOG=c},setPool:p=>{pool=p},grantWelcomeCards,hashPassword,loadFootMercatoCatalog});dbMode=db.mode;dbReady=true;console.log(`SPORT VAULT startup: storage=${db.mode}`);if(db.mode!=='memory')warmCatalog().then(()=>console.log('SPORT VAULT catalogue préchargé'),e=>console.error('SPORT VAULT préchargement du catalogue :',e.message));if(pool){setInterval(settleExpiredAuctions,30_000);setInterval(cleanupSessions,5*60_000);push.start();}}catch(e){console.error('SPORT VAULT startup database error:',e.message);dbMode='unavailable';dbStartError=String((e&&e.code)||(e&&e.name)||'UNKNOWN').slice(0,60);}});})();
