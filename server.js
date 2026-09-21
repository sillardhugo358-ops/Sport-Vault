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
function safeUser(user){const coins=Number(user.coins||0),reservedCoins=Number(user.reserved_coins||0);return{id:user.id,name:user.name,email:user.email,role:user.role||'user',coins,gems:Number(user.gems),xp:Number(user.xp),reservedCoins,availableCoins:Math.max(0,coins-reservedCoins),createdAt:user.createdAt||user.created_at,dailyClaimedAt:user.daily_claimed_at||user.dailyClaimedAt||null};}
function sessionCookie(token){return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}`;}
function expiryDate(){return new Date(Date.now()+SESSION_DAYS*86400_000);}
function publicCard(card){return{instanceId:card.instance_id||card.instanceId,cardId:card.card_id||card.cardId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,rarityLabel:RARITIES[card.rarity]?.label||card.rarity,serial:Number(card.serial),maxSupply:Number(card.max_supply||card.maxSupply),serialLabel:`${Number(card.serial)}/${Number(card.max_supply||card.maxSupply)}`,acquiredAt:card.acquired_at||card.acquiredAt,source:card.source};}
function buildInstance(card,ownerId,source='welcome'){const rarity=RARITIES[card.rarity];return{instanceId:crypto.randomUUID(),cardId:card.id,ownerId,season:card.season,name:card.name,position:card.position,club:card.club,nation:card.nation,rarity:card.rarity,serial:Math.floor(Math.random()*rarity.supply)+1,maxSupply:rarity.supply,acquiredAt:new Date().toISOString(),source,status:'owned'};}
function weightedRarity(){const total=PACK_WEIGHTS.reduce((s,[,w])=>s+w,0);let roll=Math.random()*total;for(const[rarity,w]of PACK_WEIGHTS){roll-=w;if(roll<=0)return rarity;}return'common';}
function rarityAtLeast(a,b){return RARITIES[a].order>=RARITIES[b].order;}
function drawPack(packId){const pack=PACKS[packId];if(!pack)throw new Error('Pack introuvable');const drawn=[],used=new Set();const guaranteedIndex=Math.floor(Math.random()*pack.cards);for(let i=0;i<pack.cards;i++){const available=CARD_CATALOG.filter(c=>!used.has(c.id));let candidates=i===guaranteedIndex?available.filter(c=>rarityAtLeast(c.rarity,pack.guarantee)):available;if(!candidates.length)candidates=available;const target=i===guaranteedIndex?pack.guarantee:weightedRarity();let same=candidates.filter(c=>c.rarity===target);if(!same.length)same=candidates;const card=same[Math.floor(Math.random()*same.length)];used.add(card.id);drawn.push(card);}return drawn;}

async function initDb(){if(!process.env.DATABASE_URL){if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL manquante en production. FOOTVAULT refuse de démarrer sans PostgreSQL.');return{mode:'memory'}};try{const{Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:5,connectionTimeoutMillis:5000});await pool.query('SELECT 1');await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name varchar(30) NOT NULL,email varchar(320) NOT NULL UNIQUE,password_hash text NOT NULL,coins integer NOT NULL DEFAULT 1000,gems integer NOT NULL DEFAULT 50,xp integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),daily_claimed_at timestamptz,role varchar(20) NOT NULL DEFAULT 'user')`);await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_claimed_at timestamptz');await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'user'");await pool.query("UPDATE users SET role='admin' WHERE lower(email)=ANY(string_to_array(lower(COALESCE($1,'')),','))",[process.env.ADMIN_EMAILS||'']);if(process.env.ADMIN_BOOTSTRAP_PASSWORD&&process.env.ADMIN_EMAILS){const bootstrapEmail=String(process.env.ADMIN_EMAILS).split(',')[0].trim().toLowerCase();if(bootstrapEmail){const existing=await pool.query('SELECT id FROM users WHERE lower(email)=$1',[bootstrapEmail]);if(!existing.rowCount){const bootstrapName=String(process.env.ADMIN_BOOTSTRAP_NAME||'Hugo SILLARD').slice(0,30);const passwordHash=hashPassword(String(process.env.ADMIN_BOOTSTRAP_PASSWORD));const created=await pool.query('INSERT INTO users(id,name,email,password_hash,coins,gems,role) VALUES(gen_random_uuid(),$1,$2,$3,1000,50,\'admin\') RETURNING id',[bootstrapName,bootstrapEmail,passwordHash]);await grantWelcomeCards(created.rows[0].id);}}}await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS packs_opened integer NOT NULL DEFAULT 0');await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reserved_coins integer NOT NULL DEFAULT 0');await pool.query(`CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS card_instances(instance_id uuid PRIMARY KEY,card_id varchar(32) NOT NULL,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,serial integer NOT NULL,max_supply integer NOT NULL,acquired_at timestamptz NOT NULL DEFAULT now(),source varchar(40) NOT NULL,status varchar(20) NOT NULL DEFAULT 'owned')`);await pool.query('CREATE INDEX IF NOT EXISTS card_instances_owner_idx ON card_instances(owner_id)');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS tradeable boolean NOT NULL DEFAULT true');await pool.query("UPDATE card_instances SET tradeable=false WHERE source='welcome'");await pool.query(`CREATE TABLE IF NOT EXISTS reward_claims(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,claim_id varchar(80) NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,claim_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS auctions(
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
await pool.query('CREATE INDEX IF NOT EXISTS auction_bids_auction_idx ON auction_bids(auction_id,created_at DESC)');
await pool.query(`CREATE TABLE IF NOT EXISTS registration_limits(ip varchar(255) PRIMARY KEY,last_created_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS login_limits(ip varchar(255) NOT NULL,email varchar(320) NOT NULL,failed_attempts integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ip,email))`);return{mode:'postgres'};}catch(error){console.error('SPORT VAULT database unavailable:',error.message);if(pool)await pool.end().catch(()=>{});pool=null;if(process.env.NODE_ENV==='production')throw error;return{mode:'memory',error:error.message};}}
async function findUserByEmail(email){if(pool){const r=await pool.query('SELECT * FROM users WHERE email=$1',[email]);return r.rows[0]||null;}for(const u of memory.users.values())if(u.email===email)return u;return null;}
async function getUserById(id){if(pool){const r=await pool.query('SELECT * FROM users WHERE id=$1',[id]);return r.rows[0]||null;}return memory.users.get(id)||null;}
function isAdmin(user){return !!user&&user.role==='admin'}
async function requireAdmin(req){const user=await currentUser(req);return user&&isAdmin(user)?user:null}
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
 const u=(await pool.query('SELECT id,name,email,role,coins,reserved_coins,gems,xp,packs_opened,created_at FROM users WHERE id=$1',[userId])).rows[0];
 if(!u)return{error:'Utilisateur introuvable.',status:404};
 const cards=(await pool.query("SELECT instance_id,card_id,name,club,nation,rarity,serial,max_supply,source,status,acquired_at FROM card_instances WHERE owner_id=$1 ORDER BY acquired_at DESC",[userId])).rows;
 const sales=(await pool.query("SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.completed_at,c.name AS card_name,c.rarity,c.serial FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.seller_id=$1 ORDER BY a.created_at DESC LIMIT 30",[userId])).rows;
 const bids=(await pool.query("SELECT b.auction_id,b.amount,b.created_at,c.name AS card_name,a.status FROM auction_bids b JOIN auctions a ON a.id=b.auction_id JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE b.bidder_id=$1 ORDER BY b.created_at DESC LIMIT 30",[userId])).rows;
 return {...safeUser(u),packsOpened:Number(u.packs_opened||0),createdAt:u.created_at,cards,sales,bids};
}
async function adminAuctions(){
 const r=await pool.query(`SELECT a.id,a.status,a.starting_bid,a.current_bid,a.starts_at,a.ends_at,a.created_at,a.completed_at,
 c.name AS card_name,c.rarity,c.serial,c.max_supply,u.name AS seller_name,ub.name AS bidder_name,
 (SELECT count(*) FROM auction_bids b WHERE b.auction_id=a.id)::int AS bid_count
 FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id JOIN users u ON u.id=a.seller_id LEFT JOIN users ub ON ub.id=a.current_bidder_id
 ORDER BY COALESCE(a.completed_at,a.ends_at) DESC LIMIT 100`);
 return r.rows;
}
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
async function claimMission(userId,missionId){const mission=MISSIONS.find(m=>m.id===missionId);if(!mission)return{error:'Mission introuvable.',status:404};const cards=await getUserCards(userId);const missionUser=await getUserById(userId);const progress=Math.min(missionProgress(mission,cards,missionUser),mission.target);if(progress<mission.target)return{error:'Mission non terminée.',status:400,progress,target:mission.target};if(await claimExists(userId,mission.id))return{error:'Mission déjà récupérée.',status:400};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,mission.id]);if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Mission déjà récupérée.',status:400};}const user=await applyReward(userId,mission.reward,client);await client.query('COMMIT');return{mission,reward:mission.reward,user:safeUser(user)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(userId,mission.id);const user=await applyReward(userId,mission.reward);return{mission,reward:mission.reward,user:safeUser(user)};}
async function openPackForUser(userId,packId){const pack=PACKS[packId];if(!pack)return{error:'Pack introuvable.',status:404};if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price){await client.query('ROLLBACK');return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};}const drawn=drawPack(packId);await client.query('UPDATE users SET coins=coins-$1,xp=xp+$2,packs_opened=packs_opened+1 WHERE id=$3',[pack.price,pack.cards*10,userId]);const cards=[];for(const c of drawn){const instance=buildInstance(c,userId,`pack:${pack.id}`);await createCardInstance(instance,client);cards.push(publicCard(instance));}await client.query('COMMIT');return{user:safeUser(await getUserById(userId)),cards,pack};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=await getUserById(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(Number(user.coins)-Number(user.reserved_coins||0)<pack.price)return{error:'FOOTCOINS disponibles insuffisants : une partie de tes FC est réservée par une enchère.',status:400};const drawn=drawPack(packId);user.coins-=pack.price;user.xp+=pack.cards*10;const cards=[];for(const c of drawn){const instance=buildInstance(c,userId,`pack:${pack.id}`);await createCardInstance(instance);cards.push(publicCard(instance));}return{user:safeUser(user),cards,pack};}
function albumViews(owned){return ALBUM_CLUBS.map(club=>{const cards=CARD_CATALOG.filter(c=>c.club===club.name).sort((a,b)=>a.order-b.order);const own=cards.filter(c=>owned.has(c.id)).length;return{...club,cards,owned:own,total:cards.length,complete:cards.length>0&&own===cards.length};});}
async function albumData(userId){const cards=await getUserCards(userId),owned=new Set(cards.map(c=>c.cardId)),views=albumViews(owned);return{universe:'FOOTVAULT',season:'2026',cards:CARD_CATALOG,album:{clubs:views.map(v=>({id:v.id,name:v.name,tag:v.tag,cardIds:v.cards.map(c=>c.id),owned:v.owned,total:v.total,complete:v.complete})),overallOwned:views.reduce((s,v)=>s+v.owned,0),overallTotal:CARD_CATALOG.length},rewards:{clubs:await Promise.all(views.map(async v=>({club:v.name,claimed:await claimExists(userId,`album:${v.id}`)})))}};}
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
 const r=await pool.query(`SELECT a.*,c.card_id,c.name,c.position,c.club,c.nation,c.rarity,c.season,c.serial,c.max_supply,c.source,
   u.name AS seller_name,ub.name AS bidder_name,
   (SELECT count(*) FROM auction_bids ab WHERE ab.auction_id=a.id) AS bid_count,
   (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY aa.current_bid) FROM auctions aa JOIN card_instances cc ON cc.instance_id=aa.card_instance_id WHERE aa.status='completed' AND cc.card_id=c.card_id) AS reference_median
   FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
   JOIN users u ON u.id=a.seller_id
   LEFT JOIN users ub ON ub.id=a.current_bidder_id
   WHERE a.status='active' AND a.ends_at>now() ORDER BY a.ends_at ASC`);
 return r.rows.map(x=>({...auctionPublic(x),sellerName:x.seller_name,currentBidderName:x.bidder_name||null,bidCount:Number(x.bid_count||0),referencePrice:x.reference_median===null?null:Math.round(Number(x.reference_median)),isCurrentUserBidder:!!viewerId&&x.current_bidder_id===viewerId,card:publicCard(x)}));
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
  const activeCount=Number((await client.query("SELECT count(DISTINCT auction_id) AS n FROM auction_bids b JOIN auctions a ON a.id=b.auction_id WHERE b.bidder_id=$1 AND a.status='active' AND a.ends_at>now()",[userId])).rows[0].n);
  if(activeCount>=10){await client.query('ROLLBACK');return{error:'Limite atteinte : 10 enchères actives maximum.',status:400};}
  const id=crypto.randomUUID(),ends=new Date(Date.now()+auctionDurationMs(mins));
  await client.query("UPDATE card_instances SET status='auction' WHERE instance_id=$1",[cardInstanceId]);
  await client.query("INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,starts_at,ends_at) VALUES($1,$2,$3,$4,$4,now(),$5)",[id,cardInstanceId,userId,bid,ends]);
  await client.query('COMMIT');
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
  await client.query('UPDATE auctions SET current_bid=$1,current_bidder_id=$2,ends_at=$3 WHERE id=$4',[bid,userId,ends]);
  await client.query('COMMIT');
  return{auction:{id:a.id,currentBid:bid,currentBidderId:userId,endsAt:ends.toISOString()}};
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
  await client.query('COMMIT');
  return{ok:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function auctionBidHistory(auctionId){
 const r=await pool.query("SELECT b.amount,b.created_at,u.name AS bidder_name FROM auction_bids b JOIN users u ON u.id=b.bidder_id WHERE b.auction_id=$1 ORDER BY b.created_at DESC LIMIT 100",[auctionId]);
 return r.rows.map(x=>({amount:Number(x.amount),createdAt:x.created_at,bidderName:x.bidder_name}));
}

function staticFile(req,res){let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,path.normalize(pathname));if(!file.startsWith(ROOT)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);}

