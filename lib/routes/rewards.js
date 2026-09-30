'use strict';

// Progression : succès, missions, tâches, bonus quotidien, album.
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');
const { DEFAULT_ACHIEVEMENTS, RARITIES, ALBUM_REWARDS } = require('../game-config');
const { parisDayKey, taskClaimId } = require('../periods');

function createRewardsRoutes({ leaderboard, playerProfile, listNotifications, markNotificationsRead, listTasks, addClaim, albumData, applyReward, claimDaily, claimExists, claimMission, claimTask, currentUser, getPool, getUserById, getUserCards, levelProgressFromXp, missionProgress, periodActivity, safeUser, securityEvent, taskProgress, listMissions, isMissionUnlocked }) {
async function progressionData(user){
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
  const [dailyList,weeklyList]=await Promise.all([listTasks('daily'),listTasks('weekly')]);
  const dailyTasks=await Promise.all(dailyList.map(async t=>{const progress=Math.min(taskProgress(t,dailyActivity),t.target),claimed=await claimExists(user.id,taskClaimId('daily',dailyActivity.key,t.id));return{...t,progress,completed:progress>=t.target,claimed,period:dailyActivity.key};}));
  const weeklyTasks=await Promise.all(weeklyList.map(async t=>{const progress=Math.min(taskProgress(t,weeklyActivity),t.target),claimed=await claimExists(user.id,taskClaimId('weekly',weeklyActivity.key,t.id));return{...t,progress,completed:progress>=t.target,claimed,period:weeklyActivity.key};}));
  return({user:safeUser(user),level,currentXp,xpToNext,cardCount:cards.length,daily:{claimed:dailyClaimed,reward:{coins:150,xp:10}},dailyTasks,weeklyTasks,missions:active,completedMissions:completed});
}
 return async function rewardsRoutes(req, res, url) {
if(req.method==='GET'&&url.pathname==='/api/achievements'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const cards=await getUserCards(user.id),all=getPool()?(await getPool().query('SELECT * FROM achievements WHERE active=true ORDER BY sort_order,id')).rows:DEFAULT_ACHIEVEMENTS.filter(x=>x.active);
  const stats={cards:cards.length,packs:Number(user.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};
  const achievements=await Promise.all(all.map(async x=>({id:x.id,name:x.name,category:x.category,description:x.description,type:x.type,target:Number(x.target),progress:Math.min(Number(stats[x.type]||0),Number(x.target)),coins:Number(x.coins||0),xp:Number(x.xp||0),icon:x.icon||'✦',claimed:await claimExists(user.id,'achievement:'+x.id),completed:Number(stats[x.type]||0)>=Number(x.target)})));return json(res,200,{achievements,cardCount:cards.length});
 }
if(req.method==='POST'&&url.pathname==='/api/achievements/claim'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const b=await readBody(req),id=String(b.id||''),ach=getPool()?(await getPool().query('SELECT * FROM achievements WHERE id=$1 AND active=true',[id])).rows[0]:DEFAULT_ACHIEVEMENTS.find(x=>x.id===id&&x.active);if(!ach)return json(res,404,{error:'Succès introuvable.'});
  const cards=await getUserCards(user.id),u=await getUserById(user.id),stats={cards:cards.length,packs:Number(u.packs_opened||0),rarePlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=2)?1:0,epicPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=3)?1:0,legendaryPlus:cards.some(c=>Number(RARITIES[c.rarity]?.order||0)>=4)?1:0,iconPlus:cards.some(c=>c.rarity==='icon')?1:0,distinctClubs:new Set(cards.map(c=>c.club).filter(Boolean)).size};if(Number(stats[ach.type]||0)<Number(ach.target))return json(res,400,{error:'Succès non terminé.'});
  const claimId='achievement:'+ach.id;if(getPool()){const client=await getPool().connect();try{await client.query('BEGIN');const ins=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);if(!ins.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},client,claimId);await securityEvent(user.id,null,'achievement_claim',{achievementId:ach.id},client);await client.query('COMMIT');return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});await addClaim(user.id,claimId);const updated=await applyReward(user.id,{coins:Number(ach.coins||0),xp:Number(ach.xp||0)});return json(res,200,{ok:true,reward:{coins:Number(ach.coins||0),xp:Number(ach.xp||0)},user:safeUser(updated)});
 }
