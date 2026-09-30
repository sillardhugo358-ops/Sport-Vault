'use strict';

// Journal des FOOTCOINS et tableau de bord statistique : chaque mouvement de solde est journalisé
// dans la même transaction, si bien que la somme du journal d'un joueur égale toujours son solde.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server, admin;
test.before(async () => {
  server = await startServer();
  admin = await newPlayer(server, 'Admin');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [admin.user.id]);
});
test.after(async () => { await server?.stop(); });

const q = async (sql, params) => (await server.db.query(sql, params)).rows;
async function assertBalanced(userId) {
  const [{ coins }] = await q('SELECT coins FROM users WHERE id=$1', [userId]);
  const [{ total }] = await q('SELECT COALESCE(sum(amount),0)::int AS total FROM coin_ledger WHERE user_id=$1', [userId]);
  assert.equal(total, Number(coins), 'journal ≠ solde');
}

test('inscription, pack, bonus quotidien et ajustement admin journalisés', async () => {
  const p = await newPlayer(server, 'Joueur');
  assert.deepEqual((await q('SELECT amount,reason FROM coin_ledger WHERE user_id=$1', [p.user.id])).map(r => [r.amount, r.reason]), [[1000, 'signup']]);
  assert.equal((await p.post('/api/packs/open', { packId: 'starter' })).status, 200);
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  assert.equal((await admin.post(`/api/admin/users/${p.user.id}/resources`, { resource: 'coins', amount: 500, reason: 'test' })).status, 200);
  assert.equal((await admin.post(`/api/admin/users/${p.user.id}/resources`, { resource: 'gems', amount: 5, reason: 'test' })).status, 200);
  const rows = await q('SELECT amount,reason,ref FROM coin_ledger WHERE user_id=$1 ORDER BY id', [p.user.id]);
  assert.deepEqual(rows.map(r => [r.amount, r.reason, r.ref]), [
    [1000, 'signup', null], [-100, 'pack', 'starter'], [150, 'reward', 'daily'], [500, 'admin', 'admin:' + admin.user.id],
  ]);
  await assertBalanced(p.user.id);
});

test('refus (solde insuffisant, bonus déjà pris) : rien journalisé', async () => {
  const p = await newPlayer(server, 'Refus');
  await server.db.query('UPDATE users SET coins=0 WHERE id=$1', [p.user.id]);
  await server.db.query('DELETE FROM coin_ledger WHERE user_id=$1', [p.user.id]);
  assert.equal((await p.post('/api/packs/open', { packId: 'starter' })).status, 400);
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  assert.equal((await p.post('/api/rewards/daily')).status, 400);
  assert.deepEqual((await q('SELECT amount FROM coin_ledger WHERE user_id=$1', [p.user.id])).map(r => r.amount), [150]);
  await assertBalanced(p.user.id);
});

test('ouvertures simultanées : journal toujours égal au solde', async () => {
  const p = await newPlayer(server, 'Rafale');
  await Promise.all(Array.from({ length: 8 }, () => p.post('/api/packs/open', { packId: 'starter' })));
  await assertBalanced(p.user.id);
});

test('enchère réglée : achat et vente journalisés', async () => {
  const seller = await newPlayer(server, 'Vendeur');
  const buyer = await newPlayer(server, 'Acheteur');
  const card = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  const a = (await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 120, duration: 10 })).body.auction;
  assert.equal((await buyer.post('/api/auctions/bid', { auctionId: a.id, amount: 120 })).status, 200);
  await server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await buyer.get('/api/auctions');
  assert.deepEqual((await q("SELECT amount,reason FROM coin_ledger WHERE ref=$1 ORDER BY amount", [a.id])).map(r => [r.amount, r.reason]), [[-120, 'auction_buy'], [120, 'auction_sale']]);
  await assertBalanced(seller.user.id);
  await assertBalanced(buyer.user.id);
});

test('statistiques : réservées aux admins, période bornée, chiffres cohérents', async () => {
  const p = await newPlayer(server, 'Curieux');
  assert.equal((await p.get('/api/admin/stats')).status, 403);
  const bad = await admin.get('/api/admin/stats?days=9999');
  assert.equal(bad.status, 200);
  assert.equal(bad.body.days, 14);
  assert.equal(bad.body.series.length, 14);
  const r = await admin.get('/api/admin/stats?days=7');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body;
  assert.equal(s.series.length, 7);
  const [{ n: users }] = await q('SELECT count(*)::int AS n FROM users');
  assert.equal(s.series.reduce((t, d) => t + d.signups, 0), users);
  assert.ok(s.activePlayers.d1 >= 1);
  const starter = s.packs.find(x => x.id === 'starter');
  const [{ n: opens }] = await q("SELECT count(*)::int AS n FROM security_events WHERE event='pack_open' AND details->>'packId'='starter'");
  assert.equal(starter.opens, opens);
  assert.equal(starter.coins, opens * 100);
  const [{ gained, spent }] = await q('SELECT COALESCE(sum(amount) FILTER (WHERE amount>0),0)::int AS gained, COALESCE(-sum(amount) FILTER (WHERE amount<0),0)::int AS spent FROM coin_ledger');
  assert.deepEqual([s.economy.gained, s.economy.spent], [gained, spent]);
  assert.equal(s.market.sold, 1);
  assert.equal(s.market.volume, 120);
  assert.ok(s.rarity.reduce((t, x) => t + x.n, 0) > 0);
  assert.ok(s.topSpenders.length > 0);
});
