'use strict';

// Récompenses et progression : niveaux, bonus quotidien, missions, tâches
// quotidiennes et hebdomadaires, album. Chaque récompense est enregistrée dans
// reward_claims pour ne jamais être attribuée deux fois.

const { RARITIES, ALBUM_CLUBS, ALBUM_REWARDS } = require('./game-config');
const { parisDayKey, periodInfo, taskClaimId } = require('./periods');
const { recordCoins } = require('./ledger');

function createRewards({ getPool, memory, catalog, getUserById, getUserCards, publicCard, safeUser, securityEvent, listMissions, listTasks }) {
function levelProgressFromXp(value){let remaining=Math.max(0,Math.floor(Number(value)||0)),level=1,xpToNext=150;while(remaining>=xpToNext){remaining-=xpToNext;level++;xpToNext=150+40*(level-1);}return{level,currentXp:remaining,xpToNext};}
async function applyReward(userId,reward,client=null,ref=null){const db=client||getPool();if(db){const r=await db.query('UPDATE users SET coins=coins+$1,xp=xp+$2 WHERE id=$3 RETURNING *',[reward.coins||0,reward.xp||0,userId]);if(r.rows[0])await recordCoins(db,userId,reward.coins,'reward',ref);return r.rows[0]||null;}const user=memory.users.get(userId);if(!user)return null;user.coins+=reward.coins||0;user.xp+=reward.xp||0;return user;}
async function claimExists(userId,claimId){if(getPool()){const r=await getPool().query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2',[userId,claimId]);return r.rowCount>0;}return memory.claims.has(`${userId}:${claimId}`);}
async function addClaim(userId,claimId,client=null){const db=client||getPool();if(db){await db.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,claimId]);}else memory.claims.set(`${userId}:${claimId}`,true);}
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
// Prérequis retiré des missions actives : la mission n'est plus bloquée (lib/missions.js).
async function missionUnlocked(userId,mission,missions){
  if(!mission.prerequisite||!missions.some(m=>m.id===mission.prerequisite))return true;
  return claimExists(userId,mission.prerequisite);
}
async function periodActivity(userId,kind,date=new Date()){
  const period=periodInfo(kind,date);
  if(getPool()){
    const cards=(await getPool().query(
      "SELECT * FROM card_instances WHERE owner_id=$1 AND status='owned' AND source<>'welcome' AND acquired_at >= $2 AND acquired_at < $3 ORDER BY acquired_at DESC",
      [userId,period.start,period.end]
    )).rows.map(publicCard);
    const events=(await getPool().query(
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
  const tasks=await listTasks(kind);
  const task=tasks.find(t=>t.id===taskId);
  if(!task)return{error:'Tâche introuvable.',status:404};
  const activity=await periodActivity(userId,kind);
  const progress=Math.min(taskProgress(task,activity),task.target);
  if(progress<task.target)return{error:'Tâche non terminée.',status:400,progress,target:task.target};
  const claimId=taskClaimId(kind,activity.key,task.id);
  if(await claimExists(userId,claimId))return{error:'Tâche déjà récupérée pour cette période.',status:400};
  if(getPool()){
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,claimId]);
      if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Tâche déjà récupérée pour cette période.',status:400};}
      const user=await applyReward(userId,task.reward,client,claimId);
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
async function claimDaily(userId){const reward={coins:150,xp:10};if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]);const user=r.rows[0];if(!user){await client.query('ROLLBACK');return{error:'Utilisateur introuvable.',status:404};}if(user.daily_claimed_at&&parisDayKey(user.daily_claimed_at)===parisDayKey(new Date())){await client.query('ROLLBACK');return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};}const updated=await applyReward(userId,reward,client,'daily');await client.query('UPDATE users SET daily_claimed_at=now() WHERE id=$1',[userId]);await securityEvent(userId,null,'daily_reward_claim',{coins:reward.coins,xp:reward.xp},client);await client.query('COMMIT');return{reward,user:safeUser(updated)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}const user=memory.users.get(userId);if(!user)return{error:'Utilisateur introuvable.',status:404};if(user.dailyClaimedAt&&parisDayKey(user.dailyClaimedAt)===parisDayKey(new Date()))return{error:'Récompense quotidienne déjà récupérée.',status:400,user:safeUser(user)};user.coins+=reward.coins;user.xp+=reward.xp;user.dailyClaimedAt=new Date().toISOString();return{reward,user:safeUser(user)};}
async function claimMission(userId,missionId){
  const missions=await listMissions();
  const mission=missions.find(m=>m.id===missionId);
  if(!mission)return{error:'Mission introuvable.',status:404};
  if(!(await missionUnlocked(userId,mission,missions)))return{error:'Cette mission est encore verrouillée.',status:403};
  const cards=await getUserCards(userId);
  const missionUser=await getUserById(userId);
  const progress=Math.min(missionProgress(mission,cards,missionUser),mission.target);
  if(progress<mission.target)return{error:'Mission non terminée.',status:400,progress,target:mission.target};
  if(await claimExists(userId,mission.id))return{error:'Mission déjà récupérée.',status:400};if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[userId,mission.id]);if(!inserted.rowCount){await client.query('ROLLBACK');return{error:'Mission déjà récupérée.',status:400};}const user=await applyReward(userId,mission.reward,client,'mission:'+mission.id);await securityEvent(userId,null,'mission_reward_claim',{missionId:mission.id,coins:mission.reward.coins,xp:mission.reward.xp},client);await client.query('COMMIT');return{mission,reward:mission.reward,user:safeUser(user)};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(userId,mission.id);const user=await applyReward(userId,mission.reward);return{mission,reward:mission.reward,user:safeUser(user)};}
