'use strict';

// Profil joueur (/api/profile) : identité, collection, progression, historique lisible.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('non connecté : 401', async () => {
  assert.equal((await fetch(server.base + '/api/profile')).status, 401);
});

test('nouveau joueur : identité, niveau, cartes de bienvenue, historique d\'inscription', async () => {
  const p = await newPlayer(server, 'Profilé');
  const r = await p.get('/api/profile');
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.profile.name, 'Profilé');
  assert.equal(d.profile.level, 1);
  assert.ok(d.profile.memberSince);
  const [{ n }] = (await server.db.query("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1", [p.user.id])).rows;
  assert.equal(d.collection.cards, n);
  assert.deepEqual(d.collection.rarities.map(r => r.rarity), ['common', 'rare', 'epic', 'legendary', 'icon']);
  assert.equal(d.collection.rarities.reduce((s, r) => s + r.count, 0), n);
  assert.deepEqual(d.history.map(h => [h.label, h.amount]), [['Bonus de bienvenue', 1000]]);
  assert.ok(!('email' in d.profile) && !('password_hash' in d.profile));
});

test('activité : pack, bonus, vente aux enchères ; libellés sans référence technique', async () => {
  const seller = await newPlayer(server, 'Vendeuse');
  const buyer = await newPlayer(server, 'Acheteuse');
  const card = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  await seller.post('/api/rewards/daily');
  const a = (await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 120, duration: 10 })).body.auction;
  await buyer.post('/api/auctions/bid', { auctionId: a.id, amount: 120 });
  await server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await buyer.get('/api/auctions');

  const s = (await seller.get('/api/profile')).body;
  assert.deepEqual(s.history.map(h => h.label), ['Vente aux enchères : ' + card.name, 'Bonus quotidien', 'Ouverture : STARTER PACK', 'Bonus de bienvenue']);
  assert.deepEqual(s.history.map(h => h.amount), [120, 150, -100, 1000]);
  assert.equal(s.progress.auctionsSold, 1);
  assert.equal(s.profile.packsOpened, 1);
  for (const h of s.history) assert.ok(!h.label.includes(a.id) && !('ref' in h), h.label);

  const b = (await buyer.get('/api/profile')).body;
  assert.equal(b.progress.auctionsWon, 1);
  assert.equal(b.history[0].label, 'Achat aux enchères : ' + card.name);
  assert.ok(b.collection.best.length >= 1);
});

test('cloisonnement : chaque joueur ne voit que son profil', async () => {
  const x = await newPlayer(server, 'Premier');
  const y = await newPlayer(server, 'Second');
  await x.post('/api/packs/open', { packId: 'starter' });
  const py = (await y.get('/api/profile')).body;
  assert.equal(py.profile.name, 'Second');
  assert.equal(py.profile.packsOpened, 0);
  assert.equal(py.history.length, 1);
});
