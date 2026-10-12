'use strict';

// Cartes et packs : instances de cartes, tirages (packs de secours, packs
// configurés, pools), ouverture, cartes de bienvenue. getPool() renvoie le pool
// PostgreSQL courant ; catalog() le catalogue actif (remplacé au démarrage).

const crypto = require('node:crypto');
const { RARITIES, PACKS, PACK_WEIGHTS, WHEEL, CUSTOM_PACK } = require('./game-config');
const { normalize: normalizeCustomPack, price: customPackPrice, POSITIONS } = require('./custom-pack');
const { recordCoins } = require('./ledger');
const { clubKey } = require('./club-key');

function createCards({ getPool, memory, catalog, setCatalog, getUserById, safeUser, securityEvent }) {
function publicCard(card){const limited=Boolean(card.is_limited??card.isLimited);return{instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jersey_number==null?(card.jerseyNumber==null?null:Number(card.jerseyNumber)):Number(card.jersey_number),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),rarityLabel:RARITIES[card.rarity]?.label||card.rarity,distributionType:limited?'LIMITED':'STANDARD',isLimited:limited,serial:limited&&card.serial!=null?Number(card.serial):null,maxSupply:limited&&(card.max_supply??card.maxSupply)!=null?Number(card.max_supply??card.maxSupply):null,serialLabel:limited&&card.serial!=null&&(card.max_supply??card.maxSupply)!=null?String(Number(card.serial))+'/'+String(Number(card.max_supply??card.maxSupply)):null,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}
async function buildInstance(card,ownerId,source='welcome',client=null){const limited=Boolean(card.isLimited);if(limited&&(!Number.isInteger(card.maxSupply)||card.maxSupply<1))throw new Error('Carte LIMITED invalide : quantité maximale requise.');let serial=null;if(limited&&client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`limited-card:${card.id}`]);const next=Number((await client.query('SELECT COALESCE(MAX(serial),0)+1 AS n FROM card_instances WHERE card_id=$1 AND is_limited=true',[card.id])).rows[0].n);if(next>card.maxSupply)throw drawError('Cette carte LIMITED a atteint sa quantité maximale.');serial=next;}return{instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jerseyNumber==null?null:Number(card.jerseyNumber),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),isLimited:limited,serial,maxSupply:limited?card.maxSupply:null,acquiredAt:new Date().toISOString(),source,status:'owned'};}
// Message d'achat refusé faute de FC : n'évoque une enchère que si des FC sont réellement réservés par une enchère.
function coinsShort(user,price){const reserved=Number(user.reserved_coins||0),free=Number(user.coins)-reserved;return reserved>0?'FOOTCOINS disponibles insuffisants : '+reserved+' FC sont réservés par une enchère (disponible : '+free+' FC, il en faut '+price+').':'FOOTCOINS insuffisants : il te faut '+price+' FC, tu en as '+free+'.';}
function weightedRarity(){const total=PACK_WEIGHTS.reduce((s,[,w])=>s+w,0);let roll=Math.random()*total;for(const[rarity,w]of PACK_WEIGHTS){roll-=w;if(roll<=0)return rarity;}return'common';}
function rarityAtLeast(a,b){return RARITIES[a].order>=RARITIES[b].order;}
function drawPack(packId){const pack=PACKS[packId];if(!pack)throw new Error('Pack introuvable');const drawn=[],used=new Set();const guaranteedIndex=Math.floor(Math.random()*pack.cards);for(let i=0;i<pack.cards;i++){const available=catalog().filter(c=>!used.has(c.id));let candidates=i===guaranteedIndex?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;if(!candidates.length)candidates=available;const target=i===guaranteedIndex?pack.guarantee:weightedRarity();let same=candidates.filter(c=>c.rarity===target);if(!same.length)same=candidates;const card=same[Math.floor(Math.random()*same.length)];used.add(card.id);drawn.push(card);}return drawn;}
async function listPacks(){ if(getPool()){const r=await getPool().query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,available_until FROM pack_definitions WHERE active=true AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now()) ORDER BY sort_order,id');const pr=await getPool().query("SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE active=true AND id<>'pool-standard' ORDER BY name,id");return{packs:r.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active),availableUntil:x.available_until||null})),pools:pr.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)}))};}return{packs:Object.values(PACKS),pools:[]}; }
async function getPackDefinition(packId){if(getPool()){const r=await getPool().query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,((available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())) AS in_window FROM pack_definitions WHERE id=$1 AND active=true',[packId]);return r.rows[0]||null;}return PACKS[packId]||null;}
function catalogCardsForPackConditions(cards,conditions={}){
 let out=cards.slice();
 const values=(v)=>Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean):[];
 const decades=values(conditions.decades);
 if(decades.length)out=out.filter(c=>{const y=Number(String(c.season||'').slice(0,4));return Number.isFinite(y)&&decades.includes(String(y-y%10));});
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
// Catalogue actif en mémoire (plus de 50 000 cartes) : relu depuis la base seulement
// quand il a changé (nombre de cartes actives ou dernière modification).
// Empreinte revérifiée au plus toutes les CATALOG_CACHE_MS (5 s ; 0 dans les tests) : en production la base est
// distante (~90 ms par requête) et chaque ouverture de pack refaisait cette requête.
const CATALOG_CACHE_MS=Number(process.env.CATALOG_CACHE_MS??(process.env.NODE_ENV==='test'?0:5000))||0;
let activeCatalog={key:null,cards:[],generic:[],checkedAt:0};
async function activeCatalogCards(db){
 if(CATALOG_CACHE_MS&&activeCatalog.key&&Date.now()-activeCatalog.checkedAt<CATALOG_CACHE_MS)return activeCatalog.cards;
 const f=(await db.query('SELECT count(*)::int AS n,max(updated_at) AS m FROM catalog_cards WHERE is_active=true')).rows[0];
 const key=f.n+'|'+(f.m?new Date(f.m).toISOString():'');
 if(activeCatalog.key!==key){
  const rows=(await db.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,rarity_locked,card_order FROM catalog_cards WHERE is_active=true ORDER BY card_order,id')).rows;
  const mapped=rows.map(r=>({id:r.id,ckey:r.season+'|'+clubKey(r.club),season:r.season,name:r.name,position:r.position,jerseyNumber:r.jersey_number==null?null:Number(r.jersey_number),club:r.club,nation:r.nation,rarity:r.rarity,ovr:Number(r.ovr||72),pace:Number(r.pace||72),shooting:Number(r.shooting||72),passing:Number(r.passing||72),dribbling:Number(r.dribbling||72),defending:Number(r.defending||72),physical:Number(r.physical||72),distributionType:String(r.distribution_type||'STANDARD').toUpperCase(),rarityLocked:Boolean(r.rarity_locked),isLimited:Boolean(r.is_limited),maxSupply:r.max_supply==null?null:Number(r.max_supply),order:Number(r.card_order||0),rarityLabel:RARITIES[r.rarity]?.label||r.rarity}));
  activeCatalog={key,cards:mapped,generic:mapped.filter(c=>!isInternationalCard(c)),checkedAt:0};
  // Une seule copie des cartes en mémoire : catalog() (console admin, résumé du catalogue) partage ces objets.
  if(setCatalog)setCatalog(mapped);
 }
 activeCatalog.checkedAt=Date.now();
 return activeCatalog.cards;
}
// Préchauffage au démarrage : le premier tirage ne charge plus les cartes depuis la base distante.
async function warmCatalog(){if(getPool())await activeCatalogCards(getPool());}
// Erreur métier d'un tirage (aucune carte, carte LIMITED épuisée) : message clair au joueur,
// transaction annulée, rien n'est débité — jamais une « Erreur serveur ».
function drawError(message,status=409){return Object.assign(new Error(message),{status,expected:true});}
// Cartes de la Coupe du monde (fv-w-) et de la Ligue des Nations (fv-n-) : réservées à leurs packs dédiés
// (conditions.competitions) et aux pools manuels, pour ne pas diluer les packs génériques ni le cadeau de bienvenue.
const isInternationalCard=c=>/^fv-[wnc]-/.test(String(c.id));
const competitionKeysCache=new Map();
async function competitionKeys(db,competitions){
 const id=competitions.join(','),hit=competitionKeysCache.get(id);
 if(CATALOG_CACHE_MS&&hit&&Date.now()-hit.at<CATALOG_CACHE_MS)return hit.keys;
 const rows=(await db.query('SELECT cs.season,c.name AS club FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id=ANY($1::varchar[])',[competitions])).rows;
 const keys=new Set(rows.map(r=>r.season+'|'+clubKey(r.club)));
 competitionKeysCache.set(id,{keys,at:Date.now()});
 return keys;
}
async function configuredPackCards(pack,client=null){
 const db=client||getPool();
 let cards=catalog();
 if(getPool()){
  cards=await activeCatalogCards(db);
  // Compétitions : cartes dont le club figure dans une saison de la compétition (season_clubs).
  const competitions=Array.isArray(pack.conditions?.competitions)?pack.conditions.competitions.map(String).filter(Boolean):[];
  const poolRow=pack.pool_id?(await db.query('SELECT type,config FROM pack_pools WHERE id=$1',[pack.pool_id])).rows[0]:null;
  const manualPool=poolRow?.type==='manual';
  if(!competitions.length&&!manualPool)cards=activeCatalog.generic;
  if(competitions.length){
   // Noms rapprochés comme dans l'album (lib/club-key.js) : « Angers SCO » = « SCO Angers »…
   const keys=await competitionKeys(db,competitions);
   cards=cards.filter(c=>keys.has(c.ckey));
  }
  if(pack.pool_id){
   const pr=poolRow;
   if(pr){
    const cfg=pr.config&&typeof pr.config==='object'?pr.config:{};
    if(pr.type==='manual'){const ids=Array.isArray(cfg.cardIds)?new Set(cfg.cardIds.map(String)):new Set();cards=cards.filter(c=>ids.has(String(c.id)));}
    else if(pr.type==='rarity'){const rs=Array.isArray(cfg.rarities)?cfg.rarities.map(String):[];cards=rs.length?cards.filter(c=>rs.includes(String(c.rarity))):[];}
    // Pool « club » ou « saison » sans réglage : aucune carte (jamais tout le catalogue par défaut).
    else if(pr.type==='club')cards=cfg.club?cards.filter(c=>String(c.club)===String(cfg.club)):[];
    else if(pr.type==='season')cards=cfg.season?cards.filter(c=>String(c.season)===String(cfg.season)):[];
    else if(pr.type==='limited')cards=cards.filter(c=>c.isLimited===true);
    const out=catalogCardsForPackConditions(cards,pack.conditions||{});
    // Pool manuel : chaque carte sélectionnée a la même chance ; les proportions suivent donc
    // sa composition (ex. 3 spéciales, 10 rares, 237 communes) au lieu des probabilités globales.
    out.uniform=pr.type==='manual';
    return withoutSoldOut(db,out);
   }
   console.error(`[FOOTVAULT] Pack ${pack.id}: pool ${pack.pool_id} introuvable`);
   throw drawError('La réserve de cartes de ce pack est introuvable. Aucun FOOTCOIN n\'a été débité.');
  }
  return withoutSoldOut(db,catalogCardsForPackConditions(cards,pack.conditions||{}));
 }
 return catalogCardsForPackConditions(cards,pack.conditions||{});
}
// Cartes LIMITED dont toutes les unités sont déjà distribuées : retirées du tirage (sinon l'ouverture échouerait
// au hasard dès qu'une seule est tirée). La vérification faisant foi reste dans buildInstance (verrou par carte).
async function withoutSoldOut(db,cards){
 const limited=cards.filter(c=>c.isLimited===true);
 if(!limited.length)return cards;
 const issued=new Map((await db.query('SELECT card_id,COALESCE(MAX(serial),0)::int AS n FROM card_instances WHERE is_limited=true AND card_id=ANY($1::varchar[]) GROUP BY card_id',[limited.map(c=>String(c.id))])).rows.map(r=>[r.card_id,r.n]));
 const out=cards.filter(c=>c.isLimited!==true||(issued.get(String(c.id))||0)<Number(c.maxSupply));
 out.uniform=cards.uniform;
 return out;
}
async function drawDynamicPack(pack,client=null){
 const source=await configuredPackCards(pack,client);
 if(pack.custom)return drawCustomPack(pack,source);
 if(!source.length){console.error(`[FOOTVAULT] Pack ${pack.id}: aucune carte après application des conditions`,JSON.stringify(pack.conditions||{}));throw drawError('Aucune carte n\'est disponible pour ce tirage pour le moment. Aucun FOOTCOIN n\'a été débité.');}
 const used=new Set(),drawn=[],guaranteed=Math.min(Number(pack.guarantee_count||0),Number(pack.cards||0));
 // Garantie de rareté impossible à tenir (aucune carte assez rare disponible) : le tirage est refusé, rien n'est débité.
 if(guaranteed>0&&!source.some(c=>rarityAtLeast(c.rarity,pack.guarantee))){console.error(`[FOOTVAULT] Pack ${pack.id}: garantie ${pack.guarantee} impossible à tenir`);throw drawError('Ce pack ne peut pas tenir sa garantie de rareté pour le moment. Aucun FOOTCOIN n\'a été débité.');}
 for(let i=0;i<Number(pack.cards||0);i++){
  let available=source.filter(c=>!used.has(c.id));
  if(!available.length){used.clear();available=source.slice();}
  let candidates=i<guaranteed?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;
  if(!candidates.length)candidates=available;
  let chosen;
  if(i<guaranteed||source.uniform)chosen=candidates[Math.floor(Math.random()*candidates.length)];
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
// Pack sur mesure : chaque carte est tirée comme dans un pack normal (PACK_WEIGHTS), puis relevée à la rareté minimale choisie
// (le prix suit : Legendary et Icon s'achètent comme rareté minimale). Les cartes spéciales à rareté verrouillée (pools) n'y figurent jamais.
// Tout refus survient avant le débit : sélection trop étroite ou pas assez de cartes de la rareté demandée.
function drawCustomPack(pack,source){
 const pool=source.filter(c=>!c.rarityLocked&&!c.isLimited);
 const min=pack.custom.minRarity,n=Number(pack.cards);
 if(pool.length<CUSTOM_PACK.minPool)throw drawError('Sélection trop étroite : moins de '+CUSTOM_PACK.minPool+' cartes correspondent à ces filtres. Aucun FOOTCOIN n\'a été débité.');
 const eligible=pool.filter(c=>rarityAtLeast(c.rarity,min));
 if(eligible.length<n)throw drawError('Pas assez de cartes '+(RARITIES[min]?.label||min)+' ou mieux dans cette sélection. Aucun FOOTCOIN n\'a été débité.');
 const used=new Set(),drawn=[];
 for(let i=0;i<n;i++){
  let target=weightedRarity();if(!rarityAtLeast(target,min))target=min;
  let candidates=eligible.filter(c=>c.rarity===target&&!used.has(c.id));
  if(!candidates.length)candidates=eligible.filter(c=>!used.has(c.id));
  const card=candidates[crypto.randomInt(0,candidates.length)];
  used.add(card.id);drawn.push(card);
 }
 return drawn;
}
function customPackDefinition(spec){
 const f=spec.filters,conditions={standardOnly:true};
 for(const k of ['competitions','seasons','clubs','positions'])if(f[k].length)conditions[k]=f[k];
 return{id:'custom',name:'PACK SUR MESURE',price:customPackPrice(spec),cards:spec.cards,guarantee:spec.minRarity,guarantee_count:0,pool_id:null,custom:{minRarity:spec.minRarity},conditions};
}
// Aperçu : prix et nombre de cartes disponibles pour la sélection (même calcul que l'achat).
async function quoteCustomPack(body){
 const v=normalizeCustomPack(body);if(v.error)return v;
 if(!getPool())return{error:'Pack sur mesure indisponible sans base de données.',status:503};
 const pack=customPackDefinition(v.spec);
 const source=(await configuredPackCards(pack)).filter(c=>!c.rarityLocked&&!c.isLimited);
 const eligible=source.filter(c=>rarityAtLeast(c.rarity,v.spec.minRarity)).length;
 const ok=source.length>=CUSTOM_PACK.minPool&&eligible>=v.spec.cards;
 return{ok,price:pack.price,cards:pack.cards,minRarity:v.spec.minRarity,poolSize:source.length,eligible,minPool:CUSTOM_PACK.minPool};
}
// Choix proposés dans le formulaire : compétitions, saisons, clubs et postes de la réserve générique (hors cartes internationales).
async function customPackOptions(){
 const base={min:CUSTOM_PACK.minCards,max:CUSTOM_PACK.maxCards,perCard:CUSTOM_PACK.perCard,filterBonusPct:CUSTOM_PACK.filterBonusPct,minPool:CUSTOM_PACK.minPool,positions:POSITIONS};
 if(!getPool())return{...base,competitions:[],seasons:[],clubs:[]};
 await activeCatalogCards(getPool());
 const generic=activeCatalog.generic.filter(c=>!c.rarityLocked&&!c.isLimited);
 const seasons=[...new Set(generic.map(c=>c.season))].sort().reverse();
 const clubs=[...new Set(generic.map(c=>c.club))].sort((a,b)=>a.localeCompare(b,'fr'));
 const competitions=(await getPool().query("SELECT id,name FROM competitions ORDER BY sort_order,name")).rows;
 return{...base,competitions,seasons,clubs};
}
async function openCustomPack(userId,body){
 const v=normalizeCustomPack(body);if(v.error)return v;
 if(!getPool())return{error:'Pack sur mesure indisponible sans base de données.',status:503};
 const pack=customPackDefinition(v.spec);
 const client=await getPool().connect();
 try{
  await client.query('BEGIN');
  const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}
  if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:coinsShort(user,pack.price),status:400};}
  const drawn=await drawDynamicPack(pack,client);
  const updatedUser=await chargeUser(client,userId,pack.price,pack.cards*2,'pack','custom');
  const cards=await createDrawnInstances(drawn,userId,'pack:custom',client);
  await client.query('COMMIT');
  await auditAfterCommit(client,userId,'pack_open',{packId:'custom',price:pack.price,cards:cards.length,minRarity:v.spec.minRarity,filters:v.spec.filters});
  return{user:safeUser(updatedUser),cards,pack:{id:pack.id,name:pack.name,price:pack.price,cards:pack.cards}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.expected)return{error:e.message,status:e.status};throw e;}
 finally{client.release();}
}
async function createCardInstance(instance,client=null){const db=client||getPool();if(db){await db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,acquired_at,source,status,jersey_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,[instance.instanceId,instance.cardId,instance.ownerId,instance.season,instance.name,instance.position,instance.club,instance.nation,instance.rarity,Number(instance.ovr||72),Number(instance.pace||72),Number(instance.shooting||72),Number(instance.passing||72),Number(instance.dribbling||72),Number(instance.defending||72),Number(instance.physical||72),Boolean(instance.isLimited),instance.serial,instance.maxSupply,instance.acquiredAt,instance.source,instance.status,instance.jerseyNumber??null]);}else memory.cards.set(instance.instanceId,instance);}
// Cartes tirées : un seul INSERT pour les cartes standard (avant : un aller-retour par carte, ~90 ms chacun avec la
// base distante). Les cartes LIMITED restent enregistrées une à une : leur numéro de série dépend des exemplaires déjà écrits.
async function createDrawnInstances(drawn,ownerId,source,client){
 const instances=[],batch=[];
 for(const c of drawn){const instance=await buildInstance(c,ownerId,source,client);instances.push(instance);if(instance.isLimited)await createCardInstance(instance,client);else batch.push(instance);}
 if(batch.length){
  if(!client)for(const i of batch)await createCardInstance(i);
  else{
   const per=23,values=[],holders=batch.map((i,n)=>{values.push(i.instanceId,i.cardId,i.ownerId,i.season,i.name,i.position,i.club,i.nation,i.rarity,Number(i.ovr||72),Number(i.pace||72),Number(i.shooting||72),Number(i.passing||72),Number(i.dribbling||72),Number(i.defending||72),Number(i.physical||72),Boolean(i.isLimited),i.serial,i.maxSupply,i.acquiredAt,i.source,i.status,i.jerseyNumber??null);return '('+Array.from({length:per},(_,k)=>'$'+(n*per+k+1)).join(',')+')';});
   await client.query('INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,acquired_at,source,status,jersey_number) VALUES '+holders.join(','),values);
  }
 }
 return instances.map(publicCard);
}
// Journal de sécurité écrit après la validation, avec la connexion déjà prise (une requête au lieu de trois :
// pas de point de sauvegarde) ; un échec est journalisé sans annuler le tirage déjà validé.
async function auditAfterCommit(client,userId,event,details){
 try{await client.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[userId||null,null,event,JSON.stringify(details)]);}
 catch(e){console.error('SPORT VAULT security event error:',e.message);}
}
// Débit du pack : mise à jour du joueur et ligne du journal des FC en une seule requête (un aller-retour de moins).
async function chargeUser(client,userId,price,xp,reason,ref){
 const amount=Math.trunc(Number(price)||0);
 if(!amount)return(await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3 RETURNING *',[price,xp,userId])).rows[0];
 return(await client.query('WITH u AS (UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3 RETURNING *),l AS (INSERT INTO coin_ledger(user_id,amount,reason,ref) VALUES($3,$4,$5,$6)) SELECT * FROM u',[price,xp,userId,-amount,reason,String(ref).slice(0,120)])).rows[0];
}
async function getUserCards(ownerId,client=null){if(getPool()){const r=await (client||getPool()).query("SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' ORDER BY acquired_at DESC, instance_id DESC",[ownerId]);return r.rows.map(publicCard);}return[...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard);}
function welcomeRarity(){const roll=Math.random()*100;return roll<5?'epic':roll<25?'rare':'common'}
async function grantWelcomeCards(userId,client=null){
 const existing=await getUserCards(userId,client);if(existing.length>=3)return existing;
 // Jamais de carte LIMITED dans un cadeau : il ne doit pas consommer de série et une carte épuisée ferait échouer l'inscription (500).
 let source=catalog().filter(c=>!c.isLimited);
 if(getPool()){
  source=(await activeCatalogCards(client||getPool())).filter(c=>!isInternationalCard(c)&&!c.isLimited);
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
async function openPackForUser(userId,packId){const pack=await getPackDefinition(packId);if(!pack)return{error:'Pack introuvable.',status:404};if(pack.in_window===false)return{error:'Ce pack à durée limitée n’est pas disponible en ce moment. Aucun FOOTCOIN n’a été débité.',status:409};if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:coinsShort(user,pack.price),status:400};}const drawn=await drawDynamicPack(pack,client);const updatedUser=await chargeUser(client,userId,pack.price,pack.cards*2,'pack',pack.id);const cards=await createDrawnInstances(drawn,userId,`pack:${pack.id}`,client);await client.query('COMMIT');await auditAfterCommit(client,userId,'pack_open',{packId:pack.id,price:pack.price,cards:cards.length});return{user:safeUser(updatedUser),cards,pack};}catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.expected)return{error:e.message,status:e.status};throw e;}finally{client.release();}}const user=await getUserById(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price)return{error:coinsShort(user,pack.price),status:400};const drawn=drawPack(packId);user.coins-=pack.price;user.xp+=pack.cards*2;const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,`pack:${pack.id}`,null);await createCardInstance(instance);cards.push(publicCard(instance));}memory.activity.push({userId,event:'pack_open',at:new Date().toISOString()});return{user:safeUser(user),cards,pack};}

