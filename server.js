const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const { RARITIES, FOOTVAULT_CARDS, PACKS, PACK_WEIGHTS, MISSIONS, DEFAULT_ACHIEVEMENTS, DAILY_TASKS, WEEKLY_TASKS, ALBUM_CLUBS } = require('./lib/game-config');
const { parisDateParts, parisDayKey, parisWeekKey, parisOffsetMinutes, parisLocalMidnight, periodInfo, taskClaimId } = require('./lib/periods');
const { auctionDurationMs, auctionMinBid } = require('./lib/auction-rules');
const { initDb } = require('./lib/schema');

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map(), claims: new Map(), activity: [], reg: new Map(), login: new Map() };
const { cookies, hashPassword, verifyPassword, validPassword, safeUser, sessionCookie, expiryDate, findUserByEmail, getUserById, cleanupSessions, roleLevel, canManage, isAdmin, requireAdmin, currentUser, createSession, destroySession, registrationAllowed, markRegistration, loginStatus, loginFailure, loginSuccess } = require('./lib/auth').createAuth({ db: () => pool, memory });
const { publicCard, buildInstance, weightedRarity, rarityAtLeast, drawPack, listPacks, getPackDefinition, catalogCardsForPackConditions, configuredPackCards, drawDynamicPack, createCardInstance, getUserCards, welcomeRarity, grantWelcomeCards, openPackForUser, openPoolForUser } = require('./lib/cards').createCards({ getPool: () => pool, memory, catalog: () => CARD_CATALOG, getUserById, safeUser, securityEvent });

const { rarityFromOvr, RARITY_SQL } = require('./lib/rarity');
// Rareté selon le barème, sauf carte spéciale explicitement verrouillée.
function cardRarity(body,lockedDefault=false){const locked=body.rarityLocked===undefined?lockedDefault:body.rarityLocked===true;const ovr=Number(body.ovr);return{locked,rarity:locked?String(body.rarity||'').trim().toLowerCase():(Number.isInteger(ovr)?rarityFromOvr(ovr):'common')};}

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

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}

async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Payload too large');}return JSON.parse(body||'{}');}



function levelProgressFromXp(value){let remaining=Math.max(0,Math.floor(Number(value)||0)),level=1,xpToNext=150;while(remaining>=xpToNext){remaining-=xpToNext;level++;xpToNext=150+40*(level-1);}return{level,currentXp:remaining,xpToNext};}

















