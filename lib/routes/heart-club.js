'use strict';

// Club de cœur (lib/heart-club.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createHeartClubRoutes({ currentUser, heartClub }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function heartClubRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/heart-club')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/heart-club') return json(res, 200, await heartClub.ranking(user.id));
    if (req.method === 'GET' && url.pathname === '/api/heart-club/search') return json(res, 200, await heartClub.search(url.searchParams.get('q')));
    if (req.method === 'POST' && url.pathname === '/api/heart-club/choose') return reply(res, await heartClub.choose(user.id, (await readBody(req)).club));
    return false;
  };
}

module.exports = { createHeartClubRoutes };
