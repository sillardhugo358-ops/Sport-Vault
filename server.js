const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SESSION_DAYS = 2/24;

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map(), claims: new Map(), reg: new Map(), login: new Map() };

const RARITIES = {
  common: { label: 'COMMON', supply: 1000, order: 1 },
  rare: { label: 'RARE', supply: 500, order: 2 },
  epic: { label: 'EPIC', supply: 250, order: 3 },
  legendary: { label: 'LEGENDARY', supply: 100, order: 4 },
  icon: { label: 'ICON', supply: 25, order: 5 }
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
const CARD_CATALOG = FOOTVAULT_CARDS.map(([name, position, club, nation, rarity], i) => ({ id:`fv-${String(i+1).padStart(3,'0')}`, season:'2026', name, position, club, nation, rarity, rarityLabel:RARITIES[rarity].label, maxSupply:RARITIES[rarity].supply, order:i+1 }));

const PACKS = {
  starter:{id:'starter',name:'STARTER PACK',price:100,currency:'coins',cards:5,badge:'POUR COMMENCER',description:'5 cartes FOOTVAULT · 1 carte RARE ou mieux garantie',guarantee:'rare'},
  pro:{id:'pro',name:'PRO PACK',price:250,currency:'coins',cards:8,badge:'LE PLUS POPULAIRE',description:'8 cartes FOOTVAULT · 1 carte EPIC ou mieux garantie',guarantee:'epic'},
  legend:{id:'legend',name:'LEGEND PACK',price:500,currency:'coins',cards:5,badge:'HAUTE RARETÉ',description:'5 cartes FOOTVAULT · 1 carte LEGENDARY ou mieux garantie',guarantee:'legendary'}
};
const PACK_WEIGHTS=[['common',72],['rare',21],['epic',5],['legendary',1.8],['icon',0.2]];
const MISSIONS=[
  {id:'collect-5',title:'PREMIÈRE COLLECTION',description:'Possède au moins 5 cartes.',target:5,type:'cards',reward:{coins:150,xp:50}},
  {id:'open-1',title:'OUVERTURE',description:'Ouvre ton premier pack.',target:1,type:'packs',reward:{coins:100,xp:40}},
  {id:'rare-1',title:'PREMIÈRE RARETÉ',description:'Obtiens une carte RARE ou supérieure.',target:1,type:'rarePlus',reward:{coins:250,xp:75}},
  {id:'collect-10',title:'SCOUTING INTENSIF',description:'Possède 10 cartes.',target:10,type:'cards',reward:{coins:300,xp:100}}
];
const ALBUM_CLUBS=[['aster-fc','Aster FC','AST'],['racing-nord','Racing Nord','RN'],['union-atlantique','Union Atlantique','UA'],['stade-horizon','Stade Horizon','SH']].map(([id,name,tag])=>({id,name,tag}));

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1).trim())];}));}
async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Payload too large');}return JSON.parse(body||'{}');}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [salt,hex]=String(stored).split(':');const actual=crypto.scryptSync(password,salt,64);const expected=Buffer.from(hex,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}catch{return false;}}
function safeUser(user){return{id:user.id,name:user.name,email:user.email,coins:Number(user.coins),gems:Number(user.gems),xp:Number(user.xp),createdAt:user.createdAt||user.created_at,dailyClaimedAt:user.daily_claimed_at||user.dailyClaimedAt||null};}
function sessionCookie(token){return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`;}
function expiryDate(){return new Date(Date.now()+SESSION_DAYS*86400_000);}
function publicCard(card){return{instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,rarityLabel:RARITIES[card.rarity]?.label||card.rarity,serial:Number(card.serial),maxSupply:Number(card.max_supply||card.maxSupply),serialLabel:`${Number(card.serial)}/${Number(card.max_supply||card.maxSupply)}`,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}
function buildInstance(card,ownerId,source='welcome'){const rarity=RARITIES[card.rarity];return{instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,serial:Math.floor(Math.random()*rarity.supply)+1,maxSupply:rarity.supply,acquiredAt:new Date().toISOString(),source,status:'owned'};}
function weightedRarity(){const total=PACK_WEIGHTS.reduce((s,[,w])=>s+w,0);let roll=Math.random()*total;for(const[rarity,w]of PACK_WEIGHTS){roll-=w;if(roll<=0)return rarity;}return'common';}
function rarityAtLeast(a,b){return RARITIES[a].order>=RARITIES[b].order;}
function drawPack(packId){const pack=PACKS[packId];if(!pack)throw new Error('Pack introuvable');const drawn=[],used=new Set();const guaranteedIndex=Math.floor(Math.random()*pack.cards);for(let i=0;i<pack.cards;i++){const available=CARD_CATALOG.filter(c=>!used.has(c.id));let candidates=i===guaranteedIndex?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;if(!candidates.length)candidates=available;const target=i===guaranteedIndex?pack.guarantee:weightedRarity();let same=candidates.filter(c=>c.rarity===target);if(!same.length)same=candidates;const card=same[Math.floor(Math.random()*same.length)];used.add(card.id);drawn.push(card);}return drawn;}

async function initDb(){if(!process.env.DATABASE_URL){if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL manquante en production. FOOTVAULT refuse de démarrer sans PostgreSQL.');return{mode:'memory'}};try{const{Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:5,connectionTimeoutMillis:5000});await pool.query('SELECT 1');await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name varchar(30) NOT NULL,email varchar(320) NOT NULL UNIQUE,password_hash text NOT NULL,coins integer NOT NULL DEFAULT 1000,gems integer NOT NULL DEFAULT 50,xp integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),daily_claimed_at timestamptz)`);await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_claimed_at timestamptz');await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS packs_opened integer NOT NULL DEFAULT 0');await pool.query(`CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS card_instances(instance_id uuid PRIMARY KEY,card_id varchar(32) NOT NULL,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,serial integer NOT NULL,max_supply integer NOT NULL,acquired_at timestamptz NOT NULL DEFAULT now(),source varchar(40) NOT NULL,status varchar(20) NOT NULL DEFAULT 'owned')`);await pool.query('CREATE INDEX IF NOT EXISTS card_instances_owner_idx ON card_instances(owner_id)');await pool.query(`CREATE TABLE IF NOT EXISTS reward_claims(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,claim_id varchar(80) NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,claim_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS registration_limits(ip varchar(255) PRIMARY KEY,last_created_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS login_limits(ip varchar(255) NOT NULL,email varchar(320) NOT NULL,failed_attempts integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ip,email))`);return{mode:'postgres'};}catch(error){console.error('SPORT VAULT database unavailable:',error.message);if(pool)await pool.end().catch(()=>{});pool=null;if(process.env.NODE_ENV==='production')throw error;return{mode:'memory',error:error.message};}}
async function findUserByEmail(email){if(pool){const r=await pool.query('SELECT * FROM users WHERE email=$1',[email]);return r.rows[0]||null;}for(const u of memory.users.values())if(u.email===email)return u;return null;}
async function getUserById(id){if(pool){const r=await pool.query('SELECT * FROM users WHERE id=$1',[id]);return r.rows[0]||null;}return memory.users.get(id)||null;}
async function currentUser(req){const token=cookies(req).fv_session;if(!token)return null;if(pool){const r=await pool.query('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now()',[token]);return r.rows[0]||null;}const s=memory.sessions.get(token);if(!s||s.expiresAt<=Date.now()){memory.sessions.delete(token);return null;}return memory.users.get(s.userId)||null;}
async function createSession(userId){const token=crypto.randomBytes(32).toString('hex'),expires=expiryDate();if(pool)await pool.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,userId,expires]);else memory.sessions.set(token,{userId,expiresAt:expires.getTime()});return token;}
async function destroySession(req,res){const token=cookies(req).fv_session;if(token){if(pool)await pool.query('DELETE FROM sessions WHERE token=$1',[token]);else memory.sessions.delete(token);}res.setHeader('Set-Cookie','fv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');}
async function createCardInstance(instance,client=null){const db=client||pool;if(db){await db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,serial,max_supply,acquired_at,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[instance.instanceId,instance.cardId,instance.ownerId,instance.season,instance.name,instance.position,instance.club,instance.nation,instance.rarity,instance.serial,instance.maxSupply,instance.acquiredAt,instance.source,instance.status]);}else memory.cards.set(instance.instanceId,instance);}
async function getUserCards(ownerId){if(pool){const r=await pool.query("SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' ORDER BY acquired_at DESC",[ownerId]);return r.rows.map(publicCard);}return[...memory.cards.values()].filter(c=>c.ownerId===ownerId&&c.status==='owned').sort((a,b)=>new Date(b.acquiredAt)-new Date(a.acquiredAt)).map(publicCard);}
function welcomeRarity(){const roll=Math.random()*100;return roll<5?'epic':roll<25?'rare':'common'}
async function grantWelcomeCards(userId,client=null){const existing=await getUserCards(userId);if(existing.length>=3)return existing;const created=[],used=new Set();for(let i=0;i<3;i++){let rarity=welcomeRarity(),poolCards=CARD_CATALOG.filter(c=>c.rarity===rarity&&!used.has(c.id));if(!poolCards.length){rarity='common';poolCards=CARD_CATALOG.filter(c=>c.rarity==='common'&&!used.has(c.id))}const card=poolCards[Math.floor(Math.random()*poolCards.length)];used.add(card.id);const instance=buildInstance(card,userId,'welcome');await createCardInstance(instance,client);created.push(publicCard(instance));}return created;}
async function registrationAllowed(ip,client){if(client){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ip]);const r=await client.query('SELECT last_created_at FROM registration_limits WHERE ip=$1',[ip]);return !r.rowCount||Date.now()-new Date(r.rows[0].last_created_at).getTime()>=72*3600_000}const last=memory.reg?.get(ip);return !last||Date.now()-last>=72*3600_000}
async function markRegistration(ip,client){if(client)await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);else memory.reg.set(ip,Date.now())}
function clientIp(req){return String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'unknown'}
async function loginStatus(ip,email){if(pool){const r=await pool.query('SELECT failed_attempts,blocked_until FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);if(!r.rowCount)return{blocked:false,attempts:0};const x=r.rows[0];return{blocked:x.blocked_until&&new Date(x.blocked_until)>new Date(),attempts:Number(x.failed_attempts)}}const x=memory.login?.get(ip+':'+email);return x?{blocked:x.blockedUntil>Date.now(),attempts:x.attempts}:{blocked:false,attempts:0}}
async function loginFailure(ip,email){if(pool){await pool.query("INSERT INTO login_limits(ip,email,failed_attempts,blocked_until,updated_at) VALUES($1,$2,1,NULL,now()) ON CONFLICT(ip,email) DO UPDATE SET failed_attempts=login_limits.failed_attempts+1,blocked_until=CASE WHEN login_limits.failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE login_limits.blocked_until END,updated_at=now()",[ip,email]);return}const key=ip+':'+email,x=memory.login?.get(key)||{attempts:0,blockedUntil:0};x.attempts++;if(x.attempts>=5)x.blockedUntil=Date.now()+15*60_000;memory.login.set(key,x)}
async function loginSuccess(ip,email){if(pool)await pool.query('DELETE FROM login_limits WHERE ip=$1 AND email=$2',[ip,email]);else memory.login?.delete(ip+':'+email)}
async function applyReward(userId,reward,client=null){const db=client||pool;if(db){const r=await db.query('UPDATE users SET coins=coins+$1,xp=xp+$2 WHERE id=$3 RETURNING *',[reward.coins||0,reward.xp||0,userId]);return r.rows[0]||null;}const user=memory.users.get(userId);if(!user)return null;user.coins+=reward.coins||0;user.xp+=reward.xp||0;return user;}
async function claimExists(userId,claimId){if(pool){const r=await pool.query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2',[userId,claimId]);return r.rowCount>0;}return memory.claims.has(`${userId}:${claimId}`);}
async function addClaim(userId,claimId,client=null){const db=client||pool;if(db){await db.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,claimId]);}else memory.claims.set(`${userId}:${claimId}`,true);}
function utcDayKey(date){return new Date(date).toISOString().slice(0,10);}
function missionProgress(mission,cards,user){if(mission.type==='cards')return cards.length;if(mission.type==='packs')return Number(user?.packs_opened||0);if(mission.type==='rarePlus')return cards.some(c=>RARITIES[c.rarity].order>=2)?1:0;return 0;}
async function claimDaily(userId){const reward={coins:150,xp:25};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(user.daily_claimed_at&&utcDayKey(user.daily_claimed_at)===utcDayKey(new Date())){await client.query('ROLLBACK');return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};}const updated=await applyReward(userId,reward,client);await client.query('UPDATE users SET daily_claimed_at=now() WHERE id=$1',[userId]);await client.query('COMMIT');return{reward,user:safeUser(updated)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=memory.users.get(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(user.dailyClaimedAt&&utcDayKey(user.dailyClaimedAt)===utcDayKey(new Date()))return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};user.coins+=reward.coins;user.xp+=reward.xp;user.dailyClaimedAt=new Date().toISOString();return{reward,user:safeUser(user)};}
async function claimMission(userId,missionId){const mission=MISSIONS.find(m=>m.id===missionId);if(!mission)return{error:'Mission introuvable.',status:404};const cards=await getUserCards(userId);const user=await getUserById(userId);const progress=Math.min(missionProgress(mission,cards,user),mission.target);if(progress<mission.target)return{error:'Mission non terminée.',status:400,progress,target:mission.target};if(await claimExists(userId,mission.id))return{error:'Mission déjà récupérée.',status:400};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,mission.id]);if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Mission déjà récupérée.',status:400};}const user=await applyReward(userId,mission.reward,client);await client.query('COMMIT');return{mission,reward:mission.reward,user:safeUser(user)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(userId,mission.id);const user=await applyReward(userId,mission.reward);return{mission,reward:mission.reward,user:safeUser(user)};}
async function openPackForUser(userId,packId){const pack=PACKS[packId];if(!pack)return{error:'Pack introuvable.',status:404};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS insuffisants.',status:400};}const drawn=drawPack(packId);await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*10,userId]);const cards=[];for(const c of drawn){const instance=buildInstance(c,userId,`pack:${pack.id}`);await createCardInstance(instance,client);cards.push(publicCard(instance));}await client.query('COMMIT');return{user:safeUser(await getUserById(userId)),cards,pack};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=await getUserById(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(Number(user.coins)<pack.price)return{error:'FOOTCOINS insuffisants.',status:400};const drawn=drawPack(packId);user.coins-=pack.price;user.xp+=pack.cards*10;const cards=[];for(const c of drawn){const instance=buildInstance(c,userId,`pack:${pack.id}`);await createCardInstance(instance);cards.push(publicCard(instance));}return{user:safeUser(user),cards,pack};}
function albumViews(owned){return ALBUM_CLUBS.map(club=>{const cards=CARD_CATALOG.filter(c=>c.club===club.name).sort((a,b)=>a.order-b.order);const own=cards.filter(c=>owned.has(c.id)).length;return{...club,cards,owned:own,total:cards.length,complete:cards.length>0&&own===cards.length};});}
async function albumData(userId){const cards=await getUserCards(userId),owned=new Set(cards.map(c=>c.cardId)),views=albumViews(owned);return{universe:'FOOTVAULT',season:'2026',cards:CARD_CATALOG,album:{clubs:views.map(v=>({id:v.id,name:v.name,tag:v.tag,cardIds:v.cards.map(c=>c.id),owned:v.owned,total:v.total,complete:v.complete})),overallOwned:views.reduce((s,v)=>s+v.owned,0),overallTotal:CARD_CATALOG.length},rewards:{clubs:await Promise.all(views.map(async v=>({club:v.name,claimed:await claimExists(userId,`album:${v.id}`)})))}};}
function staticFile(req,res){let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,path.normalize(pathname));if(!file.startsWith(ROOT)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);}

(async()=>{const db=await initDb();console.log(`SPORT VAULT startup: storage=${db.mode}`);const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,storage:pool?'postgres':'memory',universe:'FOOTVAULT',cards:CARD_CATALOG.length,packs:Object.keys(PACKS)});
 if(req.method==='GET'&&url.pathname==='/api/me'){const user=await currentUser(req);return json(res,user?200:401,user?{user:safeUser(user)}:{error:'Non connecté'});}
 if(req.method==='GET'&&url.pathname==='/api/cards')return json(res,200,{universe:'FOOTVAULT',season:'2026',cards:CARD_CATALOG});
 if(req.method==='GET'&&url.pathname==='/api/packs')return json(res,200,{universe:'FOOTVAULT',season:'2026',packs:Object.values(PACKS)});
 if(req.method==='GET'&&url.pathname==='/api/collection'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);return json(res,200,{user:safeUser(user),cards,count:cards.length});}
 if(req.method==='GET'&&url.pathname==='/api/progression'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);const level=Math.floor(Number(user.xp)/100)+1,currentXp=Number(user.xp)%100;const missions=await Promise.all(MISSIONS.map(async m=>{const progress=Math.min(missionProgress(m,cards,user),m.target);return{id:m.id,title:m.title,description:m.description,target:m.target,progress,reward:m.reward,completed:progress>=m.target,claimed:await claimExists(user.id,m.id)};}));const dailyClaimed=!!(user.daily_claimed_at&&utcDayKey(user.daily_claimed_at)===utcDayKey(new Date()));return json(res,200,{user:safeUser(user),level,currentXp,xpToNext:100,cardCount:cards.length,daily:{claimed:dailyClaimed,reward:{coins:150,xp:25}},missions});}
 if(req.method==='POST'&&url.pathname==='/api/rewards/daily'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const result=await claimDaily(user.id);return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 if(req.method==='POST'&&url.pathname==='/api/missions/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await claimMission(user.id,String(body.missionId||''));return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 if(req.method==='GET'&&url.pathname==='/api/album'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,await albumData(user.id));}
 if(req.method==='POST'&&url.pathname==='/api/album/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req),club=ALBUM_CLUBS.find(c=>c.id===String(body.clubId||''));if(!club)return json(res,404,{error:'Set introuvable.'});const data=await albumData(user.id),view=data.album.clubs.find(c=>c.id===club.id);if(!view||!view.complete)return json(res,400,{error:'Set incomplet.'});const claimId=`album:${club.id}`;if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!inserted.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:250,xp:75},client);await client.query('COMMIT');return json(res,200,{reward:{coins:250,xp:75},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:250,xp:75});return json(res,200,{reward:{coins:250,xp:75},user:safeUser(updated)});}
 if(req.method==='POST'&&url.pathname==='/api/packs/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPackForUser(user.id,String(body.packId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/register'){
  const ip=clientIp(req),body=await readBody(req),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(name.length<2||name.length>30||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'Nom, email valide et mot de passe de 8 caractères minimum requis.'});
  if(pool){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(!(await registrationAllowed(ip,client))){await client.query('ROLLBACK');return json(res,429,{error:'Création de compte limitée : une inscription est autorisée toutes les 72 heures depuis cette connexion.'});}
      const exists=await client.query('SELECT 1 FROM users WHERE email=$1',[email]);
      if(exists.rowCount){await client.query('ROLLBACK');return json(res,409,{error:'Cet email est déjà utilisé.'});}
      const id=crypto.randomUUID(),passwordHash=hashPassword(password),now=new Date();
      await client.query('INSERT INTO users(id,name,email,password_hash,coins,gems,xp,packs_opened,created_at) VALUES($1,$2,$3,$4,1000,50,0,0,$5)',[id,name,email,passwordHash,now]);
      const welcomeCards=await grantWelcomeCards(id,client);
      await client.query('INSERT INTO registration_limits(ip,last_created_at) VALUES($1,now()) ON CONFLICT(ip) DO UPDATE SET last_created_at=excluded.last_created_at',[ip]);
      const realUser=(await client.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
      const token=crypto.randomBytes(32).toString('hex');
      await client.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)',[token,id,expiryDate()]);
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
  if(!user||!verifyPassword(password,user.password_hash)){
    await loginFailure(ip,email);
    const left=Math.max(0,5-(status.attempts+1));
    return json(res,401,{error:left?'Email ou mot de passe incorrect. Il reste '+left+' tentative(s).':'Trop de tentatives incorrectes. Connexion bloquée pendant 15 minutes.'});
  }
  await loginSuccess(ip,email);
  const token=await createSession(user.id);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return json(res,200,{user:safeUser(user)});
 }
 if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
 return staticFile(req,res);
}catch(error){console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',()=>console.log(`SPORT VAULT running on ${PORT}`));})();
