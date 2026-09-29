'use strict';

// Marché : enchères.
// Routes déplacées telles quelles depuis server.js ; renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createAuctionsRoutes({ auctionBidHistory, auctionData, auctionHistory, cancelAuction, createAuction, currentUser, placeAuctionBid, safeUser, withdrawAuctionParticipation }) {
 return async function auctionsRoutes(req, res, url) {
if(req.method==='GET'&&url.pathname==='/api/auctions'){const user=await currentUser(req);const auctions=await auctionData(user?.id||null);return json(res,200,{auctions,user:user?safeUser(user):null});}
if(req.method==='GET'&&url.pathname==='/api/auctions/history'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});return json(res,200,{auctions:await auctionHistory(user.id)});}
if(req.method==='GET'&&url.pathname==='/api/auctions/:id'){return json(res,404,{error:'Not found'});}
if(req.method==='GET'&&url.pathname==='/api/auctions'){return json(res,200,{auctions:await auctionData()});}
if(req.method==='POST'&&url.pathname==='/api/auctions/create'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await createAuction(user.id,String(body.cardInstanceId||''),body.startingBid,body.duration);return json(res,result.error?result.status||400:201,result);}
if(req.method==='POST'&&url.pathname==='/api/auctions/bid'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await placeAuctionBid(user.id,String(body.auctionId||''),body.amount);return json(res,result.error?result.status||400:200,result);}
if(req.method==='POST'&&url.pathname==='/api/auctions/cancel'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await cancelAuction(user.id,String(body.auctionId||''));return json(res,result.error?result.status||400:200,result);}
if(req.method==='POST'&&url.pathname==='/api/auctions/withdraw'){const user=await currentUser(req);if(!user)return json(res,401,{error:'Non connecté'});const body=await readBody(req);const result=await withdrawAuctionParticipation(user.id,String(body.auctionId||''));return json(res,result.error?result.status||400:200,result);}
if(req.method==='GET'&&url.pathname.startsWith('/api/auctions/')&&url.pathname.endsWith('/bids')){const id=url.pathname.split('/')[3];return json(res,200,{bids:await auctionBidHistory(id)});}
  return false;
 };
}

module.exports = { createAuctionsRoutes };
