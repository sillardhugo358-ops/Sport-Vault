'use strict';

// Défis collectifs : jauge commune (packs, cartes, enchères, échanges), paliers réclamés une seule fois par les contributeurs,
// éditeur réservé aux administrateurs, paliers verrouillés une fois des récompenses versées.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client, userRow } = require('./helpers');

let server, admin, a, b;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const coins = async u => Number((await userRow(server, u.user.id)).coins);
const iso = ms => new Date(Date.now() + ms).toISOString();
const body = (o = {}) => ({ action: 'create', title: 'Ouvrons des packs', description: 'Tous ensemble', metrics: ['packs'], startsAt: iso(-3600e3), endsAt: iso(86400e3),
  tiers: [{ at: 2, coins: 100, xp: 10 }, { at: 4, coins: 300, xp: 30 }], ...o });
async function packEvents(user, n, cards = 5) {
  for (let i = 0; i < n; i++) await q("INSERT INTO security_events(user_id,event,details) VALUES($1,'pack_open',$2::jsonb)", [user.user.id, JSON.stringify({ packId: 'starter', cards })]);
}

test.before(async () => {
  server = await startServer({ env: { NODE_ENV: 'test', COLLECTIVE_TEST_CACHE_MS: '0.001' } });
  admin = await newPlayer(server, 'Chefcollectif');
  await q("UPDATE users SET role='creator' WHERE id=$1", [admin.user.id]);
  a = await newPlayer(server, 'Contributeur');
  b = await newPlayer(server, 'Spectateur');
});
test.after(async () => { await server.stop?.(); });

test('éditeur : réservé aux admins, validation, création et modification', async () => {
  assert.equal((await a.post('/api/admin/collective', body())).status, 403);
  assert.equal((await client(server).get('/api/admin/collective')).status, 403);
  for (const bad of [body({ title: '' }), body({ metrics: [] }), body({ metrics: ['inconnue'] }), body({ tiers: [] }), body({ tiers: [{ at: 5, coins: 1, xp: 0 }, { at: 5, coins: 1, xp: 0 }] }),
    body({ tiers: [{ at: 5, coins: 0, xp: 0 }] }), body({ endsAt: iso(-7200e3) }), body({ tiers: Array.from({ length: 7 }, (_, i) => ({ at: i + 1, coins: 1, xp: 0 })) })]) {
    const r = await admin.post('/api/admin/collective', bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.ok(r.body.errors);
  }
  const r = await admin.post('/api/admin/collective', body());
  assert.equal(r.status, 200);
  assert.equal(r.body.challenge.id, 'ouvrons-des-packs');
  assert.equal(r.body.challenge.target, 4);
  const again = await admin.post('/api/admin/collective', body());
  assert.equal(again.body.challenge.id, 'ouvrons-des-packs-2', 'identifiant généré, jamais saisi');
  const upd = await admin.post('/api/admin/collective', body({ action: 'update', id: 'ouvrons-des-packs-2', title: 'Renommé' }));
  assert.equal(upd.body.challenge.title, 'Renommé');
  await admin.post('/api/admin/collective', { action: 'toggle', id: 'ouvrons-des-packs-2', active: false });
  const list = (await admin.get('/api/admin/collective')).body;
  assert.equal(list.challenges.find(c => c.id === 'ouvrons-des-packs-2').active, false);
});

test('jauge, paliers et réclamation : contributeurs seulement, une seule fois, palier non atteint refusé', async () => {
  assert.equal((await client(server).get('/api/collective')).status, 401);
  await packEvents(a, 1);
  let d = (await a.get('/api/collective')).body.challenges.find(c => c.id === 'ouvrons-des-packs');
  assert.equal(d.total, 1); assert.equal(d.mine, 1); assert.equal(d.state, 'live');
  assert.equal((await a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 0 })).status, 400, 'palier non atteint');
  await packEvents(admin, 1);   // un autre joueur fait avancer la jauge
  d = (await b.get('/api/collective')).body.challenges.find(c => c.id === 'ouvrons-des-packs');
  assert.equal(d.mine, 0);
  const refused = await b.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 0 });
  assert.equal(refused.status, 403, 'pas de contribution : pas de récompense');
  const before = await coins(a);
  const ok = await a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 0 });
  assert.equal(ok.status, 200);
  assert.equal(await coins(a) - before, 100);
  assert.equal((await a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 0 })).status, 400, 'une seule fois');
  const rs = await Promise.all(Array.from({ length: 4 }, () => a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 1 })));
  assert.equal(rs.filter(r => r.status === 200).length, 0, 'palier 2 pas encore atteint');
  await packEvents(a, 2);
  const rs2 = await Promise.all(Array.from({ length: 4 }, () => a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 1 })));
  assert.equal(rs2.filter(r => r.status === 200).length, 1, 'concurrence : une seule récompense');
  assert.equal((await q("SELECT count(*)::int AS n FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'collective:%'", [a.user.id]))[0].n, 2);
  assert.equal((await a.post('/api/collective/claim', { id: 'ouvrons-des-packs', tier: 9 })).status, 400);
  assert.equal((await a.post('/api/collective/claim', { id: 'inconnu', tier: 0 })).status, 404);
});

