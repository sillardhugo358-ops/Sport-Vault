'use strict';

// Missions en base et éditeur admin (lib/missions.js, /api/admin/missions).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');
const { MISSIONS } = require('../lib/game-config');

let server, creator;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const base = { title: 'Mission test', description: 'Possède au moins 1 carte.', type: 'cards', target: 1, coins: 40, xp: 5, order: 50 };
const save = body => creator.post('/api/admin/missions', body);

test('migration : les 12 missions d\'origine sont en base, à l\'identique', async () => {
  const rows = (await server.db.query('SELECT * FROM missions ORDER BY sort_order')).rows;
  assert.equal(rows.length, MISSIONS.length);
  for (const m of MISSIONS) {
    const r = rows.find(x => x.id === m.id);
    assert.deepEqual([r.title, r.type, r.target, r.prerequisite, r.coins, r.xp, r.sort_order], [m.title, m.type, m.target, m.prerequisite || null, m.reward.coins, m.reward.xp, m.order]);
  }
  const p = await newPlayer(server, 'Debutant');
  const prog = (await p.get('/api/progression')).body;
  assert.deepEqual(prog.missions.map(m => m.id), ['collect-5']);
});

test('éditeur : réservé aux admins', async () => {
  const p = await newPlayer(server, 'Curieux');
  assert.equal((await p.get('/api/admin/missions')).status, 403);
  assert.equal((await p.post('/api/admin/missions', { action: 'create', ...base })).status, 403);
});

test('création : identifiant généré depuis le titre, jamais en double ; mission visible et validable', async () => {
  const [a, b] = await Promise.all([save({ action: 'create', ...base }), save({ action: 'create', ...base })]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual([a.body.mission.id, b.body.mission.id].sort(), ['mission-test', 'mission-test-2']);
  const p = await newPlayer(server, 'Joueur');
  const prog = (await p.get('/api/progression')).body;
  assert.ok(prog.missions.some(m => m.id === 'mission-test'));
  const claim = await p.post('/api/missions/claim', { missionId: 'mission-test' });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1040);
  assert.equal((await p.post('/api/missions/claim', { missionId: 'mission-test' })).status, 400);
  const list = (await creator.get('/api/admin/missions')).body.missions;
  assert.equal(list.find(m => m.id === 'mission-test').claims, 1);
});

test('modification : identifiant conservé, nouvelle récompense appliquée', async () => {
  const r = await save({ action: 'update', id: 'mission-test-2', ...base, title: 'Mission renommée', coins: 90 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mission.id, 'mission-test-2');
  assert.equal(r.body.mission.title, 'Mission renommée');
  const p = await newPlayer(server, 'Recompense');
  assert.equal((await p.post('/api/missions/claim', { missionId: 'mission-test-2' })).status, 200);
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1090);
});

test('validation : champs, prérequis inconnu, boucle, récompense nulle', async () => {
  const bad = await save({ action: 'create', ...base, title: '', type: 'inconnu', target: 0 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.title && bad.body.errors.type && bad.body.errors.target);
  assert.ok((await save({ action: 'create', ...base, coins: 0, xp: 0 })).body.errors.coins);
  assert.ok((await save({ action: 'create', ...base, prerequisite: 'absente' })).body.errors.prerequisite);
  // collect-5 -> open-1 : faire dépendre collect-5 de open-1 créerait une boucle.
  const loop = await save({ action: 'update', id: 'collect-5', ...base, prerequisite: 'open-1' });
  assert.equal(loop.status, 400);
  assert.match(loop.body.errors.prerequisite, /boucle/);
  assert.equal((await save({ action: 'update', id: 'absente', ...base })).status, 404);
});

test('désactivation : refusée si une mission active en dépend ; sinon la mission disparaît pour les joueurs', async () => {
  const blocked = await save({ action: 'toggle', id: 'collect-5', active: false });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /PREMIÈRE OUVERTURE/);
  assert.equal((await save({ action: 'toggle', id: 'mission-test', active: false })).status, 200);
  const p = await newPlayer(server, 'Tardif');
  assert.ok(!(await p.get('/api/progression')).body.missions.some(m => m.id === 'mission-test'));
  assert.equal((await p.post('/api/missions/claim', { missionId: 'mission-test' })).status, 404);
  assert.equal((await save({ action: 'toggle', id: 'mission-test', active: true })).status, 200);
});

test('prérequis retiré : la mission suivante se débloque (chaîne jamais bloquée)', async () => {
  // open-1 dépend de collect-5 ; on détache open-1, puis on désactive collect-5.
  const open1 = MISSIONS.find(m => m.id === 'open-1');
  assert.equal((await save({ action: 'update', id: 'open-1', title: open1.title, description: open1.description, type: open1.type, target: open1.target, coins: open1.reward.coins, xp: open1.reward.xp, order: open1.order, prerequisite: '' })).status, 200);
  assert.equal((await save({ action: 'toggle', id: 'collect-5', active: false })).status, 200);
  const p = await newPlayer(server, 'Libre');
  const ids = (await p.get('/api/progression')).body.missions.map(m => m.id);
  assert.ok(ids.includes('open-1') && !ids.includes('collect-5'), JSON.stringify(ids));
  const logs = (await server.db.query("SELECT count(*)::int AS n FROM admin_logs WHERE action LIKE 'mission_%'")).rows[0].n;
  assert.ok(logs >= 5);
});
