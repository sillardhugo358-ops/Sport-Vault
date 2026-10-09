'use strict';

// Saisons de classement (8 semaines) : calendrier, score = cartes obtenues pendant la saison seulement, règlement une seule fois,
// récompense (FC, XP, cartes exclusives) récupérable une seule fois même en rafale, cartes LIMITED épuisées sans bloquer les FC, droits admin.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parisDayKey } = require('../lib/periods');

// Saison courante = la 3e : début il y a 122 jours (2 saisons de 56 jours terminées + 10 jours). À régler AVANT de charger lib/leaderboard.
const addDays = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const START = addDays(parisDayKey(), -122);
process.env.LEADERBOARD_SEASON_START = START;
const { seasonInfo, seasonWindow } = require('../lib/leaderboard');
const { SEASON } = require('../lib/game-config');
const { startServer, newPlayer, client } = require('./helpers');

let server, creator, p1, p2, p3;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const ENV = { LEADERBOARD_CACHE_MS: '0', LEADERBOARD_FIRST_WEEK: '2000-01-03', LEADERBOARD_SEASON_START: START };
const S1 = seasonWindow(1), S2 = seasonWindow(2), S3 = seasonWindow(3);
const mid = w => new Date((new Date(w.start).getTime() + new Date(w.end).getTime()) / 2).toISOString();
let n = 0;
async function give(p, count, { at, source = 'pack:test' } = {}) {
  for (let i = 0; i < count; i++) {
    n++;
    const cardId = 'sea-' + n, id = crypto.randomUUID();
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Saison','France','common',70)", [cardId, 'Joueur Saison ' + n]);
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,acquired_at)
      VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Saison','France','common',$5,$6)`, [id, cardId, p.user.id, 'Joueur Saison ' + n, source, at]);
  }
}
const lb = (p, period = 'season') => p.get('/api/leaderboard?period=' + period);

test.before(async () => {
  server = await startServer({ env: ENV });
  creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  p1 = await newPlayer(server, 'Premier'); p2 = await newPlayer(server, 'Deuxieme'); p3 = await newPlayer(server, 'Troisieme');
  // Saison 2 (terminée) : p1 = 5 cartes, p2 = 3 cartes ; p3 : 4 cartes obtenues AVANT la première saison (ne comptent dans aucune) + 1 don admin (exclu).
  await give(p1, 5, { at: mid(S2) }); await give(p2, 3, { at: mid(S2) });
  await give(p3, 4, { at: new Date(new Date(S1.start).getTime() - 86400000).toISOString() }); await give(p3, 1, { at: mid(S2), source: 'admin_grant' });
  // Saison 3 (en cours) : p3 = 2 cartes.
  await give(p3, 2, { at: new Date().toISOString() });
  // Cartes exclusives du podium de la saison 2, réglées avant le règlement : une LIMITED (1 exemplaire) pour les rangs 1 à 2, une normale pour le rang 1.
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,is_limited,max_supply) VALUES('prix-ltd','2026-2027','Prix Limité','ST','FC Prix','France','legendary',92,true,1)");
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES('prix-or','2026-2027','Prix Or','ST','FC Prix','France','epic',86)");
  await q("INSERT INTO season_prizes(season_key,rank_from,rank_to,card_id) VALUES('season-2',1,2,'prix-ltd'),('season-2',1,1,'prix-or')");
});
test.after(async () => { await server?.stop(); });

test('calendrier : saisons de 8 semaines déduites de la date, avant la première saison = à venir', () => {
  const cur = seasonInfo();
  assert.equal(cur.number, 3); assert.equal(cur.key, 'season-3');
  assert.equal(Math.round((new Date(cur.end) - new Date(cur.start)) / 86400000), SEASON.weeks * 7);
  assert.equal(seasonWindow(2).end.getTime(), seasonWindow(3).start.getTime(), 'saisons consécutives, sans trou');
  assert.equal(SEASON.weeks, 8);
});

test('saison en cours : score = cartes obtenues pendant la saison seulement', async () => {
  const d = (await lb(p3)).body;
  assert.equal(d.period, 'season'); assert.equal(d.season.number, 3); assert.equal(d.season.upcoming, false); assert.ok(d.season.daysLeft > 30);
  assert.deepEqual(d.top.map(x => [x.name, x.score]), [['Troisieme', 2]], 'les 4 cartes d\'avant la saison et le don admin ne comptent pas');
  assert.equal(d.me.rank, 1);
  assert.deepEqual(d.seasonRewards, SEASON.rewards);
});

