const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const { RARITIES, FOOTVAULT_CARDS, PACKS, PACK_WEIGHTS, MISSIONS, DEFAULT_ACHIEVEMENTS, DAILY_TASKS, WEEKLY_TASKS, ALBUM_CLUBS } = require('./lib/game-config');
const { parisDateParts, parisDayKey, parisWeekKey, parisOffsetMinutes, parisLocalMidnight, periodInfo, taskClaimId } = require('./lib/periods');
const { initDb } = require('./lib/schema');

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map(), claims: new Map(), activity: [], reg: new Map(), login: new Map() };
const { cookies, hashPassword, verifyPassword, validPassword, safeUser, sessionCookie, expiryDate, findUserByEmail, getUserById, cleanupSessions, roleLevel, canManage, isAdmin, requireAdmin, currentUser, createSession, destroySession, registrationAllowed, markRegistration, loginStatus, loginFailure, loginSuccess } = require('./lib/auth').createAuth({ db: () => pool, memory });
const { publicCard, buildInstance, weightedRarity, rarityAtLeast, drawPack, listPacks, getPackDefinition, catalogCardsForPackConditions, configuredPackCards, drawDynamicPack, createCardInstance, getUserCards, welcomeRarity, grantWelcomeCards, openPackForUser, openPoolForUser } = require('./lib/cards').createCards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, safeUser, securityEvent });
const { levelProgressFromXp, applyReward, claimExists, addClaim, missionProgress, missionUnlocked, periodActivity, taskProgress, claimTask, claimDaily, claimMission, albumViews, albumData } = require('./lib/rewards').createRewards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, getUserCards, publicCard, safeUser, securityEvent });
const { auctionPublic, settleExpiredAuctions, auctionData, withdrawAuctionParticipation, auctionHistory, auctionReference, createAuction, placeAuctionBid, cancelAuction, auctionBidHistory } = require('./lib/auctions').createAuctions({ getPool: () => pool, publicCard, securityEvent });
const { cardRarity, adminLog, adminSetAccountStatus, adminSetRole, adminAdjustResources, adjustResourcesLocked, adminTransferCard, adminRemoveCard, adminGrantCard, adminLogs, adminOverview, getCollections, adminCollections, adminSetCollection, adminPacks, adminSetPack, adminCompetitions, adminSetCompetition, adminCards, adminCreateCatalogCard, adminDeleteCatalogCard, adminUpdateCatalogCard, adminUsers, adminUserDetail, adminAuctions } = require('./lib/admin').createAdmin({ getPool: () => pool, catalog: () => CARD_CATALOG, getUserById, canManage, safeUser, securityEvent, buildInstance, createCardInstance, publicCard });

const { rarityFromOvr, RARITY_SQL } = require('./lib/rarity');
// Rareté selon le barème, sauf carte spéciale explicitement verrouillée.


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

// Réponses JSON volumineuses (catalogue admin, album) compressées en gzip si le navigateur l'accepte.
function json(res,status,data){const body=JSON.stringify(data),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};if(body.length>32768&&/\bgzip\b/.test(String(res.req?.headers['accept-encoding']||''))){zlib.gzip(body,{level:1},(err,gz)=>{if(err){res.writeHead(status,headers);res.end(body);return;}res.writeHead(status,{...headers,'Content-Encoding':'gzip','Vary':'Accept-Encoding'});res.end(gz);});return;}res.writeHead(status,headers);res.end(body);}

async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Payload too large');}return JSON.parse(body||'{}');}






















async function securityEvent(userId,ip,event,details={},client=null){const db=client||pool;if(!db)return;
 // Inside a transaction, a failed INSERT would abort it and turn the caller's
 // COMMIT into a silent ROLLBACK: isolate the write in a savepoint.
 if(client)await client.query('SAVEPOINT security_event');
 try{await db.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[userId||null,ip||null,event,JSON.stringify(details)]);if(client)await client.query('RELEASE SAVEPOINT security_event');}
 catch(e){console.error('SPORT VAULT security event error:',e.message);if(client)await client.query('ROLLBACK TO SAVEPOINT security_event');}}





































