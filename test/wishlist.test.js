'use strict';

// Liste de souhaits : ajout, doublon, limite de 50, retrait, recherche, droits ; alerte quand une carte souhaitée est mise aux enchères
// (une seule notification, pas pour le vendeur, pas en double d'une alerte de prix).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');

let server, a, b, c;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
const catalogCard = async (name, rarity = 'rare') => {
  n++;
  const id = 'wish-' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Souhait','France',$3,80)", [id, name, rarity]);
  return id;
};

test.before(async () => { server = await startServer(); [a, b, c] = [await newPlayer(server, 'Alma'), await newPlayer(server, 'Boris'), await newPlayer(server, 'Cleo')]; });
test.after(async () => { await server.stop?.(); });

test('ajout, doublon, retrait, recherche et droits', async () => {
  const id = await catalogCard('Joueur Recherché');
  assert.equal((await client(server).get('/api/wishlist')).status, 401);
  assert.equal((await a.post('/api/wishlist/add', { cardId: 'inconnue' })).status, 404);
  assert.equal((await a.post('/api/wishlist/add', { cardId: id })).status, 200);
  assert.equal((await a.post('/api/wishlist/add', { cardId: id })).body.already, true, 'doublon sans erreur');
  const l = (await a.get('/api/wishlist')).body;
  assert.equal(l.cards.length, 1);
  assert.equal(l.cards[0].name, 'Joueur Recherché');
  assert.equal(l.cards[0].owned, 0);
  assert.equal((await b.get('/api/wishlist')).body.cards.length, 0, 'la liste est personnelle');
  const s = (await a.get('/api/wishlist/search?q=Recherch')).body.cards;
  assert.equal(s.length, 1);
  assert.equal(s[0].wished, true);
  assert.deepEqual((await a.get('/api/wishlist/search?q=a')).body.cards, [], 'au moins 2 caractères');
  assert.equal((await a.post('/api/wishlist/remove', { cardId: id })).status, 200);
  assert.equal((await a.get('/api/wishlist')).body.cards.length, 0);
});

test('limite de 50 cartes', async () => {
  const p = await newPlayer(server, 'Collectionneuse');
  for (let i = 0; i < 50; i++) assert.equal((await p.post('/api/wishlist/add', { cardId: await catalogCard('Carte limite ' + i) })).status, 200);
  const r = await p.post('/api/wishlist/add', { cardId: await catalogCard('Carte de trop') });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /pleine/);
});

test('alerte à la mise aux enchères : souhaiteur prévenu une fois, pas le vendeur, pas en double d\'une alerte de prix', async () => {
  const opened = await b.post('/api/packs/open', { packId: 'starter' });
  const card = opened.body.cards[0];
  // a et b veulent cette carte (b est le vendeur) ; c la veut aussi mais a déjà une alerte de prix qui s'applique
  await a.post('/api/wishlist/add', { cardId: card.cardId });
  await b.post('/api/wishlist/add', { cardId: card.cardId });
  await c.post('/api/wishlist/add', { cardId: card.cardId });
  await q("INSERT INTO price_alerts(user_id,card_id,max_price) VALUES($1,$2,1000)", [c.user.id, card.cardId]);
  const r = await b.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 100, duration: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const kinds = async p => (await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind IN ('wishlist_auction','price_alert')", [p.user.id])).map(x => x.kind);
  assert.deepEqual(await kinds(a), ['wishlist_auction']);
  assert.deepEqual(await kinds(b), [], 'le vendeur n\'est pas prévenu');
  assert.deepEqual(await kinds(c), ['price_alert'], 'alerte de prix seulement, pas de doublon');
  const l = (await a.get('/api/wishlist')).body.cards[0];
  assert.equal(l.selling, 1);
  assert.equal(l.fromPrice, 100);
  assert.equal(l.auctionId, r.body.auction.id);
});
