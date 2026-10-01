'use strict';

// Cartes favorites (vitrine du Profil) : connexion requise, seulement ses propres cartes,
// 5 au maximum même en rafale, retrait idempotent, carte vendue retirée de la vitrine.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');
const { MAX_FAVORITES } = require('../lib/favorites');

let server, owner, other;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;

test.before(async () => {
  server = await startServer();
  owner = await newPlayer(server, 'Collectionneur');
  other = await newPlayer(server, 'Voisin');
  await q('UPDATE users SET coins=100000 WHERE id=ANY($1)', [[owner.user.id, other.user.id]]);
});
test.after(async () => { await server?.stop(); });

const packCards = async p => (await p.post('/api/packs/open', { packId: 'starter' })).body.cards;
const fav = (p, instanceId, favorite = true) => p.post('/api/favorites', { instanceId, favorite });

test('connexion requise ; impossible de mettre en favori la carte d\'un autre', async () => {
  const anon = client(server);
  assert.equal((await anon.get('/api/favorites')).status, 401);
  assert.equal((await anon.post('/api/favorites', { instanceId: '00000000-0000-0000-0000-000000000000' })).status, 401);
  const [theirs] = await packCards(other);
  assert.equal((await fav(owner, theirs.instanceId)).status, 404);
  assert.equal((await fav(owner, 'pas-un-uuid')).status, 404);
  assert.equal((await q('SELECT count(*)::int AS n FROM favorite_cards'))[0].n, 0);
});

test(`ajout, ordre, limite de ${MAX_FAVORITES} même en rafale, retrait idempotent`, async () => {
  const cards = [...await packCards(owner), ...await packCards(owner)];
  const first = await fav(owner, cards[0].instanceId);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.favorites.map(c => c.instanceId), [cards[0].instanceId]);
  assert.equal((await fav(owner, cards[0].instanceId)).status, 200, 'ajout répété accepté sans doublon');
  const burst = await Promise.all(cards.slice(1, 9).map(c => fav(owner, c.instanceId)));
  assert.equal(burst.filter(r => r.status === 200).length, MAX_FAVORITES - 1);
  assert.ok(burst.filter(r => r.status === 400).every(r => /favorites/.test(r.body.error)));
  const list = (await owner.get('/api/favorites')).body.favorites;
  assert.equal(list.length, MAX_FAVORITES);
  assert.equal(list[0].instanceId, cards[0].instanceId);
  assert.equal((await fav(owner, cards[0].instanceId, false)).status, 200);
  assert.equal((await fav(owner, cards[0].instanceId, false)).status, 200);
  assert.equal((await owner.get('/api/favorites')).body.favorites.length, MAX_FAVORITES - 1);
  const profile = (await owner.get('/api/profile')).body;
  assert.equal(profile.favorites.length, MAX_FAVORITES - 1);
  assert.ok(profile.profile && profile.collection, 'le reste du profil est inchangé');
});

test('carte mise en vente : toujours affichée ; vendue : retirée chez le vendeur, absente chez l\'acheteur', async () => {
  const seller = await newPlayer(server, 'Vendeur');
  const [card] = await packCards(seller);
  assert.equal((await fav(seller, card.instanceId)).status, 200);
  const a = (await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 100, duration: 10 })).body.auction;
  assert.equal((await seller.get('/api/favorites')).body.favorites.length, 1, 'en vente : toujours en vitrine');
  assert.equal((await other.post('/api/auctions/bid', { auctionId: a.id, amount: 100 })).status, 200);
  await q("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [a.id]);
  await other.get('/api/auctions'); // règle l'enchère
  assert.equal((await seller.get('/api/favorites')).body.favorites.length, 0);
  assert.ok(!(await other.get('/api/favorites')).body.favorites.some(c => c.instanceId === card.instanceId));
  // L'ancien favori ne bloque pas la limite du vendeur.
  const more = await packCards(seller);
  for (const c of more) assert.equal((await fav(seller, c.instanceId)).status, 200);
});
