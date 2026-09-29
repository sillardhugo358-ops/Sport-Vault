const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const {Pool}=require('pg');

const ROOT=path.join(__dirname,'..');
const seedPaths=[0,1,2].map(i=>path.join(ROOT,'data','footmercato_catalog_'+i+'.b64'));

function loadCards(){
  const encoded=seedPaths.map(p=>fs.readFileSync(p,'utf8').trim()).join('');
  const seed=JSON.parse(zlib.inflateSync(Buffer.from(encoded,'base64')).toString('utf8'));
  return seed.rows.map((line,i)=>{
    const v=line.split('|');
    const club=seed.clubs[Number(v[0])],name=v[1],position=seed.positions[Number(v[2])];
    const nation=Number(v[3])<0?'':seed.nations[Number(v[3])],rarity=seed.rarities[Number(v[4])].toLowerCase(),jersey=Number(v[5]);
    return {id:'fv-ligue-1-2026-2027-'+String(i+1).padStart(3,'0'),season:'2026-2027',name,position,jersey_number:jersey<0?null:jersey,club,nation,rarity,ovr:Number(v[6]),pace:Number(v[7]),shooting:Number(v[8]),passing:Number(v[9]),dribbling:Number(v[10]),defending:Number(v[11]),physical:Number(v[12]),distribution_type:'STANDARD',is_limited:false,max_supply:null,card_order:i};
  });
}

async function ensureCompetition(client){
  let competition=(await client.query("SELECT id FROM competitions WHERE lower(name)=lower('Ligue 1') ORDER BY sort_order,id LIMIT 1")).rows[0];
  if(!competition){
    competition=(await client.query("INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES('ligue-1','Ligue 1','L1','France','Championnat de France de Ligue 1','available',0) RETURNING id")).rows[0];
  } else {
    await client.query("UPDATE competitions SET status='available',name='Ligue 1',tag='L1',country='France',updated_at=now() WHERE id=$1",[competition.id]);
  }
  let season=(await client.query("SELECT id FROM competition_seasons WHERE competition_id=$1 AND season='2026-2027' LIMIT 1",[competition.id])).rows[0];
  if(!season){
    season=(await client.query("INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,'2026-2027','2026-2027','available','Saison Ligue 1 2026-2027',0) RETURNING id",[competition.id+'-2026-2027',competition.id])).rows[0];
  } else {
    await client.query("UPDATE competition_seasons SET status='available',label='2026-2027',updated_at=now() WHERE id=$1",[season.id]);
  }
  return {competitionId:competition.id,seasonId:season.id};
}

async function ensureClubs(client,competitionId,seasonId,cards){
  const clubs=[...new Set(cards.map(c=>c.club))];
  for(let i=0;i<clubs.length;i++){
    const name=clubs[i];
    let club=(await client.query("SELECT id FROM clubs WHERE lower(name)=lower($1) ORDER BY sort_order,id LIMIT 1",[name])).rows[0];
    if(!club){
      const id=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50);
      club=(await client.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,'France',$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country='France' RETURNING id",[id,name,name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12)||'L1',i])).rows[0];
    }
    await client.query("INSERT INTO competition_clubs(club_id,competition_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[club.id,competitionId]);
    await client.query("INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[seasonId,club.id,i]);
  }
}

async function run(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquante.');
  const cards=loadCards();
  if(cards.length!==478) throw new Error('Catalogue Ligue 1 Foot Mercato invalide: '+cards.length+' cartes.');
  const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:2});
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const {competitionId,seasonId}=await ensureCompetition(client);
    await ensureClubs(client,competitionId,seasonId,cards);
    // Désactiver uniquement l'ancien catalogue 2026-2027 : ne jamais toucher aux saisons historiques fv-h-*.
    await client.query("UPDATE catalog_cards SET is_active=false,updated_at=now() WHERE season='2026-2027'");
    // Réactiver les cartes historiques déjà importées : elles ne font pas partie du sync 2026-2027.
    await client.query("UPDATE catalog_cards SET is_active=true,updated_at=now() WHERE id LIKE 'fv-h-%'");
    let synced=0;
    for(const c of cards){
      const existing=(await client.query(
        "SELECT id FROM catalog_cards WHERE season=$1 AND club=$2 AND name=$3 AND jersey_number=$4 ORDER BY updated_at DESC NULLS LAST LIMIT 1",
        [c.season,c.club,c.name,c.jersey_number]
      )).rows[0];
      const id=existing?.id||c.id;
      await client.query(`INSERT INTO catalog_cards
        (id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT(id) DO UPDATE SET
          season=excluded.season,name=excluded.name,position=excluded.position,jersey_number=excluded.jersey_number,
          club=excluded.club,nation=excluded.nation,rarity=excluded.rarity,ovr=excluded.ovr,pace=excluded.pace,
          shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,
          physical=excluded.physical,distribution_type=excluded.distribution_type,is_limited=excluded.is_limited,
          max_supply=excluded.max_supply,card_order=excluded.card_order,is_active=true,updated_at=now()`,
        [id,c.season,c.name,c.position,c.jersey_number,c.club,c.nation,c.rarity,c.ovr,c.pace,c.shooting,c.passing,c.dribbling,c.defending,c.physical,c.distribution_type,c.is_limited,c.max_supply,c.card_order,true]);
      synced++;
    }
    // Keep already-owned instances synchronized with the authoritative catalog.
    const instanceSync=await client.query(`
      UPDATE card_instances ci
      SET season=cc.season,name=cc.name,position=cc.position,jersey_number=cc.jersey_number,
          club=cc.club,nation=cc.nation,rarity=cc.rarity,ovr=cc.ovr,pace=cc.pace,
          shooting=cc.shooting,passing=cc.passing,dribbling=cc.dribbling,defending=cc.defending,physical=cc.physical
      FROM catalog_cards cc
      WHERE ci.card_id=cc.id AND cc.is_active=true
    `);
    console.log('[FOOTVAULT] '+Number(instanceSync.rowCount)+' instances existantes resynchronisées depuis le catalogue.');
    await client.query('COMMIT');
    console.log(`[FOOTVAULT] Ligue 1 2026-2027 import: ${synced} cartes synchronisées avec nationalités et postes codés.`);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();await db.end();}
}

run().catch(e=>{console.error('[FOOTVAULT] Ligue 1 import error:',e);process.exitCode=1;});