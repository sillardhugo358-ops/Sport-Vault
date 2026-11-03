'use strict';

// Duel quotidien d'équipe type : ami accepté obligatoire, deux équipes de 11, score = somme des OVR, vainqueur payé une fois (50 FC + 10 XP),
// égalité sans récompense, un duel par jour pour chacun des deux joueurs, profil privé refusé, défis simultanés, jour suivant (horloge injectée).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { startServer, newPlayer, client, userRow } = require('./helpers');
const { FORMATIONS } = require('../lib/team');
const { createTeam } = require('../lib/team');
const { createTeamDuel } = require('../lib/team-duel');

let server, pool;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const codeOf = async p => (await p.get('/api/trades')).body.code;
const coins = async p => Number((await userRow(server, p.user.id)).coins);
let n = 0;

// Équipe complète (4-3-3) dont chaque titulaire a la note ovr ; ovr = 0 : aucune équipe enregistrée.
async function team(p, ovr) {
  if (!ovr) return;
  const slots = [];
  for (const position of FORMATIONS['4-3-3']) {
    n++;
    const cardId = 'duel-' + n;
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,$3,'FC Duel','France','common',$4)", [cardId, 'Duel ' + n, position, ovr]);
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
      VALUES($1,$2,$3,'2026-2027',$4,$5,'FC Duel','France','common',$6,'pack:test')`, [crypto.randomUUID(), cardId, p.user.id, 'Duel ' + n, position, ovr]);
    slots.push(cardId);
  }
  const r = await p.post('/api/team/save', { formation: '4-3-3', slots });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}
async function player(name, ovr) {
  const p = await newPlayer(server, name);
  await team(p, ovr);
  return p;
}
async function befriend(x, y) {
  const [lo, hi] = x.user.id < y.user.id ? [x.user.id, y.user.id] : [y.user.id, x.user.id];
  await q("INSERT INTO friendships(user_low,user_high,requester,status) VALUES($1,$2,$3,'accepted')", [lo, hi, x.user.id]);
}

test.before(async () => { server = await startServer(); });
test.after(async () => { await pool?.end(); await server.stop?.(); });

test('droits et refus : connexion, code, soi-même, ami obligatoire, équipes complètes, profil privé', async () => {
  const a = await player('Alma', 80), b = await player('Boris', 70), nofriend = await player('Etranger', 70), empty = await player('Vide', 0), priv = await player('Prive', 70);
  assert.equal((await client(server).get('/api/team-duels')).status, 401);
  assert.equal((await client(server).post('/api/team-duels/challenge', { code: await codeOf(b) })).status, 401);
  assert.equal((await a.post('/api/team-duels/challenge', { code: 'court' })).status, 400);
  assert.equal((await a.post('/api/team-duels/challenge', { code: 'ZZZZZZZZ' })).status, 404);
  assert.equal((await a.post('/api/team-duels/challenge', { code: await codeOf(a) })).status, 400, 'soi-même');
  assert.equal((await a.post('/api/team-duels/challenge', { code: await codeOf(nofriend) })).status, 403, 'pas un ami');
  await q("INSERT INTO friendships(user_low,user_high,requester,status) SELECT LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid),$1,'pending'", [a.user.id, nofriend.user.id]);
  assert.equal((await a.post('/api/team-duels/challenge', { code: await codeOf(nofriend) })).status, 403, 'demande seulement envoyée');
  await befriend(a, empty); await befriend(a, priv);
  const e = await a.post('/api/team-duels/challenge', { code: await codeOf(empty) });
  assert.equal(e.status, 409);
  assert.equal(e.body.code, 'opponent_team_incomplete');
  await q("UPDATE users SET profile_visibility='private' WHERE id=$1", [priv.user.id]);
  assert.equal((await a.post('/api/team-duels/challenge', { code: await codeOf(priv) })).status, 403, 'profil privé');
  assert.equal((await empty.post('/api/team-duels/challenge', { code: await codeOf(a) })).body.code, 'team_incomplete');
  assert.equal((await q('SELECT count(*)::int AS n FROM team_duels'))[0].n, 0, 'aucun refus ne laisse de trace');
});

test('victoire : 50 FC + 10 XP une seule fois, notification, un duel par jour pour les deux joueurs', async () => {
  const a = await player('Gagnante', 80), b = await player('Perdant', 70), c = await player('Tiers', 60), d = await player('Autre', 60);
  await befriend(a, b); await befriend(b, c); await befriend(a, d);
  const before = await coins(a), xp = Number((await userRow(server, a.user.id)).xp), loserBefore = await coins(b);
  const r = await a.post('/api/team-duels/challenge', { code: await codeOf(b) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.duel.result, 'win');
  assert.deepEqual([r.body.duel.me.score, r.body.duel.opponent.score], [880, 770], 'somme des 11 OVR');
  assert.deepEqual(r.body.reward, { coins: 50, xp: 10 });
  assert.equal(await coins(a) - before, 50);
  assert.equal(Number((await userRow(server, a.user.id)).xp) - xp, 10);
  assert.equal((await q("SELECT count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'duel:%' AND user_id=$1", [a.user.id]))[0].n, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='team_duel'", [b.user.id]))[0].n, 1, 'le défié est prévenu');
  assert.equal(await coins(b), loserBefore, 'le perdant ne perd rien et ne gagne rien');
  // Un seul duel par jour : le défieur, et aussi le défié.
  const again = await a.post('/api/team-duels/challenge', { code: await codeOf(d) });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'daily_limit');
  const busy = await c.post('/api/team-duels/challenge', { code: await codeOf(b) });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'opponent_busy');
  const asB = await b.post('/api/team-duels/challenge', { code: await codeOf(c) });
  assert.equal(asB.body.code, 'daily_limit', 'le défié a aussi consommé son duel du jour');
  assert.equal(await coins(a) - before, 50, 'aucune seconde récompense');
  const s = (await b.get('/api/team-duels')).body;
  assert.equal(s.usedToday, true);
  assert.equal(s.today.result, 'loss');
  assert.equal(s.today.opponent.name, 'Gagnante');
  assert.equal(s.history.length, 1);
});

test('égalité : pas de récompense mais le duel compte ; défis simultanés : une seule récompense', async () => {
  const a = await player('Egale', 75), b = await player('Egal', 75), c = await player('Rapide', 90), d = await player('Faible1', 60), e = await player('Faible2', 60);
  await befriend(a, b); await befriend(c, d); await befriend(c, e);
  const before = await coins(a), xp = Number((await userRow(server, a.user.id)).xp);
  const t = await a.post('/api/team-duels/challenge', { code: await codeOf(b) });
  assert.equal(t.body.duel.result, 'draw');
  assert.equal(t.body.reward, null);
  assert.equal(await coins(a), before);
  assert.equal(Number((await userRow(server, a.user.id)).xp), xp);
  assert.equal((await a.get('/api/team-duels')).body.usedToday, true, 'une égalité compte pour la journée');
  const [codeD, codeE] = [await codeOf(d), await codeOf(e)];
  const cb = await coins(c);
  const res = await Promise.all([c.post('/api/team-duels/challenge', { code: codeD }), c.post('/api/team-duels/challenge', { code: codeE })]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409]);
  assert.equal(await coins(c) - cb, 50, 'une seule récompense malgré deux requêtes simultanées');
  assert.equal((await q('SELECT count(*)::int AS n FROM team_duel_days WHERE user_id=$1', [c.user.id]))[0].n, 1);
});

test('jour suivant : un nouveau duel est possible (horloge injectée)', async () => {
  pool = new Pool({ connectionString: server.databaseUrl, max: 2 });
  pool.on('error', () => {});
  const a = await player('Hier', 80), b = await player('Demain', 70);
  await befriend(a, b);
  const first = await a.post('/api/team-duels/challenge', { code: await codeOf(b) });
  assert.equal(first.status, 200);
  const paid = [];
  const duel = at => createTeamDuel({ getPool: () => pool, team: createTeam({ getPool: () => pool }), applyReward: async (id, r) => { paid.push([id, r]); return {}; }, securityEvent: async () => {}, now: () => new Date(at) });
  const code = await codeOf(b);
  const next = await duel('2031-01-02T12:00:00Z').challenge(a.user.id, code);
  assert.equal(next.duel.result, 'win', JSON.stringify(next));
  assert.equal((await duel('2031-01-02T20:00:00Z').challenge(a.user.id, code)).code, 'daily_limit', 'même jour de Paris : refusé');
  assert.deepEqual(paid, [[a.user.id, { coins: 50, xp: 10 }]]);
});