async function albumViews(owned,selectedSeasonId=null,userId=null){
 if(getPool()){
  const [comps,seasons,links,counts]=await Promise.all([
   getPool().query('SELECT id,name,tag,country,description,status,sort_order,logo_url FROM competitions ORDER BY sort_order,id'),
   getPool().query('SELECT id,competition_id,season,label,status,description,sort_order FROM competition_seasons ORDER BY competition_id,sort_order,season DESC'),
   getPool().query('SELECT sc.season_id,c.id,c.name,c.tag,c.country,c.logo_url,c.sort_order FROM season_clubs sc JOIN clubs c ON c.id=sc.club_id ORDER BY sc.season_id,sc.position,c.sort_order'),
   getPool().query(`SELECT cc.season,cc.club,COUNT(DISTINCT cc.id)::int AS total,
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
  const selectedRows=selectedSeason?(await getPool().query('SELECT id,season,name,position,jersey_number,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order FROM catalog_cards WHERE is_active=true AND season=$1 ORDER BY card_order,id',[selectedSeason])).rows:[];
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
 return [{id:'ligue-1',name:'Ligue 1',tag:'L1',country:'France',status:'available',seasons:[{id:'ligue-1-2026',competition_id:'ligue-1',season:'2026',label:'Saison 2026',status:'available',clubs:ALBUM_CLUBS.map(club=>{const cards=catalog().filter(c=>c.club===club.name&&String(c.season)==='2026');const own=cards.filter(c=>owned.has(c.id)).length;return{...club,cards,owned:own,total:cards.length,complete:cards.length>0&&own===cards.length};})}]}];
}
// Complétion par saison et par championnat. Seuls comptent les clubs qui ont des cartes au catalogue :
// une saison est complète quand tous ses clubs le sont, un championnat quand toutes ses saisons le sont.
function annotateAlbumCompletion(competitions,claimedIds){
 for(const c of competitions){
  let seasonsCounted=0,seasonsComplete=0;
  for(const s of c.seasons){
   const counted=(s.clubs||[]).filter(cl=>cl.total>0),done=counted.filter(cl=>cl.complete).length;
   const complete=counted.length>0&&done===counted.length;
   s.completion={clubs:counted.length,completeClubs:done,complete,claimed:claimedIds.has('album-season:'+s.id),reward:ALBUM_REWARDS.season};
   if(counted.length){seasonsCounted++;if(complete)seasonsComplete++;}
  }
  c.completion={seasons:seasonsCounted,completeSeasons:seasonsComplete,complete:seasonsCounted>0&&seasonsComplete===seasonsCounted,claimed:claimedIds.has('album-competition:'+c.id),reward:ALBUM_REWARDS.competition};
 }
 return competitions;
}
async function albumData(userId,selectedSeasonId=null){
 const cards=await getUserCards(userId),owned=new Set(cards.map(c=>c.cardId));
 const competitions=await albumViews(owned,selectedSeasonId,userId);
 const allClubs=competitions.flatMap(c=>c.seasons.flatMap(season=>season.clubs.map(v=>({...v,seasonId:season.id,season:season.season,competitionId:c.id}))));
 let claimedIds=new Set();
 if(getPool()){
  const claims=(await getPool().query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'album%'",[userId])).rows;
  claimedIds=new Set(claims.map(x=>x.claim_id));
 }else{
  for(const v of allClubs){const id='album:'+v.seasonId+':'+v.id;if(await claimExists(userId,id))claimedIds.add(id);}
  for(const c of competitions){for(const s of c.seasons){const id='album-season:'+s.id;if(await claimExists(userId,id))claimedIds.add(id);}const id='album-competition:'+c.id;if(await claimExists(userId,id))claimedIds.add(id);}
 }
 annotateAlbumCompletion(competitions,claimedIds);
 return{universe:'FOOTVAULT',season:'2026',album:{competitions,overallOwned:allClubs.reduce((s,c)=>s+c.owned,0),overallTotal:allClubs.reduce((s,c)=>s+c.total,0)},rewards:{amounts:ALBUM_REWARDS,clubs:allClubs.map(v=>({seasonId:v.seasonId,clubId:v.id,club:v.name,claimed:claimedIds.has('album:'+v.seasonId+':'+v.id)}))}};
}

return { levelProgressFromXp, applyReward, claimExists, addClaim, missionProgress, missionUnlocked, periodActivity, taskProgress, claimTask, claimDaily, claimMission, albumViews, albumData };
}

module.exports = { createRewards };
