'use strict';

// Marché plus lisible : prix de référence (médiane des ventes, enchères sans offre exclues),
// historique des ventes par carte, ventes récentes, alertes de prix (validation, limite,
// notification unique au bon joueur, jamais au vendeur).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');
const { MAX_ALERTS } = require('../lib/market');

let server, seller, buyer;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;

test.before(async () => {
  server = await startServer();
  seller = await newPlayer(server, 'Vendeur');
  buyer = await newPlayer(server, 'Acheteur');
  await q('UPDATE users SET coins=100000 WHERE id=ANY($1)', [[buyer.user.id, seller.user.id]]);
});
test.after(async () => { await server?.stop(); });

// Carte de pack (vendable) du vendeur, forcée sur le même modèle de carte pour tous les tests.
async function sellable(cardId) {
  const card = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  if (cardId) await q('UPDATE card_instances i SET card_id=k.id,name=k.name FROM catalog_cards k WHERE k.id=$1 AND i.instance_id=$2', [cardId, card.instanceId]);
  return card;
}
async function sell(cardId, price, { bid = true } = {}) {
  const card = await sellable(cardId);
  const a = (await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: price, duration: 10 })).body.auction;
  if (bid) assert.equal((await buyer.post('/api/auctions/bid', { auctionId: a.id, amount: price })).status, 200);
  await q("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await buyer.get('/api/auctions'); // règle les enchères échues
  return a;
}

let target;
test('prix de référence et historique : seules les ventes avec acheteur comptent', async () => {
  target = (await q('SELECT id,name FROM catalog_cards ORDER BY id LIMIT 1'))[0];
  const empty = (await buyer.get('/api/market/card?cardId=' + encodeURIComponent(target.id))).body;
  assert.deepEqual([empty.reference, empty.sales.length], [null, 0]);
  await sell(target.id, 100);
  await sell(target.id, 300);
  await sell(target.id, 200);
  await sell(target.id, 5000, { bid: false }); // sans offre : ne compte pas
  const m = (await buyer.get('/api/market/card?cardId=' + encodeURIComponent(target.id))).body;
  assert.deepEqual(m.reference, { median: 200, sales: 3, low: 100, high: 300 });
  assert.deepEqual(m.sales.map(s => s.price), [200, 300, 100]);
  // La référence affichée sur une enchère en cours suit la même règle.
  const card = await sellable(target.id);
  await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 50, duration: 10 });
  const live = (await buyer.get('/api/auctions')).body.auctions.find(a => a.cardInstanceId === card.instanceId);
  assert.equal(live.referencePrice, 200);
  const again = (await buyer.get('/api/market/card?cardId=' + encodeURIComponent(target.id))).body;
  assert.deepEqual([again.active, again.lowestActive], [1, 50]);
});

test('ventes récentes : publiques, sans identité des joueurs', async () => {
  const r = await client(server).get('/api/market/sales');
  assert.equal(r.status, 200);
  assert.ok(r.body.sales.length >= 3);
  assert.equal(r.body.sales[0].card.cardId, target.id);
  assert.equal(r.body.sales[0].referencePrice, 200);
  assert.ok(!JSON.stringify(r.body).includes(buyer.user.id) && !JSON.stringify(r.body).includes('Vendeur'));
});

test('alertes : connexion, validation, mise à jour, suppression', async () => {
  assert.equal((await client(server).get('/api/market/alerts')).status, 401);
  for (const bad of [0, -5, 1.5, 'abc']) assert.equal((await buyer.post('/api/market/alerts', { cardId: target.id, maxPrice: bad })).status, 400, String(bad));
  assert.equal((await buyer.post('/api/market/alerts', { cardId: 'inconnue', maxPrice: 100 })).status, 404);
  assert.equal((await buyer.post('/api/market/alerts', { cardId: target.id, maxPrice: 150 })).status, 200);
  assert.equal((await buyer.post('/api/market/alerts', { cardId: target.id, maxPrice: 250 })).status, 200);
  const list = (await buyer.get('/api/market/alerts')).body.alerts;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].cardId, list[0].maxPrice, list[0].referencePrice, list[0].name], [target.id, 250, 200, target.name]);
  assert.equal((await buyer.get('/api/market/card?cardId=' + encodeURIComponent(target.id))).body.alert.maxPrice, 250);
  assert.equal((await buyer.post('/api/market/alerts', { action: 'delete', cardId: target.id })).status, 200);
  assert.equal((await buyer.get('/api/market/alerts')).body.alerts.length, 0);
});

test(`alertes : ${MAX_ALERTS} au maximum par joueur, même en rafale`, async () => {
  const p = await newPlayer(server, 'Collectionneur');
  const ids = (await q('SELECT id FROM catalog_cards ORDER BY id LIMIT $1', [MAX_ALERTS + 5])).map(r => r.id);
  const results = await Promise.all(ids.map(id => p.post('/api/market/alerts', { cardId: id, maxPrice: 10 })));
  assert.equal(results.filter(r => r.status === 200).length, MAX_ALERTS);
  assert.equal((await q('SELECT count(*)::int AS n FROM price_alerts WHERE user_id=$1', [p.user.id]))[0].n, MAX_ALERTS);
});

test('déclenchement : notification si la mise de départ ne dépasse pas le prix max, jamais au vendeur', async () => {
  const watcher = await newPlayer(server, 'Guetteur');
  const tooLow = await newPlayer(server, 'Radin');
  await watcher.post('/api/market/alerts', { cardId: target.id, maxPrice: 400 });
  await tooLow.post('/api/market/alerts', { cardId: target.id, maxPrice: 100 });
  await seller.post('/api/market/alerts', { cardId: target.id, maxPrice: 1000 });
  const card = await sellable(target.id);
  assert.equal((await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 350, duration: 10 })).status, 201);
  const notes = async p => (await p.get('/api/notifications')).body.notifications.filter(n => n.kind === 'price_alert');
  const w = await notes(watcher);
  assert.equal(w.length, 1);
  assert.match(w[0].title, new RegExp(target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(w[0].body, /350/);
  assert.equal((await notes(tooLow)).length, 0);
  assert.equal((await notes(seller)).length, 0);
  assert.ok((await watcher.get('/api/market/alerts')).body.alerts[0].lastNotifiedAt);
});
