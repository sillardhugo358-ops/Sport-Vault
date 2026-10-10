'use strict';

// Équipe type (lib/team.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createTeamRoutes({ currentUser, team }) {
  return async function teamRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/team')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/team') return json(res, 200, await team.get(user.id));
    if (req.method === 'POST' && url.pathname === '/api/team/save') { const r = await team.save(user.id, await readBody(req)); return json(res, r.error ? r.status || 400 : 200, r); }
    return false;
  };
}

module.exports = { createTeamRoutes };
