'use strict';

// Liste de souhaits (lib/wishlist.js). Renvoie true si la requête a été traitée.

const { json, readBody } = require('../http');

function createWishlistRoutes({ currentUser, wishlist }) {
  const reply = (res, r) => json(res, r.error ? r.status || 400 : 200, r);
  return async function wishlistRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/wishlist')) return false;
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: 'Non connecté' });
    if (req.method === 'GET' && url.pathname === '/api/wishlist') return json(res, 200, await wishlist.list(user.id));
    if (req.method === 'GET' && url.pathname === '/api/wishlist/search') return json(res, 200, await wishlist.search(user.id, url.searchParams.get('q')));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/api/wishlist/add') return reply(res, await wishlist.add(user.id, body.cardId));
      if (url.pathname === '/api/wishlist/remove') return reply(res, await wishlist.remove(user.id, body.cardId));
    }
    return false;
  };
}

module.exports = { createWishlistRoutes };
