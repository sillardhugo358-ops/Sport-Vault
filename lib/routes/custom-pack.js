'use strict';

// Pack sur mesure (lib/cards.js) : options du formulaire, aperçu du prix et achat. Le prix et la sélection sont décidés par le serveur.

const { json, readBody } = require('../http');

function createCustomPackRoutes({ currentUser, customPackOptions, quoteCustomPack, openCustomPack }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function customPackRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/custom-pack')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/custom-pack/options') return json(res, 200, await customPackOptions());
    if (req.method === 'POST' && url.pathname === '/api/custom-pack/quote') return reply(res, await quoteCustomPack(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/custom-pack/open') return reply(res, await openCustomPack(user.id, await readBody(req)));
    return false;
  };
}

module.exports = { createCustomPackRoutes };
