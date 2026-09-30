'use strict';

// Notifications : surenchère, fin d'enchère (vente, achat, sans offre), récompenses disponibles,
// lecture, cloisonnement entre joueurs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

async function sellerWithAuction(startingBid = 100) {
  const seller = await newPlayer(server, 'Vendeur');
  const card = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  const r = await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid, duration: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { seller, card, auction: r.body.auction };
}
const expire = id => server.db.query("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [id]);
const notes = async who => (await who.get('/api/notifications')).body;

test('non connecté : 401', async () => {
  const r = await fetch(server.base + '/api/notifications');
  assert.equal(r.status, 401);
});

test('nouveau joueur : aucune notification, bonus quotidien compté comme récompense', async () => {
  const p = await newPlayer(server, 'Nouveau');
  const n = await notes(p);
  assert.deepEqual([n.notifications.length, n.unread], [0, 0]);
  assert.ok(n.rewardsReady >= 1);
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  assert.equal((await notes(p)).rewardsReady, n.rewardsReady - 1);
});

test('surenchère : le joueur dépassé est prévenu, pas le nouvel enchérisseur', async () => {
  const { card, auction } = await sellerWithAuction();
  const alice = await newPlayer(server, 'Alice');
  const bob = await newPlayer(server, 'Bob');
  assert.equal((await alice.post('/api/auctions/bid', { auctionId: auction.id, amount: 100 })).status, 200);
  assert.equal((await notes(alice)).unread, 0);
  assert.equal((await bob.post('/api/auctions/bid', { auctionId: auction.id, amount: 110 })).status, 200);
  const a = await notes(alice);
  assert.equal(a.unread, 1);
  assert.equal(a.notifications[0].kind, 'outbid');
  assert.ok(a.notifications[0].title.includes(card.name));
  assert.ok(a.notifications[0].body.includes('110'));
  assert.equal((await notes(bob)).unread, 0);
  // Relancer sa propre offre ne prévient personne.
  assert.equal((await bob.post('/api/auctions/bid', { auctionId: auction.id, amount: 130 })).status, 200);
  assert.equal((await notes(alice)).unread, 1);
});

test('fin d\'enchère : acheteur et vendeur prévenus une seule fois', async () => {
  const { seller, auction } = await sellerWithAuction(150);
  const buyer = await newPlayer(server, 'Acheteur');
  await buyer.post('/api/auctions/bid', { auctionId: auction.id, amount: 150 });
  await expire(auction.id);
  await buyer.get('/api/auctions');
  await seller.get('/api/auctions');
  const b = (await notes(buyer)).notifications.filter(n => n.kind === 'auction_won');
  const s = (await notes(seller)).notifications.filter(n => n.kind === 'auction_sold');
  assert.equal(b.length, 1);
  assert.equal(s.length, 1);
  assert.ok(s[0].body.includes('150'));
  assert.equal(b[0].link, '#collection');
});

test('fin sans offre : le vendeur est prévenu', async () => {
  const { seller, auction } = await sellerWithAuction();
  await expire(auction.id);
  await seller.get('/api/auctions');
  assert.equal((await notes(seller)).notifications.filter(n => n.kind === 'auction_unsold').length, 1);
});

test('lecture : jusqu\'à un identifiant, puis tout ; chaque joueur ne voit que les siennes', async () => {
  const { auction } = await sellerWithAuction();
  const p = await newPlayer(server, 'Lecteur');
  const others = [await newPlayer(server, 'Rival1'), await newPlayer(server, 'Rival2')];
  await p.post('/api/auctions/bid', { auctionId: auction.id, amount: 100 });
  await others[0].post('/api/auctions/bid', { auctionId: auction.id, amount: 110 });
  await p.post('/api/auctions/bid', { auctionId: auction.id, amount: 121 });
  await others[1].post('/api/auctions/bid', { auctionId: auction.id, amount: 134 });
  const n = await notes(p);
  assert.equal(n.unread, 2);
  const oldest = Math.min(...n.notifications.map(x => x.id));
  assert.equal((await p.post('/api/notifications/read', { upToId: oldest })).status, 200);
  assert.equal((await notes(p)).unread, 1);
  // Un autre joueur ne peut pas marquer les notifications de p.
  await others[0].post('/api/notifications/read', {});
  assert.equal((await notes(p)).unread, 1);
  await p.post('/api/notifications/read', {});
  const after = await notes(p);
  assert.equal(after.unread, 0);
  assert.ok(after.notifications.every(x => x.read));
  assert.ok(after.notifications.every(x => x.kind === 'outbid'));
});