const { clientIp, ipDiagnostics } = require('./lib/client-ip');































function staticFile(req,res){let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,path.normalize(pathname));if(!file.startsWith(ROOT)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);}

(async()=>{let dbReady=false;let dbMode='starting';const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'&&!dbReady)return json(res,503,{error:'Base de données en cours de démarrage.'});
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:dbReady,ready:dbReady,version:'0.3.0',storage:pool?'postgres':dbMode,universe:'FOOTVAULT',cards:CARD_CATALOG.length,packs:Object.keys(PACKS),timestamp:new Date().toISOString()});
 if(req.method==='GET'&&url.pathname==='/api/auctions'){const user=await currentUser(req);const auctions=await auctionData(user?.id||null);return json(res,200,{auctions,user:user?safeUser(user):null});}
 if(req.method==='GET'&&url.pathname==='/api/auctions/history'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,{auctions:await auctionHistory(user.id)});}
 if(req.method==='GET'&&url.pathname==='/api/auctions/:id'){return json(res,404,{error:'Not found'});}
 if(req.method==='GET'&&url.pathname==='/api/auctions'){return json(res,200,{auctions:await auctionData()});}
 if(req.method==='POST'&&url.pathname==='/api/auctions/create'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await createAuction(user.id,String(body.cardInstanceId||''),body.startingBid,body.duration);return json(res,result.error?result.status||400:201,result);}
 if(req.method==='POST'&&url.pathname==='/api/auctions/bid'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await placeAuctionBid(user.id,String(body.auctionId||''),body.amount);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/auctions/cancel'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await cancelAuction(user.id,String(body.auctionId||''));return json(res,result.error?result.status||400:200,result);} if(req.method==='POST'&&url.pathname==='/api/auctions/withdraw'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await withdrawAuctionParticipation(user.id,String(body.auctionId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname.startsWith('/api/auctions/')&&url.pathname.endsWith('/bids')){const id=url.pathname.split('/')[3];return json(res,200,{bids:await auctionBidHistory(id)});}
 if(req.method==='GET'&&url.pathname==='/api/admin/cards'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});return json(res,200,{cards:await adminCards()});}
 if(req.method==='POST'&&url.pathname==='/api/admin/cards'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});const body=await readBody(req);const result=await adminUpdateCatalogCard(admin.id,String(body.id||''),body);return json(res,result.error?result.status||400:200,result);} if(req.method==='POST'&&url.pathname==='/api/admin/cards/create'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});const body=await readBody(req);const result=await adminCreateCatalogCard(admin.id,body);return json(res,result.error?result.status||400:201,result);} if(req.method==='POST'&&url.pathname==='/api/admin/cards/delete'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});const body=await readBody(req);const result=await adminDeleteCatalogCard(admin.id,String(body.cardId||''),Boolean(body.confirm));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname==='/api/admin/overview'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{admin:safeUser(admin),overview:await adminOverview()});}
 if(req.method==='GET'&&url.pathname==='/api/admin/collections'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{collections:await adminCollections()});} if(req.method==='GET'&&url.pathname==='/api/admin/competitions'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,await adminCompetitions());} if(req.method==='POST'&&url.pathname==='/api/admin/competitions'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const body=await readBody(req);const result=await adminSetCompetition(admin.id,String(body.action||''),body);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/admin/collections'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const body=await readBody(req);const result=await adminSetCollection(admin.id,String(body.action||''),body);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname==='/api/admin/users'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{users:await adminUsers(url.searchParams.get('q')||'')});}
 if(req.method==='GET'&&url.pathname.startsWith('/api/admin/users/')){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const id=url.pathname.split('/').pop();const detail=await adminUserDetail(id);return json(res,detail.error?detail.status||404:200,detail.error?detail:{user:detail});} 
 if(req.method==='POST'&&url.pathname.startsWith('/api/admin/users/')&&url.pathname.endsWith('/action')){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const parts=url.pathname.split('/');const id=parts[parts.length-2];const body=await readBody(req);const result=await adminSetAccountStatus(admin.id,id,String(body.action||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname==='/api/admin/auctions'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{auctions:await adminAuctions()});}
 if(req.method==='GET'&&url.pathname==='/api/admin/ip-debug'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,ipDiagnostics(req));}
 if(req.method==='GET'&&url.pathname==='/api/admin/logs'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{logs:await adminLogs()});}
 if(req.method==='POST'&&url.pathname.startsWith('/api/admin/users/')&&url.pathname.endsWith('/role')){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const id=url.pathname.split('/').slice(-2)[0],body=await readBody(req);const result=await adminSetRole(admin.id,id,String(body.role||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname.startsWith('/api/admin/users/')&&url.pathname.endsWith('/resources')){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const id=url.pathname.split('/').slice(-2)[0],body=await readBody(req);const result=await adminAdjustResources(admin.id,id,String(body.resource||''),Number(body.amount),body.reason);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/admin/cards/transfer'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const body=await readBody(req);const result=await adminTransferCard(admin.id,String(body.instanceId||''),String(body.toUserId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/admin/cards/grant'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const body=await readBody(req);const result=await adminGrantCard(admin.id,String(body.userId||''),String(body.cardId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/admin/cards/remove'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const body=await readBody(req);const result=await adminRemoveCard(admin.id,String(body.instanceId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname==='/api/me'){const user=await currentUser(req);return json(res,user?200:401,user?{user:safeUser(user)}:{error:'Non connecté'});}
 // Résumé du catalogue pour l'accueil : évite de télécharger toutes les cartes (plus de 50 000).
 if(req.method==='GET'&&url.pathname==='/api/catalog/summary'){const pick=c=>({id:c.id,season:c.season,name:c.name,position:c.position,jerseyNumber:c.jersey_number??c.jerseyNumber??null,club:c.club,nation:c.nation,rarity:c.rarity,ovr:Number(c.ovr||0)});if(pool){const [t,f]=await Promise.all([pool.query('SELECT count(*)::int AS cards,count(DISTINCT club)::int AS clubs FROM catalog_cards WHERE is_active=true'),pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr FROM catalog_cards WHERE is_active=true ORDER BY ovr DESC,card_order,id LIMIT 3')]);return json(res,200,{cards:t.rows[0].cards,clubs:t.rows[0].clubs,featured:f.rows.map(pick)});}return json(res,200,{cards:CARD_CATALOG.length,clubs:new Set(CARD_CATALOG.map(c=>c.club).filter(Boolean)).size,featured:[...CARD_CATALOG].sort((a,b)=>Number(b.ovr||0)-Number(a.ovr||0)).slice(0,3).map(pick)});}
 if(req.method==='GET'&&url.pathname==='/api/cards'){const rows=pool?(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true ORDER BY card_order,id')).rows:CARD_CATALOG;const cards=pool?rows.map(row=>({id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr||72),pace:Number(row.pace||72),shooting:Number(row.shooting||72),passing:Number(row.passing||72),dribbling:Number(row.dribbling||72),defending:Number(row.defending||72),physical:Number(row.physical||72),distributionType:row.distribution_type,isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply),order:Number(row.card_order||0),rarityLabel:RARITIES[row.rarity]?.label||row.rarity})):rows;return json(res,200,{universe:'FOOTVAULT',season:'2026-2027',cards});}
 if(req.method==='GET'&&url.pathname.startsWith('/api/cards/')){const cardId=decodeURIComponent(url.pathname.slice('/api/cards/'.length));const row=pool?(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0]:CARD_CATALOG.find(c=>c.id===cardId);if(!row)return json(res,404,{error:'Carte introuvable.'});const c=pool?{id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr||72),pace:Number(row.pace||72),shooting:Number(row.shooting||72),passing:Number(row.passing||72),dribbling:Number(row.dribbling||72),defending:Number(row.defending||72),physical:Number(row.physical||72),distributionType:row.distribution_type,isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply),order:Number(row.card_order||0),rarityLabel:RARITIES[row.rarity]?.label||row.rarity}:row;return json(res,200,{card:c});}
 if(req.method==='GET'&&url.pathname==='/api/packs')return json(res,200,{universe:'FOOTVAULT',season:'2026',...(await listPacks())});
 if(req.method==='GET'&&url.pathname==='/api/admin/packs'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});return json(res,200,await adminPacks());}
 if(req.method==='POST'&&url.pathname==='/api/admin/packs'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});const body=await readBody(req);const result=await adminSetPack(admin.id,String(body.action||''),body);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname==='/api/collection'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);return json(res,200,{user:safeUser(user),cards,count:cards.length});}
 if(req.method==='GET'&&url.pathname==='/api/achievements'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id),all=pool?(await pool.query('SELECT * FROM achievements WHERE active=true ORDER BY sort_order,id')).rows:DEFAULT_ACHIEVEMENTS.filter(x=>x.active);
  const stats={cards:cards.length,packs:Number(user.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};
  const achievements=await Promise.all(all.map(async x=>({id:x.id,name:x.name,category:x.category,description:x.description,type:x.type,target:Number(x.target),progress:Math.min(Number(stats[x.type]||0),Number(x.target)),coins:Number(x.coins||0),xp:Number(x.xp||0),icon:x.icon||'✦',claimed:await claimExists(user.id,'achievement:'+x.id),completed:Number(stats[x.type]||0)>=Number(x.target)})));return json(res,200,{achievements,cardCount:cards.length});
 }
 if(req.method==='POST'&&url.pathname==='/api/achievements/claim'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const b=await readBody(req),id=String(b.id||''),ach=pool?(await pool.query('SELECT * FROM achievements WHERE id=$1 AND active=true',[id])).rows[0]:DEFAULT_ACHIEVEMENTS.find(x=>x.id===id&&x.active);if(!ach)return json(res,404,{error:'Succès introuvable.'});
  const cards=await getUserCards(user.id),u=await getUserById(user.id),stats={cards:cards.length,packs:Number(u.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};if(Number(stats[ach.type]||0)<Number(ach.target))return json(res,400,{error:'Succès non terminé.'});
  const claimId='achievement:'+ach.id;if(pool){const client=await pool.connect();try{await client.query('BEGIN');const ins=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!ins.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},client);await securityEvent(user.id,null,'achievement_claim',{achievementId:ach.id},client);await client.query('COMMIT');return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)});return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});
 }
 if(req.method==='GET'&&url.pathname==='/api/admin/achievements'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});return json(res,200,{achievements:pool?(await pool.query('SELECT * FROM achievements ORDER BY sort_order,id')).rows:DEFAULT_ACHIEVEMENTS});}
 if(req.method==='POST'&&url.pathname==='/api/admin/achievements'){
  const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès admin requis.'});const b=await readBody(req),action=String(b.action||'save'),id=String(b.id||'').trim();if(action==='delete'){await pool.query('DELETE FROM achievements WHERE id=$1',[id]);return json(res,200,{ok:true});}
  const name=String(b.name||'').trim(),category=String(b.category||'Diversité').trim(),description=String(b.description||'').trim(),type=String(b.type||''),target=Number(b.target),coins=Number(b.coins||0),xp=Number(b.xp||0),icon=String(b.icon||'✦').slice(0,20),active=b.active!==false;
  if(!/^[a-z0-9-]{3,80}$/.test(id)||!name||!description||!['cards','packs','rarePlus','epicPlus','legendaryPlus','iconPlus','distinctClubs'].includes(type)||!Number.isInteger(target)||target<1||!Number.isInteger(coins)||coins<0||!Number.isInteger(xp)||xp<0)return json(res,400,{error:'Vérifie les champs du succès.'});
  await pool.query('INSERT INTO achievements(id,name,category,description,type,target,coins,xp,icon,active,sort_order,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100,now()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description,type=EXCLUDED.type,target=EXCLUDED.target,coins=EXCLUDED.coins,xp=EXCLUDED.xp,icon=EXCLUDED.icon,active=EXCLUDED.active,updated_at=now()',[id,name,category,description,type,target,coins,xp,icon,active]);await adminLog(admin.id,null,'achievement_save',{achievementId:id,active});return json(res,200,{ok:true});
 }
 if(req.method==='GET'&&url.pathname==='/api/progression'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  const cards=await getUserCards(user.id);
  const {level,currentXp,xpToNext}=levelProgressFromXp(user.xp);
  const claimedIds=new Set();
  for(const m of MISSIONS)if(await claimExists(user.id,m.id))claimedIds.add(m.id);
  const active=[],completed=[];
  for(const m of MISSIONS){
    const claimed=claimedIds.has(m.id);
    const unlocked=!m.prerequisite||claimedIds.has(m.prerequisite);
    const progress=Math.min(missionProgress(m,cards,user),m.target);
    const item={id:m.id,order:m.order,title:m.title,description:m.description,target:m.target,progress,reward:m.reward,completed:progress>=m.target,claimed,unlocked};
    if(claimed)completed.push(item);
    else if(unlocked)active.push(item);
  }
  const dailyClaimed=!!(user.daily_claimed_at&&parisDayKey(user.daily_claimed_at)===parisDayKey(new Date()));
  const [dailyActivity,weeklyActivity]=await Promise.all([periodActivity(user.id,'daily'),periodActivity(user.id,'weekly')]);
  const dailyTasks=await Promise.all(DAILY_TASKS.map(async t=>{const progress=Math.min(taskProgress(t,dailyActivity),t.target),claimed=await claimExists(user.id,taskClaimId('daily',dailyActivity.key,t.id));return{...t,progress,completed:progress>=t.target,claimed,period:dailyActivity.key};}));
  const weeklyTasks=await Promise.all(WEEKLY_TASKS.map(async t=>{const progress=Math.min(taskProgress(t,weeklyActivity),t.target),claimed=await claimExists(user.id,taskClaimId('weekly',weeklyActivity.key,t.id));return{...t,progress,completed:progress>=t.target,claimed,period:weeklyActivity.key};}));
  return json(res,200,{user:safeUser(user),level,currentXp,xpToNext,cardCount:cards.length,daily:{claimed:dailyClaimed,reward:{coins:150,xp:10}},dailyTasks,weeklyTasks,missions:active,completedMissions:completed});
 }
 if(req.method==='POST'&&url.pathname==='/api/tasks/claim'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});
  const body=await readBody(req),kind=String(body.kind||'daily')==='weekly'?'weekly':'daily';
  const result=await claimTask(user.id,kind,String(body.taskId||''));
  return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});
 }
 if(req.method==='POST'&&url.pathname==='/api/rewards/daily'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const result=await claimDaily(user.id);return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 if(req.method==='POST'&&url.pathname==='/api/missions/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await claimMission(user.id,String(body.missionId||''));return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 
if(req.method==='POST'&&url.pathname==='/api/internal/historical-import'){
 const token=process.env.HISTORICAL_IMPORT_TOKEN;
 if(!token||req.headers['x-historical-import-token']!==token)return json(res,401,{error:'Unauthorized'});
 if(!pool)return json(res,503,{error:'Database unavailable'});
 const body=await readBody(req);
 const season=String(body.season||'').trim();
 if(!/^\d{4}-\d{4}$/.test(season)||!Array.isArray(body.cards))return json(res,400,{error:'Invalid season payload'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const seasonId='ligue-1-'+season;
  const seasonOrder=Number(season.slice(0,4))-2010;
  await client.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,sort_order) VALUES($1,'ligue-1',$2,$3,'available',$4) ON CONFLICT(id) DO UPDATE SET label=excluded.label,status='available',sort_order=excluded.sort_order",[seasonId,season,'Saison '+season,seasonOrder]);
  const clubs=new Map();
  for(const c of body.cards){
   const club=String(c[0]??'').trim(); if(club&&!clubs.has(club))clubs.set(club,'ligue-1-club-'+club.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,42));
  }
  let clubPos=0;
  for(const [club,clubId] of clubs){
   const existingByName=(await client.query('SELECT id FROM clubs WHERE name=$1',[club])).rows[0];
   let actual=existingByName?.id||clubId;
   if(!existingByName){
    const collision=(await client.query('SELECT id FROM clubs WHERE id=$1',[clubId])).rows[0];
    if(collision) actual=clubId+'-'+crypto.createHash('sha1').update(club).digest('hex').slice(0,8);
    await client.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,'France',$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,tag=excluded.tag",[actual,club,club.replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase()||'L1',clubPos]);
   } else {
    await client.query("UPDATE clubs SET tag=$2 WHERE id=$1",[actual,club.replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase()||'L1']);
   }
   await client.query("INSERT INTO competition_clubs(competition_id,club_id,position) VALUES('ligue-1',$1,$2) ON CONFLICT DO NOTHING",[actual,clubPos]);
   await client.query("INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[seasonId,actual,clubPos++]);
  }
  let index=0;
  for(const c of body.cards){
   const [club,jersey,name,position,nation,rarity,ovr,s1,s2,s3,s4,s5,s6]=c;
   if(!name||!club)continue;
   const nums=[ovr,s1,s2,s3,s4,s5,s6].map(Number);
   const id='fv-h-'+season+'-'+String(++index).padStart(5,'0');
   await client.query("INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'STANDARD',false,NULL,$16,true) ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,jersey_number=excluded.jersey_number,club=excluded.club,nation=excluded.nation,rarity=CASE WHEN catalog_cards.rarity_locked THEN catalog_cards.rarity ELSE excluded.rarity END,ovr=excluded.ovr,pace=excluded.pace,shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,is_active=true,updated_at=now()",[id,season,String(name),String(position||'ST'),jersey==null||jersey===''?null:Number(jersey),String(club),String(nation||''),rarityFromOvr(Number.isFinite(Number(ovr))?Number(ovr):72),Number.isFinite(nums[0])?nums[0]:72,...nums.slice(1).map(x=>Number.isFinite(x)?x:72),100000+seasonOrder*10000+index]);
  }
  await client.query('COMMIT');
  return json(res,200,{ok:true,season,imported:index,clubs:clubs.size});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('[FOOTVAULT] historical upload error',e);return json(res,500,{error:e.message});}finally{client.release();}
}

 if(req.method==='GET'&&url.pathname==='/api/album'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,await albumData(user.id,url.searchParams.get('seasonId')||null));}
 if(req.method==='POST'&&url.pathname==='/api/album/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req),clubId=String(body.clubId||''),seasonId=String(body.seasonId||''),data=await albumData(user.id),view=data.album.competitions.flatMap(c=>c.seasons.flatMap(s=>s.clubs.map(v=>({...v,seasonId:s.id,season:s.season,competitionId:c.id})))).find(c=>c.id===clubId&&c.seasonId===seasonId);if(!view)return json(res,404,{error:'Set introuvable.'});if(!view.complete)return json(res,400,{error:'Set incomplet.'});const claimId='album:'+seasonId+':'+clubId;if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!inserted.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:250,xp:25},client);await client.query('COMMIT');return json(res,200,{reward:{coins:250,xp:25},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:250,xp:25});return json(res,200,{reward:{coins:250,xp:25},user:safeUser(updated)});}
if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
 if(req.method==='POST'&&url.pathname==='/api/packs/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPackForUser(user.id,String(body.packId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/pools/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPoolForUser(user.id,String(body.poolId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/register'){
  const ip=clientIp(req),body=await readBody(req),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(name.length<2||name.length>30||!/^\S+@\S+\.\S+$/.test(email)||!validPassword(password))return json(res,400,{error:'Nom, email valide et mot de passe de 10 à 128 caractères avec au moins une lettre et un chiffre requis.'});
  if(pool){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const adminEmails=String(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!adminEmails.includes(email)&&!(await registrationAllowed(ip,client))){await client.query('ROLLBACK');return json(res,429,{error:'Création de compte limitée : une inscription est autorisée toutes les 72 heures depuis cette connexion.'});}
      const exists=await client.query('SELECT 1 FROM users WHERE email=$1',[email]);
      if(exists.rowCount){await client.query('ROLLBACK');return json(res,409,{error:'Cet email est déjà utilisé.'});}
      const id=crypto.randomUUID(),passwordHash=hashPassword(password),now=new Date();
      await client.query('INSERT INTO users(id,name,email,password_hash,coins,gems,xp,packs_opened,created_at) VALUES($1,$2,$3,$4,1000,50,0,0,$5)',[id,name,email,passwordHash,now]);
      const welcomeCards=await grantWelcomeCards(id,client);
      await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);
      const realUser=(await client.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
      const token=crypto.randomBytes(32).toString('hex');
      await client.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,id,expiryDate()]);
      await client.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[id,ip,'registration_success',JSON.stringify({email})]);
      await client.query('COMMIT');
      res.setHeader('Set-Cookie',sessionCookie(token));
      return json(res,201,{user:safeUser(realUser),welcomeCards});
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  if(!(await registrationAllowed(ip)))return json(res,429,{error:'Création de compte limitée à une fois toutes les 72 heures.'});
  if(await findUserByEmail(email))return json(res,409,{error:'Cet email est déjà utilisé.'});
  const user={id:crypto.randomUUID(),name,email,password_hash:hashPassword(password),coins:1000,gems:50,xp:0,packs_opened:0,createdAt:new Date().toISOString()};
  memory.users.set(user.id,user);
  const welcomeCards=await grantWelcomeCards(user.id);
  await markRegistration(ip);
  const token=await createSession(user.id);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,201,{user:safeUser(user),welcomeCards});
 }
 if(req.method==='POST'&&url.pathname==='/api/login'){
  const ip=clientIp(req),body=await readBody(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),status=await loginStatus(ip,email);
  if(status.blocked)return json(res,429,{error:'Trop de tentatives incorrectes. Connexion temporairement bloquée pendant 15 minutes.'});
  const user=await findUserByEmail(email);
  if(user?.account_status==='banned')return json(res,403,{error:'Ce compte a été banni.'});
  if(user?.account_status==='blocked'&&user.blocked_until&&new Date(user.blocked_until)>new Date())return json(res,403,{error:'Ce compte est temporairement bloqué jusqu’au '+new Date(user.blocked_until).toLocaleString('fr-FR')+'.'});
  if(!user||!verifyPassword(password,user.password_hash)){
    await loginFailure(ip,email);
    await securityEvent(user?.id||null,ip,'login_failure',{email,attempt:Number(status.attempts||0)+1});
    const left=Math.max(0,5-(status.attempts+1));
    return json(res,401,{error:left?'Email ou mot de passe incorrect. Il reste '+left+' tentative(s).':'Trop de tentatives incorrectes. Connexion bloquée pendant 15 minutes.'});
  }
  await loginSuccess(ip,email);
  await securityEvent(user.id,ip,'login_success');
  const token=await createSession(user.id);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,200,{user:safeUser(user)});
 }
 if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
 return staticFile(req,res);
}catch(error){console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',async()=>{console.log(`SPORT VAULT running on ${PORT}`);try{const db=await initDb({getCatalog:()=>CARD_CATALOG,setCatalog:c=>{CARD_CATALOG=c},setPool:p=>{pool=p},grantWelcomeCards,hashPassword,loadFootMercatoCatalog});dbMode=db.mode;dbReady=true;console.log(`SPORT VAULT startup: storage=${db.mode}`);if(pool){setInterval(settleExpiredAuctions,30_000);setInterval(cleanupSessions,5*60_000);}}catch(e){console.error('SPORT VAULT startup database error:',e.message);dbMode='unavailable';}});})();
