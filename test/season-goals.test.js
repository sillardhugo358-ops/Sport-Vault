'use strict';

// Objectifs de saison : progression par saison (cartes possédées distinctes), paliers 25/50/75/100 %, récompense unique par palier,
// journal des FC, refus sans rien consommer au plafond quotidien commun avec les sets, demandes simultanées.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, awayFromParisMidnight } = require('./helpers');
const { SEASON_GOALS, SET_DAILY_CAP_COINS } = require('../lib/game-config');
const { reached } = require('../lib/season-goals');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const SEASON = '2031-2032';
const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `goal-${from + i}`);
async function give(p, cardIds) {
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
    SELECT gen_random_uuid(),c.id,$1,c.season,c.name,c.position,c.club,c.nation,c.rarity,'pack:test' FROM catalog_cards c WHERE c.id = ANY($2::text[])`, [p.user.id, cardIds]);
}
const coins = async p => Number((await q('SELECT coins FROM users WHERE id=$1', [p.user.id]))[0].coins);
const mine = async p => (await p.get('/api/season-goals')).body.seasons.find(s => s.season === SEASON);

test.before(async () => {
  server = await startServer();
  await q(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr)
    SELECT 'goal-' || n, '${SEASON}', 'Joueur Objectif ' || n, 'ST', 'FC Objectif', 'France', 'common', 70 FROM generate_series(1,20) n`);
});
test.after(async () => { await server?.stop(); });

test('seuils : arrondi exact, aucune saison vide', () => {
  assert.equal(reached(5, 20, 25), true); assert.equal(reached(4, 20, 25), false);
  assert.equal(reached(0, 0, 25), false); assert.equal(reached(20, 20, 100), true); assert.equal(reached(19, 20, 100), false);
  assert.deepEqual(SEASON_GOALS.tiers.map(t => t.pct), [25, 50, 75, 100]);
});

test('connexion obligatoire', async () => {
  const anon = await require('./helpers').client(server);
  assert.equal((await anon.get('/api/season-goals')).status, 401);
  assert.equal((await anon.post('/api/season-goals/claim', { season: SEASON, pct: 25 })).status, 401);
});

test('progression, récompense unique par palier, journal des FC', async () => {
  const p = await newPlayer(server, 'Objectifs');
  let s = await mine(p);
  assert.equal(s.total, 20); assert.equal(s.owned, 0);
  assert.ok(s.tiers.every(t => !t.reached && !t.claimable));
  assert.equal((await p.post('/api/season-goals/claim', { season: SEASON, pct: 25 })).status, 400, 'palier non atteint');
  await give(p, ids(1, 5));
  await give(p, ids(1, 5)); // doublons : comptés une fois
  s = await mine(p);
  assert.equal(s.owned, 5); assert.equal(s.tiers[0].claimable, true); assert.equal(s.tiers[1].reached, false);
  const before = await coins(p);
  const r = await p.post('/api/season-goals/claim', { season: SEASON, pct: 25 });
  assert.equal(r.status, 200); assert.equal(r.body.reward.coins, 500);
  assert.equal(await coins(p), before + 500);
  assert.equal((await q("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=$1 AND ref=$2", [p.user.id, 'goal:' + SEASON + ':25']))[0].n, 1);
  assert.equal((await p.post('/api/season-goals/claim', { season: SEASON, pct: 25 })).status, 400, 'jamais deux fois');
  assert.equal(await coins(p), before + 500);
  assert.equal((await p.post('/api/season-goals/claim', { season: SEASON, pct: 33 })).status, 404, 'palier inconnu');
  assert.equal((await p.post('/api/season-goals/claim', { season: 'inconnue', pct: 25 })).status, 404, 'saison inconnue');
  assert.equal((await mine(p)).tiers[0].claimed, true);
});

test('demandes simultanées : une seule récompense', async () => {
  const p = await newPlayer(server, 'Simultane');
  await give(p, ids(1, 10));
  const before = await coins(p);
  const res = await Promise.all(Array.from({ length: 4 }, () => p.post('/api/season-goals/claim', { season: SEASON, pct: 50 })));
  assert.equal(res.filter(r => r.status === 200).length, 1);
  assert.equal(await coins(p), before + 1000);
});

test('plafond quotidien commun avec les sets : refus sans rien consommer', async () => {
  await awayFromParisMidnight();
  const p = await newPlayer(server, 'Plafond');
  await give(p, ids(1, 20));
  // 2 000 FC déjà gagnés aujourd'hui par un set : 5 000 + 2 000 + 1 000 passent (10 000), les 500 FC du palier 25 % dépassent le plafond.
  await q("INSERT INTO coin_ledger(user_id,amount,reason,ref) VALUES($1,2000,'reward','set:autre')", [p.user.id]);
  const before = await coins(p);
  for (const pct of [100, 75, 50]) assert.equal((await p.post('/api/season-goals/claim', { season: SEASON, pct })).status, 200);
  assert.equal(await coins(p), before + 8000);
  const info = (await p.get('/api/season-goals')).body;
  assert.equal(info.dailyCap, SET_DAILY_CAP_COINS); assert.equal(info.remainingToday, 0);
  const t = info.seasons.find(x => x.season === SEASON).tiers[0];
  assert.equal(t.reached, true); assert.equal(t.claimable, false); assert.equal(t.blockedByCap, true);
  const blocked = await p.post('/api/season-goals/claim', { season: SEASON, pct: 25 });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'daily_cap');
  assert.equal(await coins(p), before + 8000, 'rien de crédité');
  assert.equal((await q('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2', [p.user.id, 'goal:' + SEASON + ':25'])).length, 0, 'palier non consommé');
});