(async()=>{const db=await initDb();console.log(`SPORT VAULT startup: storage=${db.mode}`);const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,storage:pool?'postgres':'memory',universe:'FOOTVAULT',cards:CARD_CATALOG.length,packs:Object.keys(PACKS)});
 if(req.method==='GET'&&url.pathname==='/api/auctions'){const user=await currentUser(req);const auctions=await auctionData(user?.id||null);return json(res,200,{auctions,user:user?safeUser(user):null});}
 if(req.method==='GET'&&url.pathname==='/api/auctions/history'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,{auctions:await auctionHistory(user.id)});}
 if(req.method==='GET'&&url.pathname==='/api/auctions/:id'){return json(res,404,{error:'Not found'});}
 if(req.method==='GET'&&url.pathname==='/api/auctions'){return json(res,200,{auctions:await auctionData()});}
 if(req.method==='POST'&&url.pathname==='/api/auctions/create'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await createAuction(user.id,String(body.cardInstanceId||''),body.startingBid,body.duration);return json(res,result.error?result.status||400:201,result);}
 if(req.method==='POST'&&url.pathname==='/api/auctions/bid'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await placeAuctionBid(user.id,String(body.auctionId||''),body.amount);return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/auctions/cancel'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await cancelAuction(user.id,String(body.auctionId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='GET'&&url.pathname.startsWith('/api/auctions/')&&url.pathname.endsWith('/bids')){const id=url.pathname.split('/')[3];return json(res,200,{bids:await auctionBidHistory(id)});}
 if(req.method==='GET'&&url.pathname==='/api/admin/overview'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{admin:safeUser(admin),overview:await adminOverview()});}
 if(req.method==='GET'&&url.pathname==='/api/admin/users'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{users:await adminUsers(url.searchParams.get('q')||'')});}
 if(req.method==='GET'&&url.pathname.startsWith('/api/admin/users/')){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});const id=url.pathname.split('/').pop();const detail=await adminUserDetail(id);return json(res,detail.error?detail.status||404:200,detail.error?detail:{user:detail});}
 if(req.method==='GET'&&url.pathname==='/api/admin/auctions'){const admin=await requireAdmin(req);if(!admin)return json(res,403,{error:'Accès administrateur requis.'});return json(res,200,{auctions:await adminAuctions()});}
 if(req.method==='GET'&&url.pathname==='/api/me'){const user=await currentUser(req);return json(res,user?200:401,user?{user:safeUser(user)}:{error:'Non connecté'});}
 if(req.method==='GET'&&url.pathname==='/api/cards')return json(res,200,{universe:'FOOTVAULT',season:'2026',cards:CARD_CATALOG});
 if(req.method==='GET'&&url.pathname==='/api/packs')return json(res,200,{universe:'FOOTVAULT',season:'2026',packs:Object.values(PACKS)});
 if(req.method==='GET'&&url.pathname==='/api/collection'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);return json(res,200,{user:safeUser(user),cards,count:cards.length});}
 if(req.method==='GET'&&url.pathname==='/api/progression'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id);const level=Math.floor(Number(user.xp)/100)+1,currentXp=Number(user.xp)%100;const missions=await Promise.all(MISSIONS.map(async m=>{const progress=Math.min(missionProgress(m,cards,user),m.target);return{id:m.id,title:m.title,description:m.description,target:m.target,progress,reward:m.reward,completed:progress>=m.target,claimed:await claimExists(user.id,m.id)};}));const dailyClaimed=!!(user.daily_claimed_at&&utcDayKey(user.daily_claimed_at)===utcDayKey(new Date()));return json(res,200,{user:safeUser(user),level,currentXp,xpToNext:100,cardCount:cards.length,daily:{claimed:dailyClaimed,reward:{coins:150,xp:25}},missions});}
 if(req.method==='POST'&&url.pathname==='/api/rewards/daily'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const result=await claimDaily(user.id);return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 if(req.method==='POST'&&url.pathname==='/api/missions/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await claimMission(user.id,String(body.missionId||''));return json(res,result.error?result.status||400:200,result.error?result:{ok:true,...result});}
 if(req.method==='GET'&&url.pathname==='/api/album'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,await albumData(user.id));}
 if(req.method==='POST'&&url.pathname==='/api/album/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req),club=ALBUM_CLUBS.find(c=>c.id===String(body.clubId||''));if(!club)return json(res,404,{error:'Set introuvable.'});const data=await albumData(user.id),view=data.album.clubs.find(c=>c.id===club.id);if(!view||!view.complete)return json(res,400,{error:'Set incomplet.'});const claimId=`album:${club.id}`;if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});if(pool){const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!inserted.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:250,xp:75},client);await client.query('COMMIT');return json(res,200,{reward:{coins:250,xp:75},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:250,xp:75});return json(res,200,{reward:{coins:250,xp:75},user:safeUser(updated)});}
 if(req.method==='POST'&&url.pathname==='/api/logout'){await destroySession(req,res);return json(res,200,{ok:true});}
 if(req.method==='POST'&&url.pathname==='/api/packs/open'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await openPackForUser(user.id,String(body.packId||''));return json(res,result.error?result.status||400:200,result);}
 if(req.method==='POST'&&url.pathname==='/api/register'){
  const ip=clientIp(req),body=await readBody(req),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(name.length<2||name.length>30||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'Nom, email valide et mot de passe de 8 caractères minimum requis.'});
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
}catch(error){console.error('SPORT VAULT request error:',error);return json(res,500,{error:'Erreur serveur.'});}});const shutdown=async()=>{if(pool)await pool.end().catch(()=>{});server.close(()=>process.exit(0));};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);server.listen(PORT,'0.0.0.0',()=>{console.log(`SPORT VAULT running on ${PORT}`);if(pool)setInterval(settleExpiredAuctions,30_000);});})();
