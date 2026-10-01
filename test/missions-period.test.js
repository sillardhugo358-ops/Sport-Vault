'use strict';

// Missions du document (quotidiennes, hebdomadaires, mensuelles) : mesures sur la période,
// visites et pages consultées, « toutes les autres missions », et notifications « terminé »
// (une seule fois, rien d'ancien signalé à la première vérification).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, awayFromParisMidnight, forceRotation, missionId } = require('./helpers');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
test.before(async () => { await awayFromParisMidnight(); server = await startServer(); });
test.after(async () => { await server?.stop(); });

const daily = async p => new Map((await p.get('/api/progression')).body.dailyTasks.map(t => [t.id, t]));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('visite du jour, pages consultées (limitées), cartes obtenues par poste', async () => {
  const ids = [1, 26, 27, 11, 12, 13, 14, 3, 6].map(c => missionId('daily', c));
  await forceRotation(server, 'daily', ids);
  const p = await newPlayer(server, 'Mesures');
  let t = await daily(p);
  assert.equal(t.get(ids[0]).completed, true, 'connecté aujourd’hui');
  assert.equal(t.get(ids[1]).completed, false);
  assert.equal((await p.post('/api/activity', { page: 'album' })).status, 200);
  assert.equal((await p.post('/api/activity', { page: 'inconnue' })).status, 400);
  // Trois fiches carte d'affilée : une seule comptée (au plus une toutes les 3 s).
  for (let i = 0; i < 3; i++) await p.post('/api/activity', { page: 'card' });
  t = await daily(p);
  assert.equal(t.get(ids[1]).completed, true, 'album consulté');
  assert.equal(t.get(ids[2]).progress, 1, 'fiches limitées');
  assert.equal(t.get(ids[7]).completed, false, 'les cartes de bienvenue ne comptent pas');
  // Cartes obtenues aujourd'hui : un pack ouvert.
  const cards = (await p.post('/api/packs/open', { packId: 'starter' })).body.cards;
  t = await daily(p);
  assert.equal(t.get(ids[7]).completed, true, 'pack ouvert');
  assert.equal(t.get(ids[8]).progress, Math.min(3, cards.length));
  const pos = { 11: ['GK'], 12: ['RW', 'ST', 'LW'], 13: ['CB', 'LB', 'RB'], 14: ['DM', 'CM', 'AM'] };
  for (const [code, list] of Object.entries(pos)) {
    assert.equal(t.get(missionId('daily', Number(code))).completed, cards.some(c => list.includes(c.position)), 'poste ' + code);
  }
});

test('« toutes les autres missions » : terminée quand les autres sont récupérées', async () => {
  const ids = [1, 26, 40].map(c => missionId('daily', c));
  await forceRotation(server, 'daily', ids);
  const p = await newPlayer(server, 'Parfait');
  await p.post('/api/activity', { page: 'album' });
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: ids[2] })).status, 400);
  for (const id of ids.slice(0, 2)) assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: id })).status, 200);
  const t = await daily(p);
  assert.deepEqual([t.get(ids[2]).progress, t.get(ids[2]).target, t.get(ids[2]).completed], [2, 2, true]);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: ids[2] })).status, 200);
});

test('notifications : rien d’ancien à la première vérification, puis une notification par objectif atteint', async () => {
  const pack = missionId('daily', 3);
  await forceRotation(server, 'daily', [pack, missionId('daily', 26)]);
  const p = await newPlayer(server, 'Notifie');
  const first = (await p.get('/api/notifications')).body;
  assert.equal(first.notifications.length, 0, 'objectifs déjà atteints marqués sans notification');
  assert.ok((await q("SELECT count(*)::int AS n FROM progress_notified WHERE user_id=$1 AND key='ach:ach-first-card'", [p.user.id]))[0].n === 1);
  await p.post('/api/packs/open', { packId: 'starter' });
  await wait(10500); // au plus une vérification toutes les 10 s par joueur
  const after = (await p.get('/api/notifications')).body.notifications;
  const titles = after.map(n => n.title);
  // Une notification par objectif, ou une seule groupée au-delà de 3.
  assert.ok(titles.some(t => t === 'Mission terminée : OUVERTURE DU JOUR' || /missions? terminés/.test(t)), JSON.stringify(titles));
  assert.ok(after.some(n => n.kind === 'achievement_done' && n.link === '#successes'), 'premier pack : succès débloqué');
  await wait(10500);
  const again = (await p.get('/api/notifications')).body.notifications;
  assert.equal(again.length, after.length, 'jamais deux fois');
});
