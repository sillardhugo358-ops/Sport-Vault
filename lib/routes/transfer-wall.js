'use strict';

// Mur des transferts (lib/transfer-wall.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createTransferWallRoutes({ currentUser, transferWall }) {
  return async function transferWallRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/transfer-wall')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/transfer-wall') return json(res, 200, await transferWall.wall(user.id));
    if (req.method === 'POST' && url.pathname === '/api/transfer-wall/optin') {
      const r = await transferWall.setOptIn(user.id, (await readBody(req)).on);
      return json(res, r.error ? r.status || 400 : 200, r);
    }
    return false;
  };
}

module.exports = { createTransferWallRoutes };
