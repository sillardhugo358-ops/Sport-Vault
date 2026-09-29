'use strict';

// Progression : succès, missions, tâches, bonus quotidien, album.
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');
const { DAILY_TASKS, DEFAULT_ACHIEVEMENTS, RARITIES, WEEKLY_TASKS } = require('../game-config');
const { parisDayKey, taskClaimId } = require('../periods');

function createRewardsRoutes({ addClaim, albumData, applyReward, claimDaily, claimExists, claimMission, claimTask, currentUser, getPool, getUserById, getUserCards, levelProgressFromXp, missionProgress, periodActivity, safeUser, securityEvent, taskProgress, listMissions, isMissionUnlocked }) {
 return async function rewardsRoutes(req, res, url) {
if(req.method==='GET'&&url.pathname==='/api/achievements'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id),all=getPool()?(await getPool().query('SELECT * FROM achievements WHERE active=true ORDER BY sort_order,id')).rows:DEFAULT_ACHIEVEMENTS.filter(x=>x.active);
  const stats={cards:cards.length,packs:Number(user.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};
  const achievements=await Promise.all(all.map(async x=>({id:x.id,name:x.name,category:x.category,description:x.description,type:x.type,target:Number(x.target),progress:Math.min(Number(stats[x.type]||0),Number(x.target)),coins:Number(x.coins||0),xp:Number(x.xp||0),icon:x.icon||'✦',claimed:await claimExists(user.id,'achievement:'+x.id),completed:Number(stats[x.type]||0)>=Number(x.target)})));return json(res,200,{achievements,cardCount:cards.length});
 }
if(req.method==='POST'&&url.pathname==='/api/achievements/claim'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const b=await readBody(req),id=String(b.id||''),ach=getPool()?(await getPool().query('SELECT * FROM achievements WHERE id=$1 AND active=true',[id])).rows[0]:DEFAULT_ACHIEVEMENTS.find(x=>x.id===id&&x.active);if(!ach)return json(res,404,{error:'Succès introuvable.'});
  const cards=await getUserCards(user.id),u=await getUserById(user.id),stats={cards:cards.length,packs:Number(u.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};if(Number(stats[ach.type]||0)<Number(ach.target))return json(res,400,{error:'Succès non terminé.'});
  const claimId='achievement:'+ach.id;if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const ins=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!ins.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},client);await securityEvent(user.id,null,'achievement_claim',{achievementId:ach.id},client);await client.query('COMMIT');return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)});return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});
 }
if(req.method==='GET'&&url.pathname==='/api/progression'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  const cards=await getUserCards(user.id);
  const {level,currentXp,xpToNext}=levelProgressFromXp(user.xp);
  const claimedIds=new Set();
  const missions=await listMissions(),activeIds=new Set(missions.map(m=>m.id));
  for(const m of missions)if(await claimExists(user.id,m.id))claimedIds.add(m.id);
  const active=[],completed=[];
  for(const m of missions){
    const claimed=claimedIds.has(m.id);
    const unlocked=isMissionUnlocked(m,activeIds,claimedIds);
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
if(req.method==='GET'&&url.pathname==='/api/album'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,await albumData(user.id,url.searchParams.get('seasonId')||null));}
if(req.method==='POST'&&url.pathname==='/api/album/claim'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req),clubId=String(body.clubId||''),seasonId=String(body.seasonId||''),data=await albumData(user.id),view=data.album.competitions.flatMap(c=>c.seasons.flatMap(s=>s.clubs.map(v=>({...v,seasonId:s.id,season:s.season,competitionId:c.id})))).find(c=>c.id===clubId&&c.seasonId===seasonId);if(!view)return json(res,404,{error:'Set introuvable.'});if(!view.complete)return json(res,400,{error:'Set incomplet.'});const claimId='album:'+seasonId+':'+clubId;if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!inserted.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:250,xp:25},client);await client.query('COMMIT');return json(res,200,{reward:{coins:250,xp:25},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:250,xp:25});return json(res,200,{reward:{coins:250,xp:25},user:safeUser(updated)});}
  return false;
 };
}

module.exports = { createRewardsRoutes };
