'use strict';

// Atelier : vente rapide et fusion (lib/economy.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createEconomyRoutes({ currentUser, economy }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function economyRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/workshop')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/workshop') return json(res, 200, await economy.info(user.id));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/api/workshop/sell') return reply(res, await economy.quickSell(user.id, body));
      if (url.pathname === '/api/workshop/fuse') return reply(res, await economy.fuse(user.id, body));
    }
    return false;
  };
}

module.exports = { createEconomyRoutes };
