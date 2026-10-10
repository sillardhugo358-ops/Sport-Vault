'use strict';

// Échanges de cartes entre joueurs (lib/trades.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createTradesRoutes({ currentUser, tradeInfo, tradeLookupPlayer, tradeMyCards, tradeCreateOffer, tradeListOffers, tradeListHistory, tradeCancelOffer, tradeDeclineOffer, tradeAcceptOffer }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function tradesRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/trades')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/trades') return json(res, 200, { ...(await tradeInfo(user.id)), ...(await tradeListOffers(user.id)) });
    if (req.method === 'GET' && url.pathname === '/api/trades/history') return reply(res, await tradeListHistory(user.id, { status: url.searchParams.get('status'), page: url.searchParams.get('page') }));
    if (req.method === 'GET' && url.pathname === '/api/trades/player') return reply(res, await tradeLookupPlayer(user.id, url.searchParams.get('code')));
    if (req.method === 'GET' && url.pathname === '/api/trades/mine/cards') return json(res, 200, await tradeMyCards(user.id));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/api/trades/offer') return reply(res, await tradeCreateOffer(user.id, body));
      if (url.pathname === '/api/trades/cancel') return reply(res, await tradeCancelOffer(user.id, body.id));
      if (url.pathname === '/api/trades/decline') return reply(res, await tradeDeclineOffer(user.id, body.id));
      if (url.pathname === '/api/trades/accept') return reply(res, await tradeAcceptOffer(user.id, body.id));
    }
    return false;
  };
}

module.exports = { createTradesRoutes };
