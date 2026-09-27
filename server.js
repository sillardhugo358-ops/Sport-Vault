const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SESSION_DAYS = 2/24;

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map(), claims: new Map(), activity: [], reg: new Map(), login: new Map() };

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

const PACKS = {
  starter:{id:'starter',name:'STARTER PACK',price:100,currency:'coins',cards:5,badge:'POUR COMMENCER',description:'5 cartes FOOTVAULT',guarantee:'common'},
  pro:{id:'pro',name:'PRO PACK',price:250,currency:'coins',cards:8,badge:'LE PLUS POPULAIRE',description:'8 cartes FOOTVAULT · 1 carte RARE ou mieux garantie',guarantee:'rare'},
  legend:{id:'legend',name:'LEGEND PACK',price:500,currency:'coins',cards:5,badge:'HAUTE RARETÉ',description:'5 cartes FOOTVAULT · 1 carte EPIC ou mieux garantie',guarantee:'epic'}
};
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
const ALBUM_CLUBS=[['aster-fc','Aster FC','AST'],['racing-nord','Racing Nord','RN'],['union-atlantique','Union Atlantique','UA'],['stade-horizon','Stade Horizon','SH']].map(([id,name,tag])=>({id,name,tag}));

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1).trim())];}));}
async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Payload too large');}return JSON.parse(body||'{}');}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [salt,hex]=String(stored).split(':');const actual=crypto.scryptSync(password,salt,64);const expected=Buffer.from(hex,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}catch{return false;}}
function validPassword(password){return typeof password==='string'&&password.length>=10&&password.length<=128&&/[A-Za-z]/.test(password)&&/[0-9]/.test(password);}
function levelProgressFromXp(value){let remaining=Math.max(0,Math.floor(Number(value)||0)),level=1,xpToNext=150;while(remaining>=xpToNext){remaining-=xpToNext;level++;xpToNext=150+40*(level-1);}return{level,currentXp:remaining,xpToNext};}
function safeUser(user){const coins=Number(user.coins||0),reservedCoins=Number(user.reserved_coins||0);return{id:user.id,name:user.name,email:user.email,role:user.role||'user',coins,gems:Number(user.gems),xp:Number(user.xp),reservedCoins,availableCoins:Math.max(0,coins-reservedCoins),createdAt:user.createdAt||user.created_at,accountStatus:user.account_status||'active',blockedUntil:user.blocked_until||null,dailyClaimedAt:user.daily_claimed_at||user.dailyClaimedAt||null};}
function sessionCookie(token){return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`;}
function expiryDate(){return new Date(Date.now()+SESSION_DAYS*86400_000);}
function publicCard(card){const limited=Boolean(card.is_limited??card.isLimited);return{instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jersey_number==null?(card.jerseyNumber==null?null:Number(card.jerseyNumber)):Number(card.jersey_number),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),rarityLabel:RARITIES[card.rarity]?.label||card.rarity,distributionType:limited?'LIMITED':'STANDARD',isLimited:limited,serial:limited&&card.serial!=null?Number(card.serial):null,maxSupply:limited&&card.max_supply!=null?Number(card.max_supply):null,serialLabel:limited&&card.serial!=null&&card.max_supply!=null?String(Number(card.serial))+'/'+String(Number(card.max_supply)):null,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}
async function buildInstance(card,ownerId,source='welcome',client=null){const limited=Boolean(card.isLimited);if(limited&&(!Number.isInteger(card.maxSupply)||card.maxSupply<1))throw new Error('Carte LIMITED invalide : quantité maximale requise.');let serial=null;if(limited&&client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`limited-card:${card.id}`]);const next=Number((await client.query('SELECT COALESCE(MAX(serial),0)+1 AS n FROM card_instances WHERE card_id=$1 AND is_limited=true',[card.id])).rows[0].n);if(next>card.maxSupply)throw new Error('Cette carte LIMITED a atteint sa quantité maximale.');serial=next;}return{instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,jerseyNumber:card.jerseyNumber==null?null:Number(card.jerseyNumber),club:card.club,nation:card.nation,rarity:card.rarity,ovr:Number(card.ovr||72),pace:Number(card.pace||72),shooting:Number(card.shooting||72),passing:Number(card.passing||72),dribbling:Number(card.dribbling||72),defending:Number(card.defending||72),physical:Number(card.physical||72),isLimited:limited,serial,maxSupply:limited?card.maxSupply:null,acquiredAt:new Date().toISOString(),source,status:'owned'};}
function weightedRarity(){const total=PACK_WEIGHTS.reduce((s,[,w])=>s+w,0);let roll=Math.random()*total;for(const[rarity,w]of PACK_WEIGHTS){roll-=w;if(roll<=0)return rarity;}return'common';}
function rarityAtLeast(a,b){return RARITIES[a].order>=RARITIES[b].order;}
function drawPack(packId){const pack=PACKS[packId];if(!pack)throw new Error('Pack introuvable');const drawn=[],used=new Set();const guaranteedIndex=Math.floor(Math.random()*pack.cards);for(let i=0;i<pack.cards;i++){const available=CARD_CATALOG.filter(c=>!used.has(c.id));let candidates=i===guaranteedIndex?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;if(!candidates.length)candidates=available;const target=i===guaranteedIndex?pack.guarantee:weightedRarity();let same=candidates.filter(c=>c.rarity===target);if(!same.length)same=candidates;const card=same[Math.floor(Math.random()*same.length)];used.add(card.id);drawn.push(card);}return drawn;}

async function listPacks(){ if(pool){const r=await pool.query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active FROM pack_definitions WHERE active=true ORDER BY sort_order,id');const pr=await pool.query("SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE active=true AND id<>'pool-standard' ORDER BY name,id");return{packs:r.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)})),pools:pr.rows.map(x=>({...x,price:Number(x.price),cards:Number(x.cards),active:Boolean(x.active)}))};}return{packs:Object.values(PACKS),pools:[]}; }
async function getPackDefinition(packId){if(pool){const r=await pool.query('SELECT id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active FROM pack_definitions WHERE id=$1 AND active=true',[packId]);return r.rows[0]||null;}return PACKS[packId]||null;}
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
async function configuredPackCards(pack){
 let cards=CARD_CATALOG;
 if(pool){
  const rows=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true')).rows;
  cards=rows.map(r=>({id:r.id,season:r.season,name:r.name,position:r.position,jerseyNumber:r.jersey_number==null?null:Number(r.jersey_number),club:r.club,nation:r.nation,rarity:r.rarity,ovr:Number(r.ovr||72),pace:Number(r.pace||72),shooting:Number(r.shooting||72),passing:Number(r.passing||72),dribbling:Number(r.dribbling||72),defending:Number(r.defending||72),physical:Number(r.physical||72),distributionType:String(r.distribution_type||'STANDARD').toUpperCase(),isLimited:Boolean(r.is_limited),maxSupply:r.max_supply==null?null:Number(r.max_supply),order:Number(r.card_order||0),rarityLabel:RARITIES[r.rarity]?.label||r.rarity}));
  if(pack.pool_id){
   const pr=(await pool.query('SELECT type,config FROM pack_pools WHERE id=$1',[pack.pool_id])).rows[0];
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
async function drawDynamicPack(pack){
 const source=await configuredPackCards(pack);
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
async function initDb(){if(!process.env.DATABASE_URL){if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL manquante en production. FOOTVAULT refuse de démarrer sans PostgreSQL.');return{mode:'memory'}};try{const{Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:5,connectionTimeoutMillis:5000});await pool.query('SELECT 1');await pool.query('CREATE TABLE IF NOT EXISTS catalog_cards(id varchar(32) PRIMARY KEY,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,jersey_number integer,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,ovr integer NOT NULL DEFAULT 72,pace integer NOT NULL DEFAULT 72,shooting integer NOT NULL DEFAULT 72,passing integer NOT NULL DEFAULT 72,dribbling integer NOT NULL DEFAULT 72,defending integer NOT NULL DEFAULT 72,physical integer NOT NULL DEFAULT 72,distribution_type varchar(20) NOT NULL DEFAULT \'STANDARD\',is_limited boolean NOT NULL DEFAULT false,max_supply integer,card_order integer NOT NULL DEFAULT 0,is_active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now())');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS jersey_number integer');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS ovr integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS pace integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS shooting integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS passing integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS dribbling integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS defending integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS physical integer NOT NULL DEFAULT 72');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS distribution_type varchar(20) NOT NULL DEFAULT \'STANDARD\'');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS is_limited boolean NOT NULL DEFAULT false');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS max_supply integer');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS card_order integer NOT NULL DEFAULT 0');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()');
for(const c of CARD_CATALOG) await pool.query('INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$9,$9,$9,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING',[c.id,c.season,c.name,c.position,c.jerseyNumber??null,c.club,c.nation,c.rarity,c.ovr,c.distributionType,Boolean(c.isLimited),c.maxSupply,c.order]);
const catalogRows=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE is_active=true ORDER BY card_order,id')).rows;
CARD_CATALOG=catalogRows.map(c=>({...c,rarityLabel:RARITIES[c.rarity]?.label||c.rarity,distributionType:c.distribution_type,isLimited:Boolean(c.is_limited),maxSupply:c.max_supply==null?null:Number(c.max_supply),ovr:Number(c.ovr),pace:Number(c.pace),shooting:Number(c.shooting),passing:Number(c.passing),dribbling:Number(c.dribbling),defending:Number(c.defending),physical:Number(c.physical),order:Number(c.card_order),jerseyNumber:c.jersey_number==null?null:Number(c.jersey_number),isActive:Boolean(c.is_active)}));await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name varchar(30) NOT NULL,email varchar(320) NOT NULL UNIQUE,password_hash text NOT NULL,coins integer NOT NULL DEFAULT 1000,gems integer NOT NULL DEFAULT 50,xp integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),daily_claimed_at timestamptz,role varchar(20) NOT NULL DEFAULT 'user')`);await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_claimed_at timestamptz');await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'user'");await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status varchar(20) NOT NULL DEFAULT 'active'");await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_until timestamptz");const configuredAdmins=String(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(configuredAdmins.length){await pool.query("UPDATE users SET role='admin' WHERE lower(email)=ANY($1::text[]) AND role<>'creator'",[configuredAdmins]);await pool.query("UPDATE users SET role='creator' WHERE lower(email)=$1",[configuredAdmins[0]]);}if(process.env.ADMIN_BOOTSTRAP_PASSWORD&&process.env.ADMIN_EMAILS){const bootstrapEmail=String(process.env.ADMIN_EMAILS).split(',')[0].trim().toLowerCase();if(bootstrapEmail){const existing=await pool.query('SELECT id FROM users WHERE lower(email)=$1',[bootstrapEmail]);if(!existing.rowCount){const bootstrapName=String(process.env.ADMIN_BOOTSTRAP_NAME||'Hugo SILLARD').slice(0,30);const passwordHash=hashPassword(String(process.env.ADMIN_BOOTSTRAP_PASSWORD));const created=await pool.query('INSERT INTO users(id,name,email,password_hash,coins,gems,role) VALUES(gen_random_uuid(),$1,$2,$3,1000,50,\'admin\') RETURNING id',[bootstrapName,bootstrapEmail,passwordHash]);await grantWelcomeCards(created.rows[0].id);}}}await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS packs_opened integer NOT NULL DEFAULT 0');await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reserved_coins integer NOT NULL DEFAULT 0');await pool.query(`CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS card_instances(instance_id uuid PRIMARY KEY,card_id varchar(32) NOT NULL,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,is_limited boolean NOT NULL DEFAULT false,serial integer,max_supply integer,acquired_at timestamptz NOT NULL DEFAULT now(),source varchar(40) NOT NULL,status varchar(20) NOT NULL DEFAULT 'owned',ovr integer NOT NULL DEFAULT 72,pace integer NOT NULL DEFAULT 72,shooting integer NOT NULL DEFAULT 72,passing integer NOT NULL DEFAULT 72,dribbling integer NOT NULL DEFAULT 72,defending integer NOT NULL DEFAULT 72,physical integer NOT NULL DEFAULT 72)`);await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS jersey_number integer');await pool.query('CREATE INDEX IF NOT EXISTS card_instances_owner_idx ON card_instances(owner_id)');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS is_limited boolean NOT NULL DEFAULT false');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS ovr integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS pace integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS shooting integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS passing integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS dribbling integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS defending integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS physical integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ALTER COLUMN serial DROP NOT NULL');await pool.query('ALTER TABLE card_instances ALTER COLUMN max_supply DROP NOT NULL');await pool.query("UPDATE card_instances SET is_limited=false,serial=NULL,max_supply=NULL WHERE is_limited=false OR is_limited IS NULL");await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS tradeable boolean NOT NULL DEFAULT true');await pool.query("UPDATE card_instances SET tradeable=false WHERE source='welcome'");await pool.query('CREATE TABLE IF NOT EXISTS competitions(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL,tag varchar(12) NOT NULL,country varchar(60) NOT NULL DEFAULT \'\',description text NOT NULL DEFAULT \'\',status varchar(20) NOT NULL DEFAULT \'upcoming\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS clubs(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL UNIQUE,tag varchar(12) NOT NULL,country varchar(60) NOT NULL DEFAULT \'\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_url text');await pool.query('CREATE TABLE IF NOT EXISTS competition_clubs(competition_id varchar(50) NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,club_id varchar(50) NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,position integer NOT NULL DEFAULT 0,PRIMARY KEY(competition_id,club_id))');await pool.query('CREATE TABLE IF NOT EXISTS competition_seasons(id varchar(80) PRIMARY KEY,competition_id varchar(50) NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,season varchar(12) NOT NULL,label varchar(80) NOT NULL,status varchar(20) NOT NULL DEFAULT \'upcoming\',description text NOT NULL DEFAULT \'\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(competition_id,season))');await pool.query('CREATE TABLE IF NOT EXISTS season_clubs(season_id varchar(80) NOT NULL REFERENCES competition_seasons(id) ON DELETE CASCADE,club_id varchar(50) NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,position integer NOT NULL DEFAULT 0,PRIMARY KEY(season_id,club_id))');const baseClubs=[['aster-fc','Aster FC','AST','France'],['racing-nord','Racing Nord','RN','France'],['union-atlantique','Union Atlantique','UA','France'],['stade-horizon','Stade Horizon','SH','France']];const clubBootstrap=(await pool.query('SELECT count(*)::int AS n FROM clubs')).rows[0];if(Number(clubBootstrap.n)===0)for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[...baseClubs[i],i]);await pool.query("INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES('ligue-1','Ligue 1','L1','France','Championnat de France','available',0) ON CONFLICT(id) DO NOTHING");for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO competition_clubs(competition_id,club_id,position) SELECT $1,$2::varchar,$3 WHERE EXISTS (SELECT 1 FROM clubs WHERE id=$2::varchar) ON CONFLICT DO NOTHING',['ligue-1',baseClubs[i][0],i]);await pool.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,sort_order) VALUES('ligue-1-2026','ligue-1','2026','Saison 2026','available',0) ON CONFLICT(id) DO NOTHING");for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO season_clubs(season_id,club_id,position) SELECT $1,$2::varchar,$3 WHERE EXISTS (SELECT 1 FROM clubs WHERE id=$2::varchar) ON CONFLICT DO NOTHING',['ligue-1-2026',baseClubs[i][0],i]);const upcoming=[['premier-league','Premier League','PL','Angleterre'],['serie-a','Serie A','SA','Italie'],['bundesliga','Bundesliga','BL','Allemagne'],['la-liga','La Liga','LL','Espagne'],['ligue-des-champions','Ligue des Champions','LDC','Europe'],['coupe-du-monde','Coupe du Monde','CDM','International'],['ligue-des-nations','Ligue des Nations','LN','Europe']];for(let i=0;i<upcoming.length;i++)await pool.query('INSERT INTO competitions(id,name,tag,country,status,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[upcoming[i][0],upcoming[i][1],upcoming[i][2],upcoming[i][3],'upcoming',i+1]);for(let i=0;i<upcoming.length;i++)await pool.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,sort_order) VALUES($1,$2,'2026',$3,'upcoming',0) ON CONFLICT(id) DO NOTHING",[upcoming[i][0]+'-2026',upcoming[i][0],'Saison 2026']);await pool.query('CREATE TABLE IF NOT EXISTS card_collections(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL,tag varchar(12) NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS card_collection_cards(collection_id varchar(50) NOT NULL REFERENCES card_collections(id) ON DELETE CASCADE,card_id varchar(32) NOT NULL,position integer NOT NULL DEFAULT 0,PRIMARY KEY(collection_id,card_id))');await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''");await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0");await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()");for(let i=0;i<ALBUM_CLUBS.length;i++){const c=ALBUM_CLUBS[i];await pool.query('INSERT INTO card_collections(id,name,tag,description,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[c.id,c.name,c.tag,'Collection de base FOOTVAULT',i]);const clubCards=CARD_CATALOG.filter(x=>x.club===c.name).sort((a,b)=>a.order-b.order);for(let position=0;position<clubCards.length;position++){const card=clubCards[position];await pool.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3) ON CONFLICT(collection_id,card_id) DO UPDATE SET position=EXCLUDED.position',[c.id,card.id,position]);}}await pool.query(`CREATE TABLE IF NOT EXISTS reward_claims(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,claim_id varchar(80) NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,claim_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS auctions(
 id uuid PRIMARY KEY,
 card_instance_id uuid NOT NULL UNIQUE REFERENCES card_instances(instance_id) ON DELETE RESTRICT,
 seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 starting_bid integer NOT NULL CHECK(starting_bid>0),
 current_bid integer NOT NULL CHECK(current_bid>0),
 current_bidder_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 cancelled_at timestamptz
)`);
await pool.query('CREATE INDEX IF NOT EXISTS auctions_active_idx ON auctions(status,ends_at)');
await pool.query('CREATE INDEX IF NOT EXISTS auctions_seller_idx ON auctions(seller_id)');
await pool.query('CREATE INDEX IF NOT EXISTS auctions_card_idx ON auctions(card_instance_id)');
await pool.query(`CREATE TABLE IF NOT EXISTS auction_bids(
 id bigserial PRIMARY KEY,
 auction_id uuid NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
 bidder_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 amount integer NOT NULL CHECK(amount>0),
 created_at timestamptz NOT NULL DEFAULT now()
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS auction_withdrawals(
 auction_id uuid NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
 bidder_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 withdrawn_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(auction_id,bidder_id)
)`);
await pool.query('CREATE INDEX IF NOT EXISTS auction_withdrawals_bidder_idx ON auction_withdrawals(bidder_id)');
await pool.query('CREATE INDEX IF NOT EXISTS auction_bids_auction_idx ON auction_bids(auction_id,created_at DESC)');
await pool.query(`CREATE TABLE IF NOT EXISTS admin_logs(id bigserial PRIMARY KEY,admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,action varchar(60) NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE INDEX IF NOT EXISTS admin_logs_created_idx ON admin_logs(created_at DESC)');await pool.query(`CREATE TABLE IF NOT EXISTS security_events(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,ip varchar(255),event varchar(80) NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events(created_at DESC)');await pool.query('CREATE INDEX IF NOT EXISTS security_events_user_idx ON security_events(user_id,created_at DESC)');await pool.query('CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)');await pool.query('CREATE TABLE IF NOT EXISTS pack_pools(id varchar(64) PRIMARY KEY,name varchar(100) NOT NULL,type varchar(20) NOT NULL,config jsonb NOT NULL DEFAULT \'{}\'::jsonb,price integer NOT NULL DEFAULT 0,cards integer NOT NULL DEFAULT 1,badge varchar(80) NOT NULL DEFAULT \'\',description varchar(300) NOT NULL DEFAULT \'\',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');await pool.query("ALTER TABLE pack_pools ADD COLUMN IF NOT EXISTS price integer NOT NULL DEFAULT 0");await pool.query("ALTER TABLE pack_pools ADD COLUMN IF NOT EXISTS cards integer NOT NULL DEFAULT 1");await pool.query("ALTER TABLE pack_pools ADD COLUMN IF NOT EXISTS badge varchar(80) NOT NULL DEFAULT ''");await pool.query("ALTER TABLE pack_pools ADD COLUMN IF NOT EXISTS description varchar(300) NOT NULL DEFAULT ''");await pool.query("ALTER TABLE pack_pools ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true");await pool.query("UPDATE pack_pools SET price=100 WHERE id<>'pool-standard' AND price=0");
await pool.query('CREATE TABLE IF NOT EXISTS pack_definitions(id varchar(64) PRIMARY KEY,name varchar(100) NOT NULL,price integer NOT NULL,currency varchar(20) NOT NULL DEFAULT \'coins\',cards integer NOT NULL,badge varchar(80) NOT NULL DEFAULT \'\',description varchar(300) NOT NULL DEFAULT \'\',guarantee varchar(20) NOT NULL DEFAULT \'common\',guarantee_count integer NOT NULL DEFAULT 1,pool_id varchar(64) REFERENCES pack_pools(id) ON DELETE RESTRICT,conditions jsonb NOT NULL DEFAULT \'{}\'::jsonb,active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');
await pool.query('ALTER TABLE pack_definitions ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT \'{}\'::jsonb');

const pc=(await pool.query('SELECT count(*)::int n FROM pack_definitions')).rows[0].n;if(Number(pc)===0){await pool.query('INSERT INTO pack_pools(id,name,type,config) VALUES($1,$2,$3,$4)', ['pool-standard','POOL STANDARD 2026-2027','all',JSON.stringify({weights:PACK_WEIGHTS})]);let pi=0;for(const p of Object.values(PACKS)){const conditions=p.id==='starter'?{rarities:['common'],limitedOnly:false,standardOnly:true}:p.id==='pro'?{rarities:['common','rare'],limitedOnly:false,standardOnly:true}:{rarities:['common','rare','epic'],limitedOnly:false,standardOnly:true};await pool.query('INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)',[p.id,p.name,p.price,p.currency,p.cards,p.badge,p.description,p.guarantee,1,'pool-standard',JSON.stringify(conditions),pi++]);}}
await pool.query('CREATE TABLE IF NOT EXISTS app_migrations(id varchar(120) PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  const levelMigrationId='level-progression-rework-2026-09-25';
  if(!(await pool.query('SELECT 1 FROM app_migrations WHERE id=$1',[levelMigrationId])).rowCount){
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    await client.query(`UPDATE users SET xp=((floor(GREATEST(0,xp)::numeric/100)*(130+20*floor(GREATEST(0,xp)::numeric/100)))+round(mod(GREATEST(0,xp),100)*(150+40*floor(GREATEST(0,xp)::numeric/100))/100.0))::integer`);
    await client.query('INSERT INTO app_migrations(id) VALUES($1)',[levelMigrationId]);
    await client.query('COMMIT');
    console.log('[FOOTVAULT] Progression migrée : niveaux conservés, nouveau barème XP appliqué.');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
 const cardCatalogResetId='reset-card-catalog-footmercato-2026-09-25-v2';
 const cardCatalogReset=(await pool.query('SELECT 1 FROM app_migrations WHERE id=$1',[cardCatalogResetId])).rowCount>0;
 if(!cardCatalogReset){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM auction_bids');
   await client.query('DELETE FROM auction_withdrawals');
   await client.query('DELETE FROM auctions');
   await client.query('DELETE FROM card_instances');
   await client.query('DELETE FROM card_collection_cards');
   await client.query('DELETE FROM catalog_cards');
   const freshCards=loadFootMercatoCatalog();
   if(freshCards.length!==478)throw new Error('Catalogue Foot Mercato invalide pendant le reset: '+freshCards.length+' cartes.');
   for(const c of freshCards){
    await client.query(`INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true)`,[c.id,c.season,c.name,c.position,c.jerseyNumber??null,c.club,c.nation,c.rarity,c.ovr,c.pace,c.shooting,c.passing,c.dribbling,c.defending,c.physical,c.distributionType,Boolean(c.isLimited),c.maxSupply,c.order]);
   }
   await client.query('INSERT INTO app_migrations(id) VALUES($1)',[cardCatalogResetId]);
   await client.query('COMMIT');
   CARD_CATALOG=freshCards;
   console.log('[FOOTVAULT] RESET catalogue v2: anciennes cartes, instances et enchères supprimées; '+freshCards.length+' cartes Foot Mercato importées.');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
const packReset=(await pool.query("SELECT 1 FROM app_migrations WHERE id='reset-packs-2026-09-24'")).rowCount>0;
if(!packReset){
 await pool.query("INSERT INTO pack_pools(id,name,type,config,active) VALUES('pool-standard','POOL STANDARD 2026-2027','all',$1,true) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,config=excluded.config,active=true",[JSON.stringify({weights:PACK_WEIGHTS})]);
 const resetPacks=[
  ['starter','STARTER PACK',100,'coins',5,'POUR COMMENCER','5 cartes FOOTVAULT','common',1,{rarities:['common'],limitedOnly:false,standardOnly:true},true,0],
  ['pro','PRO PACK',250,'coins',8,'LE PLUS POPULAIRE','8 cartes FOOTVAULT · 1 carte RARE ou mieux garantie','rare',1,{rarities:['common','rare'],limitedOnly:false,standardOnly:true},true,1],
  ['legend','LEGEND PACK',500,'coins',5,'HAUTE RARETÉ','5 cartes FOOTVAULT · 1 carte EPIC ou mieux garantie','epic',1,{rarities:['common','rare','epic'],limitedOnly:false,standardOnly:true},true,2]
 ];
 for(const p of resetPacks){
  await pool.query("INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pool-standard',$10,$11,$12) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,currency=excluded.currency,cards=excluded.cards,badge=excluded.badge,description=excluded.description,guarantee=excluded.guarantee,guarantee_count=excluded.guarantee_count,pool_id=excluded.pool_id,conditions=excluded.conditions,active=excluded.active,sort_order=excluded.sort_order,updated_at=now()",[p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],JSON.stringify(p[9]),p[10],p[11]]);
 }
 await pool.query("INSERT INTO app_migrations(id) VALUES('reset-packs-2026-09-24')");
}

await pool.query(`CREATE TABLE IF NOT EXISTS registration_limits(ip varchar(255) PRIMARY KEY,last_created_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS login_limits(ip varchar(255) NOT NULL,email varchar(320) NOT NULL,failed_attempts integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ip,email))`);return{mode:'postgres'};}catch(error){console.error('SPORT VAULT database unavailable:',error.message);if(pool)await pool.end().catch(()=>{});pool=null;if(process.env.NODE_ENV==='production')throw error;return{mode:'memory',error:error.message};}}
async function findUserByEmail(email){if(pool){const r=await pool.query('SELECT * FROM users WHERE email=$1',[email]);return r.rows[0]||null;}for(const u of memory.users.values())if(u.email===email)return u;return null;}
async function getUserById(id){if(pool){const r=await pool.query('SELECT * FROM users WHERE id=$1',[id]);return r.rows[0]||null;}return memory.users.get(id)||null;}
async function adminLog(adminId,targetUserId,action,details={}){await pool.query('INSERT INTO admin_logs(admin_id,target_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[adminId,targetUserId,action,JSON.stringify(details)]);}
async function securityEvent(userId,ip,event,details={},client=null){const db=client||pool;if(!db)return;try{await db.query('INSERT INTO security_events(user_id,ip,event,details) VALUES($1,$2,$3,$4::jsonb)',[userId||null,ip||null,event,JSON.stringify(details)])}catch(e){console.error('SPORT VAULT security event error:',e.message)}}
async function cleanupSessions(){if(!pool)return;try{await pool.query('DELETE FROM sessions WHERE expires_at<=now()')}catch(e){console.error('SPORT VAULT session cleanup error:',e.message)}}
function roleLevel(role){return role==='creator'?3:role==='admin'?2:1}
function canManage(actor,target){return roleLevel(actor.role)>roleLevel(target.role)}
function isAdmin(user){return !!user&&(user.role==='admin'||user.role==='creator')}
async function requireAdmin(req){const user=await currentUser(req);return isAdmin(user)?user:null}
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
 const admin=await getUserById(adminId),u=(await pool.query('SELECT id,role,coins,reserved_coins,gems FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};if(!(admin.role==='creator'&&adminId===userId)&&!canManage(admin,u))return{error:'Tu ne peux pas modifier ce compte.',status:403};
 const n=Number(amount);if(!Number.isInteger(n)||n===0||Math.abs(n)>100000000)return{error:'Montant invalide.',status:400};
 if(kind==='coins'&&n<0&&Number(u.coins)-Number(u.reserved_coins)+n<0)return{error:'Impossible de retirer des FC disponibles.',status:400};
 if(kind==='gems'&&n<0&&Number(u.gems)+n<0)return{error:'Impossible de retirer autant de GEMS.',status:400};
 if(!['coins','gems'].includes(kind))return{error:'Ressource invalide.',status:400};
 const col=kind==='coins'?'coins':'gems';const updated=(await pool.query(`UPDATE users SET ${col}=${col}+$1 WHERE id=$2 RETURNING *`,[n,userId])).rows[0];
 await securityEvent(userId,null,'admin_resource_adjust',{adminId,resource:kind,amount:n});
 await adminLog(adminId,userId,'resource_adjust',{resource:kind,amount:n,reason:String(reason||'').slice(0,200)});
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
 const comps=(await pool.query('SELECT id,name,tag,country,description,status,sort_order FROM competitions ORDER BY sort_order,id')).rows;
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
async function adminCards(){const r=await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE is_active=true ORDER BY card_order,id');const statsRows=await pool.query('SELECT card_id,count(*)::int AS total_instances,count(DISTINCT owner_id)::int AS owners FROM card_instances GROUP BY card_id');const stats=new Map(statsRows.rows.map(x=>[x.card_id,x]));return r.rows.map(c=>({...c,jerseyNumber:c.jersey_number==null?null:Number(c.jersey_number),ovr:Number(c.ovr),pace:Number(c.pace),shooting:Number(c.shooting),passing:Number(c.passing),dribbling:Number(c.dribbling),defending:Number(c.defending),physical:Number(c.physical),distributionType:c.distribution_type,isLimited:Boolean(c.is_limited),maxSupply:c.max_supply==null?null:Number(c.max_supply),order:Number(c.card_order),rarityLabel:RARITIES[c.rarity]?.label||c.rarity,totalInstances:Number(stats.get(c.id)?.total_instances||0),owners:Number(stats.get(c.id)?.owners||0)}));}
async function adminCreateCatalogCard(adminId,body){
 const admin=await getUserById(adminId);if(!admin||admin.role!=='creator')return{error:'Seul le Créateur peut ajouter une carte au catalogue.',status:403};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=String(body.nation||'').trim(),season=String(body.season||'').trim(),rarity=String(body.rarity||'').trim().toLowerCase(),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
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
  if(existing) await client.query('UPDATE catalog_cards SET is_active=true,season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,distribution_type=$16,is_limited=$17,max_supply=$18,card_order=$19,updated_at=now() WHERE id=$1',[id,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,maxOrder]);
  else await client.query('INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',[id,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,maxOrder,true]);
  await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[id]);
  await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) SELECT id,$1,COALESCE((SELECT MAX(position)+1 FROM card_collection_cards x WHERE x.collection_id=card_collections.id),0) FROM card_collections WHERE LOWER(name)=LOWER($2) ON CONFLICT DO NOTHING',[id,club]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
 const created={id,season,name,position,jerseyNumber,club,nation,rarity,rarityLabel:RARITIES[rarity].label,distributionType:isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,ovr,...stats,order:maxOrder,isActive:true};
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
 const dbCard=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE id=$1 AND is_active=true',[cardId])).rows[0];if(!dbCard)return{error:'Carte introuvable.',status:404};const c={id:dbCard.id,season:dbCard.season,name:dbCard.name,position:dbCard.position,jerseyNumber:dbCard.jersey_number==null?null:Number(dbCard.jersey_number),club:dbCard.club,nation:dbCard.nation,rarity:dbCard.rarity,ovr:Number(dbCard.ovr),pace:Number(dbCard.pace),shooting:Number(dbCard.shooting),passing:Number(dbCard.passing),dribbling:Number(dbCard.dribbling),defending:Number(dbCard.defending),physical:Number(dbCard.physical),distributionType:dbCard.distribution_type,isLimited:Boolean(dbCard.is_limited),maxSupply:dbCard.max_supply==null?null:Number(dbCard.max_supply),order:Number(dbCard.card_order||0)};
 const name=String(body.name||'').trim(),position=String(body.position||'').trim().toUpperCase(),jerseyNumber=body.jerseyNumber===''||body.jerseyNumber==null?null:Number(body.jerseyNumber),club=String(body.club||'').trim(),nation=String(body.nation||'').trim(),season=String(body.season||'').trim(),rarity=String(body.rarity||'').trim().toLowerCase(),competitionId=String(body.competitionId||'').trim(),seasonId=String(body.seasonId||'').trim();
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
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('UPDATE catalog_cards SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,distribution_type=$16,is_limited=$17,max_supply=$18,updated_at=now() WHERE id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited?'LIMITED':'STANDARD',isLimited,maxSupply]);await client.query('UPDATE card_instances SET season=$2,name=$3,position=$4,jersey_number=$5,club=$6,nation=$7,rarity=$8,ovr=$9,pace=$10,shooting=$11,passing=$12,dribbling=$13,defending=$14,physical=$15,is_limited=$16,max_supply=$17 WHERE card_id=$1',[cardId,season,name,position,jerseyNumber,club,nation,rarity,ovr,stats.pace,stats.shooting,stats.passing,stats.dribbling,stats.defending,stats.physical,isLimited,maxSupply]);await client.query('DELETE FROM card_collection_cards WHERE card_id=$1',[cardId]);await client.query('INSERT INTO card_collection_cards(collection_id,card_id,position) SELECT id,$1,COALESCE((SELECT MAX(position)+1 FROM card_collection_cards x WHERE x.collection_id=card_collections.id),0) FROM card_collections WHERE LOWER(name)=LOWER($2) ON CONFLICT DO NOTHING',[cardId,club]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
 Object.assign(c,{season,name,position,jerseyNumber,club,nation,rarity,rarityLabel:RARITIES[rarity].label,distributionType:isLimited?'LIMITED':'STANDARD',isLimited,maxSupply,ovr,...stats});
 await adminLog(adminId,null,'catalog_card_update',{cardId,name,position,jerseyNumber,club,nation,rarity,ovr,competitionId,seasonId,distributionType:isLimited?'LIMITED':'STANDARD',maxSupply,...stats});
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
async function currentUser(req){const token=cookies(req).fv_session;if(!token)return null;if(pool){const r=await pool.query("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now() AND (u.account_status='active' OR (u.account_status='blocked' AND u.blocked_until<=now()))",[token]);return r.rows[0]||null;}const s=memory.sessions.get(token);if(!s||s.expiresAt<=Date.now()){memory.sessions.delete(token);return null;}const u=memory.users.get(s.userId);return u&&u.accountStatus!=='banned'&&!(u.accountStatus==='blocked'&&u.blockedUntil>Date.now())?u:null;}
async function createSession(userId){const token=crypto.randomBytes(32).toString('hex'),expires=expiryDate();if(pool){await pool.query('DELETE FROM sessions WHERE expires_at<=now()');await pool.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,userId,expires]);}else memory.sessions.set(token,{userId,expiresAt:expires.getTime()});return token;}
async function destroySession(req,res){const token=cookies(req).fv_session;if(token){if(pool)await pool.query('DELETE FROM sessions WHERE token=$1',[token]);else memory.sessions.delete(token);}res.setHeader('Set-Cookie','fv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');}
async function createCardInstance(instance,client=null){const db=client||pool;if(db){await db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,serial,max_supply,acquired_at,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,[instance.instanceId,instance.cardId,instance.ownerId,instance.season,instance.name,instance.position,instance.club,instance.nation,instance.rarity,Number(instance.ovr||72),Number(instance.pace||72),Number(instance.shooting||72),Number(instance.passing||72),Number(instance.dribbling||72),Number(instance.defending||72),Number(instance.physical||72),Boolean(instance.isLimited),instance.serial,instance.maxSupply,instance.acquiredAt,instance.source,instance.status]);}else memory.cards.set(instance.instanceId,instance);}
async function getUserCards(ownerId){if(pool){const r=await pool.query("SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' ORDER BY acquired_at DESC",[ownerId]);return r.rows.map(publicCard);}return[...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard);}
function welcomeRarity(){const roll=Math.random()*100;return roll<5?'epic':roll<25?'rare':'common'}
async function grantWelcomeCards(userId,client=null){
 const existing=await getUserCards(userId);if(existing.length>=3)return existing;
 let source=CARD_CATALOG;
 if(pool){
  const rows=(await pool.query("SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true ORDER BY card_order,id")).rows;
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
async function registrationAllowed(ip,client){if(client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ip]);const r=await client.query('SELECT last_created_at FROM registration_limits WHERE ip=$1',[ip]);return !r.rowCount||Date.now()-new Date(r.rows[0].last_created_at).getTime()>=72*3600_000}const last=memory.reg?.get(ip);return !last||Date.now()-last>=72*3600_000}
async function markRegistration(ip,client){if(client)await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);else memory.reg.set(ip,Date.now())}
function clientIp(req){return String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'unknown'}
async function loginStatus(ip,email){if(pool){const r=await pool.query('SELECT failed_attempts,blocked_until FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);if(!r.rowCount)return{blocked:false,attempts:0};const x=r.rows[0];return{blocked:x.blocked_until&&new Date(x.blocked_until)>new Date(),attempts:Number(x.failed_attempts)}}const x=memory.login?.get(ip+':'+email);return x?{blocked:x.blockedUntil>Date.now(),attempts:x.attempts}:{blocked:false,attempts:0}}
async function loginFailure(ip,email){if(pool){await pool.query("INSERT INTO login_limits(ip,email,failed_attempts,blocked_until,updated_at) VALUES($1,$2,1,NULL,now()) ON CONFLICT(ip,email) DO UPDATE SET failed_attempts=login_limits.failed_attempts+1,blocked_until=CASE WHEN login_limits.failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE login_limits.blocked_until END,updated_at=now()",[ip,email]);return}const key=ip+':'+email,x=memory.login?.get(key)||{attempts:0,blockedUntil:0};x.attempts++;if(x.attempts>=5)x.blockedUntil=Date.now()+15*60_000;memory.login.set(key,x)}
async function loginSuccess(ip,email){if(pool)await pool.query('DELETE FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);else memory.login?.delete(ip+':'+email)}
async function applyReward(userId,reward,client=null){const db=client||pool;if(db){const r=await db.query('UPDATE users SET coins=coins+$1,xp=xp+$2 WHERE id=$3 RETURNING *',[reward.coins||0,reward.xp||0,userId]);return r.rows[0]||null;}const user=memory.users.get(userId);if(!user)return null;user.coins+=reward.coins||0;user.xp+=reward.xp||0;return user;}
async function claimExists(userId,claimId){if(pool){const r=await pool.query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2',[userId,claimId]);return r.rowCount>0;}return memory.claims.has(`${userId}:${claimId}`);}
async function addClaim(userId,claimId,client=null){const db=client||pool;if(db){await db.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,claimId]);}else memory.claims.set(`${userId}:${claimId}`,true);}
function parisDateParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
  const out={};for(const p of parts)if(p.type!=='literal')out[p.type]=p.value;
  return{year:Number(out.year),month:Number(out.month),day:Number(out.day)};
}
function parisDayKey(date=new Date()){
  const p=parisDateParts(date);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
function parisWeekKey(date=new Date()){
  const p=parisDateParts(date),d=new Date(Date.UTC(p.year,p.month-1,p.day)),day=d.getUTCDay(),diff=day===0?-6:1-day;
  d.setUTCDate(d.getUTCDate()+diff);
  return d.toISOString().slice(0,10);
}
function parisOffsetMinutes(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'longOffset',hour:'2-digit'}).formatToParts(new Date(date));
  const raw=parts.find(p=>p.type==='timeZoneName')?.value||'GMT+01:00';
  const m=raw.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if(!m)return 60;
  const minutes=Number(m[2])*60+Number(m[3]||0);
  return m[1]==='-'?-minutes:minutes;
}
function parisLocalMidnight(key){
  const [year,month,day]=key.split('-').map(Number);
  const probe=new Date(Date.UTC(year,month-1,day,12,0,0));
  return new Date(Date.UTC(year,month-1,day,0,0,0)-parisOffsetMinutes(probe)*60000);
}
function periodInfo(kind,date=new Date()){
  const key=kind==='weekly'?parisWeekKey(date):parisDayKey(date);
  const start=parisLocalMidnight(key);
  // Advance from the calendar period key, not the UTC date of local midnight.
  // In Europe/Paris, local midnight falls on the previous UTC date; using
  // start.getUTCDate() here made daily periods end at their own start.
  const [year,month,day]=key.split('-').map(Number);
  const days=kind==='weekly'?7:1;
  const nextDate=new Date(Date.UTC(year,month-1,day+days,12,0,0));
  const nextKey=nextDate.toISOString().slice(0,10);
  const end=parisLocalMidnight(nextKey);
  return{key,start,end};
}

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
function taskClaimId(kind,periodKey,taskId){return `${kind}:${periodKey}:${taskId}`;}
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
async function claimDaily(userId){const reward={coins:150,xp:10};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(user.daily_claimed_at&&parisDayKey(user.daily_claimed_at)===parisDayKey(new Date())){await client.query('ROLLBACK');return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};}const updated=await applyReward(userId,reward,client);await client.query('UPDATE users SET daily_claimed_at=now() WHERE id=$1',[userId]);await securityEvent(userId,null,'daily_reward_claim',{coins:reward.coins,xp:reward.xp},client);await client.query('COMMIT');return{reward,user:safeUser(updated)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=memory.users.get(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(user.dailyClaimedAt&&utcDayKey(user.dailyClaimedAt)===utcDayKey(new Date()))return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};user.coins+=reward.coins;user.xp+=reward.xp;user.dailyClaimedAt=new Date().toISOString();return{reward,user:safeUser(user)};}
async function claimMission(userId,missionId){
  const mission=MISSIONS.find(m=>m.id===missionId);
  if(!mission)return{error:'Mission introuvable.',status:404};
  if(!(await missionUnlocked(userId,mission)))return{error:'Cette mission est encore verrouillée.',status:403};
  const cards=await getUserCards(userId);
  const missionUser=await getUserById(userId);
  const progress=Math.min(missionProgress(mission,cards,missionUser),mission.target);
  if(progress<mission.target)return{error:'Mission non terminée.',status:400,progress,target:mission.target};
  if(await claimExists(userId,mission.id))return{error:'Mission déjà récupérée.',status:400};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,mission.id]);if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Mission déjà récupérée.',status:400};}const user=await applyReward(userId,mission.reward,client);await securityEvent(userId,null,'mission_reward_claim',{missionId:mission.id,coins:mission.reward.coins,xp:mission.reward.xp});await client.query('COMMIT');return{mission,reward:mission.reward,user:safeUser(user)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(userId,mission.id);const user=await applyReward(userId,mission.reward);return{mission,reward:mission.reward,user:safeUser(user)};}
async function openPackForUser(userId,packId){const pack=await getPackDefinition(packId);if(!pack)return{error:'Pack introuvable.',status:404};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};}const drawn=await drawDynamicPack(pack);await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*2,userId]);const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,`pack:${pack.id}`,client);await createCardInstance(instance,client);cards.push(publicCard(instance));}await securityEvent(userId,null,'pack_open',{packId:pack.id,price:pack.price,cards:cards.length},client);const updatedUser=(await client.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];await client.query('COMMIT');return{user:safeUser(updatedUser),cards,pack};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=await getUserById(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price)return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};const drawn=drawPack(packId);user.coins-=pack.price;user.xp+=pack.cards*2;const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,`pack:${pack.id}`,null);await createCardInstance(instance);cards.push(publicCard(instance));}memory.activity.push({userId,event:'pack_open',at:new Date().toISOString()});return{user:safeUser(user),cards,pack};}
async function openPoolForUser(userId,poolId){
 const pr=await pool.query('SELECT id,name,type,config,price,cards,badge,description,active FROM pack_pools WHERE id=$1 AND active=true',[poolId]);const poolDef=pr.rows[0];if(!poolDef)return{error:'Tirage introuvable.',status:404};
 const pack={id:'pool:'+poolDef.id,name:poolDef.name,price:Number(poolDef.price),cards:Number(poolDef.cards),guarantee:'common',guarantee_count:0,pool_id:poolDef.id,conditions:{}};
 if(pack.price<0||pack.cards<1)return{error:'Configuration du tirage invalide.',status:400};
 const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};}const drawn=await drawDynamicPack(pack);const cards=[];for(const c of drawn){const instance=await buildInstance(c,userId,pack.id,client);await createCardInstance(instance,client);cards.push(publicCard(instance));}await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*2,userId]);await securityEvent(userId,null,'pool_draw',{poolId:poolDef.id,price:pack.price,cards:cards.length},client);const updatedUser=(await client.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];await client.query('COMMIT');return{user:safeUser(updatedUser),cards,pack:{...pack,poolId:poolDef.id,pool:true}};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
