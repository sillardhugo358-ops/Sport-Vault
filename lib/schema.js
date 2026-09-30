'use strict';

// Schéma PostgreSQL, données de départ et migrations ponctuelles, exécutés
// au démarrage du serveur.

const { RARITIES, PACKS, THEMED_PACKS, MISSIONS, PACK_WEIGHTS, DEFAULT_ACHIEVEMENTS, ALBUM_CLUBS, DAILY_TASKS, WEEKLY_TASKS } = require('./game-config');
const { RARITY_SQL } = require('./rarity');
const { NATION_FR } = require('./nations');
const { recordCoins } = require('./ledger');
const { linkLigue1History } = require('./ligue1-history');
const { seedSerieAWeek } = require('./challenges');

async function initDb(ctx){
 // Dépendances fournies par server.js ; pool et catalogue lui sont remontés
 // dès leur création (grantWelcomeCards s'en sert pendant l'initialisation).
 const {grantWelcomeCards,hashPassword,loadFootMercatoCatalog}=ctx;let pool=null;let CARD_CATALOG=ctx.getCatalog();
if(!process.env.DATABASE_URL){if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL manquante en production. FOOTVAULT refuse de démarrer sans PostgreSQL.');return{mode:'memory'}};try{const{Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:5,connectionTimeoutMillis:5000});ctx.setPool(pool);await pool.query('SELECT 1');await pool.query('CREATE TABLE IF NOT EXISTS catalog_cards(id varchar(32) PRIMARY KEY,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,jersey_number integer,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,ovr integer NOT NULL DEFAULT 72,pace integer NOT NULL DEFAULT 72,shooting integer NOT NULL DEFAULT 72,passing integer NOT NULL DEFAULT 72,dribbling integer NOT NULL DEFAULT 72,defending integer NOT NULL DEFAULT 72,physical integer NOT NULL DEFAULT 72,distribution_type varchar(20) NOT NULL DEFAULT \'STANDARD\',is_limited boolean NOT NULL DEFAULT false,max_supply integer,card_order integer NOT NULL DEFAULT 0,is_active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now())');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS jersey_number integer');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS ovr integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS pace integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS shooting integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS passing integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS dribbling integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS defending integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS physical integer NOT NULL DEFAULT 72');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS distribution_type varchar(20) NOT NULL DEFAULT \'STANDARD\'');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS is_limited boolean NOT NULL DEFAULT false');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS max_supply integer');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS card_order integer NOT NULL DEFAULT 0');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS rarity_locked boolean NOT NULL DEFAULT false');
await pool.query('ALTER TABLE catalog_cards ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()');
for(const c of CARD_CATALOG) await pool.query('INSERT INTO catalog_cards(id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$9,$9,$9,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING',[c.id,c.season,c.name,c.position,c.jerseyNumber??null,c.club,c.nation,c.rarity,c.ovr,c.distributionType,Boolean(c.isLimited),c.maxSupply,c.order]);
const catalogRows=(await pool.query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active FROM catalog_cards WHERE is_active=true ORDER BY card_order,id')).rows;
CARD_CATALOG=catalogRows.map(c=>({...c,rarityLabel:RARITIES[c.rarity]?.label||c.rarity,distributionType:c.distribution_type,isLimited:Boolean(c.is_limited),maxSupply:c.max_supply==null?null:Number(c.max_supply),ovr:Number(c.ovr),pace:Number(c.pace),shooting:Number(c.shooting),passing:Number(c.passing),dribbling:Number(c.dribbling),defending:Number(c.defending),physical:Number(c.physical),order:Number(c.card_order),jerseyNumber:c.jersey_number==null?null:Number(c.jersey_number),isActive:Boolean(c.is_active)}));ctx.setCatalog(CARD_CATALOG);await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name varchar(30) NOT NULL,email varchar(320) NOT NULL UNIQUE,password_hash text NOT NULL,coins integer NOT NULL DEFAULT 1000,gems integer NOT NULL DEFAULT 50,xp integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),daily_claimed_at timestamptz,role varchar(20) NOT NULL DEFAULT 'user')`);await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_claimed_at timestamptz');await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'user'");await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status varchar(20) NOT NULL DEFAULT 'active'");await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_until timestamptz");const configuredAdmins=String(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(configuredAdmins.length){await pool.query("UPDATE users SET role='admin' WHERE lower(email)=ANY($1::text[]) AND role<>'creator'",[configuredAdmins]);await pool.query("UPDATE users SET role='creator' WHERE lower(email)=$1",[configuredAdmins[0]]);}await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS packs_opened integer NOT NULL DEFAULT 0');await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reserved_coins integer NOT NULL DEFAULT 0');await pool.query(`CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS card_instances(instance_id uuid PRIMARY KEY,card_id varchar(32) NOT NULL,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,season varchar(12) NOT NULL,name varchar(80) NOT NULL,position varchar(8) NOT NULL,club varchar(80) NOT NULL,nation varchar(80) NOT NULL,rarity varchar(20) NOT NULL,is_limited boolean NOT NULL DEFAULT false,serial integer,max_supply integer,acquired_at timestamptz NOT NULL DEFAULT now(),source varchar(40) NOT NULL,status varchar(20) NOT NULL DEFAULT 'owned',ovr integer NOT NULL DEFAULT 72,pace integer NOT NULL DEFAULT 72,shooting integer NOT NULL DEFAULT 72,passing integer NOT NULL DEFAULT 72,dribbling integer NOT NULL DEFAULT 72,defending integer NOT NULL DEFAULT 72,physical integer NOT NULL DEFAULT 72)`);await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS jersey_number integer');await pool.query('CREATE INDEX IF NOT EXISTS card_instances_owner_idx ON card_instances(owner_id)');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS is_limited boolean NOT NULL DEFAULT false');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS ovr integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS pace integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS shooting integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS passing integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS dribbling integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS defending integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS physical integer NOT NULL DEFAULT 72');await pool.query('ALTER TABLE card_instances ALTER COLUMN serial DROP NOT NULL');await pool.query('ALTER TABLE card_instances ALTER COLUMN max_supply DROP NOT NULL');await pool.query("UPDATE card_instances SET is_limited=false,serial=NULL,max_supply=NULL WHERE is_limited=false OR is_limited IS NULL");await pool.query('ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS tradeable boolean NOT NULL DEFAULT true');await pool.query("UPDATE card_instances SET tradeable=false WHERE source='welcome'");await pool.query('CREATE TABLE IF NOT EXISTS competitions(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL,tag varchar(12) NOT NULL,country varchar(60) NOT NULL DEFAULT \'\',description text NOT NULL DEFAULT \'\',status varchar(20) NOT NULL DEFAULT \'upcoming\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('ALTER TABLE competitions ADD COLUMN IF NOT EXISTS logo_url text');await pool.query("UPDATE competitions SET logo_url='https://static.wikia.nocookie.net/logopedia/images/3/31/Ligue_1_2024.png' WHERE id='ligue-1' AND COALESCE(logo_url,'')=''");await pool.query('CREATE TABLE IF NOT EXISTS clubs(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL UNIQUE,tag varchar(12) NOT NULL,country varchar(60) NOT NULL DEFAULT \'\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_url text');await pool.query('CREATE TABLE IF NOT EXISTS competition_clubs(competition_id varchar(50) NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,club_id varchar(50) NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,position integer NOT NULL DEFAULT 0,PRIMARY KEY(competition_id,club_id))');await pool.query('CREATE TABLE IF NOT EXISTS competition_seasons(id varchar(80) PRIMARY KEY,competition_id varchar(50) NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,season varchar(12) NOT NULL,label varchar(80) NOT NULL,status varchar(20) NOT NULL DEFAULT \'upcoming\',description text NOT NULL DEFAULT \'\',sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(competition_id,season))');await pool.query('CREATE TABLE IF NOT EXISTS season_clubs(season_id varchar(80) NOT NULL REFERENCES competition_seasons(id) ON DELETE CASCADE,club_id varchar(50) NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,position integer NOT NULL DEFAULT 0,PRIMARY KEY(season_id,club_id))');const baseClubs=[['aster-fc','Aster FC','AST','France'],['racing-nord','Racing Nord','RN','France'],['union-atlantique','Union Atlantique','UA','France'],['stade-horizon','Stade Horizon','SH','France']];const clubBootstrap=(await pool.query('SELECT count(*)::int AS n FROM clubs')).rows[0];if(Number(clubBootstrap.n)===0)for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[...baseClubs[i],i]);await pool.query("INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES('ligue-1','Ligue 1','L1','France','Championnat de France','available',0) ON CONFLICT(id) DO NOTHING");await pool.query("UPDATE competitions SET logo_url='https://static.wikia.nocookie.net/logopedia/images/3/31/Ligue_1_2024.png' WHERE id='ligue-1' AND COALESCE(logo_url,'')=''");for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO competition_clubs(competition_id,club_id,position) SELECT $1,$2::varchar,$3 WHERE EXISTS (SELECT 1 FROM clubs WHERE id=$2::varchar) ON CONFLICT DO NOTHING',['ligue-1',baseClubs[i][0],i]);await pool.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,sort_order) VALUES('ligue-1-2026','ligue-1','2026','Saison 2026','available',0) ON CONFLICT(id) DO NOTHING");for(let i=0;i<baseClubs.length;i++)await pool.query('INSERT INTO season_clubs(season_id,club_id,position) SELECT $1,$2::varchar,$3 WHERE EXISTS (SELECT 1 FROM clubs WHERE id=$2::varchar) ON CONFLICT DO NOTHING',['ligue-1-2026',baseClubs[i][0],i]);const upcoming=[['premier-league','Premier League','PL','Angleterre'],['serie-a','Serie A','SA','Italie'],['bundesliga','Bundesliga','BL','Allemagne'],['la-liga','La Liga','LL','Espagne'],['ligue-des-champions','Ligue des Champions','LDC','Europe'],['coupe-du-monde','Coupe du Monde','CDM','International'],['ligue-des-nations','Ligue des Nations','LN','Europe']];for(let i=0;i<upcoming.length;i++)await pool.query('INSERT INTO competitions(id,name,tag,country,status,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[upcoming[i][0],upcoming[i][1],upcoming[i][2],upcoming[i][3],'upcoming',i+1]);for(let i=0;i<upcoming.length;i++)await pool.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,sort_order) VALUES($1,$2,'2026',$3,'upcoming',0) ON CONFLICT(id) DO NOTHING",[upcoming[i][0]+'-2026',upcoming[i][0],'Saison 2026']);await pool.query('CREATE TABLE IF NOT EXISTS card_collections(id varchar(50) PRIMARY KEY,name varchar(80) NOT NULL,tag varchar(12) NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS card_collection_cards(collection_id varchar(50) NOT NULL REFERENCES card_collections(id) ON DELETE CASCADE,card_id varchar(32) NOT NULL,position integer NOT NULL DEFAULT 0,PRIMARY KEY(collection_id,card_id))');await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''");await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0");await pool.query("ALTER TABLE card_collections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()");for(let i=0;i<ALBUM_CLUBS.length;i++){const c=ALBUM_CLUBS[i];await pool.query('INSERT INTO card_collections(id,name,tag,description,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[c.id,c.name,c.tag,'Collection de base FOOTVAULT',i]);const clubCards=CARD_CATALOG.filter(x=>x.club===c.name).sort((a,b)=>a.order-b.order);for(let position=0;position<clubCards.length;position++){const card=clubCards[position];await pool.query('INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES($1,$2,$3) ON CONFLICT(collection_id,card_id) DO UPDATE SET position=EXCLUDED.position',[c.id,card.id,position]);}}await pool.query(`CREATE TABLE IF NOT EXISTS reward_claims(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,claim_id varchar(80) NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,claim_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS achievements(id varchar(80) PRIMARY KEY,name varchar(100) NOT NULL,category varchar(50) NOT NULL,description text NOT NULL,type varchar(30) NOT NULL,target integer NOT NULL CHECK(target>0),coins integer NOT NULL DEFAULT 0,xp integer NOT NULL DEFAULT 0,icon varchar(20) NOT NULL DEFAULT '✦',active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);for(let i=0;i<DEFAULT_ACHIEVEMENTS.length;i++){const a=DEFAULT_ACHIEVEMENTS[i];await pool.query('INSERT INTO achievements(id,name,category,description,type,target,coins,xp,icon,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING',[a.id,a.name,a.category,a.description,a.type,a.target,a.coins,a.xp,a.icon,a.active,i]);}await pool.query(`CREATE TABLE IF NOT EXISTS auctions(
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
   CARD_CATALOG=freshCards;ctx.setCatalog(CARD_CATALOG);
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
// Barème des raretés : les cartes déjà hors barème (cartes spéciales, décision
// du 29/09/2026) gardent leur rareté, verrouillée ; le poste LM devient LW.
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='rarity-scale-lm-2026-09-29'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const locked=await client.query(`UPDATE catalog_cards SET rarity_locked=true WHERE rarity_locked=false AND rarity<>(${RARITY_SQL}) RETURNING id`);
  const lm=await client.query("UPDATE catalog_cards SET position='LW',updated_at=now() WHERE position='LM'");
  const lmOwned=await client.query("UPDATE card_instances SET position='LW' WHERE position='LM'");
  await client.query("INSERT INTO app_migrations(id) VALUES('rarity-scale-lm-2026-09-29')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Barème des raretés : ${locked.rowCount} carte(s) spéciale(s) verrouillée(s) (${locked.rows.map(r=>r.id).join(', ')||'aucune'}) ; poste LM → LW : ${lm.rowCount} carte(s), ${lmOwned.rowCount} exemplaire(s).`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
// Packs thématiques : un par compétition, un par décennie (demande du 30/09/2026).
// Créés une seule fois ; ensuite modifiables dans la console admin.
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='packs-competitions-decennies-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const start=Number((await client.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM pack_definitions')).rows[0].n);
  let created=0;
  for(let i=0;i<THEMED_PACKS.length;i++){const p=THEMED_PACKS[i];created+=(await client.query("INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order) VALUES($1,$2,$3,'coins',$4,$5,$6,$7,$8,NULL,$9,true,$10) ON CONFLICT(id) DO NOTHING",[p.id,p.name,p.price,p.cards,p.badge,p.description,p.guarantee,p.guaranteeCount,JSON.stringify(p.conditions),start+i])).rowCount;}
  await client.query("INSERT INTO app_migrations(id) VALUES('packs-competitions-decennies-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Packs thématiques : ${created} pack(s) créé(s).`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
// Missions en base (éditables dans la console admin), reprises une fois de MISSIONS.
// Les récompenses déjà validées (reward_claims, clé = identifiant de mission) restent valables.
await pool.query("CREATE TABLE IF NOT EXISTS missions(id varchar(80) PRIMARY KEY,title varchar(100) NOT NULL,description varchar(300) NOT NULL,type varchar(30) NOT NULL,target integer NOT NULL CHECK(target>0),prerequisite varchar(80),coins integer NOT NULL DEFAULT 0 CHECK(coins>=0),xp integer NOT NULL DEFAULT 0 CHECK(xp>=0),sort_order integer NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())");
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='missions-table-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  let created=0;
  for(const m of MISSIONS)created+=(await client.query('INSERT INTO missions(id,title,description,type,target,prerequisite,coins,xp,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) ON CONFLICT(id) DO NOTHING',[m.id,m.title,m.description,m.type,m.target,m.prerequisite||null,m.reward.coins,m.reward.xp,m.order])).rowCount;
  await client.query("INSERT INTO app_migrations(id) VALUES('missions-table-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Missions : ${created} mission(s) reprise(s) en base.`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
// Nationalités en français (CLAUDE.md) : noms anglais et codes à 3 lettres convertis
// dans le catalogue et dans les exemplaires possédés (lib/nations.js).
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='nations-fr-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const pairs=Object.entries(NATION_FR).filter(([src,fr])=>src!==fr);
  const src=pairs.map(p=>p[0]),fr=pairs.map(p=>p[1]);
  const cat=await client.query('UPDATE catalog_cards c SET nation=m.fr,updated_at=now() FROM unnest($1::text[],$2::text[]) AS m(src,fr) WHERE c.nation=m.src',[src,fr]);
  const inst=await client.query('UPDATE card_instances c SET nation=m.fr FROM unnest($1::text[],$2::text[]) AS m(src,fr) WHERE c.nation=m.src',[src,fr]);
  await client.query("INSERT INTO app_migrations(id) VALUES('nations-fr-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Nationalités en français : ${cat.rowCount} carte(s), ${inst.rowCount} exemplaire(s).`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
// Numéro de maillot des exemplaires : il n'était pas enregistré à la création (packs, bienvenue,
// dons admin) ; repris du catalogue pour le filigrane des cartes v4.
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='instances-jersey-2026-09-30'")).rowCount){
 const r=await pool.query('UPDATE card_instances ci SET jersey_number=cc.jersey_number FROM catalog_cards cc WHERE ci.card_id=cc.id AND ci.jersey_number IS NULL AND cc.jersey_number IS NOT NULL');
 await pool.query("INSERT INTO app_migrations(id) VALUES('instances-jersey-2026-09-30') ON CONFLICT DO NOTHING");
 console.log(`[FOOTVAULT] Numéros de maillot repris du catalogue : ${r.rowCount} exemplaire(s).`);
}

// Tâches quotidiennes et hebdomadaires en base (éditables dans la console admin), reprises une fois
// de DAILY_TASKS et WEEKLY_TASKS avec les mêmes identifiants : les récompenses déjà récupérées restent valables.
await pool.query("CREATE TABLE IF NOT EXISTS period_tasks(kind varchar(10) NOT NULL CHECK(kind IN ('daily','weekly')),id varchar(80) NOT NULL,title varchar(100) NOT NULL,description varchar(300) NOT NULL,type varchar(30) NOT NULL,target integer NOT NULL CHECK(target>0),coins integer NOT NULL DEFAULT 0 CHECK(coins>=0),xp integer NOT NULL DEFAULT 0 CHECK(xp>=0),sort_order integer NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,id))");
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='period-tasks-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  let created=0;
  for(const [kind,list] of [['daily',DAILY_TASKS],['weekly',WEEKLY_TASKS]])for(let i=0;i<list.length;i++){const t=list[i];created+=(await client.query('INSERT INTO period_tasks(kind,id,title,description,type,target,coins,xp,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) ON CONFLICT DO NOTHING',[kind,t.id,t.title,t.description,t.type,t.target,t.reward.coins,t.reward.xp,i])).rowCount;}
  await client.query("INSERT INTO app_migrations(id) VALUES('period-tasks-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Tâches : ${created} tâche(s) reprise(s) en base.`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

// Saisons historiques de Ligue 1 (cartes fv-h-) rattachées à l'album et aux packs, une seule fois.
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='ligue1-history-seasons-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const r=await linkLigue1History(client);
  await client.query("INSERT INTO app_migrations(id) VALUES('ligue1-history-seasons-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Ligue 1 historique : ${r.seasons} saison(s), ${r.clubs} club(s), ${r.links} rattachement(s), ${r.created} club(s) créé(s).`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

// Packs à durée limitée : visibles et ouvrables seulement entre available_from et available_until (NULL = sans limite).
await pool.query('ALTER TABLE pack_definitions ADD COLUMN IF NOT EXISTS available_from timestamptz');
await pool.query('ALTER TABLE pack_definitions ADD COLUMN IF NOT EXISTS available_until timestamptz');

// Défis thématiques (lib/challenges.js) et premier défi « Semaine Serie A » avec son pack limité.
await pool.query(`CREATE TABLE IF NOT EXISTS challenges(id varchar(80) PRIMARY KEY,title varchar(100) NOT NULL,description varchar(300) NOT NULL,type varchar(30) NOT NULL,competition_id varchar(50) REFERENCES competitions(id) ON DELETE SET NULL,pack_id varchar(64) REFERENCES pack_definitions(id) ON DELETE SET NULL,target integer NOT NULL CHECK(target>0),coins integer NOT NULL DEFAULT 0 CHECK(coins>=0),xp integer NOT NULL DEFAULT 0 CHECK(xp>=0),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at>starts_at))`);
if(!(await pool.query("SELECT 1 FROM app_migrations WHERE id='challenge-semaine-serie-a-2026-09-30'")).rowCount){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const r=await seedSerieAWeek(client);
  await client.query("INSERT INTO app_migrations(id) VALUES('challenge-semaine-serie-a-2026-09-30')");
  await client.query('COMMIT');
  console.log(`[FOOTVAULT] Défi Semaine Serie A : ${r.created?'créé ('+r.start.toISOString()+' → '+r.end.toISOString()+')':'non créé (pas de cartes de Serie A)'}.`);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

// Notifications des joueurs (lib/notifications.js).
await pool.query('CREATE TABLE IF NOT EXISTS notifications(id bigserial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind varchar(30) NOT NULL,title varchar(120) NOT NULL,body varchar(300) NOT NULL DEFAULT \'\',link varchar(120),created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz)');
await pool.query('CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at DESC)');

// Alertes de prix du marché (lib/market.js) : une par joueur et par carte du catalogue.
await pool.query('CREATE TABLE IF NOT EXISTS price_alerts(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,card_id varchar(32) NOT NULL,max_price integer NOT NULL CHECK(max_price>0),created_at timestamptz NOT NULL DEFAULT now(),last_notified_at timestamptz,PRIMARY KEY(user_id,card_id))');
await pool.query('CREATE INDEX IF NOT EXISTS price_alerts_card_idx ON price_alerts(card_id)');

// Journal des FOOTCOINS (tableau de bord économique) : une ligne par mouvement de solde.
await pool.query('CREATE TABLE IF NOT EXISTS coin_ledger(id bigserial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,amount integer NOT NULL,reason varchar(20) NOT NULL,ref varchar(120),created_at timestamptz NOT NULL DEFAULT now())');
await pool.query('CREATE INDEX IF NOT EXISTS coin_ledger_created_idx ON coin_ledger(created_at)');
await pool.query('CREATE INDEX IF NOT EXISTS coin_ledger_user_idx ON coin_ledger(user_id,created_at)');

await pool.query(`CREATE TABLE IF NOT EXISTS registration_limits(ip varchar(255) PRIMARY KEY,last_created_at timestamptz NOT NULL)`);await pool.query(`CREATE TABLE IF NOT EXISTS login_limits(ip varchar(255) NOT NULL,email varchar(320) NOT NULL,failed_attempts integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ip,email))`);// Premier compte créé en dernier : ses cartes de bienvenue exigent la table
// card_instances, créée plus haut.
if(process.env.ADMIN_BOOTSTRAP_PASSWORD&&process.env.ADMIN_EMAILS){const bootstrapEmail=String(process.env.ADMIN_EMAILS).split(',')[0].trim().toLowerCase();if(bootstrapEmail){const existing=await pool.query('SELECT id FROM users WHERE lower(email)=$1',[bootstrapEmail]);if(!existing.rowCount){const bootstrapName=String(process.env.ADMIN_BOOTSTRAP_NAME||'Hugo SILLARD').slice(0,30);const passwordHash=hashPassword(String(process.env.ADMIN_BOOTSTRAP_PASSWORD));const created=await pool.query('INSERT INTO users(id,name,email,password_hash,coins,gems,role) VALUES(gen_random_uuid(),$1,$2,$3,1000,50,\'admin\') RETURNING id',[bootstrapName,bootstrapEmail,passwordHash]);await recordCoins(pool,created.rows[0].id,1000,'signup');await grantWelcomeCards(created.rows[0].id);}}}
return{mode:'postgres'};}catch(error){console.error('SPORT VAULT database unavailable:',error.message);if(pool)await pool.end().catch(()=>{});pool=null;ctx.setPool(pool);if(process.env.NODE_ENV==='production')throw error;return{mode:'memory',error:error.message};}}

module.exports = { initDb };
