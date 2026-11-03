'use strict';

// Prêts de cartes (lib/loans.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createLoansRoutes({ currentUser, loans }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function loansRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/loans')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/loans') return json(res, 200, await loans.list(user.id));
    if (req.method === 'GET' && url.pathname === '/api/loans/cards') return json(res, 200, await loans.lendable(user.id, url.searchParams.get('q')));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/api/loans/lend') return reply(res, await loans.lend(user.id, body));
      if (url.pathname === '/api/loans/return') return reply(res, await loans.giveBack(user.id, body.id));
    }
    return false;
  };
}

module.exports = { createLoansRoutes };
