'use strict';

// Primes (lib/bounties.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createBountiesRoutes({ currentUser, bounties, safeUser }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r.user ? { ...r, user: safeUser(r.user) } : r);
  return async function bountiesRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/bounties')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/bounties') return json(res, 200, await bounties.list(user.id));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/api/bounties/create') return reply(res, await bounties.create(user.id, body));
      if (url.pathname === '/api/bounties/cancel') return reply(res, await bounties.cancel(user.id, body.id));
      if (url.pathname === '/api/bounties/fulfil') return reply(res, await bounties.fulfil(user.id, body.id));
    }
    return false;
  };
}

module.exports = { createBountiesRoutes };
