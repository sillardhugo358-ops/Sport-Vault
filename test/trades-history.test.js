'use strict';

// Historique complet des échanges : offres closes seulement, filtre par statut, pagination, jamais celles des autres joueurs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');

let server, a, b, c;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const offer = (from, to, status, minutesAgo) => q(`INSERT INTO trade_offers(id,from_user,to_user,status,expires_at,resolved_at,created_at)
  VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::varchar,now()+interval '1 day',CASE WHEN $3::varchar='open' THEN NULL ELSE now()-($4::text||' minutes')::interval END,now()-($4::text||' minutes')::interval-interval '1 hour')`, [from.user.id, to.user.id, status, String(minutesAgo)]);

test.before(async () => {
  server = await startServer();
  a = await newPlayer(server, 'Historien'); b = await newPlayer(server, 'Partenaire'); c = await newPlayer(server, 'Etranger');
  for (let i = 0; i < 12; i++) await offer(i % 2 ? a : b, i % 2 ? b : a, 'accepted', i + 1);
  await offer(a, b, 'declined', 30); await offer(b, a, 'cancelled', 31); await offer(a, b, 'expired', 32); await offer(a, b, 'open', 0);
  await offer(b, c, 'accepted', 5);
});
test.after(async () => { await server.stop?.(); });

test('historique : connexion obligatoire, offres closes seulement, pagination, filtre, jamais celles des autres', async () => {
  assert.equal((await client(server).get('/api/trades/history')).status, 401);
  const all = (await a.get('/api/trades/history')).body;
  assert.equal(all.total, 15, '12 acceptées + refusée + annulée + expirée ; l\'offre ouverte et celle des autres sont exclues');
  assert.equal(all.offers.length, 10); assert.equal(all.pages, 2); assert.equal(all.page, 1);
  assert.ok(all.offers.every(o => o.status !== 'open' && ['from', 'to'].includes(o.mine)));
  const p2 = (await a.get('/api/trades/history?page=2')).body;
  assert.equal(p2.offers.length, 5);
  assert.equal(new Set([...all.offers, ...p2.offers].map(o => o.id)).size, 15, 'pas de doublon entre les pages');
  assert.equal((await a.get('/api/trades/history?status=declined')).body.total, 1);
  assert.equal((await a.get('/api/trades/history?status=accepted')).body.total, 12);
  assert.equal((await a.get('/api/trades/history?status=bidon')).status, 400);
  assert.equal((await a.get('/api/trades/history?page=-4')).body.page, 1, 'page invalide ramenée à 1');
  assert.equal((await c.get('/api/trades/history')).body.total, 1, 'seulement ses propres échanges');
  assert.equal((await client(server).get('/api/trades')).status, 401);
});
