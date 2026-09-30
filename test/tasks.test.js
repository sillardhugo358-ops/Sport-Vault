'use strict';

// Tâches quotidiennes et hebdomadaires en base et éditeur admin (lib/tasks.js, /api/admin/tasks).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');
const { DAILY_TASKS, WEEKLY_TASKS } = require('../lib/game-config');

let server, creator;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const base = { kind: 'daily', title: 'Tâche test', description: 'Ouvre 2 packs aujourd’hui.', type: 'packsOpened', target: 2, coins: 60, xp: 6, order: 20 };
const save = body => creator.post('/api/admin/tasks', body);
const q = async (sql, params) => (await server.db.query(sql, params)).rows;

test('reprise en base : mêmes identifiants, récompenses et ordre que la configuration', async () => {
  const r = await creator.get('/api/admin/tasks');
  assert.equal(r.status, 200);
  for (const [kind, list] of [['daily', DAILY_TASKS], ['weekly', WEEKLY_TASKS]]) {
    const got = r.body.tasks.filter(t => t.kind === kind);
    assert.deepEqual(got.map(t => [t.id, t.target, t.reward.coins, t.reward.xp]), list.map(t => [t.id, t.target, t.reward.coins, t.reward.xp]));
  }
  // Un joueur voit les mêmes tâches qu'avant.
  const p = await newPlayer(server, 'Joueur');
  const prog = (await p.get('/api/progression')).body;
  assert.deepEqual(prog.dailyTasks.map(t => t.id), DAILY_TASKS.map(t => t.id));
  assert.deepEqual(prog.weeklyTasks.map(t => t.id), WEEKLY_TASKS.map(t => t.id));
});

test('droits : un joueur ne lit ni ne modifie les tâches', async () => {
  const p = await newPlayer(server, 'Curieux');
  assert.equal((await p.get('/api/admin/tasks')).status, 403);
  assert.equal((await p.post('/api/admin/tasks', { ...base, action: 'create' })).status, 403);
});

test('création : identifiant généré, visible et récupérable par les joueurs', async () => {
  const r = await save({ ...base, action: 'create' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.task.id, 'tache-test');
  const dup = await save({ ...base, action: 'create', title: 'TÂCHE TEST' });
  assert.equal(dup.status, 400);
  assert.ok(dup.body.errors.title);
  // Même titre dans l'autre période : autorisé, identifiant indépendant.
  const weekly = await save({ ...base, action: 'create', kind: 'weekly' });
  assert.equal(weekly.status, 200);
  assert.equal(weekly.body.task.id, 'tache-test');

  const p = await newPlayer(server, 'Ouvreur');
  assert.ok((await p.get('/api/progression')).body.dailyTasks.some(t => t.id === 'tache-test' && t.target === 2));
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'tache-test' })).status, 400);
  await p.post('/api/packs/open', { packId: 'starter' });
  await p.post('/api/packs/open', { packId: 'starter' });
  const claim = await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'tache-test' });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.reward.coins, 60);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'tache-test' })).status, 400);

  // Modifier la tâche en cours de période ne permet pas de la récupérer une seconde fois.
  const up = await save({ ...base, action: 'update', id: 'tache-test', title: 'Tâche test renommée', target: 1, coins: 500 });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.task.id, 'tache-test');
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'tache-test' })).status, 400);
  const listed = (await creator.get('/api/admin/tasks')).body.tasks.find(t => t.kind === 'daily' && t.id === 'tache-test');
  assert.equal(listed.claims, 1);
  assert.equal(listed.reward.coins, 500);
});

test('validation : erreurs par champ, période et action inconnues', async () => {
  const r = await save({ action: 'create', kind: 'daily', title: 'x', description: '', type: 'inconnu', target: 0, coins: 0, xp: 0, order: -1 });
  assert.equal(r.status, 400);
  for (const f of ['title', 'description', 'type', 'target', 'coins', 'order']) assert.ok(r.body.errors[f], f);
  assert.equal((await save({ ...base, action: 'create', kind: 'monthly' })).status, 400);
  assert.equal((await save({ ...base, action: 'delete' })).status, 400);
  assert.equal((await save({ ...base, action: 'update', id: 'inexistante' })).status, 404);
});

test('désactivation : masquée aux joueurs, non récupérable, dernière tâche active protégée, tracée', async () => {
  assert.equal((await save({ action: 'toggle', kind: 'daily', id: 'open-1', active: false })).status, 200);
  const p = await newPlayer(server, 'Retardataire');
  assert.ok(!(await p.get('/api/progression')).body.dailyTasks.some(t => t.id === 'open-1'));
  await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'open-1' })).status, 404);
  assert.equal((await save({ action: 'toggle', kind: 'daily', id: 'open-1', active: true })).status, 200);

  const weekly = (await creator.get('/api/admin/tasks')).body.tasks.filter(t => t.kind === 'weekly');
  for (const t of weekly.slice(1)) assert.equal((await save({ action: 'toggle', kind: 'weekly', id: t.id, active: false })).status, 200);
  const last = await save({ action: 'toggle', kind: 'weekly', id: weekly[0].id, active: false });
  assert.equal(last.status, 400);
  const actions = (await q("SELECT action FROM admin_logs WHERE action LIKE 'task_%'")).map(r => r.action);
  for (const a of ['task_create', 'task_update', 'task_disable', 'task_enable']) assert.ok(actions.includes(a), a);
});

test('redémarrage : les tâches modifiées ne sont pas écrasées par la configuration', async () => {
  await server.restart();
  const t = (await creator.get('/api/admin/tasks')).body.tasks.find(x => x.kind === 'daily' && x.id === 'tache-test');
  assert.equal(t.title, 'Tâche test renommée');
  assert.equal((await q("SELECT count(*)::int AS n FROM app_migrations WHERE id='period-tasks-2026-09-30'"))[0].n, 1);
});