test('métriques cartes, enchères et échanges ; défi à venir ; paliers verrouillés après réclamation ; délai dépassé', async () => {
  const mk = async (o) => (await admin.post('/api/admin/collective', body({ title: 'Défi ' + Math.random().toString(36).slice(2, 7), ...o }))).body.challenge;
  const cards = await mk({ metrics: ['cards'], tiers: [{ at: 5, coins: 10, xp: 0 }] });
  assert.equal((await a.get('/api/collective')).body.challenges.find(c => c.id === cards.id).total, 20, '4 packs × 5 cartes');
  const trades = await mk({ metrics: ['trades'], tiers: [{ at: 1, coins: 10, xp: 0 }] });
  const auctions = await mk({ metrics: ['auctions'], tiers: [{ at: 1, coins: 10, xp: 0 }] });
  const t0 = (await a.get('/api/collective')).body.challenges;
  assert.equal(t0.find(c => c.id === trades.id).total, 0);
  assert.equal(t0.find(c => c.id === auctions.id).total, 0);
  await q("INSERT INTO trade_offers(id,from_user,to_user,status,expires_at,resolved_at) VALUES(gen_random_uuid(),$1,$2,'accepted',now()+interval '1 day',now())", [a.user.id, b.user.id]);
  const t1 = (await b.get('/api/collective')).body.challenges.find(c => c.id === trades.id);
  assert.equal(t1.total, 1, 'échange conclu compté'); assert.equal(t1.mine, 1, 'les deux parties contribuent');
  const future = await mk({ startsAt: iso(3600e3), endsAt: iso(7200e3) });
  const f = (await a.get('/api/collective')).body.challenges.find(c => c.id === future.id);
  assert.equal(f.state, 'upcoming'); assert.equal(f.total, 0);
  assert.equal((await a.post('/api/collective/claim', { id: future.id, tier: 0 })).status, 400);
  const locked = await admin.post('/api/admin/collective', body({ action: 'update', id: 'ouvrons-des-packs', tiers: [{ at: 2, coins: 999, xp: 10 }, { at: 4, coins: 300, xp: 30 }] }));
  assert.equal(locked.status, 409, 'paliers non modifiables une fois des récompenses versées');
  const title = await admin.post('/api/admin/collective', body({ action: 'update', id: 'ouvrons-des-packs', title: 'Titre modifié' }));
  assert.equal(title.status, 200, 'le titre reste modifiable');
  const old = await mk({ startsAt: iso(-20 * 86400e3), endsAt: iso(-10 * 86400e3) });
  assert.equal((await a.post('/api/collective/claim', { id: old.id, tier: 0 })).status, 409, 'délai de 7 jours dépassé');
  assert.equal((await a.get('/api/collective')).body.challenges.some(c => c.id === old.id), false, 'plus affiché');
});
