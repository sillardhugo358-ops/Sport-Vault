'use strict';

// Amis et profils publics (lib/friends.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createFriendsRoutes({ currentUser, friends }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function friendsRoutes(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/friends') && p !== '/api/players/profile' && p !== '/api/profile/visibility') return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && p === '/api/friends') return json(res, 200, await friends.summary(user.id));
    if (req.method === 'GET' && p === '/api/friends/activity') return json(res, 200, await friends.activity(user.id));
    if (req.method === 'GET' && p === '/api/players/profile') return reply(res, await friends.publicProfile(user.id, url.searchParams.get('code')));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (p === '/api/friends/request') return reply(res, await friends.request(user.id, body.code));
      if (p === '/api/friends/accept') return reply(res, await friends.respond(user.id, body.id, 'accept'));
      if (p === '/api/friends/decline') return reply(res, await friends.respond(user.id, body.id, 'decline'));
      if (p === '/api/friends/cancel') return reply(res, await friends.respond(user.id, body.id, 'cancel'));
      if (p === '/api/friends/remove') return reply(res, await friends.remove(user.id, body.id));
      if (p === '/api/profile/visibility') return reply(res, await friends.setVisibility(user.id, String(body.visibility || '')));
    }
    return false;
  };
}

module.exports = { createFriendsRoutes };
