'use strict';

// Classement des collectionneurs (/api/leaderboard) : barème par rareté, doublons ignorés,
// cartes offertes par l'admin et comptes bannis exclus, classement de la semaine, données publiques.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer } = require('./helpers');

let server, alice, bruno, chloe, denis;
const q = (sql, params) => server.db.query(sql, params);

async function give(player, cardId, rarity, { source = 'pack:test', acquiredAt = null } = {}) {
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,acquired_at)
           VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Classement','France',$5,$6,COALESCE($7::timestamptz,now()))`,
    [crypto.randomUUID(), cardId, player.user.id, 'Joueur ' + cardId, rarity, source, acquiredAt]);
}

test.before(async () => {
  server = await startServer({ env: { LEADERBOARD_CACHE_MS: '0' } });
  alice = await newPlayer(server, 'Alice');
  bruno = await newPlayer(server, 'Bruno');
  chloe = await newPlayer(server, 'Chloé');
  denis = await newPlayer(server, 'Denis');
  // Base de départ connue : les cartes de bienvenue des joueurs de test sont retirées (base jetable).
  await q('DELETE FROM card_instances WHERE owner_id = ANY($1::uuid[])', [[alice, bruno, chloe, denis].map(p => p.user.id)]);
  const old = new Date(Date.now() - 30 * 86400_000).toISOString();
  await give(alice, 'lb-icon-1', 'icon', { acquiredAt: old });
  await give(alice, 'lb-icon-1', 'icon', { acquiredAt: old }); // doublon : ne compte pas
  await give(alice, 'lb-icon-2', 'icon', { acquiredAt: old });
  await give(bruno, 'lb-leg-1', 'legendary');
  for (const id of ['lb-c-1', 'lb-c-2', 'lb-c-3']) await give(bruno, id, 'common');
  await give(chloe, 'lb-icon-3', 'icon', { source: 'admin_grant' }); // don de l'admin : exclu
  await give(chloe, 'lb-rare-1', 'rare');
  await give(denis, 'lb-icon-4', 'icon');
  await q("UPDATE users SET account_status='banned' WHERE id=$1", [denis.user.id]);
});
test.after(async () => { await server?.stop(); });

test('général : points par rareté, doublons ignorés, dons admin et bannis exclus', async () => {
  const r = await alice.get('/api/leaderboard');
  assert.equal(r.status, 200);
  const top = r.body.top.map(p => [p.rank, p.name, p.score, p.uniqueCards, p.topCards]);
  assert.deepEqual(top.slice(0, 3), [[1, 'Alice', 100, 2, 2], [2, 'Bruno', 23, 4, 1], [3, 'Chloé', 3, 1, 0]]);
  assert.ok(!r.body.top.some(p => p.name === 'Denis'), 'compte banni classé');
  assert.deepEqual(r.body.points, { common: 1, rare: 3, epic: 8, legendary: 20, icon: 50 });
  assert.equal(r.body.me.rank, 1);
  assert.ok(r.body.top.find(p => p.name === 'Alice').me);
  assert.ok(!r.body.top.find(p => p.name === 'Bruno').me);
});

test('semaine : seules les cartes obtenues depuis lundi comptent', async () => {
  const r = await bruno.get('/api/leaderboard?period=week');
  assert.equal(r.body.period, 'week');
  assert.ok(Date.parse(r.body.week.start) <= Date.now() && Date.now() < Date.parse(r.body.week.end));
  const names = r.body.top.map(p => p.name);
  assert.equal(names[0], 'Bruno');
  assert.ok(!names.includes('Alice'), 'cartes anciennes comptées dans la semaine');
  assert.equal(r.body.me.rank, 1);
  const a = (await alice.get('/api/leaderboard?period=week')).body.me;
  assert.deepEqual([a.rank, a.score], [null, 0]);
});

test('public : visible sans compte, sans identifiant ni e-mail', async () => {
  const r = await fetch(server.base + '/api/leaderboard');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.me, null);
  const raw = JSON.stringify(body);
  for (const p of [alice, bruno]) {
    assert.ok(!raw.includes(p.user.id), 'identifiant exposé');
    assert.ok(!raw.includes(p.user.email), 'e-mail exposé');
  }
  assert.equal((await (await fetch(server.base + '/api/leaderboard?period=nimporte')).json()).period, 'all');
});

test('égalité : même rang, et une nouvelle carte fait monter le joueur', async () => {
  await give(chloe, 'lb-leg-2', 'legendary');
  for (const id of ['lb-c-1', 'lb-c-2']) await give(chloe, id, 'common');
  // Chloé : 3 + 20 + 2 = 25 > Bruno 23.
  const top = (await chloe.get('/api/leaderboard')).body.top;
  assert.deepEqual(top.slice(0, 3).map(p => [p.rank, p.name]), [[1, 'Alice'], [2, 'Chloé'], [3, 'Bruno']]);
  await give(bruno, 'lb-c-4', 'common');
  await give(bruno, 'lb-c-5', 'common');
  const tied = (await bruno.get('/api/leaderboard')).body.top.filter(p => p.score === 25);
  assert.equal(tied.length, 2);
});
