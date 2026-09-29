'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, newPlayer } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('santé : serveur prêt sur PostgreSQL, catalogue chargé', async () => {
  const r = await client(server).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.storage, 'postgres');
  const active = Number((await server.db.query('SELECT count(*) FROM catalog_cards WHERE is_active=true')).rows[0].count);
  assert.ok(active > 0);
  assert.equal(r.body.cards, active);
  assert.deepEqual(r.body.packs, ['starter', 'pro', 'legend']);
});

test('inscription : 1 000 FC, 50 gems, 3 cartes de bienvenue', async () => {
  const p = await newPlayer(server, 'Alice');
  assert.equal(p.user.coins, 1000);
  assert.equal(p.user.gems, 50);
  const col = await p.get('/api/collection');
  assert.equal(col.body.count, 3);
});

test('inscription : une seule par IP toutes les 72 h', async () => {
  const first = await newPlayer(server, 'Bob');
  const r = await client(server, first.ip).post('/api/register', { name: 'Bob2', email: 'bob2@test.footvault', password: 'MotDePasse123' });
  assert.equal(r.status, 429);
});

test('inscription : mot de passe trop faible refusé', async () => {
  const r = await client(server).post('/api/register', { name: 'Carl', email: 'carl@test.footvault', password: 'court' });
  assert.equal(r.status, 400);
});

test('inscription : email déjà utilisé refusé', async () => {
  const p = await newPlayer(server, 'Dana');
  const r = await client(server).post('/api/register', { name: 'Dana2', email: p.email, password: 'MotDePasse123' });
  assert.equal(r.status, 409);
});

test('connexion : bon mot de passe accepté, mauvais refusé', async () => {
  const p = await newPlayer(server, 'Eve');
  const bad = await client(server).post('/api/login', { email: p.email, password: 'Mauvais12345' });
  assert.ok(bad.status >= 400);
  const c = client(server);
  const ok = await c.post('/api/login', { email: p.email, password: 'MotDePasse123' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/me')).body.user.id, p.user.id);
});

test('actions protégées : refusées sans connexion', async () => {
  const c = client(server);
  assert.equal((await c.post('/api/packs/open', { packId: 'starter' })).status, 401);
  assert.equal((await c.post('/api/rewards/daily')).status, 401);
  assert.equal((await c.post('/api/auctions/bid', { auctionId: 'x', amount: 10 })).status, 401);
});

test('inscription : 8 inscriptions simultanées, toutes acceptées', async () => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => newPlayer(server, 'Foule' + i)));
  assert.deepEqual(results.map(r => r.status), Array(8).fill('fulfilled'));
});

test('diagnostic IP : réservé aux admins, montre la chaîne reçue', async () => {
  const p = await newPlayer(server, 'Diag');
  assert.equal((await p.get('/api/admin/ip-debug')).status, 403);
  await server.db.query("UPDATE users SET role='admin' WHERE id=$1", [p.user.id]);
  const r = await p.get('/api/admin/ip-debug');
  assert.equal(r.status, 200);
  assert.equal(r.body.resolvedIp, p.ip);
  assert.deepEqual(r.body.forwardedChain, [p.ip]);
});
