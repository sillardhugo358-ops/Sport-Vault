'use strict';

// Récompenses du classement de la semaine (lib/leaderboard.js) : semaine écoulée figée une seule
// fois, barème par rang (ex æquo : même récompense), notification, récupération unique même en
// rafale et journalisée, rien pour un joueur non classé.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, userRow, awayFromParisMidnight } = require('./helpers');
const { periodInfo } = require('../lib/periods');
const { LEADERBOARD_REWARDS } = require('../lib/game-config');

let server, alice, bruno, chloe, david, emma;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
// Calculées dans before(), une fois la garde de minuit passée : sinon une exécution lancée juste avant
// le passage de semaine (dimanche 22 h UTC) comparerait avec la semaine d'avant l'attente.
let lastWeek, inLastWeek;

async function give(player, cardId, rarity, acquiredAt = inLastWeek) {
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,acquired_at)
    VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Classement','France',$5,'pack:test',$6)`,
  [crypto.randomUUID(), cardId, player.user.id, 'Joueur ' + cardId, rarity, acquiredAt]);
}

test.before(async () => {
  await awayFromParisMidnight();
  lastWeek = periodInfo('weekly', new Date(periodInfo('weekly').start.getTime() - 1000));
  inLastWeek = new Date(lastWeek.start.getTime() + 86400_000).toISOString();
  server = await startServer({ env: { LEADERBOARD_CACHE_MS: '0', LEADERBOARD_FIRST_WEEK: '2000-01-03' } });
  [alice, bruno, chloe, david, emma] = [await newPlayer(server, 'Alice'), await newPlayer(server, 'Bruno'), await newPlayer(server, 'Chloe'), await newPlayer(server, 'David'), await newPlayer(server, 'Emma')];
  await give(alice, 'lr-icon', 'icon');          // 50 pts : 1re
  await give(bruno, 'lr-leg', 'legendary');      // 20 pts : 2e
  await give(chloe, 'lr-rare-1', 'rare');        // 3 pts : 3e ex æquo
  await give(david, 'lr-rare-2', 'rare');        // 3 pts : 3e ex æquo
  await give(emma, 'lr-icon-now', 'icon', new Date().toISOString()); // cette semaine : rien pour la semaine écoulée
});
test.after(async () => { await server?.stop(); });

test('semaine écoulée figée : rangs, barème, ex æquo, notification', async () => {
  const d = (await alice.get('/api/leaderboard?period=week')).body;
  assert.deepEqual(d.rewards, LEADERBOARD_REWARDS);
  assert.deepEqual(d.myRewards.map(r => [r.week, r.rank, r.reward.coins, r.claimed]), [[lastWeek.key, 1, 5000, false]]);
  const results = await q('SELECT user_id,rank,coins FROM leaderboard_results WHERE week_key=$1 ORDER BY rank,coins', [lastWeek.key]);
  const byUser = new Map(results.map(r => [r.user_id, r]));
  assert.equal(byUser.get(bruno.user.id).coins, 3000);
  assert.deepEqual([byUser.get(chloe.user.id).rank, byUser.get(david.user.id).rank], [3, 3]);
  assert.equal(byUser.get(chloe.user.id).coins, 2000);
  assert.ok(!byUser.has(emma.user.id), 'cartes de cette semaine : pas comptées pour la semaine écoulée');
  const notif = (await alice.get('/api/notifications')).body;
  assert.ok(notif.notifications.some(n => n.kind === 'leaderboard_reward' && n.title.includes('1er')));
  assert.ok(notif.rewardsReady >= 1);
  // Une seule fois, même après redémarrage.
  await server.restart();
  await bruno.get('/api/leaderboard');
  assert.equal((await q('SELECT count(*)::int AS n FROM leaderboard_results WHERE week_key=$1', [lastWeek.key]))[0].n, results.length);
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE kind='leaderboard_reward' AND user_id=$1", [alice.user.id]))[0].n, 1);
});

test('récupération : une seule fois en rafale, journalisée ; rien sans classement', async () => {
  const before = Number((await userRow(server, alice.user.id)).coins);
  const burst = await Promise.all(Array.from({ length: 5 }, () => alice.post('/api/leaderboard/claim', { week: lastWeek.key })));
  assert.equal(burst.filter(r => r.status === 200).length, 1);
  assert.equal(Number((await userRow(server, alice.user.id)).coins), before + 5000);
  assert.deepEqual((await q('SELECT amount FROM coin_ledger WHERE user_id=$1 AND ref=$2', [alice.user.id, 'leaderboard-week:' + lastWeek.key])).map(r => r.amount), [5000]);
  assert.equal((await alice.get('/api/leaderboard')).body.myRewards[0].claimed, true);
  assert.equal((await emma.post('/api/leaderboard/claim', { week: lastWeek.key })).status, 404);
  assert.equal((await alice.post('/api/leaderboard/claim', { week: '1999-01-04' })).status, 404);
});
