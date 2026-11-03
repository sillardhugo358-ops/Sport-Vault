'use strict';

// Duel quotidien d'équipe type (lib/team-duel.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createTeamDuelRoutes({ currentUser, teamDuel }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function teamDuelRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/team-duels')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/team-duels') return json(res, 200, await teamDuel.status(user.id));
    if (req.method === 'POST' && url.pathname === '/api/team-duels/challenge') return reply(res, await teamDuel.challenge(user.id, (await readBody(req)).code));
    return false;
  };
}

module.exports = { createTeamDuelRoutes };
