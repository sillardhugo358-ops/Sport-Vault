'use strict';

// Console d'administration : comptes (statut, rôle, ressources), cartes des joueurs,
// catalogue, compétitions et clubs, collections, packs, journaux, vue d'ensemble, enchères.
// getPool() renvoie le pool PostgreSQL courant ; catalog() le catalogue actif en mémoire.

const crypto = require('node:crypto');
const { RARITIES, ALBUM_CLUBS } = require('./game-config');
const { rarityFromOvr } = require('./rarity');
const { frenchNation } = require('./nations');
const { recordCoins } = require('./ledger');

function createAdmin({ getPool, catalog, getUserById, canManage, safeUser, securityEvent, buildInstance, createCardInstance, publicCard, configuredPackCards }) {
// Rareté selon le barème, sauf carte spéciale explicitement verrouillée.
function cardRarity(body,lockedDefault=false){const locked=body.rarityLocked===undefined?lockedDefault:body.rarityLocked===true;const ovr=Number(body.ovr);return{locked,rarity:locked?String(body.rarity||'').trim().toLowerCase():(Number.isInteger(ovr)?rarityFromOvr(ovr):'common')};}
async function adminLog(adminId,targetUserId,action,details={},client=null){await (client||getPool()).query('INSERT INTO admin_logs(admin_id,target_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[adminId,targetUserId,action,JSON.stringify(details)]);}
async function adminSetAccountStatus(adminId,userId,action){
 const admin=await getUserById(adminId),u=(await getPool().query('SELECT id,role,account_status,blocked_until FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};
 if(adminId===userId)return{error:'Tu ne peux pas modifier ton propre compte.',status:400};
 if(!canManage(admin,u))return{error:'Tu ne peux pas modifier un compte de niveau égal ou supérieur.',status:403};
 if(action==='ban'){await getPool().query("UPDATE users SET account_status='banned',blocked_until=NULL WHERE id=$1",[userId]);await getPool().query('DELETE FROM sessions WHERE user_id=$1',[userId]);await adminLog(adminId,userId,'ban');return{ok:true,accountStatus:'banned'};}
 if(action==='block'){await getPool().query("UPDATE users SET account_status='blocked',blocked_until=now()+interval '24 hours' WHERE id=$1",[userId]);await getPool().query('DELETE FROM sessions WHERE user_id=$1',[userId]);await adminLog(adminId,userId,'block',{durationHours:24});return{ok:true,accountStatus:'blocked',blockedUntil:new Date(Date.now()+24*3600_000).toISOString()};}
 if(action==='unblock'){await getPool().query("UPDATE users SET account_status='active',blocked_until=NULL WHERE id=$1",[userId]);await adminLog(adminId,userId,'unblock');return{ok:true,accountStatus:'active'};}
 return{error:'Action administrateur inconnue.',status:400};
}
async function adminSetRole(adminId,userId,role){
 const admin=await getUserById(adminId),u=(await getPool().query('SELECT id,role FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};if(adminId===userId)return{error:'Tu ne peux pas modifier ton propre rôle.',status:400};
 if(admin.role!=='creator'||u.role==='creator')return{error:'Seul le Créateur peut gérer les rôles, et le Créateur est protégé.',status:403};
 if(!['user','admin'].includes(role))return{error:'Rôle invalide.',status:400};
 await getPool().query('UPDATE users SET role=$1 WHERE id=$2',[role,userId]);await adminLog(adminId,userId,'role_change',{role});return{ok:true,role};
}
async function adminAdjustResources(adminId,userId,kind,amount,reason){
 const client=await getPool().connect();
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
 if(kind==='coins')await recordCoins(client,userId,n,'admin','admin:'+adminId);
 await securityEvent(userId,null,'admin_resource_adjust',{adminId,resource:kind,amount:n},client);
 await adminLog(adminId,userId,'resource_adjust',{resource:kind,amount:n,reason:String(reason||'').slice(0,200)},client);
 return{ok:true,user:safeUser(updated)};
}
async function adminTransferCard(adminId,instanceId,toUserId){
 const admin=await getUserById(adminId),client=await getPool().connect();try{await client.query('BEGIN');const c=(await client.query('SELECT * FROM card_instances WHERE instance_id=$1 FOR UPDATE',[instanceId])).rows[0];const to=(await client.query('SELECT id,role FROM users WHERE id=$1',[toUserId])).rows[0];if(!c||!to){await client.query('ROLLBACK');return{error:'Carte ou utilisateur introuvable.',status:404}};const owner=(await client.query('SELECT id,role FROM users WHERE id=$1',[c.owner_id])).rows[0];if(!((admin.role==='creator'&&adminId===owner.id)||canManage(admin,owner))||!canManage(admin,to)){await client.query('ROLLBACK');return{error:'Action non autorisée sur ce compte.',status:403}};if(c.status!=='owned'){await client.query('ROLLBACK');return{error:'Cette carte n’est pas disponible pour un transfert.',status:400}};await client.query('UPDATE card_instances SET owner_id=$1,source=$2 WHERE instance_id=$3',[toUserId,'admin_transfer',instanceId]);await client.query('COMMIT');await adminLog(adminId,toUserId,'card_transfer',{instanceId,fromUserId:c.owner_id});return{ok:true};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}
async function adminRemoveCard(adminId,instanceId){
 const admin=await getUserById(adminId),c=(await getPool().query('SELECT * FROM card_instances WHERE instance_id=$1',[instanceId])).rows[0];if(!c)return{error:'Carte introuvable.',status:404};const owner=await getUserById(c.owner_id);if(!(admin.role==='creator'&&adminId===c.owner_id)&&!canManage(admin,owner))return{error:'Action non autorisée.',status:403};if(c.status!=='owned')return{error:'Cette carte ne peut pas être retirée actuellement.',status:400};await getPool().query('DELETE FROM card_instances WHERE instance_id=$1',[instanceId]);await adminLog(adminId,c.owner_id,'card_remove',{instanceId,cardId:c.card_id,name:c.name});return{ok:true};}
async function adminGrantCard(adminId,userId,cardId){
 const admin=await getUserById(adminId),u=await getUserById(userId);if(!u)return{error:'Utilisateur introuvable.',status:404};if(!(admin.role==='creator'&&adminId===userId)&&!canManage(admin,u))return{error:'Action non autorisée.',status:403};const row=(await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,max_supply FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0];if(!row)return{error:'Carte introuvable dans le catalogue.',status:404};const card={id:row.id,season:row.season,name:row.name,position:row.position,jerseyNumber:row.jersey_number==null?null:Number(row.jersey_number),club:row.club,nation:row.nation,rarity:row.rarity,ovr:Number(row.ovr),pace:Number(row.pace),shooting:Number(row.shooting),passing:Number(row.passing),dribbling:Number(row.dribbling),defending:Number(row.defending),physical:Number(row.physical),isLimited:Boolean(row.is_limited),maxSupply:row.max_supply==null?null:Number(row.max_supply)};const client=await getPool().connect();try{await client.query('BEGIN');const instance=await buildInstance(card,userId,'admin_grant',client);await createCardInstance(instance,client);await client.query('COMMIT');await adminLog(adminId,userId,'card_grant',{instanceId:instance.instanceId,cardId,name:card.name});return{ok:true,card:publicCard(instance)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}}
async function adminLogs(){const r=await getPool().query(`SELECT l.id,l.action,l.details,l.created_at,a.name AS admin_name,t.name AS target_name FROM admin_logs l JOIN users a ON a.id=l.admin_id LEFT JOIN users t ON t.id=l.target_user_id ORDER BY l.created_at DESC LIMIT 100`);return r.rows;}
async function adminOverview(){
 const [u,c,a,completed,packs,coins,gems]=await Promise.all([
  getPool().query("SELECT count(*)::int AS n FROM users"),
  getPool().query("SELECT count(*)::int AS n FROM card_instances"),
  getPool().query("SELECT count(*)::int AS n FROM auctions WHERE status='active' AND ends_at>now()"),
  getPool().query("SELECT count(*)::int AS n FROM auctions WHERE status='completed'"),
  getPool().query("SELECT COALESCE(sum(packs_opened),0)::int AS n FROM users"),
  getPool().query("SELECT COALESCE(sum(coins),0)::bigint AS n,COALESCE(sum(reserved_coins),0)::bigint AS reserved FROM users"),
  getPool().query("SELECT COALESCE(sum(gems),0)::bigint AS n FROM users")
 ]);
 const rarity=await getPool().query("SELECT rarity,count(*)::int AS n FROM card_instances GROUP BY rarity ORDER BY n DESC");
 const recent=await getPool().query("SELECT id,name,email,role,coins,reserved_coins,gems,xp,created_at FROM users ORDER BY created_at DESC LIMIT 10");
 return {stats:{users:u.rows[0].n,cards:c.rows[0].n,activeAuctions:a.rows[0].n,completedAuctions:completed.rows[0].n,packsOpened:packs.rows[0].n,totalCoins:Number(coins.rows[0].n),reservedCoins:Number(coins.rows[0].reserved),totalGems:Number(gems.rows[0].n)},rarity:rarity.rows,recentUsers:recent.rows.map(safeUser)};
}
async function getCollections(){if(!getPool())return ALBUM_CLUBS.map(c=>({...c,cards:catalog().filter(x=>x.club===c.name).sort((a,b)=>a.order-b.order)}));const cols=(await getPool().query('SELECT id,name,tag,description,sort_order,created_at,updated_at FROM card_collections ORDER BY sort_order,id')).rows;const links=(await getPool().query('SELECT collection_id,card_id,position FROM card_collection_cards ORDER BY collection_id,position')).rows;const by=new Map();for(const x of links){const arr=by.get(x.collection_id)||[];const card=catalog().find(c=>c.id===x.card_id);if(card)arr.push({...card,collectionPosition:Number(x.position)});by.set(x.collection_id,arr);}return cols.map(c=>({...c,cards:(by.get(c.id)||[]).sort((a,b)=>a.collectionPosition-b.collectionPosition)}));}
async function adminCollections(){const collections=await getCollections();return collections.map(c=>({...c,cardCount:c.cards.length,cardIds:c.cards.map(x=>x.id)}));}
async function adminSetCollection(adminId,action,body){const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut modifier les collections.',status:403};const id=String(body.id||'').trim(),name=String(body.name||'').trim(),tag=String(body.tag||'').trim().toUpperCase(),description=String(body.description||'').trim().slice(0,500);if(action==='create'){if(!/^[a-z0-9-]{2,50}$/.test(id)||name.length<2||name.length>80||tag.length<1||tag.length>12)return{error:'ID, nom et tag invalides.',status:400};const exists=await getPool().query('SELECT 1 FROM card_collections WHERE id=$1',[id]);if(exists.rowCount)return{error:'Cet ID de collection existe déjà.',status:409};const maxOrder=(await getPool().query('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM card_collections')).rows[0].n;await getPool().query('INSERT INTO card_collections(id,name,tag,description,sort_order) VALUES($1,$2,$3,$4,$5)',[id,name,tag,description,Number(maxOrder)]);await adminLog(adminId,null,'collection_create',{id,name,tag});return{ok:true};}if(action==='update'){if(!id||name.length<2||name.length>80||tag.length<1||tag.length>12)return{error:'ID, nom et tag invalides.',status:400};const r=await getPool().query('UPDATE card_collections SET name=$1,tag=$2,description=$3,updated_at=now() WHERE id=$4 RETURNING id',[name,tag,description,id]);if(!r.rowCount)return{error:'Collection introuvable.',status:404};await adminLog(adminId,null,'collection_update',{id,name,tag});return{ok:true};}if(action==='delete'){if(!id)return{error:'Collection introuvable.',status:400};const r=await getPool().query('DELETE FROM card_collections WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Collection introuvable.',status:404};await adminLog(adminId,null,'collection_delete',{id});return{ok:true};}if(action==='set_card_collections'){if(!id)return{error:'Carte introuvable.',status:400};const validCard=catalog().some(c=>c.id===id);if(!validCard)return{error:'Carte introuvable.',status:404};const collectionIds=Array.isArray(body.collectionIds)?[...new Set(body.collectionIds.map(String))]:[];const invalid=(await getPool().query('SELECT id FROM card_collections WHERE id=ANY($1::varchar[])',[collectionIds])).rows.map(x=>x.id);if(invalid.length!==collectionIds.length)return{error:'Une ou plusieurs collections sont invalides.',status:400};const client=await getPool().connect();try{await client.query('BEGIN');await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[id]);for(const collectionId of collectionIds){const pos=(await client.query('SELECT COALESCE(MAX(position),-1)+1 AS n FROM card_collection_cards WHERE collection_id=$1',[collectionId])).rows[0].n;await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3)',[collectionId,id,Number(pos)]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}await adminLog(adminId,null,'card_collections_update',{cardId:id,collectionIds});return{ok:true};}if(action==='set_cards'){if(!id)return{error:'Collection introuvable.',status:400};const exists=await getPool().query('SELECT 1 FROM card_collections WHERE id=$1',[id]);if(!exists.rowCount)return{error:'Collection introuvable.',status:404};const ids=Array.isArray(body.cardIds)?[...new Set(body.cardIds.map(String))]:[];const invalid=ids.filter(cardId=>!catalog().some(c=>c.id===cardId));if(invalid.length)return{error:'Une ou plusieurs cartes sont invalides.',status:400};const client=await getPool().connect();try{await client.query('BEGIN');await client.query('DELETE FROM card_collection_cards WHERE collection_id=$1',[id]);for(let i=0;i<ids.length;i++)await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3)',[id,ids[i],i]);await client.query('UPDATE card_collections SET updated_at=now() WHERE id=$1',[id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}await adminLog(adminId,null,'collection_cards_update',{id,cardCount:ids.length});return{ok:true};}return{error:'Action collection inconnue.',status:400};}
async function adminPacks(){const packs=(await getPool().query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,conditions,pool_id,active,sort_order FROM pack_definitions ORDER BY sort_order,id')).rows;const pools=(await getPool().query('SELECT * FROM pack_pools ORDER BY name')).rows;return{packs:packs.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)})),pools:pools.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)}))};}
async function adminSetPack(adminId,action,body){const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut gérer les packs.',status:403};
 if(action==='pool_create'||action==='pool_update'){const id=String(body.id||'').trim(),name=String(body.name||'').trim(),type=String(body.type||'all'),config=body.config&&typeof body.config==='object'?body.config:{},price=Number(body.price??config.price??0),cards=Number(body.cards??config.cards??1),badge=String(body.badge??config.badge??'').trim(),description=String(body.description??config.description??'').trim().slice(0,300),active=body.active!==false&&config.active!==false;if((action==='pool_update'&&!id)||name.length<2||!['all','rarity','club','season','limited','manual'].includes(type)||!Number.isInteger(price)||price<0||!Number.isInteger(cards)||cards<1||cards>20)return{error:'Informations de pool invalides.',status:400};if(type==='manual'){const ids=Array.isArray(config.cardIds)?[...new Set(config.cardIds.map(String))]:[];const parts=['specialCount','rareCount','commonCount'];if(parts.some(k=>config[k]!=null)){const total=parts.reduce((n,k)=>n+(Number(config[k])||0),0);if(total!==ids.length)return{error:'La composition du pool ('+total+' cartes) doit correspondre au nombre de cartes sélectionnées ('+ids.length+').',status:400};}if(active){const n=Number((await getPool().query('SELECT count(*)::int AS n FROM catalog_cards WHERE is_active AND id=ANY($1::varchar[])',[ids])).rows[0].n);if(!n)return{error:'Aucune carte active dans ce pool : il ne pourrait pas être tiré.',status:400};}}const finalId=id||'pool-'+crypto.randomUUID().replace(/-/g,'').slice(0,10);if(action==='pool_create')await getPool().query('INSERT INTO pack_pools(id,name,type,config,price,cards,badge,description,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[finalId,name,type,JSON.stringify({...config,price,cards,badge,description,active}),price,cards,badge,description,active]);else{const r=await getPool().query('UPDATE pack_pools SET name=$1,type=$2,config=$3,price=$4,cards=$5,badge=$6,description=$7,active=$8,updated_at=now() WHERE id=$9',[name,type,JSON.stringify({...config,price,cards,badge,description,active}),price,cards,badge,description,active,finalId]);if(!r.rowCount)return{error:'Pool introuvable.',status:404};}await adminLog(adminId,null,'pack_pool_'+action,{id:finalId,name,type,price,cards});return{ok:true,id:finalId};}
 if(action==='pool_delete'){const id=String(body.id||'');const r=await getPool().query('DELETE FROM pack_pools WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Pool introuvable.',status:404};return{ok:true};}
 if(action==='pack_create'||action==='pack_update'){const id=String(body.id||'').trim(),name=String(body.name||'').trim(),price=Number(body.price),cards=Number(body.cards),badge=String(body.badge||'').trim(),description=String(body.description||'').trim(),guarantee=String(body.guarantee||'common'),guaranteeCount=Number(body.guaranteeCount||0),poolId=String(body.poolId||'').trim()||null,conditions=body.conditions&&typeof body.conditions==='object'?body.conditions:{},active=body.active!==false;if((action==='pack_update'&&!id)||name.length<2||!Number.isInteger(price)||price<0||!Number.isInteger(cards)||cards<1||cards>20||!['common','rare','epic','legendary','icon'].includes(guarantee)||!Number.isInteger(guaranteeCount)||guaranteeCount<0||guaranteeCount>cards)return{error:'Informations de pack invalides.',status:400};if(poolId&&!(await getPool().query('SELECT 1 FROM pack_pools WHERE id=$1',[poolId])).rowCount)return{error:'Pool introuvable.',status:404};if(active&&!(await configuredPackCards({pool_id:poolId,conditions})).length)return{error:'Aucune carte active ne correspond à ces conditions : ce pack ne pourrait pas être ouvert. Élargis les conditions ou désactive le pack.',status:400};const finalId=id||'pack-'+crypto.randomUUID().replace(/-/g,'').slice(0,10);if(action==='pack_create'){const max=(await getPool().query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM pack_definitions')).rows[0].n;await getPool().query("INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order) VALUES($1,$2,$3,'coins',$4,$5,$6,$7,$8,$9,$10,$11,$12)",[finalId,name,price,cards,badge,description,guarantee,guaranteeCount,poolId,JSON.stringify(conditions),active,Number(max)]);}else{const r=await getPool().query('UPDATE pack_definitions SET name=$1,price=$2,cards=$3,badge=$4,description=$5,guarantee=$6,guarantee_count=$7,pool_id=$8,conditions=$9,active=$10,updated_at=now() WHERE id=$11',[name,price,cards,badge,description,guarantee,guaranteeCount,poolId,JSON.stringify(conditions),active,finalId]);if(!r.rowCount)return{error:'Pack introuvable.',status:404};}await adminLog(adminId,null,'pack_'+action,{id:finalId,name,poolId,conditions});return{ok:true,id:finalId};}
 if(action==='pack_delete'){const id=String(body.id||'');const r=await getPool().query('DELETE FROM pack_definitions WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)return{error:'Pack introuvable.',status:404};return{ok:true};}return{error:'Action pack inconnue.',status:400};
}
async function adminCompetitions(){
 const comps=(await getPool().query('SELECT id,name,tag,country,description,status,sort_order,logo_url FROM competitions ORDER BY sort_order,id')).rows;
 const seasons=(await getPool().query(`SELECT cs.id,cs.competition_id,cs.season,cs.label,cs.status,cs.description,cs.sort_order FROM competition_seasons cs ORDER BY cs.competition_id,cs.sort_order,cs.season DESC`)).rows;
 const clubs=(await getPool().query('SELECT id,name,tag,country,logo_url,sort_order FROM clubs ORDER BY sort_order,name')).rows;
 const seasonLinks=(await getPool().query('SELECT season_id,club_id,position FROM season_clubs ORDER BY season_id,position')).rows;
 const clubCompetitionLinks=(await getPool().query('SELECT cc.club_id,cc.competition_id,c.name AS competition_name FROM competition_clubs cc JOIN competitions c ON c.id=cc.competition_id ORDER BY c.sort_order,c.name')).rows;
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
  if(action==='create'){const exists=await getPool().query('SELECT 1 FROM competitions WHERE id=$1',[id]);if(exists.rowCount)return{error:'Cette compétition existe déjà.',status:409};const max=(await getPool().query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM competitions')).rows[0].n;await getPool().query('INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,name,tag,country,description,status,Number(max)]);}
  else{const rr=await getPool().query('UPDATE competitions SET name=$1,tag=$2,country=$3,description=$4,status=$5,updated_at=now() WHERE id=$6 RETURNING id',[name,tag,country,description,status,id]);if(!rr.rowCount)return{error:'Compétition introuvable.',status:404};}
  await adminLog(adminId,null,'competition_'+action,{id,name,status});return{ok:true};
 }
 if(action==='delete'){const rr=await getPool().query('DELETE FROM competitions WHERE id=$1 RETURNING id',[id]);if(!rr.rowCount)return{error:'Compétition introuvable.',status:404};await adminLog(adminId,null,'competition_delete',{id});return{ok:true};}
 if(action==='season_create'||action==='season_update'){
  const seasonId=String(body.seasonId||id||'').trim(),competitionId=String(body.competitionId||'').trim(),season=String(body.season||'').trim(),label=season,seasonStatus=String(body.seasonStatus||'upcoming').trim(),seasonDescription=String(body.seasonDescription||'').trim().slice(0,500);
  if((action==='season_update'&&!seasonId)||!competitionId||!/^[0-9]{4}(?:-[0-9]{4})?$/.test(season)||!['available','upcoming'].includes(seasonStatus))return{error:'Informations de saison invalides.',status:400};
  if(!(await getPool().query('SELECT 1 FROM competitions WHERE id=$1',[competitionId])).rowCount)return{error:'Compétition introuvable.',status:404};
  let finalSeasonId=seasonId;
  if(action==='season_create'){
   const base=competitionId+'-'+season.toLowerCase().replace(/[^0-9]+/g,'-').replace(/^-+|-+$/g,'');
   finalSeasonId=base||('season-'+crypto.randomUUID().replace(/-/g,'').slice(0,12));
   let n=1,candidate=finalSeasonId;while((await getPool().query('SELECT 1 FROM competition_seasons WHERE id=$1 OR (competition_id=$2 AND season=$3)',[candidate,competitionId,season])).rowCount){candidate=finalSeasonId+'-'+n++;}finalSeasonId=candidate;
   const max=(await getPool().query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM competition_seasons WHERE competition_id=$1',[competitionId])).rows[0].n;
   await getPool().query('INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)',[finalSeasonId,competitionId,season,label,seasonStatus,seasonDescription,Number(max)]);
  }else{
   const previous=(await getPool().query('SELECT season FROM competition_seasons WHERE id=$1 AND competition_id=$2',[seasonId,competitionId])).rows[0];if(!previous)return{error:'Saison introuvable.',status:404};
   if((await getPool().query('SELECT 1 FROM competition_seasons WHERE competition_id=$1 AND season=$2 AND id<>$3',[competitionId,season,seasonId])).rowCount)return{error:'Cette saison existe déjà dans la compétition.',status:409};
   const clubIds=(await getPool().query('SELECT club_id FROM season_clubs WHERE season_id=$1',[seasonId])).rows.map(x=>x.club_id);const client=await getPool().connect();
   try{await client.query('BEGIN');await client.query('UPDATE competition_seasons SET season=$1,label=$1,status=$2,description=$3,updated_at=now() WHERE id=$4',[season,seasonStatus,seasonDescription,seasonId]);if(previous.season!==season&&clubIds.length){await client.query('UPDATE catalog_cards SET season=$1,updated_at=now() WHERE season=$2 AND club IN (SELECT name FROM clubs WHERE id=ANY($3::varchar[]))',[season,previous.season,clubIds]);await client.query('UPDATE card_instances SET season=$1 WHERE season=$2 AND club IN (SELECT name FROM clubs WHERE id=ANY($3::varchar[]))',[season,previous.season,clubIds]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  }
  await adminLog(adminId,null,'competition_season_'+(action==='season_create'?'create':'update'),{seasonId:finalSeasonId,competitionId,season});return{ok:true,seasonId:finalSeasonId};
 }
 if(action==='season_delete'){
  const rr=await getPool().query('DELETE FROM competition_seasons WHERE id=$1 RETURNING id',[String(body.seasonId||id||'')]);if(!rr.rowCount)return{error:'Saison introuvable.',status:404};await adminLog(adminId,null,'competition_season_delete',{seasonId:String(body.seasonId||id||'')});return{ok:true};
 }
 if(action==='season_set_clubs'){
  const seasonId=String(body.seasonId||'').trim(),ids=Array.isArray(body.clubIds)?[...new Set(body.clubIds.map(String))]:[];
  if(!(await getPool().query('SELECT 1 FROM competition_seasons WHERE id=$1',[seasonId])).rowCount)return{error:'Saison introuvable.',status:404};
  const valid=(await getPool().query('SELECT id FROM clubs WHERE id=ANY($1::varchar[])',[ids])).rows.map(x=>x.id);if(valid.length!==ids.length)return{error:'Un ou plusieurs clubs sont invalides.',status:400};
  const client=await getPool().connect();try{await client.query('BEGIN');await client.query('DELETE FROM season_clubs WHERE season_id=$1',[seasonId]);for(let i=0;i<ids.length;i++)await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3)',[seasonId,ids[i],i]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'competition_season_clubs_update',{seasonId,clubIds:ids});return{ok:true};
 }
 if(action==='club_create'){
  const cn=String(body.clubName||body.name||'').trim(),logoUrl=String(body.logoUrl||'').trim().slice(0,2048),competitionIds=Array.isArray(body.competitionIds)?[...new Set(body.competitionIds.map(String))]:[];
  if(cn.length<2||cn.length>80||!competitionIds.length)return{error:'Nom du club et au moins une compétition obligatoires.',status:400};
  if(logoUrl&&!/^https?:\/\/\S+$/i.test(logoUrl))return{error:'Le logo doit être une URL d’image commençant par https:// ou http://.',status:400};
  const validComps=(await getPool().query('SELECT id,country FROM competitions WHERE id=ANY($1::varchar[]) AND status=\'available\'',[competitionIds])).rows;
  if(validComps.length!==competitionIds.length)return{error:'Une ou plusieurs compétitions sélectionnées sont indisponibles.',status:400};
  const exists=await getPool().query('SELECT 1 FROM clubs WHERE LOWER(name)=LOWER($1)',[cn]);if(exists.rowCount)return{error:'Ce club existe déjà.',status:409};
  const baseId=cn.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,36)||'club';
  const cid=baseId+'-'+crypto.randomUUID().replace(/-/g,'').slice(0,8),ct=cn.split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,6).toUpperCase()||'CLUB',cc=validComps[0]?.country||'';
  const max=(await getPool().query('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM clubs')).rows[0].n,client=await getPool().connect();
  try{await client.query('BEGIN');await client.query('INSERT INTO clubs(id,name,tag,country,logo_url,sort_order) VALUES($1,$2,$3,$4,$5,$6)',[cid,cn,ct,cc,logoUrl||null,Number(max)]);for(let i=0;i<competitionIds.length;i++)await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[competitionIds[i],cid,i]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'club_create',{id:cid,name:cn,competitionIds,hasLogo:!!logoUrl});return{ok:true};
 }
 if(action==='club_update'){
  const clubId=String(body.id||body.clubId||'').trim(),cn=String(body.clubName||body.name||'').trim(),logoUrl=String(body.logoUrl||'').trim().slice(0,2048),competitionIds=Array.isArray(body.competitionIds)?[...new Set(body.competitionIds.map(String))]:[];
  const previous=(await getPool().query('SELECT name,country FROM clubs WHERE id=$1',[clubId])).rows[0];if(!previous)return{error:'Club introuvable.',status:404};
  if(cn.length<2||cn.length>80||!competitionIds.length)return{error:'Nom du club et au moins une compétition obligatoires.',status:400};
  if(logoUrl&&!/^https?:\/\/\S+$/i.test(logoUrl))return{error:'Le logo doit être une URL d’image commençant par https:// ou http://.',status:400};
  const validComps=(await getPool().query('SELECT id,country FROM competitions WHERE id=ANY($1::varchar[]) AND status=\'available\'',[competitionIds])).rows;if(validComps.length!==competitionIds.length)return{error:'Une ou plusieurs compétitions sélectionnées sont indisponibles.',status:400};
  const cc=validComps[0]?.country||previous.country||'',client=await getPool().connect();
  try{await client.query('BEGIN');await client.query('UPDATE clubs SET name=$1,country=$2,logo_url=$3,updated_at=now() WHERE id=$4',[cn,cc,logoUrl||null,clubId]);await client.query('DELETE FROM competition_clubs WHERE club_id=$1',[clubId]);for(let i=0;i<competitionIds.length;i++)await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[competitionIds[i],clubId,i]);if(previous.name!==cn){await client.query('UPDATE catalog_cards SET club=$1,updated_at=now() WHERE club=$2',[cn,previous.name]);await client.query('UPDATE card_instances SET club=$1 WHERE club=$2',[cn,previous.name]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  await adminLog(adminId,null,'club_update',{id:clubId,name:cn,competitionIds,hasLogo:!!logoUrl});return{ok:true};
 }
 if(action==='club_delete'){const previous=(await getPool().query('SELECT id,name FROM clubs WHERE id=$1',[id])).rows[0];if(!previous)return{error:'Club introuvable.',status:404};const rr=await getPool().query('DELETE FROM clubs WHERE id=$1 RETURNING id',[id]);if(!rr.rowCount)return{error:'Club introuvable.',status:404};await adminLog(adminId,null,'club_delete',{id});return{ok:true};}
 return{error:'Action compétition inconnue.',status:400};
}
async function adminCards(){const r=await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,rarity_locked,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE is_active=true ORDER BY card_order,id');const statsRows=await getPool().query('SELECT card_id,count(*)::int AS total_instances,count(DISTINCT owner_id)::int AS owners FROM card_instances GROUP BY card_id');const stats=new Map(statsRows.rows.map(x=>[x.card_id,x]));return r.rows.map(c=>adminCardView(c,stats.get(c.id)));}
// Catalogue admin paginé côté serveur : filtres (recherche, rareté, poste, club, saison) et page de 50 cartes.
const ADMIN_PAGE_SIZE=50;
async function adminCardsPage(params={}){
 const where=['is_active=true'],values=[];
 const add=(sql,v)=>{values.push(v);where.push(sql.replace('?','$'+values.length));};
 // Recherche sans accents ni majuscules (« mbappe » trouve « Mbappé »).
 const q=String(params.q||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').slice(0,80);
 if(q)add("translate(lower(name||' '||club||' '||nation||' '||id||' '||position),'àâäáãåçéèêëíìîïñóòôöõøúùûüýÿšžćčđłńőűğış','aaaaaaceeeeiiiinoooooouuuuyyszccdlnougis') LIKE ?",'%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%');
 for(const k of ['rarity','position','club','season']){const v=String(params[k]||'').trim();if(v)add(k+'=?',v.slice(0,80));}
 const limit=Math.min(200,Math.max(1,Number.parseInt(params.limit,10)||ADMIN_PAGE_SIZE));
 const total=(await getPool().query(`SELECT count(*)::int AS n FROM catalog_cards WHERE ${where.join(' AND ')}`,values)).rows[0].n;
 const pages=Math.max(1,Math.ceil(total/limit)),page=Math.min(pages,Math.max(1,Number.parseInt(params.page,10)||1));
 const rows=(await getPool().query(`SELECT id,season,name,position,jersey_number,club,nation,rarity,rarity_locked,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE ${where.join(' AND ')} ORDER BY card_order,id LIMIT ${limit} OFFSET ${(page-1)*limit}`,values)).rows;
 const stats=new Map((await getPool().query('SELECT card_id,count(*)::int AS total_instances,count(DISTINCT owner_id)::int AS owners FROM card_instances WHERE card_id=ANY($1::varchar[]) GROUP BY card_id',[rows.map(c=>c.id)])).rows.map(x=>[x.card_id,x]));
 return {cards:rows.map(c=>adminCardView(c,stats.get(c.id))),total,page,pages,limit};
}
// Chiffres et listes de filtres du catalogue, sans charger les cartes.
async function adminCardsSummary(){
 const [kpi,circ,facets,clubs]=await Promise.all([
  getPool().query('SELECT count(*)::int AS cards,count(*) FILTER (WHERE is_limited)::int AS limited FROM catalog_cards WHERE is_active=true'),
  getPool().query('SELECT COALESCE(sum(owners),0)::int AS owners FROM (SELECT count(DISTINCT ci.owner_id) AS owners FROM card_instances ci JOIN catalog_cards cc ON cc.id=ci.card_id AND cc.is_active GROUP BY ci.card_id) s'),
  getPool().query("SELECT array_agg(DISTINCT rarity) AS rarities,array_agg(DISTINCT position) AS positions,array_agg(DISTINCT season) AS seasons,array_agg(DISTINCT nation) FILTER (WHERE nation<>'') AS nations FROM catalog_cards WHERE is_active=true"),
  getPool().query("SELECT club,count(*)::int AS n FROM catalog_cards WHERE is_active=true AND club<>'' GROUP BY club ORDER BY club")
 ]);
 const instances=(await getPool().query('SELECT count(*)::int AS n FROM card_instances ci JOIN catalog_cards cc ON cc.id=ci.card_id AND cc.is_active')).rows[0].n;
 const f=facets.rows[0]||{};
 return {cards:kpi.rows[0].cards,limited:kpi.rows[0].limited,instances,owners:circ.rows[0].owners,rarities:f.rarities||[],positions:f.positions||[],seasons:f.seasons||[],nations:f.nations||[],clubs:clubs.rows.map(r=>({name:r.club,cards:r.n}))};
}
function adminCardView(c,s){return ({id:c.id,season:c.season,name:c.name,position:c.position,club:c.club,nation:c.nation,rarity:c.rarity,rarityLocked:Boolean(c.rarity_locked),jerseyNumber:c.jersey_number==null?null:Number(c.jersey_number),ovr:Number(c.ovr),pace:Number(c.pace),shooting:Number(c.shooting),passing:Number(c.passing),dribbling:Number(c.dribbling),defending:Number(c.defending),physical:Number(c.physical),distributionType:c.distribution_type,isLimited:Boolean(c.is_limited),maxSupply:c.max_supply==null?null:Number(c.max_supply),order:Number(c.card_order),rarityLabel:RARITIES[c.rarity]?.label||c.rarity,totalInstances:Number(s?.total_instances||0),owners:Number(s?.owners||0)});}
async function adminCreateCatalogCard(adminId,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut ajouter une carte au catalogue.',status:403};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=frenchNation(body.nation),season=String(body.season||'').trim(),{rarity,locked:rarityLocked}=cardRarity(body),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
 const allowedPositions=['GK','RB','LB','CB','RWB','LWB','DM','CM','AM','RW','LW','ST'];
 if(!competitionId||!seasonId)return{error:'Compétition et saison obligatoires.',status:400};
 const context=(await getPool().query('SELECT cs.id,cs.competition_id,cs.season,c.id AS club_id,c.name AS club_name FROM competition_seasons cs JOIN competitions comp ON comp.id=cs.competition_id JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id WHERE cs.id=$1 AND cs.competition_id=$2 AND c.name=$3 AND cs.status=\'available\' AND comp.status=\'available\'',[seasonId,competitionId,club])).rows[0];
 const ovr=Number(body.ovr),stats={pace:Number(body.pace),shooting:Number(body.shooting),passing:Number(body.passing),dribbling:Number(body.dribbling),defending:Number(body.defending),physical:Number(body.physical)},isLimited=Boolean(body.isLimited),maxSupply=body.maxSupply===''||body.maxSupply==null?null:Number(body.maxSupply);
 if(!context||!name||name.length>80||!allowedPositions.includes(position)||(jerseyNumber!==null&&(!Number.isInteger(jerseyNumber)||jerseyNumber<1||jerseyNumber>99))||!nation||nation.length>80||!season||season.length>12||String(context.season)!==season)return{error:'Un ou plusieurs champs sont invalides.',status:400};
 if(!RARITIES[rarity])return{error:'Rareté invalide.',status:400};
 if(!Number.isInteger(ovr)||ovr<1||ovr>99)return{error:'OVR doit être un entier entre 1 et 99.',status:400};
 if(Object.values(stats).some(v=>!Number.isInteger(v)||v<1||v>99))return{error:'Chaque statistique doit être un entier entre 1 et 99.',status:400};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const baseId=String(body.id||'').trim().toLowerCase();
 const id=baseId||('fv-'+crypto.randomUUID().replace(/-/g,'').slice(0,20));
 if(!/^[a-z0-9-]{2,32}$/.test(id))return{error:'ID de carte invalide.',status:400};
 const existing=(await getPool().query('SELECT id,is_active FROM catalog_cards WHERE id=$1',[id])).rows[0];
 if(existing?.is_active)return{error:'Cet ID de carte existe déjà.',status:409};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const client=await getPool().connect();
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
 catalog().push(created);
 await adminLog(adminId,null,'catalog_card_create',{cardId:id,name,position,club,nation,rarity,ovr,competitionId,seasonId});
 return{ok:true,card:created};
}
async function adminDeleteCatalogCard(adminId,cardId,confirm=false){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut supprimer une carte du catalogue.',status:403};
 const card=catalog().find(x=>x.id===cardId);if(!card)return{error:'Carte introuvable.',status:404};
 const preview=(await getPool().query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status='owned')::int AS owned,count(*) FILTER (WHERE status='auction')::int AS auction FROM card_instances WHERE card_id=$1`,[cardId])).rows[0];
 const total=Number(preview.total||0),owned=Number(preview.owned||0),auction=Number(preview.auction||0);
 if(!confirm)return{preview:true,cardId,name:card.name,owned,total,auction};
 const client=await getPool().connect();let deletedAuctions=0;
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
  const pos=catalog().findIndex(x=>x.id===cardId);if(pos>=0)catalog().splice(pos,1);
  await adminLog(adminId,null,'catalog_card_delete',{cardId,name:card.name,club:card.club,deletedInstances:deleted,deletedAuctions});
  return{ok:true,deletedInstances:deleted,deletedAuctions};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function adminUpdateCatalogCard(adminId,cardId,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut modifier le catalogue.',status:403};
 const dbCard=(await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,rarity_locked,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0];if(!dbCard)return{error:'Carte introuvable.',status:404};const c={id:dbCard.id,season:dbCard.season,name:dbCard.name,position:dbCard.position,jerseyNumber:dbCard.jersey_number==null?null:Number(dbCard.jersey_number),club:dbCard.club,nation:dbCard.nation,rarity:dbCard.rarity,ovr:Number(dbCard.ovr),pace:Number(dbCard.pace),shooting:Number(dbCard.shooting),passing:Number(dbCard.passing),dribbling:Number(dbCard.dribbling),defending:Number(dbCard.defending),physical:Number(dbCard.physical),distributionType:dbCard.distribution_type,isLimited:Boolean(dbCard.is_limited),maxSupply:dbCard.max_supply==null?null:Number(dbCard.max_supply),order:Number(dbCard.card_order||0)};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=frenchNation(body.nation),season=String(body.season||'').trim(),{rarity,locked:rarityLocked}=cardRarity(body,Boolean(dbCard.rarity_locked)),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
 const allowedPositions=['GK','RB','LB','CB','RWB','LWB','DM','CM','AM','RW','LW','ST'],allowedClubs=getPool()?(await getPool().query('SELECT name FROM clubs')).rows.map(x=>x.name):[...new Set(catalog().map(x=>x.club).filter(Boolean))];
 if(!competitionId||!seasonId)return{error:'Compétition et saison obligatoires.',status:400};
 const context=(await getPool().query('SELECT cs.id,cs.competition_id,cs.season,c.id AS club_id,c.name AS club_name FROM competition_seasons cs JOIN competitions comp ON comp.id=cs.competition_id JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id WHERE cs.id=$1 AND cs.competition_id=$2 AND c.name=$3 AND cs.status=\'available\' AND comp.status=\'available\'',[seasonId,competitionId,club])).rows[0];const ovr=Number(body.ovr),stats={pace:Number(body.pace),shooting:Number(body.shooting),passing:Number(body.passing),dribbling:Number(body.dribbling),defending:Number(body.defending),physical:Number(body.physical)},isLimited=Boolean(body.isLimited),maxSupply=body.maxSupply===''||body.maxSupply==null?null:Number(body.maxSupply);
 if(!name||name.length>80||!allowedPositions.includes(position)||(jerseyNumber!==null&&(!Number.isInteger(jerseyNumber)||jerseyNumber<1||jerseyNumber>99))||!allowedClubs.includes(club)||!nation||nation.length>80||!season||season.length>12||String(context.season)!==season)return{error:'Un ou plusieurs champs sont invalides.',status:400};
 if(!RARITIES[rarity])return{error:'Rareté invalide.',status:400};
 if(!Number.isInteger(ovr)||ovr<1||ovr>99)return{error:'OVR doit être un entier entre 1 et 99.',status:400};if(Object.values(stats).some(v=>!Number.isInteger(v)||v<1||v>99))return{error:'Chaque statistique doit être un entier entre 1 et 99.',status:400};
 if(isLimited&&(!Number.isInteger(maxSupply)||maxSupply<1))return{error:'Une carte LIMITED doit avoir une quantité maximale.',status:400};
 const circulation=Number((await getPool().query('SELECT count(*)::int AS n FROM card_instances WHERE card_id=$1',[cardId])).rows[0].n);
 if(circulation>0&&Boolean(c.isLimited)!==isLimited)return{error:'Le type STANDARD/LIMITED ne peut plus être changé après la mise en circulation d’exemplaires.',status:409};
 if(isLimited&&circulation>Number(maxSupply))return{error:`La quantité maximale ne peut pas être inférieure aux ${circulation} exemplaire(s) déjà en circulation.`,status:409};
 const client=await getPool().connect();try{await client.query('BEGIN');await client.query('UPDATE catalog_cards SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,distribution_type=$16,is_limited=$17,max_supply=$18,rarity_locked=$19,updated_at=now() WHERE id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,rarityLocked]);await client.query('UPDATE card_instances SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,is_limited=$16,max_supply=$17 WHERE card_id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited,maxSupply]);await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[cardId]);await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) SELECT id,$1,COALESCE((SELECT MAX(position)+1 FROM card_collection_cards x WHERE x.collection_id=card_collections.id),0) FROM card_collections WHERE LOWER(name)=LOWER($2) ON CONFLICT DO NOTHING',[cardId,club]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
 Object.assign(c,{season,name,position,jerseyNumber,club,nation,rarity,rarityLocked,rarityLabel:RARITIES[rarity].label,distributionType:isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,ovr,...stats});
 await adminLog(adminId,null,'catalog_card_update',{cardId,name,position,jerseyNumber,club,nation,rarity,rarityLocked,ovr,competitionId,seasonId,distributionType:isLimited?'LIMITED':'STANDARD',maxSupply,...stats});
 return{ok:true,card:c};
}
async function adminUsers(search=''){
 const q=String(search||'').trim().toLowerCase();
 const r=await getPool().query(`SELECT u.id,u.name,u.email,u.role,u.coins,u.reserved_coins,u.gems,u.xp,u.created_at,
 (SELECT count(*) FROM card_instances c WHERE c.owner_id=u.id)::int AS card_count,
 (SELECT count(*) FROM auctions a WHERE a.seller_id=u.id AND a.status='active' AND a.ends_at>now())::int AS active_sales,
 (SELECT count(DISTINCT b.auction_id) FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.bidder_id=u.id AND a.status='active' AND a.ends_at>now())::int AS active_bids
 FROM users u WHERE ($1='' OR lower(u.name) LIKE '%'||$1||'%' OR lower(u.email) LIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 100`,[q]);
 return r.rows.map(x=>({...safeUser(x),cardCount:x.card_count,activeSales:x.active_sales,activeBids:x.active_bids}));
}
async function adminUserDetail(userId){
 const u=(await getPool().query('SELECT id,name,email,role,account_status,blocked_until,coins,reserved_coins,gems,xp,packs_opened,created_at FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};
 const cards=(await getPool().query("SELECT instance_id,card_id,name,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,source,status,acquired_at FROM card_instances WHERE owner_id=$1 ORDER BY acquired_at DESC",[userId])).rows;
 const sales=(await getPool().query("SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.completed_at,c.name AS card_name,c.rarity,c.is_limited,c.serial,c.max_supply FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.seller_id=$1 ORDER BY a.created_at DESC LIMIT 30",[userId])).rows;
 const bids=(await getPool().query("SELECT b.auction_id,b.amount,b.created_at,c.name AS card_name,a.status FROM auction_bids b JOIN auctions a ON a.id=b.auction_id JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE b.bidder_id=$1 ORDER BY b.created_at DESC LIMIT 30",[userId])).rows;
 return {...safeUser(u),packsOpened:Number(u.packs_opened||0),createdAt:u.created_at,cards,sales,bids};
}
async function adminAuctions(){
 const r=await getPool().query(`SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.created_at,a.completed_at,
 c.name AS card_name,c.rarity,c.is_limited,c.serial,c.max_supply,u.name AS seller_name,ub.name AS bidder_name,
 (SELECT count(*) FROM auction_bids b WHERE b.auction_id=a.id)::int AS bid_count
 FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id JOIN users u ON u.id=a.seller_id LEFT JOIN users ub ON ub.id=a.current_bidder_id
 ORDER BY COALESCE(a.completed_at,a.ends_at) DESC LIMIT 100`);
 return r.rows;
}

return { cardRarity, adminLog, adminSetAccountStatus, adminSetRole, adminAdjustResources, adjustResourcesLocked, adminTransferCard, adminRemoveCard, adminGrantCard, adminLogs, adminOverview, getCollections, adminCollections, adminSetCollection, adminPacks, adminSetPack, adminCompetitions, adminSetCompetition, adminCards, adminCardsPage, adminCardsSummary, adminCreateCatalogCard, adminDeleteCatalogCard, adminUpdateCatalogCard, adminUsers, adminUserDetail, adminAuctions };
}

module.exports = { createAdmin };