test('règlement des saisons terminées : une seule fois, rangs et récompenses figés, notification', async () => {
  const d = (await lb(p1)).body;       // déclenche le règlement
  assert.equal(d.mySeasons.length, 1); assert.equal(d.mySeasons[0].number, 2);
  assert.equal(d.mySeasons[0].rank, 1); assert.equal(d.mySeasons[0].score, 5);
  assert.deepEqual(d.mySeasons[0].reward, { coins: SEASON.rewards[0].coins, xp: SEASON.rewards[0].xp });
  assert.deepEqual(d.mySeasons[0].cards.map(c => c.name).sort(), ['Prix Limité', 'Prix Or']);
  const second = (await lb(p2)).body.mySeasons[0];
  assert.equal(second.rank, 2); assert.deepEqual(second.reward, { coins: SEASON.rewards[1].coins, xp: SEASON.rewards[1].xp });
  assert.deepEqual((await lb(p3)).body.mySeasons, [], 'p3 n\'avait aucune carte obtenue pendant la saison 2');
  assert.equal((await q("SELECT count(*)::int AS n FROM leaderboard_seasons WHERE season_key='season-2'"))[0].n, 1);
  await lb(p1); await lb(p1);
  assert.equal((await q("SELECT count(*)::int AS n FROM leaderboard_season_results WHERE season_key='season-2'"))[0].n, 2, 'règlement unique');
  assert.equal((await p1.get('/api/notifications')).body.notifications.filter(x => x.kind === 'leaderboard_reward' && /Saison 2/.test(x.title)).length, 1);
});

test('récupération : FC, XP et cartes exclusives une seule fois, même en rafale ; journal des FC', async () => {
  const before = Number((await q('SELECT coins FROM users WHERE id=$1', [p1.user.id]))[0].coins);
  const results = await Promise.all(Array.from({ length: 8 }, () => p1.post('/api/leaderboard/claim', { season: 'season-2' })));
  assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results.map(r => r.status)));
  const ok = results.find(r => r.status === 200).body;
  assert.deepEqual(ok.reward, { coins: SEASON.rewards[0].coins, xp: SEASON.rewards[0].xp });
  assert.deepEqual(ok.cards.map(c => c.id).sort(), ['prix-ltd', 'prix-or']);
  assert.equal(Number((await q('SELECT coins FROM users WHERE id=$1', [p1.user.id]))[0].coins), before + SEASON.rewards[0].coins);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND source='season:season-2'", [p1.user.id]))[0].n, 2);
  assert.equal((await q("SELECT serial FROM card_instances WHERE owner_id=$1 AND card_id='prix-ltd'", [p1.user.id]))[0].serial, 1, 'numéro de série #1/1');
  const ledger = await q("SELECT amount FROM coin_ledger WHERE user_id=$1 AND ref='leaderboard-season:season-2'", [p1.user.id]);
  assert.deepEqual(ledger.map(r => Number(r.amount)), [SEASON.rewards[0].coins]);
  assert.equal((await p1.post('/api/leaderboard/claim', { season: 'season-2' })).status, 400, 'déjà récupérée');
  assert.equal((await lb(p1)).body.mySeasons[0].claimed, true);
});

test('carte LIMITED épuisée : les FC et l\'XP sont quand même versés, l\'échec est tracé', async () => {
  const before = Number((await q('SELECT coins FROM users WHERE id=$1', [p2.user.id]))[0].coins);
  const r = await p2.post('/api/leaderboard/claim', { season: 'season-2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.cards, [], 'prix-ltd épuisée (1 exemplaire déjà attribué au 1er)');
  assert.equal(Number((await q('SELECT coins FROM users WHERE id=$1', [p2.user.id]))[0].coins), before + SEASON.rewards[1].coins);
  assert.equal((await q("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='season_prize_failed'", [p2.user.id]))[0].n, 1);
});

test('récupération : non classé, saison inconnue ou non connecté refusés', async () => {
  assert.equal((await p3.post('/api/leaderboard/claim', { season: 'season-2' })).status, 404);
  assert.equal((await p1.post('/api/leaderboard/claim', { season: 'n-importe-quoi' })).status, 404);
  assert.equal((await p1.post('/api/leaderboard/claim', { season: 'season-9' })).status, 404);
  assert.equal((await client(server).post('/api/leaderboard/claim', { season: 'season-2' })).status, 401);
});

test('admin : cartes exclusives réglées pour la saison en cours seulement ; droits et validation', async () => {
  assert.equal((await p1.get('/api/admin/season-prizes')).status, 403);
  assert.equal((await p1.post('/api/admin/season-prizes', { action: 'add', season: 'season-3', from: 1, cardId: 'prix-or' })).status, 403);
  const list = (await creator.get('/api/admin/season-prizes')).body;
  assert.deepEqual(list.seasons.map(s => s.season), ['season-3', 'season-4']);
  const post = body => creator.post('/api/admin/season-prizes', body);
  assert.equal((await post({ action: 'add', season: 'season-2', from: 1, cardId: 'prix-or' })).status, 409, 'saison terminée : figée');
  assert.equal((await post({ action: 'add', season: 'x', from: 1, cardId: 'prix-or' })).status, 400);
  assert.equal((await post({ action: 'add', season: 'season-3', from: 0, cardId: 'prix-or' })).status, 400);
  assert.equal((await post({ action: 'add', season: 'season-3', from: 5, to: 2, cardId: 'prix-or' })).status, 400);
  assert.equal((await post({ action: 'add', season: 'season-3', from: 1, cardId: 'inconnue' })).status, 404);
  const ok = await post({ action: 'add', season: 'season-3', from: 1, to: 3, cardId: 'prix-or' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.prizes.map(p => [p.from, p.to, p.card.name]), [[1, 3, 'Prix Or']]);
  assert.equal((await lb(p3)).body.seasonPrizes.length, 1, 'visible par les joueurs');
  assert.equal((await post({ action: 'remove', season: 'season-3', from: 1, to: 3, cardId: 'prix-or' })).body.prizes.length, 0);
});
