'use strict';

// Notifications push : clé publique, abonnement et désabonnement d'un appareil (lib/push.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createPushRoutes({ currentUser, push }) {
  return async function pushRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/push')) return false;
    if (req.method === 'GET' && url.pathname === '/api/push/config') return json(res, 200, { enabled: push.enabled(), publicKey: push.publicKey() });
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') { const r = await push.subscribe(user.id, await readBody(req)); return json(res, r.error ? r.status || 400 : 200, r); }
    if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') { const body = await readBody(req); return json(res, 200, await push.unsubscribe(user.id, body.endpoint)); }
    return false;
  };
}

module.exports = { createPushRoutes };
