'use strict';

// Enchères : durées autorisées, palier +10 %, prolongation anti-sniping,
// réservation des FOOTCOINS et règlement final.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

// Vendeur avec une carte issue d'un pack (les cartes de bienvenue ne se vendent pas).
async function sellerWithCard() {
  const seller = await newPlayer(server, 'Vendeur');
  const opened = await seller.post('/api/packs/open', { packId: 'starter' });
  return { seller, card: opened.body.cards[0] };
}

async function createAuction(seller, card, startingBid = 100, duration = 10) {
  const r = await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid, duration });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.auction;
}

const auctionRow = async id => (await server.db.query('SELECT * FROM auctions WHERE id=$1', [id])).rows[0];
const reserved = async p => Number((await userRow(server, p.user.id)).reserved_coins);

test('création : durées autorisées uniquement (10 min à 24 h)', async () => {
  const { seller, card } = await sellerWithCard();
  for (const bad of [5, 15, 120, 2880]) {
    const r = await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 100, duration: bad });
    assert.equal(r.status, 400, `durée ${bad} acceptée`);
  }
  for (const [i, ok] of [10, 30, 60, 180, 360, 720, 1440].entries()) {
    const extra = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
    const a = await createAuction(seller, i === 0 ? card : extra, 100, ok);
    const ms = new Date(a.endsAt) - Date.now();
    assert.ok(Math.abs(ms - ok * 60_000) < 10_000, `durée ${ok} min : ${ms} ms`);
  }
});

test('création : carte de bienvenue ou carte d\'un autre joueur refusée', async () => {
  const seller = await newPlayer(server, 'Nouveau');
  const welcome = (await seller.get('/api/collection')).body.cards[0];
  assert.equal((await seller.post('/api/auctions/create', { cardInstanceId: welcome.instanceId, startingBid: 100, duration: 10 })).status, 400);
  const { card } = await sellerWithCard();
  assert.equal((await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 100, duration: 10 })).status, 400);
});

test('enchère : mise de départ, puis palier minimal de +10 %', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  const bob = await newPlayer(server, 'Bob');
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 99 })).status, 400);
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })).status, 200);
  const low = await bob.post('/api/auctions/bid', { auctionId: a.id, amount: 109 });
  assert.equal(low.status, 400);
  assert.match(low.body.error, /110/);
  assert.equal((await bob.post('/api/auctions/bid', { auctionId: a.id, amount: 110 })).status, 200);
});

test('enchère : le vendeur ne peut pas enchérir sur sa carte', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card);
  assert.equal((await seller.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })).status, 400);
});

test('enchère : FC réservés, puis libérés quand on est surenchéri', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 200);
  const alice = await newPlayer(server, 'Alice');
  const bob = await newPlayer(server, 'Bob');
  await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 200 });
  assert.equal(await reserved(alice), 200);
  await bob.post('/api/auctions/bid', { auctionId: a.id, amount: 220 });
  assert.equal(await reserved(alice), 0);
  assert.equal(await reserved(bob), 220);
});

test('enchère : impossible au-delà des FC disponibles', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 1001 })).status, 400);
  assert.equal(await reserved(alice), 0);
});

test('anti-sniping : enchère dans les 30 dernières secondes, +1 minute', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  await server.db.query("UPDATE auctions SET ends_at=now()+interval '20 seconds' WHERE id=$1", [a.id]);
  const before = new Date((await auctionRow(a.id)).ends_at).getTime();
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })).status, 200);
  const after = new Date((await auctionRow(a.id)).ends_at).getTime();
  assert.equal(after - before, 60_000);
});

test('anti-sniping : pas de prolongation hors des 30 dernières secondes', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  await server.db.query("UPDATE auctions SET ends_at=now()+interval '45 seconds' WHERE id=$1", [a.id]);
  const before = new Date((await auctionRow(a.id)).ends_at).getTime();
  await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 });
  assert.equal(new Date((await auctionRow(a.id)).ends_at).getTime(), before);
});

test('règlement : carte au gagnant, FC au vendeur, réservation soldée', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  const bob = await newPlayer(server, 'Bob');
  await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 });
  await bob.post('/api/auctions/bid', { auctionId: a.id, amount: 150 });
  const sellerBefore = Number((await userRow(server, seller.user.id)).coins);
  await server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await bob.get('/api/auctions'); // déclenche le règlement des enchères expirées
  assert.equal((await auctionRow(a.id)).status, 'completed');
  assert.equal(Number((await userRow(server, seller.user.id)).coins), sellerBefore + 150);
  const b = await userRow(server, bob.user.id);
  assert.equal(Number(b.coins), 1000 - 150);
  assert.equal(Number(b.reserved_coins), 0);
  assert.equal(Number((await userRow(server, alice.user.id)).coins), 1000);
  const owned = (await server.db.query('SELECT owner_id,status FROM card_instances WHERE instance_id=$1', [card.instanceId])).rows[0];
  assert.deepEqual(owned, { owner_id: bob.user.id, status: 'owned' });
});

test('règlement : sans enchère, la carte revient au vendeur', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  await server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await seller.get('/api/auctions');
  const owned = (await server.db.query('SELECT owner_id,status FROM card_instances WHERE instance_id=$1', [card.instanceId])).rows[0];
  assert.deepEqual(owned, { owner_id: seller.user.id, status: 'owned' });
});

test('enchère terminée : plus aucune mise acceptée', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  await server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })).status, 400);
});

test('annulation : possible avant la première enchère seulement', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  assert.equal((await seller.post('/api/auctions/cancel', { auctionId: a.id })).status, 200);
  const other = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  const b = await createAuction(seller, other, 100);
  const alice = await newPlayer(server, 'Alice');
  await alice.post('/api/auctions/bid', { auctionId: b.id, amount: 100 });
  assert.equal((await seller.post('/api/auctions/cancel', { auctionId: b.id })).status, 400);
});

test('enchères simultanées : un seul gagnant par palier, réservations cohérentes', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const players = await Promise.all(['A', 'B', 'C', 'D', 'E'].map(n => newPlayer(server, 'Rival' + n)));
  const results = await Promise.all(players.map(p => p.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const total = (await Promise.all(players.map(reserved))).reduce((s, x) => s + x, 0);
  assert.equal(total, 100);
});

test('retrait : un enchérisseur surenchéri quitte la vente et ne peut plus miser', async () => {
  const { seller, card } = await sellerWithCard();
  const a = await createAuction(seller, card, 100);
  const alice = await newPlayer(server, 'Alice');
  const bob = await newPlayer(server, 'Bob');
  await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 100 });
  await bob.post('/api/auctions/bid', { auctionId: a.id, amount: 110 });
  const w = await alice.post('/api/auctions/withdraw', { auctionId: a.id });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(await reserved(alice), 0);
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: a.id, amount: 200 })).status, 400);
});