async function albumViews(owned,selectedSeasonId=null,userId=null){
 if(pool){
  const [comps,seasons,links,counts]=await Promise.all([
   pool.query('SELECT id,name,tag,country,description,status,sort_order FROM competitions ORDER BY sort_order,id'),
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
   const isTroyes=clubKey(x.name)==='estac troyes';
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
function auctionDurationMs(minutes){return Number(minutes)*60_000;}
function auctionMinBid(current){return Math.ceil(Number(current)*1.10);}
function auctionPublic(row){return{id:row.id,cardInstanceId:row.card_instance_id,sellerId:row.seller_id,startingBid:Number(row.starting_bid),currentBid:Number(row.current_bid),currentBidderId:row.current_bidder_id||null,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,createdAt:row.created_at,completedAt:row.completed_at||null};}
async function settleExpiredAuctions(){
 if(!pool)return;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const auctions=(await client.query("SELECT * FROM auctions WHERE status='active' AND ends_at<=now() ORDER BY ends_at FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
  for(const a of auctions){
   if(a.current_bidder_id){
    await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[Number(a.current_bid),a.current_bidder_id]);
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
  await securityEvent(userId,null,'auction_withdraw',{auctionId,currentBidderChanged: a.current_bidder_id===userId,restoredBid:restoredBid?.amount||null});
  await client.query('COMMIT');
  return{ok:true,auction:{id:auctionId,currentBid:restoredBid?.amount||Number(a.starting_bid),currentBidderId:restoredBid?.bidderId||null}};
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
  await securityEvent(userId,null,'auction_create',{auctionId:id,cardInstanceId,startingBid:bid,durationMinutes:mins});await client.query('COMMIT');
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
  await securityEvent(userId,null,'auction_cancel',{auctionId});await client.query('COMMIT');
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
   await client.query("INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'STANDARD',false,NULL,$16,true) ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,jersey_number=excluded.jersey_number,club=excluded.club,nation=excluded.nation,rarity=excluded.rarity,ovr=excluded.ovr,pace=excluded.pace,shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,is_active=true,updated_at=now()",[id,season,String(name),String(position||'ST'),jersey==null||jersey===''?null:Number(jersey),String(club),String(nation||''),String(rarity||'common').toLowerCase(),Number.isFinite(nums[0])?nums[0]:72,...nums.slice(1).map(x=>Number.isFinite(x)?x:72),100000+seasonOrder*10000+index]);
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
}catch(error){console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',async()=>{console.log(`SPORT VAULT running on ${PORT}`);try{const db=await initDb();dbMode=db.mode;dbReady=true;console.log(`SPORT VAULT startup: storage=${db.mode}`);if(pool){setInterval(settleExpiredAuctions,30_000);setInterval(cleanupSessions,5*60_000);}}catch(e){console.error('SPORT VAULT startup database error:',e.message);dbMode='unavailable';}});})();
