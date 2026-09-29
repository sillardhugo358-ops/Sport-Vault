'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins, userRow } = require('./helpers');

const ORDER = { common: 1, rare: 2, epic: 3, legendary: 4, icon: 5 };
const atLeast = (cards, rarity) => cards.some(c => ORDER[c.rarity] >= ORDER[rarity]);

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

for (const [packId, price, count, guarantee] of [['starter', 100, 5, 'common'], ['pro', 250, 8, 'rare'], ['legend', 500, 5, 'epic']]) {
  test(`pack ${packId} : ${price} FC, ${count} cartes, garantie ${guarantee}`, async () => {
    const p = await newPlayer(server, 'Ouvreur');
    await setCoins(server, p.user.id, price * 10);
    for (let i = 0; i < 10; i++) {
      const r = await p.post('/api/packs/open', { packId });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.cards.length, count);
      assert.ok(atLeast(r.body.cards, guarantee), `aucune carte ${guarantee} ou mieux : ${r.body.cards.map(c => c.rarity)}`);
      assert.equal(new Set(r.body.cards.map(c => c.cardId)).size, count, 'carte en double dans un même pack');
    }
    const row = await userRow(server, p.user.id);
    assert.equal(Number(row.coins), 0);
    assert.equal(Number(row.packs_opened), 10);
    const col = await p.get('/api/collection');
    assert.equal(col.body.count, 3 + 10 * count);
  });
}

test('pack : solde insuffisant refusé, rien débité ni ajouté', async () => {
  const p = await newPlayer(server, 'Fauché');
  await setCoins(server, p.user.id, 99);
  const r = await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal(r.status, 400);
  assert.equal(Number((await userRow(server, p.user.id)).coins), 99);
  assert.equal((await p.get('/api/collection')).body.count, 3);
});

test('pack : ouvertures simultanées, jamais de solde négatif', async () => {
  const p = await newPlayer(server, 'Pressé');
  await setCoins(server, p.user.id, 300);
  const results = await Promise.all(Array.from({ length: 8 }, () => p.post('/api/packs/open', { packId: 'starter' })));
  const ok = results.filter(r => r.status === 200).length;
  assert.equal(ok, 3);
  const row = await userRow(server, p.user.id);
  assert.equal(Number(row.coins), 0);
  assert.equal((await p.get('/api/collection')).body.count, 3 + 3 * 5);
});

test('pack : pack inconnu refusé', async () => {
  const p = await newPlayer(server, 'Curieux');
  const r = await p.post('/api/packs/open', { packId: 'inexistant' });
  assert.equal(r.status, 404);
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1000);
});

test('pack : 8 joueurs ouvrent en même temps, tous servis', async () => {
  const players = [];
  for (let i = 0; i < 8; i++) players.push(await newPlayer(server, 'Foule' + i));
  const results = await Promise.all(players.map(p => p.post('/api/packs/open', { packId: 'starter' })));
  assert.deepEqual(results.map(r => r.status), Array(8).fill(200));
});
