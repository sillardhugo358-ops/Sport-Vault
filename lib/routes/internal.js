'use strict';

// Route interne : import de l'historique Ligue 1 (jeton HISTORICAL_IMPORT_TOKEN).
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const crypto = require('node:crypto');
const { json, readBody } = require('../http');
const { rarityFromOvr } = require('../rarity');

function createInternalRoutes({ getPool }) {
 return async function internalRoutes(req, res, url) {
if(req.method==='POST'&&url.pathname==='/api/internal/historical-import'){
 const token=process.env.HISTORICAL_IMPORT_TOKEN;
 if(!token||req.headers['x-historical-import-token']!==token)return json(res,401,{error:'Unauthorized'});
 if(!getPool())return json(res,503,{error:'Database unavailable'});
 const body=await readBody(req);
 const season=String(body.season||'').trim();
 if(!/^\d{4}-\d{4}$/.test(season)||!Array.isArray(body.cards))return json(res,400,{error:'Invalid season payload'});
 const client=await getPool().connect();
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
  return false;
 };
}

module.exports = { createInternalRoutes };