if(req.method==='GET'&&url.pathname==='/api/progression'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  return json(res,200,await progressionData(user));
 }
// Cloche de l'en-tête : notifications stockées (enchères) et nombre de récompenses à récupérer.
// Classement public des collectionneurs ; le joueur connecté y voit aussi son propre rang.
if(req.method==='GET'&&url.pathname==='/api/leaderboard'){
  const user=await currentUser(req);
  return json(res,200,await leaderboard(url.searchParams.get('period'),user?.id||null));
 }
if(req.method==='GET'&&url.pathname==='/api/profile'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  return json(res,200,await playerProfile(user));
 }
if(req.method==='GET'&&url.pathname==='/api/notifications'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  const [list,p]=await Promise.all([listNotifications(user.id),progressionData(user)]);
  const ready=(p.daily.claimed?0:1)+p.dailyTasks.filter(t=>t.completed&&!t.claimed).length+p.weeklyTasks.filter(t=>t.completed&&!t.claimed).length+p.missions.filter(m=>m.completed&&!m.claimed).length;
  return json(res,200,{...list,rewardsReady:ready});
 }
if(req.method==='POST'&&url.pathname==='/api/notifications/read'){
  const user=await currentUser(req);
  if(!user)return json(res,401,{error:'Non connecté'});
  const b=await readBody(req);
  return json(res,200,await markNotificationsRead(user.id,b.upToId));
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
// Récompenses de l'album : club complet, saison complète ou championnat entier (lib/rewards.js).
// Une récompense par joueur et par niveau (reward_claims), jamais attribuée deux fois même en rafale.
if(req.method==='POST'&&url.pathname==='/api/album/claim'){
  const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});
  const body=await readBody(req),level=['season','competition'].includes(body.level)?body.level:'club';
  const clubId=String(body.clubId||''),seasonId=String(body.seasonId||''),competitionId=String(body.competitionId||'');
  const data=await albumData(user.id),comps=data.album.competitions;
  let claimId,reward,label;
  if(level==='club'){
   const view=comps.flatMap(c=>c.seasons.flatMap(s=>s.clubs.map(v=>({...v,seasonId:s.id})))).find(c=>c.id===clubId&&c.seasonId===seasonId);
   if(!view)return json(res,404,{error:'Set introuvable.'});
   if(!view.complete)return json(res,400,{error:'Set incomplet.'});
   claimId='album:'+seasonId+':'+clubId;reward=ALBUM_REWARDS.club;label=view.name;
  }else if(level==='season'){
   const season=comps.flatMap(c=>c.seasons).find(s=>s.id===seasonId);
   if(!season)return json(res,404,{error:'Saison introuvable.'});
   if(!season.completion.complete)return json(res,400,{error:'Saison incomplète : '+season.completion.completeClubs+' club(s) complet(s) sur '+season.completion.clubs+'.'});
   claimId='album-season:'+seasonId;reward=ALBUM_REWARDS.season;label=season.label||season.season;
  }else{
   const comp=comps.find(c=>c.id===competitionId);
   if(!comp)return json(res,404,{error:'Championnat introuvable.'});
   if(!comp.completion.complete)return json(res,400,{error:'Championnat incomplet : '+comp.completion.completeSeasons+' saison(s) complète(s) sur '+comp.completion.seasons+'.'});
   claimId='album-competition:'+competitionId;reward=ALBUM_REWARDS.competition;label=comp.name;
  }
  if(await claimExists(user.id,claimId))return json(res,400,{error:'Récompense déjà récupérée.'});
  if(getPool()){
   const client=await getPool().connect();
   try{
    await client.query('BEGIN');
    const inserted=await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id',[user.id,claimId]);
    if(!inserted.rowCount){await client.query('ROLLBACK');return json(res,400,{error:'Récompense déjà récupérée.'});}
    const updated=await applyReward(user.id,reward,client,claimId);
    await securityEvent(user.id,null,'album_reward_claim',{level,claimId,coins:reward.coins,xp:reward.xp},client);
    await client.query('COMMIT');
    return json(res,200,{level,label,reward,user:safeUser(updated)});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  await addClaim(user.id,claimId);const updated=await applyReward(user.id,reward);
  return json(res,200,{level,label,reward,user:safeUser(updated)});
 }
  return false;
 };
}

module.exports = { createRewardsRoutes };
