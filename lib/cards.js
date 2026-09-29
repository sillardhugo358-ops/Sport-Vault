'use strict';

// Cartes et packs : instances de cartes, tirages (packs de secours, packs
// configurés, pools), ouverture, cartes de bienvenue. getPool() renvoie le pool
// PostgreSQL courant ; catalog() le catalogue actif (remplacé au démarrage).

const crypto = require('node:crypto');
const { RARITIES, PACKS, PACK_WEIGHTS } = require('./game-config');

function createCards({ getPool, memory, catalog, getUserById, safeUser, securityEvent }) {
function publicCard(card){const limited=Boolean(card.is_limited??card.isLimited);return{instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jersey_number==null?(card.jerseyNumber==null?null:Number(card.jerseyNumber)):Number(card.jersey_number),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),rarityLabel:RARITIES[card.rarity]?.label||card.rarity,distributionType:limited?'LIMITED':'STANDARD',isLimited:limited,serial:limited&&card.serial!=null?Number(card.serial):null,maxSupply:limited&&card.max_supply!=null?Number(card.max_supply):null,serialLabel:limited&&card.serial!=null&&card.max_supply!=null?String(Number(card.serial))+'/'+String(Number(card.max_supply)):null,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}
async function buildInstance(card,ownerId,source='welcome',client=null){const limited=Boolean(card.isLimited);if(limited&&(!Number.isInteger(card.maxSupply)||card.maxSupply<1))throw new Error('Carte LIMITED invalide : quantité maximale requise.');let serial=null;if(limited&&client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`limited-card:${card.id}`]);const next=Number((await client.query('SELECT COALESCE(MAX(serial),0)+1 AS n FROM card_instances WHERE card_id=$1 AND is_limited=true',[card.id])).rows[0].n);if(next>card.maxSupply)throw new Error('Cette carte LIMITED a atteint sa quantité maximale.');serial=next;}return{instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jerseyNumber==null?null:Number(card.jerseyNumber),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),isLimited:limited,serial,maxSupply:limited?card.maxSupply:null,acquiredAt:new Date().toISOString(),source,status:'owned'};}
function weightedRarity(){const total=PACK_WEIGHTS.reduce((s,[,w])=>s+w,0);let roll=Math.random()*total;for(const[rarity,w]of PACK_WEIGHTS){roll-=w;if(roll<=0)return rarity;}return'common';}
function rarityAtLeast(a,b){return RARITIES[a].order>=RARITIES[b].order;}
function drawPack(packId){const pack=PACKS[packId];if(!pack)throw new Error('Pack introuvable');const drawn=[],used=new Set();const guaranteedIndex=Math.floor(Math.random()*pack.cards);for(let i=0;i<pack.cards;i++){const available=catalog().filter(c=>!used.has(c.id));let candidates=i===guaranteedIndex?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;if(!candidates.length)candidates=available;const target=i===guaranteedIndex?pack.guarantee:weightedRarity();let same=candidates.filter(c=>c.rarity===target);if(!same.length)same=candidates;const card=same[Math.floor(Math.random()*same.length)];used.add(card.id);drawn.push(card);}return drawn;}
async function listPacks(){ if(getPool()){const r=await getPool().query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active FROM pack_definitions WHERE active=true ORDER BY sort_order,id');const pr=await getPool().query("SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE active=true AND id<>'pool-standard' ORDER BY name,id");return{packs:r.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)})),pools:pr.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)}))};}return{packs:Object.values(PACKS),pools:[]}; }
async function getPackDefinition(packId){if(getPool()){const r=await getPool().query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active FROM pack_definitions WHERE id=$1 AND active=true',[packId]);return r.rows[0]||null;}return PACKS[packId]||null;}
function catalogCardsForPackConditions(cards,conditions={}){
 let out=cards.slice();
 const values=(v)=>Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean):[];
 const rarities=values(conditions.rarities).map(x=>x.toLowerCase()),clubs=values(conditions.clubs),seasons=values(conditions.seasons),nations=values(conditions.nations),positions=values(conditions.positions);
 if(rarities.length)out=out.filter(c=>rarities.includes(String(c.rarity||'').trim().toLowerCase()));
 if(clubs.length)out=out.filter(c=>clubs.includes(String(c.club||'').trim()));
 if(seasons.length)out=out.filter(c=>{const season=String(c.season||'').trim();return seasons.includes(season)||(season==='2026-2027'&&seasons.includes('2026'))||(season==='2026'&&seasons.includes('2026-2027'));});
 if(nations.length)out=out.filter(c=>nations.includes(String(c.nation||'').trim()));
 if(positions.length)out=out.filter(c=>positions.includes(String(c.position||'').trim()));
 if(conditions.limitedOnly===true)out=out.filter(c=>c.isLimited===true||String(c.distributionType||'').toUpperCase()==='LIMITED');
 if(conditions.standardOnly===true)out=out.filter(c=>c.isLimited!==true&&String(c.distributionType||'STANDARD').toUpperCase()!=='LIMITED');
 const minOvr=conditions.minOvr==null||conditions.minOvr===''?NaN:Number(conditions.minOvr);if(Number.isFinite(minOvr))out=out.filter(c=>Number(c.ovr||0)>=minOvr);
 const maxOvr=conditions.maxOvr==null||conditions.maxOvr===''?NaN:Number(conditions.maxOvr);if(Number.isFinite(maxOvr))out=out.filter(c=>Number(c.ovr||0)<=maxOvr);
 return out;
}
async function configuredPackCards(pack,client=null){
 const db=client||getPool();
 let cards=catalog();
 if(getPool()){
  const rows=(await db.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true')).rows;
  cards=rows.map(r=>({id:r.id,season:r.season,name:r.name,position:r.position,jerseyNumber:r.jersey_number==null?null:Number(r.jersey_number),club:r.club,nation:r.nation,rarity:r.rarity,ovr:Number(r.ovr||72),pace:Number(r.pace||72),shooting:Number(r.shooting||72),passing:Number(r.passing||72),dribbling:Number(r.dribbling||72),defending:Number(r.defending||72),physical:Number(r.physical||72),distributionType:String(r.distribution_type||'STANDARD').toUpperCase(),isLimited:Boolean(r.is_limited),maxSupply:r.max_supply==null?null:Number(r.max_supply),order:Number(r.card_order||0),rarityLabel:RARITIES[r.rarity]?.label||r.rarity}));
  if(pack.pool_id){
   const pr=(await db.query('SELECT type,config FROM pack_pools WHERE id=$1',[pack.pool_id])).rows[0];
   if(pr){
    const cfg=pr.config&&typeof pr.config==='object'?pr.config:{};
    if(pr.type==='manual'){const ids=Array.isArray(cfg.cardIds)?new Set(cfg.cardIds.map(String)):new Set();cards=cards.filter(c=>ids.has(String(c.id)));}
    else if(pr.type==='rarity'){const rs=Array.isArray(cfg.rarities)?cfg.rarities.map(String):[];cards=rs.length?cards.filter(c=>rs.includes(String(c.rarity))):[];}
    else if(pr.type==='club'&&cfg.club)cards=cards.filter(c=>String(c.club)===String(cfg.club));
    else if(pr.type==='season'&&cfg.season)cards=cards.filter(c=>String(c.season)===String(cfg.season));
    else if(pr.type==='limited')cards=cards.filter(c=>c.isLimited===true);
    return catalogCardsForPackConditions(cards,pack.conditions||{});
   }
  }
 }
 return catalogCardsForPackConditions(cards,pack.conditions||{});
}
async function drawDynamicPack(pack,client=null){
 const source=await configuredPackCards(pack,client);
 if(!source.length){console.error(`[FOOTVAULT] Pack ${pack.id}: aucune carte après application des conditions`,JSON.stringify(pack.conditions||{}));throw new Error('Aucune carte ne correspond aux conditions de ce pack.');}
 const used=new Set(),drawn=[],guaranteed=Math.min(Number(pack.guarantee_count||0),Number(pack.cards||0));
 for(let i=0;i<Number(pack.cards||0);i++){
  let available=source.filter(c=>!used.has(c.id));
  if(!available.length){used.clear();available=source.slice();}
  let candidates=i<guaranteed?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;
  if(!candidates.length)candidates=available;
  let chosen;
  if(i<guaranteed)chosen=candidates[Math.floor(Math.random()*candidates.length)];
  else{
   let roll=Math.random()*PACK_WEIGHTS.reduce((sum,x)=>sum+Number(x[1]||0),0),target='common';
   for(const x of PACK_WEIGHTS){roll-=Number(x[1]||0);if(roll<=0){target=x[0];break;}}
   const same=candidates.filter(c=>c.rarity===target);
   chosen=(same.length?same:candidates)[Math.floor(Math.random()*(same.length?same.length:candidates.length))];
  }
  used.add(chosen.id);drawn.push(chosen);
 }
 return drawn;
}
async function createCardInstance(instance,client=null){const db=client||getPool();if(db){await db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,acquired_at,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,[instance.instanceId,instance.cardId,instance.ownerId,instance.season,instance.name,instance.position,instance.club,instance.nation,instance.rarity,Number(instance.ovr||72),Number(instance.pace||72),Number(instance.shooting||72),Number(instance.passing||72),Number(instance.dribbling||72),Number(instance.defending||72),Number(instance.physical||72),Boolean(instance.isLimited),instance.serial,instance.maxSupply,instance.acquiredAt,instance.source,instance.status]);}else memory.cards.set(instance.instanceId,instance);}
async function getUserCards(ownerId,client=null){if(getPool()){const r=await (client||getPool()).query("SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' ORDER BY acquired_at DESC",[ownerId]);return r.rows.map(publicCard);}return[...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard);}
function welcomeRarity(){const roll=Math.random()*100;return roll<5?'epic':roll<25?'rare':'common'}
async function grantWelcomeCards(userId,client=null){
 const existing=await getUserCards(userId,client);if(existing.length>=3)return existing;
 let source=catalog();
 if(getPool()){
  const rows=(await (client||getPool()).query("SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true ORDER BY card_order,id")).rows;
  source=rows.map(r=>({id:r.id,season:r.season,name:r.name,position:r.position,jerseyNumber:r.jersey_number==null?null:Number(r.jersey_number),club:r.club,nation:r.nation,rarity:r.rarity,ovr:Number(r.ovr||72),pace:Number(r.pace||72),shooting:Number(r.shooting||72),passing:Number(r.passing||72),dribbling:Number(r.dribbling||72),defending:Number(r.defending||72),physical:Number(r.physical||72),isLimited:Boolean(r.is_limited),maxSupply:r.max_supply==null?null:Number(r.max_supply),order:Number(r.card_order||0),rarityLabel:RARITIES[r.rarity]?.label||r.rarity}));
 }
 const created=[],used=new Set();
 for(let i=0;i<3;i++){
  let rarity=welcomeRarity(),poolCards=source.filter(c=>c.rarity===rarity&&!used.has(c.id));
  if(!poolCards.length){rarity='common';poolCards=source.filter(c=>c.rarity==='common'&&!used.has(c.id));}
  if(!poolCards.length)break;
  const card=poolCards[Math.floor(Math.random()*poolCards.length)];used.add(card.id);
  const instance=await buildInstance(card,userId,'welcome',client);await createCardInstance(instance,client);created.push(publicCard(instance));
 }
 return created;
}
async function openPackForUser(userId,packId){const pack=await getPackDefinition(packId);if(!pack)return{error:'Pack introuvable.',status:404};if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};}const drawn=await drawDynamicPack(pack,client);await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*2,userId]);const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,`pack:${pack.id}`,client);await createCardInstance(instance,client);cards.push(publicCard(instance));}await securityEvent(userId,null,'pack_open',{packId:pack.id,price:pack.price,cards:cards.length},client);const updatedUser=(await client.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];await client.query('COMMIT');return{user:safeUser(updatedUser),cards,pack};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=await getUserById(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price)return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};const drawn=drawPack(packId);user.coins-=pack.price;user.xp+=pack.cards*2;const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,`pack:${pack.id}`,null);await createCardInstance(instance);cards.push(publicCard(instance));}memory.activity.push({userId,event:'pack_open',at:new Date().toISOString()});return{user:safeUser(user),cards,pack};}
async function openPoolForUser(userId,poolId){
 const pr=await getPool().query('SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE id=$1 AND active=true',[poolId]);const poolDef=pr.rows[0];if(!poolDef)return{error:'Tirage introuvable.',status:404};
 const pack={id:'pool:'+poolDef.id,name:poolDef.name,price:Number(poolDef.price),cards:Number(poolDef.cards),guarantee:'common',guarantee_count:0,pool_id:poolDef.id,conditions:{}};
 if(pack.price<0||pack.cards<1)return{error:'Configuration du tirage invalide.',status:400};
 const client=await getPool().connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};}const drawn=await drawDynamicPack(pack,client);const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,pack.id,client);await createCardInstance(instance,client);cards.push(publicCard(instance));}await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*2,userId]);await securityEvent(userId,null,'pool_draw',{poolId:poolDef.id,price:pack.price,cards:cards.length},client);const updatedUser=(await client.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];await client.query('COMMIT');return{user:safeUser(updatedUser),cards,pack:{...pack,poolId:poolDef.id,pool:true}};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}

return { publicCard, buildInstance, weightedRarity, rarityAtLeast, drawPack, listPacks, getPackDefinition, catalogCardsForPackConditions, configuredPackCards, drawDynamicPack, createCardInstance, getUserCards, welcomeRarity, grantWelcomeCards, openPackForUser, openPoolForUser };
}

module.exports = { createCards };