// Roue des éditions limitées (pools) : chaque carte spéciale (rareté verrouillée) tirée fait tourner une roue ; le serveur tire
// le résultat (jamais le client). La carte limitée gagnée s'AJOUTE aux cartes tirées. Un type d'édition sans exemplaire en
// stock (ou sans carte créée) devient une case « rien » : la roue ne peut pas tomber sur une édition épuisée.
async function spinWheel(client,userId,source){
 const tiers=WHEEL.tiers.map(t=>t.supply);
 const rows=(await client.query(`SELECT c.id,c.max_supply,c.max_supply-COALESCE((SELECT max(serial) FROM card_instances i WHERE i.card_id=c.id AND i.is_limited=true),0) AS remaining
  FROM catalog_cards c WHERE c.is_active=true AND c.is_limited=true AND c.max_supply=ANY($1::int[])`,[tiers])).rows.filter(r=>Number(r.remaining)>0);
 const stock=new Map();for(const r of rows){if(!stock.has(Number(r.max_supply)))stock.set(Number(r.max_supply),[]);stock.get(Number(r.max_supply)).push(r.id);}
 const live=WHEEL.tiers.filter(t=>stock.has(t.supply));
 const segments=[];live.forEach((t,i)=>{segments.push({label:'/'+t.supply,tier:t.supply,chance:t.chance});segments.push({label:'RIEN',tier:null});});
 if(!live.length)segments.push({label:'RIEN',tier:null},{label:'RIEN',tier:null});
 const lost=100-live.reduce((s,t)=>s+t.chance,0);
 let roll=crypto.randomInt(0,1000000)/10000,won=null;
 for(const t of live){roll-=t.chance;if(roll<0){won=t.supply;break;}}
 let card=null;
 if(won!==null){
  const ids=stock.get(won),cardId=ids[crypto.randomInt(0,ids.length)];
  await client.query('SAVEPOINT wheel_card');
  try{
   const def=(await activeCatalogCards(client)).find(x=>x.id===cardId);
   const instance=await buildInstance(def,userId,source,client);await createCardInstance(instance,client);
   await client.query('RELEASE SAVEPOINT wheel_card');card=publicCard(instance);card.bonus=true;
  }catch(e){console.error('[FOOTVAULT] Roue : carte limitée non créée',e.message);await client.query('ROLLBACK TO SAVEPOINT wheel_card');won=null;card=null;}
 }
 const rienIdx=segments.map((s,i)=>s.tier===null?i:-1).filter(i=>i>=0);
 const index=won!==null?segments.findIndex(s=>s.tier===won):rienIdx[crypto.randomInt(0,rienIdx.length)];
 return{segments,index,lostChance:Math.round(lost*10)/10,tier:won,card};
}
async function openPoolForUser(userId,poolId){
 const pr=await getPool().query('SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE id=$1 AND active=true',[poolId]);const poolDef=pr.rows[0];if(!poolDef)return{error:'Tirage introuvable.',status:404};
 const pack={id:'pool:'+poolDef.id,name:poolDef.name,price:Number(poolDef.price),cards:Number(poolDef.cards),guarantee:'common',guarantee_count:0,pool_id:poolDef.id,conditions:{}};
 if(pack.price<0||pack.cards<1)return{error:'Configuration du tirage invalide.',status:400};
 const client=await getPool().connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:coinsShort(user,pack.price),status:400};}const drawn=await drawDynamicPack(pack,client);const cards=await createDrawnInstances(drawn,userId,pack.id,client);const wheels=[];for(const s of drawn.filter(x=>x.rarityLocked&&!x.isLimited)){const w=await spinWheel(client,userId,pack.id);wheels.push({special:{id:s.id,name:s.name},segments:w.segments,index:w.index,lostChance:w.lostChance,tier:w.tier,card:w.card});if(w.card)cards.push(w.card);}const updatedUser=await chargeUser(client,userId,pack.price,pack.cards*2,'pool',poolDef.id);await client.query('COMMIT');await auditAfterCommit(client,userId,'pool_draw',{poolId:poolDef.id,price:pack.price,cards:cards.length,wheels:wheels.map(w=>w.tier)});return{user:safeUser(updatedUser),cards,wheels,pack:{...pack,poolId:poolDef.id,pool:true}};}catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.expected)return{error:e.message,status:e.status};throw e;}finally{client.release();}}

return { publicCard, buildInstance, weightedRarity, rarityAtLeast, drawPack, listPacks, getPackDefinition, catalogCardsForPackConditions, configuredPackCards, drawDynamicPack, createCardInstance, getUserCards, welcomeRarity, grantWelcomeCards, openPackForUser, openCustomPack, quoteCustomPack, customPackOptions, openPoolForUser, warmCatalog, activeCatalogCards };
}

module.exports = { createCards };
