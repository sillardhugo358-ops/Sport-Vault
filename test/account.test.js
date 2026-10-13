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
  // Catalogue et packs : détails réservés aux administrateurs (la santé publique reste minimale).
  const admin = await newPlayer(server, 'Verificateur');
  await server.db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
  const d = (await admin.get('/api/health')).body;
  const active = Number((await server.db.query('SELECT count(*) FROM catalog_cards WHERE is_active=true')).rows[0].count);
  assert.ok(active > 0);
  assert.equal(d.cards, active);
  assert.deepEqual(d.packs, ['starter', 'pro', 'legend']);
});

test('inscription : 1 000 FC, 50 gems, 3 cartes de bienvenue', async () => {
  const p = await newPlayer(server, 'Alice');
  assert.equal(p.user.coins, 1000);
  assert.equal(p.user.gems, 50);
  const col = await p.get('/api/collection');
  assert.equal(col.body.count, 3);
});

test('inscription : 5 comptes au plus par connexion et par fenêtre de 72 h, au-delà refusé avec un message clair', async () => {
  const first = await newPlayer(server, 'Bob');
  const c = client(server, first.ip);
  // Réseau partagé (mobile, domicile, école) : les 4 suivants passent, le 6e est refusé.
  for (let i = 2; i <= 5; i++) {
    const r = await c.post('/api/register', { name: 'Bob' + i, email: `bob${i}@test.footvault`, password: 'MotDePasse123' });
    assert.equal(r.status, 201, 'compte ' + i + ' : ' + JSON.stringify(r.body));
  }
  const sixth = await client(server, first.ip).post('/api/register', { name: 'Bob6', email: 'bob6@test.footvault', password: 'MotDePasse123' });
  assert.equal(sixth.status, 429);
  assert.match(sixth.body.error, /5 au maximum toutes les 72 heures/);
  // Une autre connexion n'est pas touchée.
  assert.equal((await client(server).post('/api/register', { name: 'Bob7', email: 'bob7@test.footvault', password: 'MotDePasse123' })).status, 201);
});

test('inscription : la fenêtre expirée repart de zéro (anciennes lignes sans compteur comprises)', async () => {
  const first = await newPlayer(server, 'Fenetre');
  const q = (sql, params) => server.db.query(sql, params);
  // Ligne ancienne (avant le compteur) : une inscription il y a plus de 72 h ne bloque plus.
  await q("UPDATE registration_limits SET window_start=NULL, count=1, last_created_at=now() - interval '73 hours' WHERE ip=$1", [first.ip]);
  const r = await client(server, first.ip).post('/api/register', { name: 'Fenetre2', email: 'fenetre2@test.footvault', password: 'MotDePasse123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = (await q('SELECT count FROM registration_limits WHERE ip=$1', [first.ip])).rows[0];
  assert.equal(Number(row.count), 1, 'nouvelle fenêtre : compteur remis à 1');
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
