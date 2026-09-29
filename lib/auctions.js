'use strict';

// Marché : enchères (création, offres, anti-sniping, règlement, annulation, retrait, historique).
// Règles de durée et de palier : lib/auction-rules.js. getPool() renvoie le pool PostgreSQL courant.

const { auctionDurationMs, auctionMinBid } = require('./auction-rules');

function createAuctions({ getPool, publicCard, securityEvent }) {
function auctionPublic(row){return{id:row.id,cardInstanceId:row.card_instance_id,sellerId:row.seller_id,startingBid:Number(row.starting_bid),currentBid:Number(row.current_bid),currentBidderId:row.current_bidder_id||null,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,createdAt:row.created_at,completedAt:row.completed_at||null};}
async function settleExpiredAuctions(){
 if(!getPool())return;
 const client=await getPool().connect();
 try{
  await client.query('BEGIN');
  const auctions=(await client.query("SELECT * FROM auctions WHERE status='active' AND ends_at<=now() ORDER BY ends_at FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
  for(const a of auctions){
   if(a.current_bidder_id){
    await client.query('UPDATE users SET coins=coins-$1,reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2',[Number(a.current_bid),a.current_bidder_id]);
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
 const r=await getPool().query(`SELECT a.*,c.card_id,c.name,c.position,c.club,c.nation,c.rarity,c.season,c.is_limited,c.serial,c.max_supply,c.source,
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
 const client=await getPool().connect();
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
  await securityEvent(userId,null,'auction_withdraw',{auctionId,currentBidderChanged: a.current_bidder_id===userId,restoredBid:restoredBid?.amount||null},client);
  await client.query('COMMIT');
  const after=(await getPool().query('SELECT current_bid,current_bidder_id FROM auctions WHERE id=$1',[auctionId])).rows[0];
  return{ok:true,auction:{id:auctionId,currentBid:Number(after.current_bid),currentBidderId:after.current_bidder_id||null}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function auctionHistory(userId){
 await settleExpiredAuctions();
 const r=await getPool().query(`SELECT a.*,c.card_id,c.name,c.position,c.club,c.nation,c.rarity,c.season,c.serial,c.max_supply,c.source,
   u.name AS seller_name,ub.name AS bidder_name
   FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
   JOIN users u ON u.id=a.seller_id
   LEFT JOIN users ub ON ub.id=a.current_bidder_id
   WHERE a.status='completed' AND (a.seller_id=$1 OR a.current_bidder_id=$1 OR EXISTS(SELECT 1 FROM auction_bids b WHERE b.auction_id=a.id AND b.bidder_id=$1))
   ORDER BY COALESCE(a.completed_at,a.ends_at) DESC LIMIT 100`,[userId]);
 return r.rows.map(x=>({...auctionPublic(x),sellerName:x.seller_name,currentBidderName:x.bidder_name||null,card:publicCard(x)}));
}
async function auctionReference(cardId){
 const r=await getPool().query("SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY current_bid) AS median,count(*) AS count FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.status='completed' AND c.card_id=$1",[cardId]);
 return {median:r.rows[0].median===null?null:Math.round(Number(r.rows[0].median)),count:Number(r.rows[0].count)};
}
async function createAuction(userId,cardInstanceId,startingBid,duration){
 const minutesMap={10:10,30:30,60:60,180:180,360:360,720:720,1440:1440};
 const mins=minutesMap[Number(duration)];
 if(!mins)return{error:'Durée d’enchère invalide.',status:400};
 const bid=Math.floor(Number(startingBid));
 if(!Number.isSafeInteger(bid)||bid<1)return{error:'La mise de départ doit être un nombre entier positif.',status:400};
 const client=await getPool().connect();
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
  await securityEvent(userId,null,'auction_create',{auctionId:id,cardInstanceId,startingBid:bid,durationMinutes:mins},client);await client.query('COMMIT');
  return{auction:{id,cardInstanceId,startingBid:bid,currentBid:bid,endsAt:ends.toISOString(),status:'active'}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function placeAuctionBid(userId,auctionId,amount){
 await settleExpiredAuctions();
 const bid=Math.floor(Number(amount));
 if(!Number.isSafeInteger(bid)||bid<1)return{error:'Enchère invalide.',status:400};
 const client=await getPool().connect();
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
  return{ok:true,auction:{id:a.id,currentBid:bid,currentBidderId:userId,endsAt:ends.toISOString(),bidCount:Number((await getPool().query('SELECT count(*) AS n FROM auction_bids WHERE auction_id=$1',[a.id])).rows[0].n)}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function cancelAuction(userId,auctionId){
 const client=await getPool().connect();
 try{
  await client.query('BEGIN');
  const a=(await client.query("SELECT * FROM auctions WHERE id=$1 FOR UPDATE",[auctionId])).rows[0];
  if(!a){await client.query('ROLLBACK');return{error:'Enchère introuvable.',status:404};}
  if(a.seller_id!==userId){await client.query('ROLLBACK');return{error:'Cette enchère ne t’appartient pas.',status:403};}
  if(a.status!=='active'){await client.query('ROLLBACK');return{error:'Cette enchère n’est plus active.',status:400};}
  if(a.current_bidder_id){await client.query('ROLLBACK');return{error:'Impossible d’annuler après la première enchère.',status:400};}
  await client.query("UPDATE auctions SET status='cancelled',cancelled_at=now() WHERE id=$1",[auctionId]);
  await client.query("UPDATE card_instances SET status='owned' WHERE instance_id=$1",[a.card_instance_id]);
  await securityEvent(userId,null,'auction_cancel',{auctionId},client);await client.query('COMMIT');
  return{ok:true};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release();}
}
async function auctionBidHistory(auctionId){
 const r=await getPool().query("SELECT b.amount,b.created_at,u.name AS bidder_name FROM auction_bids b JOIN users u ON u.id=b.bidder_id WHERE b.auction_id=$1 ORDER BY b.created_at DESC LIMIT 100",[auctionId]);
 return r.rows.map(x=>({amount:Number(x.amount),createdAt:x.created_at,bidderName:x.bidder_name}));
}

return { auctionPublic, settleExpiredAuctions, auctionData, withdrawAuctionParticipation, auctionHistory, auctionReference, createAuction, placeAuctionBid, cancelAuction, auctionBidHistory };
}

module.exports = { createAuctions };
