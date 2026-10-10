'use strict';

// Statistiques de collection (lib/collection-stats.js). Renvoie true si la requête a été traitée.

const { json } = require('../http');

function createCollectionStatsRoutes({ currentUser, collectionStats }) {
  return async function collectionStatsRoutes(req, res, url) {
    if (req.method !== 'GET' || url.pathname !== '/api/collection/stats') return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    return json(res, 200, await collectionStats(user.id));
  };
}

module.exports = { createCollectionStatsRoutes };
