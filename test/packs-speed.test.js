'use strict';

// Ouverture d'un pack en peu de requêtes : cartes insérées en un seul INSERT, débit + journal en une requête,
// événement de sécurité écrit après la validation ; démarrage sans réinsérer le catalogue Foot Mercato.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins, userRow } = require('./helpers');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('ouverture : cartes, débit, journal des FC et événement de sécurité cohérents', async () => {
  const p = await newPlayer(server, 'Rapide');
  await setCoins(server, p.user.id, 1000);
  const before = Number((await userRow(server, p.user.id)).coins);
  const r = await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cards.length, 5);
  assert.equal(new Set(r.body.cards.map(c => c.instanceId)).size, 5, 'cinq exemplaires distincts');
  const rows = await q("SELECT card_id,owner_id,rarity,ovr,status,source,serial FROM card_instances WHERE owner_id=$1 AND source='pack:starter'", [p.user.id]);
  assert.equal(rows.length, 5);
  assert.ok(rows.every(x => x.status === 'owned' && x.ovr > 0 && x.serial === null));
  assert.deepEqual(rows.map(x => x.card_id).sort(), r.body.cards.map(c => c.cardId).sort());
  const coins = Number((await userRow(server, p.user.id)).coins);
  assert.equal(coins, before - 100);
  assert.equal(r.body.user.coins, coins, 'solde renvoyé = solde en base');
  assert.deepEqual((await q("SELECT amount,reason,ref FROM coin_ledger WHERE user_id=$1 AND reason='pack'", [p.user.id])).map(x => [Number(x.amount), x.ref]), [[-100, 'starter']]);
  assert.equal((await q("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='pack_open'", [p.user.id]))[0].n, 1);
});

test('solde insuffisant : rien débité, rien inséré, rien journalisé', async () => {
  const p = await newPlayer(server, 'Fauche');
  await setCoins(server, p.user.id, 10);
  const r = await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal(r.status, 400);
  assert.equal(Number((await userRow(server, p.user.id)).coins), 10);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND source='pack:starter'", [p.user.id]))[0].n, 0);
  assert.equal((await q("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=$1 AND reason='pack'", [p.user.id]))[0].n, 0);
});

test('redémarrage : le catalogue Foot Mercato n\'est pas réinséré ni dupliqué', async () => {
  const count = async () => (await q("SELECT count(*)::int AS n,count(DISTINCT id)::int AS d FROM catalog_cards"))[0];
  const first = await count();
  assert.ok(first.n >= 478);
  await q("DELETE FROM catalog_cards WHERE id=(SELECT min(id) FROM catalog_cards WHERE card_order>0 AND id NOT LIKE 'fv-%')");
  await server.restart();
  const second = await count();
  assert.equal(second.n, first.n, 'la carte supprimée est recréée (comme avant), sans doublon');
  assert.equal(second.n, second.d);
});

test('16 joueurs ouvrent en même temps : aucune connexion de la base épuisée', async () => {
  const players = [];
  for (let i = 0; i < 16; i++) players.push(await newPlayer(server, 'Meute' + i));
  const results = await Promise.all(players.map(p => p.post('/api/packs/open', { packId: 'starter' })));
  assert.deepEqual(results.map(r => r.status), Array(16).fill(200));
});
