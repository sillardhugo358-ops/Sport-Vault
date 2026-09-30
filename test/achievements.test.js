'use strict';

// Administration des succès (lib/achievements.js, /api/admin/achievements).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');

let server, creator;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const base = { name: 'Premier pas', category: 'Collection', description: 'Possède au moins 1 carte.', icon: '★', type: 'cards', target: 1, coins: 30, xp: 5 };
const save = body => creator.post('/api/admin/achievements', body);

test('réservé aux admins', async () => {
  const p = await newPlayer(server, 'Curieux');
  assert.equal((await p.get('/api/admin/achievements')).status, 403);
  assert.equal((await p.post('/api/admin/achievements', { action: 'create', ...base })).status, 403);
});

test('création : identifiant généré par le serveur, jamais écrasé ; succès visible et récupérable', async () => {
  const before = (await creator.get('/api/admin/achievements')).body.achievements.length;
  const [a, b] = await Promise.all([save({ action: 'create', ...base }), save({ action: 'create', ...base, name: 'Premier pas bis' })]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(a.body.achievement.id, 'ach-premier-pas');
  // Un identifiant envoyé par le client à la création est ignoré : pas d'écrasement possible.
  const c = await save({ action: 'create', ...base, id: 'ach-premier-pas', name: 'Autre succès' });
  assert.equal(c.status, 200);
  assert.notEqual(c.body.achievement.id, 'ach-premier-pas');
  const list = (await creator.get('/api/admin/achievements')).body;
  assert.equal(list.achievements.length, before + 3);
  assert.equal(list.achievements.find(x => x.id === 'ach-premier-pas').name, 'Premier pas');
  assert.ok(list.types.cards);
  const p = await newPlayer(server, 'Joueur');
  const claim = await p.post('/api/achievements/claim', { id: 'ach-premier-pas' });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1030);
  const after = (await creator.get('/api/admin/achievements')).body.achievements.find(x => x.id === 'ach-premier-pas');
  assert.equal(after.claims, 1);
});

test('modification : identifiant conservé ; nom en double refusé', async () => {
  const r = await save({ action: 'update', id: 'ach-premier-pas', ...base, name: 'Premier pas (modifié)', coins: 60 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.achievement.id, 'ach-premier-pas');
  assert.equal(Number(r.body.achievement.coins), 60);
  const dup = await save({ action: 'update', id: 'ach-premier-pas', ...base, name: 'Premier pas bis' });
  assert.equal(dup.status, 400);
  assert.match(dup.body.errors.name, /déjà/);
  assert.equal((await save({ action: 'update', id: 'absent', ...base })).status, 404);
});

test('validation : erreurs par champ, montants trop grands refusés sans erreur serveur', async () => {
  const r = await save({ action: 'create', ...base, name: '', category: '', type: 'inconnu', target: 0, coins: 1e12, xp: -1 });
  assert.equal(r.status, 400);
  for (const f of ['name', 'category', 'type', 'target', 'coins', 'xp']) assert.ok(r.body.errors[f], f);
  assert.ok((await save({ action: 'create', ...base, name: 'Sans récompense', coins: 0, xp: 0 })).body.errors.coins);
});

test('désactivation puis suppression : tracées, récompenses acquises conservées', async () => {
  assert.equal((await save({ action: 'toggle', id: 'ach-premier-pas', active: false })).status, 200);
  const p = await newPlayer(server, 'Tardif');
  const ach = (await p.get('/api/achievements')).body.achievements;
  assert.ok(!ach.some(x => x.id === 'ach-premier-pas'));
  assert.equal((await save({ action: 'delete', id: 'ach-premier-pas' })).status, 200);
  assert.equal((await save({ action: 'delete', id: 'ach-premier-pas' })).status, 404);
  const claims = (await server.db.query("SELECT count(*)::int AS n FROM reward_claims WHERE claim_id='achievement:ach-premier-pas'")).rows[0].n;
  assert.equal(claims, 1);
  const logs = (await server.db.query("SELECT action FROM admin_logs WHERE action LIKE 'achievement_%'")).rows.map(r => r.action);
  for (const a of ['achievement_create', 'achievement_update', 'achievement_disable', 'achievement_delete']) assert.ok(logs.includes(a), a);
});
