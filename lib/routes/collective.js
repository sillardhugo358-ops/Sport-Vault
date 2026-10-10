'use strict';

// Défis collectifs (lib/collective.js) : lecture et réclamation pour les joueurs, éditeur pour les administrateurs.

const { json, readBody } = require('../http');

function createCollectiveRoutes({ currentUser, requireAdmin, collective, safeUser }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function collectiveRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/collective') && !url.pathname.startsWith('/api/admin/collective')) return false;
    if (url.pathname.startsWith('/api/admin/')) {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, 403, { error: 'Accès admin requis.' });
      if (req.method === 'GET' && url.pathname === '/api/admin/collective') return json(res, 200, await collective.adminList());
      if (req.method === 'POST' && url.pathname === '/api/admin/collective') return reply(res, await collective.adminSave(admin.id, await readBody(req)));
      return false;
    }
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/collective') return json(res, 200, await collective.list(user.id));
    if (req.method === 'POST' && url.pathname === '/api/collective/claim') {
      const r = await collective.claim(user.id, await readBody(req));
      return reply(res, r.error ? r : { ...r, user: safeUser(r.user) });
    }
    return false;
  };
}

module.exports = { createCollectiveRoutes };