async function adminLog(adminId,targetUserId,action,details={},client=null){await (client||pool).query('INSERT INTO admin_logs(admin_id,target_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[adminId,targetUserId,action,JSON.stringify(details)]);}
async function securityEvent(userId,ip,event,details={},client=null){const db=client||pool;if(!db)return;
 // Inside a transaction, a failed INSERT would abort it and turn the caller's
 // COMMIT into a silent ROLLBACK: isolate the write in a savepoint.
 if(client)await client.query('SAVEPOINT security_event');
 try{await db.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[userId||null,ip||null,event,JSON.stringify(details)]);if(client)await client.query('RELEASE SAVEPOINT security_event');}
 catch(e){console.error('SPORT VAULT security event error:',e.message);if(client)await client.query('ROLLBACK TO SAVEPOINT security_event');}}





async function adminSetAccountStatus(adminId,userId,action){
 const admin=await getUserById(adminId),u=(await pool.query('SELECT id,role,account_status,blocked_until FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};
 if(adminId===userId)return{error:'Tu ne peux pas modifier ton propre compte.',status:400};
 if(!canManage(admin,u))return{error:'Tu ne peux pas modifier un compte de niveau égal ou supérieur.',status:403};
 if(action==='ban'){await pool.query("UPDATE users SET account_status='banned',blocked_until=NULL WHERE id=$1",[userId]);await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);await adminLog(adminId,userId,'ban');return{ok:true,accountStatus:'banned'};}
 if(action==='block'){await pool.query("UPDATE users SET account_status='blocked',blocked_until=now()+interval '24 hours' WHERE id=$1",[userId]);await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);await adminLog(adminId,userId,'block',{durationHours:24});return{ok:true,accountStatus:'blocked',blockedUntil:new Date(Date.now()+24*3600_000).toISOString()};}
 if(action==='unblock'){await pool.query("UPDATE users SET account_status='active',blocked_until=NULL WHERE id=$1",[userId]);await adminLog(adminId,userId,'unblock');return{ok:true,accountStatus:'active'};}
 return{error:'Action administrateur inconnue.',status:400};
}
async function adminSetRole(adminId,userId,role){
 const admin=await getUserById(adminId),u=(await pool.query('SELECT id,role FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};if(adminId===userId)return{error:'Tu ne peux pas modifier ton propre rôle.',status:400};
 if(admin.role!=='creator'||u.role==='creator')return{error:'Seul le Créateur peut gérer les rôles, et le Créateur est protégé.',status:403};
 if(!['user','admin'].includes(role))return{error:'Rôle invalide.',status:400};
 await pool.query('UPDATE users SET role=$1 WHERE id=$2',[role,userId]);await adminLog(adminId,userId,'role_change',{role});return{ok:true,role};
}
async function adminAdjustResources(adminId,userId,kind,amount,reason){
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const result=await adjustResourcesLocked(client,adminId,userId,kind,amount,reason);
 await client.query(result.error?'ROLLBACK':'COMMIT');
 return result;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function adjustResourcesLocked(client,adminId,userId,kind,amount,reason){
 const admin=await getUserById(adminId),u=(await client.query('SELECT id,role,coins,reserved_coins,gems FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};if(!(admin.role==='creator'&&adminId===userId)&&!canManage(admin,u))return{error:'Tu ne peux pas modifier ce compte.',status:403};
 const n=Number(amount);if(!Number.isInteger(n)||n===0||Math.abs(n)>100000000)return{error:'Montant invalide.',status:400};
 if(kind==='coins'&&n<0&&Number(u.coins)-Number(u.reserved_coins)+n<0)return{error:'Impossible de retirer des FC disponibles.',status:400};
 if(kind==='gems'&&n<0&&Number(u.gems)+n<0)return{error:'Impossible de retirer autant de GEMS.',status:400};
 if(!['coins','gems'].includes(kind))return{error:'Ressource invalide.',status:400};
 const col=kind==='coins'?'coins':'gems';const updated=(await client.query(`UPDATE users SET ${col}=${col}+$1 WHERE id=$2 RETURNING *`,[n,userId])).rows[0];
 await securityEvent(userId,null,'admin_resource_adjust',{adminId,resource:kind,amount:n},client);
 await adminLog(adminId,userId,'resource_adjust',{resource:kind,amount:n,reason:String(reason||'').slice(0,200)},client);
 return{ok:true,user:safeUser(updated)};
}
async function adminTransferCard(adminId,instanceId,toUserId){
 const admin=await getUserById(adminId),client=await pool.connect();try{await client.query('BEGIN');const c=(await client.query('SELECT * FROM card_instances WHERE instance_id=$1 FOR UPDATE',[instanceId])).rows[0];const to=(await client.query('SELECT id,role FROM users WHERE id=$1',[toUserId])).rows[0];if(!c||!to){await client.query('ROLLBACK');return{error:'Carte ou utilisateur introuvable.',status:404}};const owner=(await client.query('SELECT id,role FROM users WHERE id=$1',[c.owner_id])).rows[0];if(!((admin.role==='creator'&&adminId===owner.id)||canManage(admin,owner))||!canManage(admin,to)){await client.query('ROLLBACK');return{error:'Action non autorisée sur ce compte.',status:403}};if(c.status!=='owned'){await client.query('ROLLBACK');return{error:'Cette carte n’est pas disponible pour un transfert.',status:400}};await client.query('UPDATE card_instances SET owner_id=$1,source=$2 WHERE instance_id=$3',[toUserId,'admin_transfer',instanceId]);await client.query('COMMIT');await adminLog(adminId,toUserId,'card_transfer',{instanceId,fromUserId:c.owner_id});return{ok:true};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}
async function adminRemoveCard(adminId,instanceId){
 const admin=await getUserById(adminId),c=(await pool.query('SELECT * FROM card_instances WHERE instance_id=$1',[instanceId])).rows[0];if(!c)return{error:'Carte introuvable.',status:404};const owner=await getUserById(c.owner_id);if(!(admin.role==='creator'&&adminId===c.owner_id)&&!canManage(admin,owner))return{error:'Action non autorisée.',status:403};if(c.status!=='owned')return{error:'Cette carte ne peut pas être retirée actuellement.',status:400};await pool.query('DELETE FROM card_instances WHERE instance_id=$1',[instanceId]);await adminLog(adminId,c.owner_id,'card_remove',{instanceId,cardId:c.card_id,name:c.name});return{ok:true};}
async function adminGrantCard(adminId,userId,cardId){
 const admin=await getUserById(adminId),u=await getUserById(userId);if(!u)return{error:'Utilisateur introuvable.',status:404};if(!(admin.role==='creator'&&adminId===userId)&&!canManage(admin,u))return{error:'Action non autorisée.',status:403};const row=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,max_supply FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0];if(!row)return{error:'Carte introuvable dans le catalogue.',status:404};const card={id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr),pace:Number(row.pace),shooting:Number(row.shooting),passing:Number(row.passing),dribbling:Number(row.dribbling),defending:Number(row.defending),physical:Number(row.physical),isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply)};const client=await pool.connect();try{await client.query('BEGIN');const instance=await buildInstance(card,userId,'admin_grant',client);await createCardInstance(instance,client);await client.query('COMMIT');await adminLog(adminId,userId,'card_grant',{instanceId:instance.instanceId,cardId,name:card.name});return{ok:true,card:publicCard(instance)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}}
async function adminLogs(){const r=await pool.query(`SELECT l.id,l.action,l.details,l.created_at,a.name AS admin_name,t.name AS target_name FROM admin_logs l JOIN users a ON a.id=l.admin_id LEFT JOIN users t ON t.id=l.target_user_id ORDER BY l.created_at DESC LIMIT 100`);return r.rows;}
async function adminOverview(){
 const [u,c,a,completed,packs,coins,gems]=await Promise.all([
  pool.query("SELECT count(*)::int AS n FROM users"),
  pool.query("SELECT count(*)::int AS n FROM card_instances"),
  pool.query("SELECT count(*)::int AS n FROM auctions WHERE status='active' AND ends_at>now()"),
  pool.query("SELECT count(*)::int AS n FROM auctions WHERE status='completed'"),
  pool.query("SELECT COALESCE(sum(packs_opened),0)::int AS n FROM users"),
  pool.query("SELECT COALESCE(sum(coins),0)::bigint AS n,COALESCE(sum(reserved_coins),0)::bigint AS reserved FROM users"),
  pool.query("SELECT COALESCE(sum(gems),0)::bigint AS n FROM users")
 ]);
 const rarity=await pool.query("SELECT rarity,count(*)::int AS n FROM card_instances GROUP BY rarity ORDER BY n DESC");
 const recent=await pool.query("SELECT id,name,email,role,coins,reserved_coins,gems,xp,created_at FROM users ORDER BY created_at DESC LIMIT 10");
 return {stats:{users:u.rows[0].n,cards:c.rows[0].n,activeAuctions:a.rows[0].n,completedAuctions:completed.rows[0].n,packsOpened:packs.rows[0].n,totalCoins:Number(coins.rows[0].n),reservedCoins:Number(coins.rows[0].reserved),totalGems:Number(gems.rows[0].n)},rarity:rarity.rows,recentUsers:recent.rows.map(safeUser)};
}
async function getCollections(){if(!pool)return ALBUM_CLUBS.map(c=>({...c,cards:CARD_CATALOG.filter(x=>x.club===c.name).sort((a,b)=>a.order-b.order)}));const cols=(await pool.query('SELECT id,name,tag,description,sort_order,created_at,updated_at FROM card_collections ORDER BY sort_order,id')).rows;const links=(await pool.query('SELECT collection_id,card_id,position FROM card_collection_cards ORDER BY collection_id,position')).rows;const by=new Map();for(const x of links){const arr=by.get(x.collection_id)||[];const card=CARD_CATALOG.find(c=>c.id===x.card_id);if(card)arr.push({...card,collectionPosition:Number(x.position)});by.set(x.collection_id,arr);}return cols.map(c=>({...c,cards:(by.get(c.id)||[]).sort((a,b)=>a.collectionPosition-b.collectionPosition)}));}
async function adminCollections(){const collections=await getCollections();return collections.map(c=>({...c,cardCount:c.cards.length,cardIds:c.cards.map(x=>x.id)}));}
async function adminSetCollection(adminId,action,body){const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut modifier les collections.',status:403};const id=String(body.id||'').trim(),name=String(body.name||'').trim(),tag=String(body.tag||'').trim().toUpperCase(),description=String(body.description||'').trim().slice(0,500);if(action==='create'){if(!/^[a-z0-9-]{2,50}$/.test(id)||name.length<2||name.length>80||tag.length<1||tag.length>12)return{error:'ID, nom et tag invalides.',status:400};const exists=await pool.query('SELECT 1 FROM card_collections WHERE id=$1',[id]);if(exists.rowCount)return{error:'Cet ID de collection existe déjà.',status:409};const maxOrder=(await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM card_collections')).rows[0].n;await pool.query('INSERT INTO card_collections(id,name,tag,description,sort_order) VALUES($1,$2,$3,$4,$5)',[id,name,tag,description,Number(maxOrder)]);await adminLog(adminId,null,'collection_create',{id,name,tag});return{ok:true};}if(action==='update'){if(!id||name.length<2||name.length>80||tag.length<1||tag.length>12)return{error:'ID, nom et tag invalides.',status:400};const r=await pool.query('UPDATE card_collections SET name=$1,tag=$2,description=$3,updated_at=now() WHERE id=$4 RETURNING id',[name,tag,description,id]);if(!r.rowCount)return{error:'Collection introuvable.',status:404};await adminLog(adminId,null,'collection_update',{id,name,tag});return{ok:true};}if(action==='delete'){if(!id)return{error:'Collection introuvable.',status:400};const r=await pool.query('DELETE FROM card_collections WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Collection introuvable.',status:404};await adminLog(adminId,null,'collection_delete',{id});return{ok:true};}if(action==='set_card_collections'){if(!id)return{error:'Carte introuvable.',status:400};const validCard=CARD_CATALOG.some(c=>c.id===id);if(!validCard)return{error:'Carte introuvable.',status:404};const collectionIds=Array.isArray(body.collectionIds)?[...new Set(body.collectionIds.map(String))]:[];const invalid=(await pool.query('SELECT id FROM card_collections WHERE id=ANY($1::varchar[])',[collectionIds])).rows.map(x=>x.id);if(invalid.length!==collectionIds.length)return{error:'Une ou plusieurs collections sont invalides.',status:400};const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[id]);for(const collectionId of collectionIds){const pos=(await client.query('SELECT COALESCE(MAX(position),-1)+1 AS n FROM card_collection_cards WHERE collection_id=$1',[collectionId])).rows[0].n;await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3)',[collectionId,id,Number(pos)]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}await adminLog(adminId,null,'card_collections_update',{cardId:id,collectionIds});return{ok:true};}if(action==='set_cards'){if(!id)return{error:'Collection introuvable.',status:400};const exists=await pool.query('SELECT 1 FROM card_collections WHERE id=$1',[id]);if(!exists.rowCount)return{error:'Collection introuvable.',status:404};const ids=Array.isArray(body.cardIds)?[...new Set(body.cardIds.map(String))]:[];const invalid=ids.filter(cardId=>!CARD_CATALOG.some(c=>c.id===cardId));if(invalid.length)return{error:'Une ou plusieurs cartes sont invalides.',status:400};const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM card_collection_cards WHERE collection_id=$1',[id]);for(let i=0;i<ids.length;i++)await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3)',[id,ids[i],i]);await client.query('UPDATE card_collections SET updated_at=now() WHERE id=$1',[id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}await adminLog(adminId,null,'collection_cards_update',{id,cardCount:ids.length});return{ok:true};}return{error:'Action collection inconnue.',status:400};}
async function adminPacks(){const packs=(await pool.query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,conditions,pool_id,active,sort_order FROM pack_definitions ORDER BY sort_order,id')).rows;const pools=(await pool.query('SELECT * FROM pack_pools ORDER BY name')).rows;return{packs:packs.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)})),pools:pools.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)}))};}
async function adminSetPack(adminId,action,body){const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut gérer les packs.',status:403};
 if(action==='pool_create'||action==='pool_update'){const id=String(body.id||'').trim(),name=String(body.name||'').trim(),type=String(body.type||'all'),config=body.config&&typeof body.config==='object'?body.config:{},price=Number(body.price??config.price??0),cards=Number(body.cards??config.cards??1),badge=String(body.badge??config.badge??'').trim(),description=String(body.description??config.description??'').trim().slice(0,300),active=body.active!==false&&config.active!==false;if((action==='pool_update'&&!id)||name.length<2||!['all','rarity','club','season','limited','manual'].includes(type)||!Number.isInteger(price)||price<0||!Number.isInteger(cards)||cards<1||cards>20)return{error:'Informations de pool invalides.',status:400};const finalId=id||'pool-'+crypto.randomUUID().replace(/-/g,'').slice(0,10);if(action==='pool_create')await pool.query('INSERT INTO pack_pools(id,name,type,config,price,cards,badge,description,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[finalId,name,type,JSON.stringify({...config,price,cards,badge,description,active}),price,cards,badge,description,active]);else{const r=await pool.query('UPDATE pack_pools SET name=$1,type=$2,config=$3,price=$4,cards=$5,badge=$6,description=$7,active=$8,updated_at=now() WHERE id=$9',[name,type,JSON.stringify({...config,price,cards,badge,description,active}),price,cards,badge,description,active,finalId]);if(!r.rowCount)return{error:'Pool introuvable.',status:404};}await adminLog(adminId,null,'pack_pool_'+action,{id:finalId,name,type,price,cards});return{ok:true,id:finalId};}
 if(action==='pool_delete'){const id=String(body.id||'');const r=await pool.query('DELETE FROM pack_pools WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Pool introuvable.',status:404};return{ok:true};}
 if(action==='pack_create'||action==='pack_update'){const id=String(body.id||'').trim(),name=String(body.name||'').trim(),price=Number(body.price),cards=Number(body.cards),badge=String(body.badge||'').trim(),description=String(body.description||'').trim(),guarantee=String(body.guarantee||'common'),guaranteeCount=Number(body.guaranteeCount||0),poolId=String(body.poolId||'').trim()||null,conditions=body.conditions&&typeof body.conditions==='object'?body.conditions:{},active=body.active!==false;if((action==='pack_update'&&!id)||name.length<2||!Number.isInteger(price)||price<0||!Number.isInteger(cards)||cards<1||cards>20||!['common','rare','epic','legendary','icon'].includes(guarantee)||!Number.isInteger(guaranteeCount)||guaranteeCount<0||guaranteeCount>cards)return{error:'Informations de pack invalides.',status:400};if(poolId&&!(await pool.query('SELECT 1 FROM pack_pools WHERE id=$1',[poolId])).rowCount)return{error:'Pool introuvable.',status:404};const finalId=id||'pack-'+crypto.randomUUID().replace(/-/g,'').slice(0,10);if(action==='pack_create'){const max=(await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM pack_definitions')).rows[0].n;await pool.query("INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order) VALUES($1,$2,$3,'coins',$4,$5,$6,$7,$8,$9,$10,$11,$12)",[finalId,name,price,cards,badge,description,guarantee,guaranteeCount,poolId,JSON.stringify(conditions),active,Number(max)]);}else{const r=await pool.query('UPDATE pack_definitions SET name=$1,price=$2,cards=$3,badge=$4,description=$5,guarantee=$6,guarantee_count=$7,pool_id=$8,conditions=$9,active=$10,updated_at=now() WHERE id=$11',[name,price,cards,badge,description,guarantee,guaranteeCount,poolId,JSON.stringify(conditions),active,finalId]);if(!r.rowCount)return{error:'Pack introuvable.',status:404};}await adminLog(adminId,null,'pack_'+action,{id:finalId,name,poolId,conditions});return{ok:true,id:finalId};}
 if(action==='pack_delete'){const id=String(body.id||'');const r=await pool.query('DELETE FROM pack_definitions WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Pack introuvable.',status:404};return{ok:true};}return{error:'Action pack inconnue.',status:400};
}
async function adminCompetitions(){
 const comps=(await pool.query('SELECT id,name,tag,country,description,status,sort_order,logo_url FROM competitions ORDER BY sort_order,id')).rows;
 const seasons=(await pool.query(`SELECT cs.id,cs.competition_id,cs.season,cs.label,cs.status,cs.description,cs.sort_order FROM competition_seasons cs ORDER BY cs.competition_id,cs.sort_order,cs.season DESC`)).rows;
 const clubs=(await pool.query('SELECT id,name,tag,country,logo_url,sort_order FROM clubs ORDER BY sort_order,name')).rows;
 const seasonLinks=(await pool.query('SELECT season_id,club_id,position FROM season_clubs ORDER BY season_id,position')).rows;
 const clubCompetitionLinks=(await pool.query('SELECT cc.club_id,cc.competition_id,c.name AS competition_name FROM competition_clubs cc JOIN competitions c ON c.id=cc.competition_id ORDER BY c.sort_order,c.name')).rows;
 const by=new Map();for(const l of seasonLinks){const arr=by.get(l.season_id)||[];arr.push(l.club_id);by.set(l.season_id,arr);}
 const clubComps=new Map();for(const l of clubCompetitionLinks){const x=clubComps.get(l.club_id)||{ids:[],names:[]};x.ids.push(l.competition_id);x.names.push(l.competition_name);clubComps.set(l.club_id,x);}
 const competitionClubs=new Map();for(const l of clubCompetitionLinks){const arr=competitionClubs.get(l.competition_id)||[];arr.push(l.club_id);competitionClubs.set(l.competition_id,arr);}
 return{competitions:comps.map(c=>({...c,clubIds:competitionClubs.get(c.id)||[],seasons:seasons.filter(x=>x.competition_id===c.id).map(x=>({...x,clubIds:by.get(x.id)||[],clubCount:(by.get(x.id)||[]).length})),seasonCount:seasons.filter(x=>x.competition_id===c.id).length})),clubs:clubs.map(c=>({...c,competitionIds:clubComps.get(c.id)?.ids||[],competitionNames:clubComps.get(c.id)?.names||[]}))};
}
async function adminSetCompetition(adminId,action,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut modifier les compétitions.',status:403};
 const id=String(body.id||'').trim(),name=String(body.name||'').trim(),tag=String(body.tag||'').trim().toUpperCase(),country=String(body.country||'').trim(),description=String(body.description||'').trim().slice(0,500),status=String(body.status||'upcoming').trim();
 if(action==='create'||action==='update'){
  if(!/^[a-z0-9-]{2,50}$/.test(id)||name.length<2||name.length>80||tag.length<1||tag.length>12||!['available','upcoming'].includes(status))return{error:'Informations de compétition invalides.',status:400};
  if(action==='create'){const exists=await pool.query('SELECT 1 FROM competitions WHERE id=$1',[id]);if(exists.rowCount)return{error:'Cette compétition existe déjà.',status:409};const max=(await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM competitions')).rows[0].n;await pool.query('INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,name,tag,country,description,status,Number(max)]);}
  else{const rr=await pool.query('UPDATE competitions SET name=$1,tag=$2,country=$3,description=$4,status=$5,updated_at=now() WHERE id=$6 RETURNING id',[name,tag,country,description,status,id]);if(!rr.rowCount)return{error:'Compétition introuvable.',status:404};}
  await adminLog(adminId,null,'competition_'+action,{id,name,status});return{ok:true};
 }
 if(action==='delete'){const rr=await pool.query('DELETE FROM competitions WHERE id=$1 RETURNING id',[id]);if(!rr.rowCount)return{error:'Compétition introuvable.',status:404};await adminLog(adminId,null,'competition_delete',{id});return{ok:true};}
 if(action==='season_create'||action==='season_update'){
  const seasonId=String(body.seasonId||id||'').trim(),competitionId=String(body.competitionId||'').trim(),season=String(body.season||'').trim(),label=season,seasonStatus=String(body.seasonStatus||'upcoming').trim(),seasonDescription=String(body.seasonDescription||'').trim().slice(0,500);
  if((action==='season_update'&&!seasonId)||!competitionId||!/^[0-9]{4}(?:-[0-9]{4})?$/.test(season)||!['available','upcoming'].includes(seasonStatus))return{error:'Informations de saison invalides.',status:400};
  if(!(await pool.query('SELECT 1 FROM competitions WHERE id=$1',[competitionId])).rowCount)return{error:'Compétition introuvable.',status:404};
  let finalSeasonId=seasonId;
  if(action==='season_create'){
   const base=competitionId+'-'+season.toLowerCase().replace(/[^0-9]+/g,'-').replace(/^-+|-+$/g,'');
   finalSeasonId=base||('season-'+crypto.randomUUID().replace(/-/g,'').slice(0,12));
   let n=1,candidate=finalSeasonId;while((await pool.query('SELECT 1 FROM competition_seasons WHERE id=$1 OR (competition_id=$2 AND season=$3)',[candidate,competitionId,season])).rowCount){candidate=finalSeasonId+'-'+n++;}finalSeasonId=candidate;
   const max=(await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM competition_seasons WHERE competition_id=$1',[competitionId])).rows[0].n;
   await pool.query('INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)',[finalSeasonId,competitionId,season,label,seasonStatus,seasonDescription,Number(max)]);
  }else{
   const previous=(await pool.query('SELECT season FROM competition_seasons WHERE id=$1 AND competition_id=$2',[seasonId,competitionId])).rows[0];if(!previous)return{error:'Saison introuvable.',status:404};
   if((await pool.query('SELECT 1 FROM competition_seasons WHERE competition_id=$1 AND season=$2 AND id<>$3',[competitionId,season,seasonId])).rowCount)return{error:'Cette saison existe déjà dans la compétition.',status:409};
   const clubIds=(await pool.query('SELECT club_id FROM season_clubs WHERE season_id=$1',[seasonId])).rows.map(x=>x.club_id);const client=await pool.connect();
   try{await client.query('BEGIN');await client.query('UPDATE competition_seasons SET season=$1,label=$1,status=$2,description=$3,updated_at=now() WHERE id=$4',[season,seasonStatus,seasonDescription,seasonId]);if(previous.season!==season&&clubIds.length){await client.query('UPDATE catalog_cards SET season=$1,updated_at=now() WHERE season=$2 AND club IN (SELECT name FROM clubs WHERE id=ANY($3::varchar[]))',[season,previous.season,clubIds]);await client.query('UPDATE card_instances SET season=$1 WHERE season=$2 AND club IN (SELECT name FROM clubs WHERE id=ANY($3::varchar[]))',[season,previous.season,clubIds]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  }
  await adminLog(adminId,null,'competition_season_'+(action==='season_create'?'create':'update'),{seasonId:finalSeasonId,competitionId,season});return{ok:true,seasonId:finalSeasonId};
 }
 if(action==='season_delete'){
  const rr=await pool.query('DELETE FROM competition_seasons WHERE id=$1 RETURNING id',[String(body.seasonId||id||'')]);if(!rr.rowCount)return{error:'Saison introuvable.',status:404};await adminLog(adminId,null,'competition_season_delete',{seasonId:String(body.seasonId||id||'')});return{ok:true};
 }
 if(action==='season_set_clubs'){
  const seasonId=String(body.seasonId||'').trim(),ids=Array.isArray(body.clubIds)?[...new Set(body.clubIds.map(String))]:[];
  if(!(await pool.query('SELECT 1 FROM competition_seasons WHERE id=$1',[seasonId])).rowCount)return{error:'Saison introuvable.',status:404};
  const valid=(await pool.query('SELECT id FROM clubs WHERE id=ANY($1::varchar[])',[ids])).rows.map(x=>x.id);if(valid.length!==ids.length)return{error:'Un ou plusieurs clubs sont invalides.',status:400};
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM season_clubs WHERE season_id=$1',[seasonId]);for(let i=0;i<ids.length;i++)await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3)',[seasonId,ids[i],i]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'competition_season_clubs_update',{seasonId,clubIds:ids});return{ok:true};
 }
 if(action==='club_create'){
  const cn=String(body.clubName||body.name||'').trim(),logoUrl=String(body.logoUrl||'').trim().slice(0,2048),competitionIds=Array.isArray(body.competitionIds)?[...new Set(body.competitionIds.map(String))]:[];
  if(cn.length<2||cn.length>80||!competitionIds.length)return{error:'Nom du club et au moins une compétition obligatoires.',status:400};
  if(logoUrl&&!/^https?:\/\/\S+$/i.test(logoUrl))return{error:'Le logo doit être une URL d’image commençant par https:// ou http://.',status:400};
  const validComps=(await pool.query('SELECT id,country FROM competitions WHERE id=ANY($1::varchar[]) AND status=\'available\'',[competitionIds])).rows;
  if(validComps.length!==competitionIds.length)return{error:'Une ou plusieurs compétitions sélectionnées sont indisponibles.',status:400};
  const exists=await pool.query('SELECT 1 FROM clubs WHERE LOWER(name)=LOWER($1)',[cn]);if(exists.rowCount)return{error:'Ce club existe déjà.',status:409};
  const baseId=cn.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,36)||'club';
  const cid=baseId+'-'+crypto.randomUUID().replace(/-/g,'').slice(0,8),ct=cn.split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,6).toUpperCase()||'CLUB',cc=validComps[0]?.country||'';
  const max=(await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM clubs')).rows[0].n,client=await pool.connect();
  try{await client.query('BEGIN');await client.query('INSERT INTO clubs(id,name,tag,country,logo_url,sort_order) VALUES($1,$2,$3,$4,$5,$6)',[cid,cn,ct,cc,logoUrl||null,Number(max)]);for(let i=0;i<competitionIds.length;i++)await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[competitionIds[i],cid,i]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'club_create',{id:cid,name:cn,competitionIds,hasLogo:!!logoUrl});return{ok:true};
 }
 if(action==='club_update'){
  const clubId=String(body.id||body.clubId||'').trim(),cn=String(body.clubName||body.name||'').trim(),logoUrl=String(body.logoUrl||'').trim().slice(0,2048),competitionIds=Array.isArray(body.competitionIds)?[...new Set(body.competitionIds.map(String))]:[];
  const previous=(await pool.query('SELECT name,country FROM clubs WHERE id=$1',[clubId])).rows[0];if(!previous)return{error:'Club introuvable.',status:404};
  if(cn.length<2||cn.length>80||!competitionIds.length)return{error:'Nom du club et au moins une compétition obligatoires.',status:400};
  if(logoUrl&&!/^https?:\/\/\S+$/i.test(logoUrl))return{error:'Le logo doit être une URL d’image commençant par https:// ou http://.',status:400};
  const validComps=(await pool.query('SELECT id,country FROM competitions WHERE id=ANY($1::varchar[]) AND status=\'available\'',[competitionIds])).rows;if(validComps.length!==competitionIds.length)return{error:'Une ou plusieurs compétitions sélectionnées sont indisponibles.',status:400};
  const cc=validComps[0]?.country||previous.country||'',client=await pool.connect();
  try{await client.query('BEGIN');await client.query('UPDATE clubs SET name=$1,country=$2,logo_url=$3,updated_at=now() WHERE id=$4',[cn,cc,logoUrl||null,clubId]);await client.query('DELETE FROM competition_clubs WHERE club_id=$1',[clubId]);for(let i=0;i<competitionIds.length;i++)await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[competitionIds[i],clubId,i]);if(previous.name!==cn){await client.query('UPDATE catalog_cards SET club=$1,updated_at=now() WHERE club=$2',[cn,previous.name]);await client.query('UPDATE card_instances SET club=$1 WHERE club=$2',[cn,previous.name]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'club_update',{id:clubId,name:cn,competitionIds,hasLogo:!!logoUrl});return{ok:true};
 }
 if(action==='club_delete'){const previous=(await pool.query('SELECT id,name FROM clubs WHERE id=$1',[id])).rows[0];if(!previous)return{error:'Club introuvable.',status:404};const rr=await pool.query('DELETE FROM clubs WHERE id=$1 RETURNING id',[id]);if(!rr.rowCount)return{error:'Club introuvable.',status:404};await adminLog(adminId,null,'club_delete',{id});return{ok:true};}
 return{error:'Action compétition inconnue.',status:400};
}
async function adminCards(){const r=await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,rarity_locked,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE is_active=true ORDER BY card_order,id');const statsRows=await pool.query('SELECT card_id,count(*)::int AS total_instances,count(DISTINCT owner_id)::int AS owners FROM card_instances GROUP BY card_id');const stats=new Map(statsRows.rows.map(x=>[x.card_id,x]));return r.rows.map(c=>({...c,rarityLocked:Boolean(c.rarity_locked),jerseyNumber:c.jersey_number==null?null:Number(c.jersey_number),ovr:Number(c.ovr),pace:Number(c.pace),shooting:Number(c.shooting),passing:Number(c.passing),dribbling:Number(c.dribbling),defending:Number(c.defending),physical:Number(c.physical),distributionType:c.distribution_type,isLimited:Boolean(c.is_limited),maxSupply:c.max_supply==null?null:Number(c.max_supply),order:Number(c.card_order),rarityLabel:RARITIES[c.rarity]?.label||c.rarity,totalInstances:Number(stats.get(c.id)?.total_instances||0),owners:Number(stats.get(c.id)?.owners||0)}));}
async function adminCreateCatalogCard(adminId,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut ajouter une carte au catalogue.',status:403};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=String(body.nation||'').trim(),season=String(body.season||'').trim(),{rarity,locked:rarityLocked}=cardRarity(body),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
 const allowedPositions=['GK','RB','LB','CB','RWB','LWB','DM','CM','AM','RW','LW','ST'];
 if(!competitionId||!seasonId)return{error:'Compétition et saison obligatoires.',status:400};
 const context=(await pool.query('SELECT cs.id,cs.competition_id,cs.season,c.id AS club_id,c.name AS club_name FROM competition_seasons cs JOIN competitions comp ON comp.id=cs.competition_id JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id WHERE cs.id=$1 AND cs.competition_id=$2 AND c.name=$3 AND cs.status=\'available\' AND comp.status=\'available\'',[seasonId,competitionId,club])).rows[0];
 const ovr=Number(body.ovr),stats={pace:Number(body.pace),shooting:Number(body.shooting),passing:Number(body.passing),dribbling:Number(body.dribbling),defending:Number(body.defending),physical:Number(body.physical)},isLimited=Boolean(body.isLimited),maxSupply=body.maxSupply===''||body.maxSupply==null?null:Number(body.maxSupply);
 if(!context||!name||name.length>80||!allowedPositions.includes(position)||(jerseyNumber!==null&&(!Number.isInteger(jerseyNumber)||jerseyNumber<1||jerseyNumber>99))||!nation||nation.length>80||!season||season.length>12||String(context.season)!==season)return{error:'Un ou plusieurs champs sont invalides.',status:400};
 if(!RARITIES[rarity])return{error:'Rareté invalide.',status:400};
 if(!Number.isInteger(ovr)||ovr<1||ovr>99)return{error:'OVR doit être un entier entre 1 et 99.',status:400};
 if(Object.values(stats).some(v=>!Number.isInteger(v)||v<1||v>99))return{error:'Chaque statistique doit être un entier entre 1 et 99.',status:400};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const baseId=String(body.id||'').trim().toLowerCase();
 const id=baseId||('fv-'+crypto.randomUUID().replace(/-/g,'').slice(0,20));
 if(!/^[a-z0-9-]{2,32}$/.test(id))return{error:'ID de carte invalide.',status:400};
 const existing=(await pool.query('SELECT id,is_active FROM catalog_cards WHERE id=$1',[id])).rows[0];
 if(existing?.is_active)return{error:'Cet ID de carte existe déjà.',status:409};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const client=await pool.connect();
 let maxOrder=0;
 try{
  await client.query('BEGIN');
  maxOrder=Number((await client.query('SELECT COALESCE(MAX(card_order),-1)+1 AS n FROM catalog_cards')).rows[0].n);
  if(existing) await client.query('UPDATE catalog_cards SET is_active=true,season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,distribution_type=$16,is_limited=$17,max_supply=$18,card_order=$19,rarity_locked=$20,updated_at=now() WHERE id=$1',[id,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,maxOrder,rarityLocked]);
  else await client.query('INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active,rarity_locked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)',[id,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,maxOrder,true,rarityLocked]);
  await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[id]);
  await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) SELECT id,$1,COALESCE((SELECT MAX(position)+1 FROM card_collection_cards x WHERE x.collection_id=card_collections.id),0) FROM card_collections WHERE LOWER(name)=LOWER($2) ON CONFLICT DO NOTHING',[id,club]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
 const created={id,season,name,position,jerseyNumber,club,nation,rarity,rarityLocked,rarityLabel:RARITIES[rarity].label,distributionType:isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,ovr,...stats,order:maxOrder,isActive:true};
 CARD_CATALOG.push(created);
 await adminLog(adminId,null,'catalog_card_create',{cardId:id,name,position,club,nation,rarity,ovr,competitionId,seasonId});
 return{ok:true,card:created};
}
async function adminDeleteCatalogCard(adminId,cardId,confirm=false){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut supprimer une carte du catalogue.',status:403};
 const card=CARD_CATALOG.find(x=>x.id===cardId);if(!card)return{error:'Carte introuvable.',status:404};
 const preview=(await pool.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status='owned')::int AS owned,count(*) FILTER (WHERE status='auction')::int AS auction FROM card_instances WHERE card_id=$1`,[cardId])).rows[0];
 const total=Number(preview.total||0),owned=Number(preview.owned||0),auction=Number(preview.auction||0);
 if(!confirm)return{preview:true,cardId,name:card.name,owned,total,auction};
 const client=await pool.connect();let deletedAuctions=0;
 try{
  await client.query('BEGIN');
  const locked=(await client.query('SELECT id FROM catalog_cards WHERE id=$1 AND is_active=true FOR UPDATE',[cardId])).rows[0];
  if(!locked){await client.query('ROLLBACK');return{error:'Carte introuvable.',status:404};}
  const cardAuctions=(await client.query(`SELECT id,current_bid,current_bidder_id,status FROM auctions WHERE card_instance_id IN (SELECT instance_id FROM card_instances WHERE card_id=$1) FOR UPDATE`,[cardId])).rows;
  for(const auction of cardAuctions){
   if(auction.status==='active'&&auction.current_bidder_id)await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[Number(auction.current_bid||0),auction.current_bidder_id]);
   await client.query('DELETE FROM auctions WHERE id=$1',[auction.id]);
  }
  deletedAuctions=cardAuctions.length;
  const deleted=(await client.query('DELETE FROM card_instances WHERE card_id=$1 RETURNING instance_id',[cardId])).rowCount;
  await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[cardId]);
  await client.query('UPDATE catalog_cards SET is_active=false,updated_at=now() WHERE id=$1',[cardId]);
  await client.query('COMMIT');
  const pos=CARD_CATALOG.findIndex(x=>x.id===cardId);if(pos>=0)CARD_CATALOG.splice(pos,1);
  await adminLog(adminId,null,'catalog_card_delete',{cardId,name:card.name,club:card.club,deletedInstances:deleted,deletedAuctions});
  return{ok:true,deletedInstances:deleted,deletedAuctions};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function adminUpdateCatalogCard(adminId,cardId,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut modifier le catalogue.',status:403};
 const dbCard=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,rarity_locked,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0];if(!dbCard)return{error:'Carte introuvable.',status:404};const c={id:dbCard.id,season:dbCard.season,name:dbCard.name,position:dbCard.position,jerseyNumber:dbCard.jersey_number==null?null:Number(dbCard.jersey_number),club:dbCard.club,nation:dbCard.nation,rarity:dbCard.rarity,ovr:Number(dbCard.ovr),pace:Number(dbCard.pace),shooting:Number(dbCard.shooting),passing:Number(dbCard.passing),dribbling:Number(dbCard.dribbling),defending:Number(dbCard.defending),physical:Number(dbCard.physical),distributionType:dbCard.distribution_type,isLimited:Boolean(dbCard.is_limited),maxSupply:dbCard.max_supply==null?null:Number(dbCard.max_supply),order:Number(dbCard.card_order||0)};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=String(body.nation||'').trim(),season=String(body.season||'').trim(),{rarity,locked:rarityLocked}=cardRarity(body,Boolean(dbCard.rarity_locked)),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
 const allowedPositions=['GK','RB','LB','CB','RWB','LWB','DM','CM','AM','RW','LW','ST'],allowedClubs=pool?(await pool.query('SELECT name FROM clubs')).rows.map(x=>x.name):[...new Set(CARD_CATALOG.map(x=>x.club).filter(Boolean))];
 if(!competitionId||!seasonId)return{error:'Compétition et saison obligatoires.',status:400};
 const context=(await pool.query('SELECT cs.id,cs.competition_id,cs.season,c.id AS club_id,c.name AS club_name FROM competition_seasons cs JOIN competitions comp ON comp.id=cs.competition_id JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id WHERE cs.id=$1 AND cs.competition_id=$2 AND c.name=$3 AND cs.status=\'available\' AND comp.status=\'available\'',[seasonId,competitionId,club])).rows[0];const ovr=Number(body.ovr),stats={pace:Number(body.pace),shooting:Number(body.shooting),passing:Number(body.passing),dribbling:Number(body.dribbling),defending:Number(body.defending),physical:Number(body.physical)},isLimited=Boolean(body.isLimited),maxSupply=body.maxSupply===''||body.maxSupply==null?null:Number(body.maxSupply);
 if(!name||name.length>80||!allowedPositions.includes(position)||(jerseyNumber!==null&&(!Number.isInteger(jerseyNumber)||jerseyNumber<1||jerseyNumber>99))||!allowedClubs.includes(club)||!nation||nation.length>80||!season||season.length>12||String(context.season)!==season)return{error:'Un ou plusieurs champs sont invalides.',status:400};
 if(!RARITIES[rarity])return{error:'Rareté invalide.',status:400};
 if(!Number.isInteger(ovr)||ovr<1||ovr>99)return{error:'OVR doit être un entier entre 1 et 99.',status:400};if(Object.values(stats).some(v=>!Number.isInteger(v)||v<1||v>99))return{error:'Chaque statistique doit être un entier entre 1 et 99.',status:400};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const circulation=Number((await pool.query('SELECT count(*)::int AS n FROM card_instances WHERE card_id=$1',[cardId])).rows[0].n);
 if(circulation>0&&Boolean(c.isLimited)!==isLimited)return{error:'Le type STANDARD/LIMITED ne peut plus être changé après la mise en circulation d’exemplaires.',status:409};
 if(isLimited&&circulation>Number(maxSupply))return{error:`La quantité maximale ne peut pas être inférieure aux ${circulation} exemplaire(s) déjà en circulation.`,status:409};
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('UPDATE catalog_cards SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,distribution_type=$16,is_limited=$17,max_supply=$18,rarity_locked=$19,updated_at=now() WHERE id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,rarityLocked]);await client.query('UPDATE card_instances SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,is_limited=$16,max_supply=$17 WHERE card_id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited,maxSupply]);await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[cardId]);await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) SELECT id,$1,COALESCE((SELECT MAX(position)+1 FROM card_collection_cards x WHERE x.collection_id=card_collections.id),0) FROM card_collections WHERE LOWER(name)=LOWER($2) ON CONFLICT DO NOTHING',[cardId,club]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
 Object.assign(c,{season,name,position,jerseyNumber,club,nation,rarity,rarityLocked,rarityLabel:RARITIES[rarity].label,distributionType:isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,ovr,...stats});
 await adminLog(adminId,null,'catalog_card_update',{cardId,name,position,jerseyNumber,club,nation,rarity,rarityLocked,ovr,competitionId,seasonId,distributionType:isLimited?'LIMITED':'STANDARD',maxSupply,...stats});
 return{ok:true,card:c};
}
async function adminUsers(search=''){
 const q=String(search||'').trim().toLowerCase();
 const r=await pool.query(`SELECT u.id,u.name,u.email,u.role,u.coins,u.reserved_coins,u.gems,u.xp,u.created_at,
 (SELECT count(*) FROM card_instances c WHERE c.owner_id=u.id)::int AS card_count,
 (SELECT count(*) FROM auctions a WHERE a.seller_id=u.id AND a.status='active' AND a.ends_at>now())::int AS active_sales,
 (SELECT count(DISTINCT b.auction_id) FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.bidder_id=u.id AND a.status='active' AND a.ends_at>now())::int AS active_bids
 FROM users u WHERE ($1='' OR lower(u.name) LIKE '%'||$1||'%' OR lower(u.email) LIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 100`,[q]);
 return r.rows.map(x=>({...safeUser(x),cardCount:x.card_count,activeSales:x.active_sales,activeBids:x.active_bids}));
}
async function adminUserDetail(userId){
 const u=(await pool.query('SELECT id,name,email,role,account_status,blocked_until,coins,reserved_coins,gems,xp,packs_opened,created_at FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};
 const cards=(await pool.query("SELECT instance_id,card_id,name,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,source,status,acquired_at FROM card_instances WHERE owner_id=$1 ORDER BY acquired_at DESC",[userId])).rows;
 const sales=(await pool.query("SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.completed_at,c.name AS card_name,c.rarity,c.is_limited,c.serial,c.max_supply FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.seller_id=$1 ORDER BY a.created_at DESC LIMIT 30",[userId])).rows;
 const bids=(await pool.query("SELECT b.auction_id,b.amount,b.created_at,c.name AS card_name,a.status FROM auction_bids b JOIN auctions a ON a.id=b.auction_id JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE b.bidder_id=$1 ORDER BY b.created_at DESC LIMIT 30",[userId])).rows;
 return {...safeUser(u),packsOpened:Number(u.packs_opened||0),createdAt:u.created_at,cards,sales,bids};
}
async function adminAuctions(){
 const r=await pool.query(`SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.created_at,a.completed_at,
 c.name AS card_name,c.rarity,c.is_limited,c.serial,c.max_supply,u.name AS seller_name,ub.name AS bidder_name,
 (SELECT count(*) FROM auction_bids b WHERE b.auction_id=a.id)::int AS bid_count
 FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id JOIN users u ON u.id=a.seller_id LEFT JOIN users ub ON ub.id=a.current_bidder_id
 ORDER BY COALESCE(a.completed_at,a.ends_at) DESC LIMIT 100`);
 return r.rows;
}









const { clientIp, ipDiagnostics } = require('./lib/client-ip');



async function applyReward(userId,reward,client=null){const db=client||pool;if(db){const r=await db.query('UPDATE users SET coins=coins+$1,xp=xp+$2 WHERE id=$3 RETURNING *',[reward.coins||0,reward.xp||0,userId]);return r.rows[0]||null;}const user=memory.users.get(userId);if(!user)return null;user.coins+=reward.coins||0;user.xp+=reward.xp||0;return user;}
async function claimExists(userId,claimId){if(pool){const r=await pool.query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2',[userId,claimId]);return r.rowCount>0;}return memory.claims.has(`${userId}:${claimId}`);}
async function addClaim(userId,claimId,client=null){const db=client||pool;if(db){await db.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,claimId]);}else memory.claims.set(`${userId}:${claimId}`,true);}

function missionProgress(mission,cards,user){
  if(mission.type==='cards')return cards.length;
  if(mission.type==='packs')return Number(user?.packs_opened||0);
  if(mission.type==='rarePlus')return cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0;
  if(mission.type==='epicPlus')return cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0;
  if(mission.type==='legendaryPlus')return cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0;
  if(mission.type==='iconPlus')return cards.some(c=>String(c.rarity)==='icon')?1:0;
  if(mission.type==='distinctClubs')return new Set(cards.map(c=>c.club).filter(Boolean)).size;
  return 0;
}
async function missionUnlocked(userId,mission){
  if(!mission.prerequisite)return true;
  return claimExists(userId,mission.prerequisite);
}
async function periodActivity(userId,kind,date=new Date()){
  const period=periodInfo(kind,date);
  if(pool){
    const cards=(await pool.query(
      "SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' AND source<>'welcome' AND acquired_at >= $2 AND acquired_at < $3 ORDER BY acquired_at DESC",
      [userId,period.start,period.end]
    )).rows.map(publicCard);
    const events=(await pool.query(
      "SELECT event,created_at FROM security_events WHERE user_id=$1 AND event IN ('pack_open','pool_draw') AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC",
      [userId,period.start,period.end]
    )).rows;
    return{...period,cards,packOpens:events.length};
  }
  const cards=[...memory.cards.values()].filter(c=>c.ownerId===userId&&c.status==='owned'&&c.source!=='welcome'&&new Date(c.acquiredAt)>=period.start&&new Date(c.acquiredAt)<period.end).map(publicCard);
  const packOpens=memory.activity.filter(e=>e.userId===userId&&(e.event==='pack_open'||e.event==='pool_draw')&&new Date(e.at)>=period.start&&new Date(e.at)<period.end).length;
  return{...period,cards,packOpens};
}
function taskProgress(task,activity){
  if(task.type==='packsOpened')return activity.packOpens;
  if(task.type==='cardsObtained')return activity.cards.length;
  if(task.type==='rarePlusObtained')return activity.cards.filter(c=>Number(RARITIES[c.rarity]?.order||0)>=2).length;
  if(task.type==='distinctClubsObtained')return new Set(activity.cards.map(c=>c.club).filter(Boolean)).size;
  return 0;
}

async function claimTask(userId,kind,taskId){
  const tasks=kind==='weekly'?WEEKLY_TASKS:DAILY_TASKS;
  const task=tasks.find(t=>t.id===taskId);
  if(!task)return{error:'Tâche introuvable.',status:404};
  const activity=await periodActivity(userId,kind);
  const progress=Math.min(taskProgress(task,activity),task.target);
  if(progress<task.target)return{error:'Tâche non terminée.',status:400,progress,target:task.target};
  const claimId=taskClaimId(kind,activity.key,task.id);
  if(await claimExists(userId,claimId))return{error:'Tâche déjà récupérée pour cette période.',status:400};
  if(pool){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,claimId]);
      if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Tâche déjà récupérée pour cette période.',status:400};}
      const user=await applyReward(userId,task.reward,client);
      await securityEvent(userId,null,kind==='weekly'?'weekly_task_claim':'daily_task_claim',{taskId:task.id,period:activity.key,coins:task.reward.coins,xp:task.reward.xp},client);
      await client.query('COMMIT');
      return{task,reward:task.reward,user:safeUser(user),period:activity.key};
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
    finally{client.release();}
  }
  memory.claims.set(`${userId}:${claimId}`,true);
  const user=await applyReward(userId,task.reward);
  return{task,reward:task.reward,user:safeUser(user),period:activity.key};
}
async function claimDaily(userId){const reward={coins:150,xp:10};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(user.daily_claimed_at&&parisDayKey(user.daily_claimed_at)===parisDayKey(new Date())){await client.query('ROLLBACK');return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};}const updated=await applyReward(userId,reward,client);await client.query('UPDATE users SET daily_claimed_at=now() WHERE id=$1',[userId]);await securityEvent(userId,null,'daily_reward_claim',{coins:reward.coins,xp:reward.xp},client);await client.query('COMMIT');return{reward,user:safeUser(updated)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=memory.users.get(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(user.dailyClaimedAt&&parisDayKey(user.dailyClaimedAt)===parisDayKey(new Date()))return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};user.coins+=reward.coins;user.xp+=reward.xp;user.dailyClaimedAt=new Date().toISOString();return{reward,user:safeUser(user)};}
async function claimMission(userId,missionId){
  const mission=MISSIONS.find(m=>m.id===missionId);
  if(!mission)return{error:'Mission introuvable.',status:404};
  if(!(await missionUnlocked(userId,mission)))return{error:'Cette mission est encore verrouillée.',status:403};
  const cards=await getUserCards(userId);
  const missionUser=await getUserById(userId);
  const progress=Math.min(missionProgress(mission,cards,missionUser),mission.target);
  if(progress<mission.target)return{error:'Mission non terminée.',status:400,progress,target:mission.target};
  if(await claimExists(userId,mission.id))return{error:'Mission déjà récupérée.',status:400};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,mission.id]);if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Mission déjà récupérée.',status:400};}const user=await applyReward(userId,mission.reward,client);await securityEvent(userId,null,'mission_reward_claim',{missionId:mission.id,coins:mission.reward.coins,xp:mission.reward.xp},client);await client.query('COMMIT');return{mission,reward:mission.reward,user:safeUser(user)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(userId,mission.id);const user=await applyReward(userId,mission.reward);return{mission,reward:mission.reward,user:safeUser(user)};}


async function albumViews(owned,selectedSeasonId=null,userId=null){
 if(pool){
  const [comps,seasons,links,counts]=await Promise.all([
   pool.query('SELECT id,name,tag,country,description,status,sort_order,logo_url FROM competitions ORDER BY sort_order,id'),
   pool.query('SELECT id,competition_id,season,label,status,description,sort_order FROM competition_seasons ORDER BY competition_id,sort_order,season DESC'),
   pool.query('SELECT sc.season_id,c.id,c.name,c.tag,c.country,c.logo_url,c.sort_order FROM season_clubs sc JOIN clubs c ON c.id=sc.club_id ORDER BY sc.season_id,sc.position,c.sort_order'),
   pool.query(`SELECT cc.season,cc.club,COUNT(DISTINCT cc.id)::int AS total,
     COUNT(DISTINCT cc.id) FILTER (WHERE ci.instance_id IS NOT NULL)::int AS owned
     FROM catalog_cards cc
     LEFT JOIN card_instances ci ON ci.card_id=cc.id AND ci.owner_id=$1 AND ci.status='owned'
     WHERE cc.is_active=true GROUP BY cc.season,cc.club`,[userId])
  ]);
  const seasonRows=seasons.rows,seasonById=new Map(seasonRows.map(x=>[x.id,String(x.season)]));
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const clubKey=v=>{const n=norm(v);const aliases={troyes:'estactroyes',estac:'estactroyes',estactroyes:'estactroyes',losclille:'lille',losc:'lille',lilleosc:'lille',angerssco:'angers',stadebretois:'brest',stadebretois29:'brest'};return aliases[n]||n;};
  const countMap=new Map(counts.rows.map(r=>[String(r.season)+'|'+clubKey(r.club),{total:Number(r.total||0),owned:Number(r.owned||0)}]));
  const selected=seasonRows.find(x=>x.id===selectedSeasonId),selectedSeason=selected?String(selected.season):null;
  const selectedRows=selectedSeason?(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true AND season=$1 ORDER BY card_order,id',[selectedSeason])).rows:[];
  const cardsByClub=new Map();
  for(const r of selectedRows){
   const key=String(r.season)+'|'+clubKey(r.club),arr=cardsByClub.get(key)||[];
   arr.push({id:r.id,season:r.season,name:r.name,position:r.position,jerseyNumber:r.jersey_number==null?null:Number(r.jersey_number),club:r.club,nation:r.nation,rarity:r.rarity,ovr:Number(r.ovr||72),pace:Number(r.pace||72),shooting:Number(r.shooting||72),passing:Number(r.passing||72),dribbling:Number(r.dribbling||72),defending:Number(r.defending||72),physical:Number(r.physical||72),distributionType:String(r.distribution_type||'STANDARD').toUpperCase(),isLimited:Boolean(r.is_limited),maxSupply:r.max_supply==null?null:Number(r.max_supply),order:Number(r.card_order||0),rarityLabel:RARITIES[r.rarity]?.label||r.rarity});
   cardsByClub.set(key,arr);
  }
  const grouped=new Map();
  const seenClubKeys=new Set();
  for(const x of links.rows){
   const season=seasonById.get(x.season_id)||'',key=season+'|'+clubKey(x.name),stats=countMap.get(key)||{total:0,owned:0};
   const uniqueKey=String(x.season_id)+'|'+clubKey(x.name);
   if(seenClubKeys.has(uniqueKey)) continue;
   seenClubKeys.add(uniqueKey);
   const cards=selectedSeason===season?(cardsByClub.get(key)||[]):[];
   const arr=grouped.get(x.season_id)||[];
   const isTroyes=clubKey(x.name)==='estactroyes';
   arr.push({id:x.id,name:isTroyes?'ESTAC Troyes':x.name,tag:isTroyes?'EST':x.tag,country:x.country,logoUrl:x.logo_url||'',cards,owned:stats.owned,total:stats.total,complete:stats.total>0&&stats.owned===stats.total});
   grouped.set(x.season_id,arr);
  }
  return comps.rows.map(comp=>({...comp,seasons:seasonRows.filter(x=>x.competition_id===comp.id).map(season=>({...season,clubs:grouped.get(season.id)||[]}))}));
 }
 return [{id:'ligue-1',name:'Ligue 1',tag:'L1',country:'France',status:'available',seasons:[{id:'ligue-1-2026',competition_id:'ligue-1',season:'2026',label:'Saison 2026',status:'available',clubs:ALBUM_CLUBS.map(club=>{const cards=CARD_CATALOG.filter(c=>c.club===club.name&&String(c.season)==='2026');const own=cards.filter(c=>owned.has(c.id)).length;return{...club,cards,owned:own,total:cards.length,complete:cards.length>0&&own===cards.length};})}]}];
}
async function albumData(userId,selectedSeasonId=null){
 const cards=await getUserCards(userId),owned=new Set(cards.map(c=>c.cardId));
 const competitions=await albumViews(owned,selectedSeasonId,userId);
 const allClubs=competitions.flatMap(c=>c.seasons.flatMap(season=>season.clubs.map(v=>({...v,seasonId:season.id,season:season.season,competitionId:c.id}))));
 let claimedIds=new Set();
 if(pool){
  const claims=(await pool.query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'album:%'",[userId])).rows;
  claimedIds=new Set(claims.map(x=>x.claim_id));
 }else{
  for(const v of allClubs){const id='album:'+v.seasonId+':'+v.id;if(await claimExists(userId,id))claimedIds.add(id);}
 }
 return{universe:'FOOTVAULT',season:'2026',album:{competitions,overallOwned:allClubs.reduce((s,c)=>s+c.owned,0),overallTotal:allClubs.reduce((s,c)=>s+c.total,0)},rewards:{clubs:allClubs.map(v=>({seasonId:v.seasonId,clubId:v.id,club:v.name,claimed:claimedIds.has('album:'+v.seasonId+':'+v.id)}))}};
}

function auctionPublic(row){return{id:row.id,cardInstanceId:row.card_instance_id,sellerId:row.seller_id,startingBid:Number(row.starting_bid),currentBid:Number(row.current_bid),currentBidderId:row.current_bidder_id||null,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,createdAt:row.created_at,completedAt:row.completed_at||null};}
async function settleExpiredAuctions(){
 if(!pool)return;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const auctions=(await client.query("SELECT * FROM auctions WHERE status='active' AND ends_at<=now() ORDER BY ends_at FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
  for(const a of auctions){
   if(a.current_bidder_id){
    await client.query('UPDATE users SET coins=coins-$1,reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[Number(a.current_bid),a.current_bidder_id]);
    await client.query('UPDATE users SET coins=coins+$1 WHERE id=$2',[Number(a.current_bid),a.seller_id]);
    await client.query("UPDATE card_instances SET owner_id=$1,status='owned',tradeable=true WHERE instance_id=$2",[a.current_bidder_id,a.card_instance_id]);
   }else{
    await client.query("UPDATE card_instances SET status='owned' WHERE instance_id=$1",[a.card_instance_id]);
   }
   await client.query("UPDATE auctions SET status='completed',completed_at=now() WHERE id=$1",[a.id]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Auction settlement error:',e.message)}finally{client.release();}
}
async function auctionData(viewerId=null){
 await settleExpiredAuctions();
 const r=await pool.query(`SELECT a.*,c.card_id,c.name,c.position,c.club,c.nation,c.rarity,c.season,c.is_limited,c.serial,c.max_supply,c.source,
   u.name AS seller_name,ub.name AS bidder_name,
   (SELECT count(*) FROM auction_bids ab WHERE ab.auction_id=a.id) AS bid_count,
   (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY aa.current_bid) FROM auctions aa JOIN card_instances cc ON cc.instance_id=aa.card_instance_id WHERE aa.status='completed' AND cc.card_id=c.card_id) AS reference_median,
   (SELECT count(*) FROM auction_bids bx WHERE bx.auction_id=a.id AND bx.bidder_id=$1) > 0 AS user_participates,
   (SELECT count(*) FROM auction_withdrawals wx WHERE wx.auction_id=a.id AND wx.bidder_id=$1) > 0 AS user_withdrawn
   FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
   JOIN users u ON u.id=a.seller_id
   LEFT JOIN users ub ON ub.id=a.current_bidder_id
   WHERE a.status='active' AND a.ends_at>now() ORDER BY a.ends_at ASC`,[viewerId]);
 return r.rows.map(x=>({...auctionPublic(x),sellerName:x.seller_name,currentBidderName:x.bidder_name||null,bidCount:Number(x.bid_count||0),referencePrice:x.reference_median===null?null:Math.round(Number(x.reference_median)),isCurrentUserBidder:!!viewerId&&x.current_bidder_id===viewerId,isCurrentUserParticipant:!!viewerId&&!!x.user_participates,isCurrentUserWithdrawn:!!viewerId&&!!x.user_withdrawn,card:publicCard(x)}));
}
async function withdrawAuctionParticipation(userId,auctionId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const a=(await client.query('SELECT * FROM auctions WHERE id=$1 FOR UPDATE',[auctionId])).rows[0];
  if(!a){await client.query('ROLLBACK');return{error:'Enchère introuvable.',status:404};}
  if(a.status!=='active'||new Date(a.ends_at)<=new Date()){await client.query('ROLLBACK');return{error:'Cette enchère est terminée.',status:400};}
  if(a.seller_id===userId){await client.query('ROLLBACK');return{error:'Le vendeur ne peut pas se retirer de sa propre enchère.',status:400};}
  const participated=(await client.query('SELECT 1 FROM auction_bids WHERE auction_id=$1 AND bidder_id=$2 LIMIT 1',[auctionId,userId])).rowCount>0;
  if(!participated){await client.query('ROLLBACK');return{error:'Tu ne participes pas à cette enchère.',status:400};}
  const already=(await client.query('SELECT 1 FROM auction_withdrawals WHERE auction_id=$1 AND bidder_id=$2',[auctionId,userId])).rowCount>0;
  if(already){await client.query('ROLLBACK');return{error:'Tu as déjà quitté cette enchère.',status:400};}
  await client.query('INSERT INTO auction_withdrawals(auction_id,bidder_id) VALUES($1,$2)',[auctionId,userId]);
  let restoredBid=null;
  if(a.current_bidder_id===userId){
    const currentAmount=Number(a.current_bid);
    await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[currentAmount,userId]);
    const candidates=(await client.query(`SELECT b.bidder_id, MAX(b.amount) FILTER (WHERE b.created_at = latest.latest_at) AS amount
      FROM auction_bids b
      JOIN (SELECT bidder_id,MAX(created_at) AS latest_at FROM auction_bids WHERE auction_id=$1 GROUP BY bidder_id) latest
        ON latest.bidder_id=b.bidder_id AND latest.latest_at=b.created_at
      WHERE b.auction_id=$1 AND b.bidder_id<>$2
        AND NOT EXISTS (SELECT 1 FROM auction_withdrawals w WHERE w.auction_id=b.auction_id AND w.bidder_id=b.bidder_id)
      GROUP BY b.bidder_id,latest.latest_at
      ORDER BY latest.latest_at DESC`,[auctionId,userId])).rows;
    for(const candidate of candidates){
      const bidder=(await client.query('SELECT id,coins,reserved_coins FROM users WHERE id=$1 FOR UPDATE',[candidate.bidder_id])).rows[0];
      const amount=Number(candidate.amount||0);
      if(bidder&&Number(bidder.coins)-Number(bidder.reserved_coins)>=amount&&amount>=Number(a.starting_bid)){restoredBid={bidderId:bidder.id,amount};break;}
    }
    if(restoredBid){
      await client.query('UPDATE users SET reserved_coins=reserved_coins+$1 WHERE id=$2',[restoredBid.amount,restoredBid.bidderId]);
      await client.query('UPDATE auctions SET current_bid=$1,current_bidder_id=$2 WHERE id=$3',[restoredBid.amount,restoredBid.bidderId,auctionId]);
    }else{
      await client.query('UPDATE auctions SET current_bid=starting_bid,current_bidder_id=NULL WHERE id=$1',[auctionId]);
    }
  }
  await securityEvent(userId,null,'auction_withdraw',{auctionId,currentBidderChanged: a.current_bidder_id===userId,restoredBid:restoredBid?.amount||null},client);
  await client.query('COMMIT');
  const after=(await pool.query('SELECT current_bid,current_bidder_id FROM auctions WHERE id=$1',[auctionId])).rows[0];
  return{ok:true,auction:{id:auctionId,currentBid:Number(after.current_bid),currentBidderId:after.current_bidder_id||null}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function auctionHistory(userId){
 await settleExpiredAuctions();
 const r=await pool.query(`SELECT a.*,c.card_id,c.name,c.position,c.club,c.nation,c.rarity,c.season,c.serial,c.max_supply,c.source,
   u.name AS seller_name,ub.name AS bidder_name
   FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
   JOIN users u ON u.id=a.seller_id
   LEFT JOIN users ub ON ub.id=a.current_bidder_id
   WHERE a.status='completed' AND (a.seller_id=$1 OR a.current_bidder_id=$1 OR EXISTS(SELECT 1 FROM auction_bids b WHERE b.auction_id=a.id AND b.bidder_id=$1))
   ORDER BY COALESCE(a.completed_at,a.ends_at) DESC LIMIT 100`,[userId]);
 return r.rows.map(x=>({...auctionPublic(x),sellerName:x.seller_name,currentBidderName:x.bidder_name||null,card:publicCard(x)}));
}
async function auctionReference(cardId){
 const r=await pool.query("SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY current_bid) AS median,count(*) AS count FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.status='completed' AND c.card_id=$1",[cardId]);
 return {median:r.rows[0].median===null?null:Math.round(Number(r.rows[0].median)),count:Number(r.rows[0].count)};
}
async function createAuction(userId,cardInstanceId,startingBid,duration){
 const minutesMap={10:10,30:30,60:60,180:180,360:360,720:720,1440:1440};
 const mins=minutesMap[Number(duration)];
 if(!mins)return{error:'Durée d’enchère invalide.',status:400};
 const bid=Math.floor(Number(startingBid));
 if(!Number.isSafeInteger(bid)||bid<1)return{error:'La mise de départ doit être un nombre entier positif.',status:400};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const card=(await client.query("SELECT * FROM card_instances WHERE instance_id=$1 FOR UPDATE",[cardInstanceId])).rows[0];
  if(!card){await client.query('ROLLBACK');return{error:'Carte introuvable.',status:404};}
  if(card.owner_id!==userId||card.status!=='owned'){await client.query('ROLLBACK');return{error:'Cette carte n’est pas disponible.',status:400};}
  if(card.tradeable===false||card.source==='welcome'){await client.query('ROLLBACK');return{error:'Cette carte ne peut pas être mise aux enchères.',status:400};}
  const existing=(await client.query("SELECT 1 FROM auctions WHERE card_instance_id=$1 AND status='active'",[cardInstanceId])).rowCount;
  if(existing){await client.query('ROLLBACK');return{error:'Cette carte est déjà aux enchères.',status:400};}
  const activeCount=Number((await client.query("SELECT count(DISTINCT b.auction_id) AS n FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.bidder_id=$1 AND a.status='active' AND a.ends_at>now() AND NOT EXISTS (SELECT 1 FROM auction_withdrawals w WHERE w.auction_id=a.id AND w.bidder_id=$1)",[userId])).rows[0].n);
  if(activeCount>=10){await client.query('ROLLBACK');return{error:'Limite atteinte : 10 enchères actives maximum.',status:400};}
  const id=crypto.randomUUID(),ends=new Date(Date.now()+auctionDurationMs(mins));
  await client.query("UPDATE card_instances SET status='auction' WHERE instance_id=$1",[cardInstanceId]);
  await client.query("INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,starts_at,ends_at) VALUES($1,$2,$3,$4,$4,now(),$5)",[id,cardInstanceId,userId,bid,ends]);
  await securityEvent(userId,null,'auction_create',{auctionId:id,cardInstanceId,startingBid:bid,durationMinutes:mins},client);await client.query('COMMIT');
  return{auction:{id,cardInstanceId,startingBid:bid,currentBid:bid,endsAt:ends.toISOString(),status:'active'}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function placeAuctionBid(userId,auctionId,amount){
 await settleExpiredAuctions();
 const bid=Math.floor(Number(amount));
 if(!Number.isSafeInteger(bid)||bid<1)return{error:'Enchère invalide.',status:400};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const a=(await client.query("SELECT * FROM auctions WHERE id=$1 FOR UPDATE",[auctionId])).rows[0];
  if(!a){await client.query('ROLLBACK');return{error:'Enchère introuvable.',status:404};}
  if(a.status!=='active'||new Date(a.ends_at)<=new Date()){await client.query('ROLLBACK');return{error:'Cette enchère est terminée.',status:400};}
  if(a.seller_id===userId){await client.query('ROLLBACK');return{error:'Tu ne peux pas enchérir sur ta propre carte.',status:400};}
  const withdrawn=(await client.query('SELECT 1 FROM auction_withdrawals WHERE auction_id=$1 AND bidder_id=$2',[auctionId,userId])).rowCount>0;
  if(withdrawn){await client.query('ROLLBACK');return{error:'Tu as quitté cette enchère et ne peux plus y participer.',status:400};}
  const min=a.current_bidder_id?auctionMinBid(a.current_bid):Number(a.starting_bid);
  if(bid<min){await client.query('ROLLBACK');return{error:'Mise minimum : '+min+' FC.',status:400};}
  const now=Date.now(),end=new Date(a.ends_at).getTime();
  if(a.current_bidder_id===userId){
    const extra=bid-Number(a.current_bid);
    const u=(await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[userId])).rows[0];
    if(Number(u.coins)-Number(u.reserved_coins)<extra){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants.',status:400};}
    await client.query('UPDATE users SET reserved_coins=reserved_coins+$1 WHERE id=$2',[extra,userId]);
  }else{
    const u=(await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[userId])).rows[0];
    if(!u){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}
    if(Number(u.coins)-Number(u.reserved_coins)<bid){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants.',status:400};}
    if(a.current_bidder_id)await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[Number(a.current_bid),a.current_bidder_id]);
    await client.query('UPDATE users SET reserved_coins=reserved_coins+$1 WHERE id=$2',[bid,userId]);
  }
  await client.query('INSERT INTO auction_bids(auction_id,bidder_id,amount) VALUES($1,$2,$3)',[auctionId,userId,bid]);
  let ends=new Date(a.ends_at);
  if(end-now<=30_000)ends=new Date(end+60_000);
  await client.query('UPDATE auctions SET current_bid=$1,current_bidder_id=$2,ends_at=$3 WHERE id=$4',[bid,userId,ends,auctionId]);
  await securityEvent(userId,null,'auction_bid',{auctionId:a.id,amount:bid},client);await client.query('COMMIT');
  return{ok:true,auction:{id:a.id,currentBid:bid,currentBidderId:userId,endsAt:ends.toISOString(),bidCount:Number((await pool.query('SELECT count(*) AS n FROM auction_bids WHERE auction_id=$1',[a.id])).rows[0].n)}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function cancelAuction(userId,auctionId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const a=(await client.query("SELECT * FROM auctions WHERE id=$1 FOR UPDATE",[auctionId])).rows[0];
  if(!a){await client.query('ROLLBACK');return{error:'Enchère introuvable.',status:404};}
  if(a.seller_id!==userId){await client.query('ROLLBACK');return{error:'Cette enchère ne t’appartient pas.',status:403};}
  if(a.status!=='active'){await client.query('ROLLBACK');return{error:'Cette enchère n’est plus active.',status:400};}
  if(a.current_bidder_id){await client.query('ROLLBACK');return{error:'Impossible d’annuler après la première enchère.',status:400};}
  await client.query("UPDATE auctions SET status='cancelled',cancelled_at=now() WHERE id=$1",[auctionId]);
  await client.query("UPDATE card_instances SET status='owned' WHERE instance_id=$1",[a.card_instance_id]);
  await securityEvent(userId,null,'auction_cancel',{auctionId},client);await client.query('COMMIT');
  return{ok:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function auctionBidHistory(auctionId){
 const r=await pool.query("SELECT b.amount,b.created_at,u.name AS bidder_name FROM auction_bids b JOIN users u ON u.id=b.bidder_id WHERE b.auction_id=$1 ORDER BY b.created_at DESC LIMIT 100",[auctionId]);
 return r.rows.map(x=>({amount:Number(x.amount),createdAt:x.created_at,bidderName:x.bidder_name}));
}

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
