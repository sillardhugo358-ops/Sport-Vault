'use strict';

// Missions quotidiennes, hebdomadaires et mensuelles en base et éditeur admin (lib/tasks.js, /api/admin/tasks).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, forceRotation, missionId } = require('./helpers');
const { DAILY_TASKS, WEEKLY_TASKS } = require('../lib/game-config');
const { MISSION_CATALOG } = require('../lib/missions-catalog');

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

test('missions du document : 40 / 45 / 15, les 8 tâches d’origine désactivées et sauvegardées, tirage 3 / 5 / 5', async () => {
  const r = await creator.get('/api/admin/tasks');
  assert.equal(r.status, 200);
  const coded = r.body.tasks.filter(t => t.code != null);
  for (const [kind, n] of [['daily', 40], ['weekly', 45], ['monthly', 15]]) assert.equal(coded.filter(t => t.kind === kind).length, n, kind);
  const old = r.body.tasks.filter(t => [...DAILY_TASKS, ...WEEKLY_TASKS].some(o => o.id === t.id));
  assert.equal(old.length, 8);
  assert.ok(old.every(t => !t.active));
  assert.equal((await q("SELECT count(*)::int AS n FROM achievement_migration_backup WHERE migration_id='missions-pdf-2026-10-01'"))[0].n, 8);
  assert.deepEqual(coded.filter(t => !t.active).map(t => t.id), MISSION_CATALOG.filter(m => m.pending).map(m => m.id), '« Partage » à venir');
  // Même tirage pour tous les joueurs, parmi les missions actives.
  const a = (await (await newPlayer(server, 'Joueur')).get('/api/progression')).body;
  const b = (await (await newPlayer(server, 'Autre')).get('/api/progression')).body;
  assert.deepEqual([a.dailyTasks.length, a.weeklyTasks.length, a.monthlyTasks.length], [3, 5, 5]);
  for (const k of ['dailyTasks', 'weeklyTasks', 'monthlyTasks']) assert.deepEqual(a[k].map(t => t.id), b[k].map(t => t.id));
  assert.ok(a.dailyTasks.every(t => t.reward.coins >= 100 && !t.completed));
  assert.ok(new Date(a.periodEnds.monthly) > new Date(a.periodEnds.weekly) || new Date(a.periodEnds.monthly) > new Date(a.periodEnds.daily));
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

  // Le tirage du jour est déjà fixé : la nouvelle mission entre dans le tirage suivant (ici forcé).
  const p = await newPlayer(server, 'Ouvreur');
  const drawn = (await p.get('/api/progression')).body.dailyTasks.map(t => t.id);
  assert.ok(!drawn.includes('tache-test'));
  await forceRotation(server, 'daily', [...drawn.slice(0, 2), 'tache-test']);
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
  assert.equal((await save({ ...base, action: 'create', kind: 'yearly' })).status, 400);
  assert.equal((await save({ ...base, action: 'delete' })).status, 400);
  assert.equal((await save({ ...base, action: 'update', id: 'inexistante' })).status, 404);
});

test('désactivation : masquée aux joueurs, non récupérable, dernière tâche active protégée, tracée', async () => {
  const open1 = missionId('daily', 3);
  await forceRotation(server, 'daily', [open1, missionId('daily', 1)]);
  assert.equal((await save({ action: 'toggle', kind: 'daily', id: open1, active: false })).status, 200);
  const p = await newPlayer(server, 'Retardataire');
  assert.deepEqual((await p.get('/api/progression')).body.dailyTasks.map(t => t.id), [missionId('daily', 1)]);
  await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: open1 })).status, 404);
  assert.equal((await save({ action: 'toggle', kind: 'daily', id: open1, active: true })).status, 200);
  // Une mission « à venir » ne s'active pas.
  assert.equal((await save({ action: 'toggle', kind: 'daily', id: missionId('daily', 37), active: true })).status, 400);

  const weekly = (await creator.get('/api/admin/tasks')).body.tasks.filter(t => t.kind === 'weekly' && t.active);
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
  assert.equal((await q("SELECT count(*)::int AS n FROM app_migrations WHERE id IN ('period-tasks-2026-09-30','missions-pdf-2026-10-01')"))[0].n, 2);
  assert.equal((await q('SELECT count(*)::int AS n FROM period_tasks WHERE code IS NOT NULL'))[0].n, 100);
});
