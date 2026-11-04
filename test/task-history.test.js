'use strict';

// Historique des missions périodiques terminées (GET /api/tasks/history) : relu dans reward_claims, titre depuis period_tasks, FC réellement versés
// depuis coin_ledger, tâche retirée = titre nul, autres récompenses exclues, plus récent d'abord, limité, jamais celui d'un autre joueur.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');
const { TASK_HISTORY_LIMIT } = require('../lib/game-config');

let server, a, b, daily, weekly;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const claim = (p, id, at) => q('INSERT INTO reward_claims(user_id,claim_id,claimed_at) VALUES($1,$2,$3)', [p.user.id, id, at]);

test.before(async () => {
  server = await startServer();
  [a, b] = [await newPlayer(server, 'Historien'), await newPlayer(server, 'Voisin')];
  daily = (await q("SELECT id,title,coins,xp FROM period_tasks WHERE kind='daily' ORDER BY sort_order LIMIT 1"))[0];
  weekly = (await q("SELECT id,title,coins,xp FROM period_tasks WHERE kind='weekly' ORDER BY sort_order LIMIT 1"))[0];
});
test.after(async () => { await server.stop?.(); });

test('droits, historique vide, puis lignes triées avec titre, période et FC versés', async () => {
  assert.equal((await client(server).get('/api/tasks/history')).status, 401);
  assert.deepEqual((await a.get('/api/tasks/history')).body.history, []);
  await claim(a, `daily:2026-11-02:${daily.id}`, '2026-11-02T10:00:00Z');
  await claim(a, `weekly:2026-10-26:${weekly.id}`, '2026-11-03T10:00:00Z');
  await claim(a, 'daily:2026-11-01:tache-qui-nexiste-plus', '2026-11-01T10:00:00Z');
  // Récompenses d'autres natures : jamais dans cet historique.
  await claim(a, 'achievement:premier-pas', '2026-11-03T11:00:00Z'); await claim(a, 'goal:2026-2027:25', '2026-11-03T12:00:00Z'); await claim(a, 'set:un-set', '2026-11-03T13:00:00Z');
  // FC réellement versés (l'administrateur a pu modifier la tâche depuis) : le journal fait foi.
  await q("INSERT INTO coin_ledger(user_id,amount,reason,ref) VALUES($1,777,'reward',$2)", [a.user.id, `daily:2026-11-02:${daily.id}`]);
  await claim(b, `daily:2026-11-02:${daily.id}`, '2026-11-03T09:00:00Z');
  const h = (await a.get('/api/tasks/history')).body.history;
  assert.deepEqual(h.map(x => [x.kind, x.period, x.id]), [['weekly', '2026-10-26', weekly.id], ['daily', '2026-11-02', daily.id], ['daily', '2026-11-01', 'tache-qui-nexiste-plus']], 'plus récent d’abord, rien d’autre');
  assert.equal(h[0].title, weekly.title);
  assert.deepEqual(h[0].reward, { coins: Number(weekly.coins), xp: Number(weekly.xp) });
  assert.equal(h[1].reward.coins, 777, 'FC du journal, pas ceux de la tâche actuelle');
  assert.equal(h[2].title, null, 'tâche retirée : titre nul');
  assert.equal(h[2].reward, null);
  assert.equal((await b.get('/api/tasks/history')).body.history.length, 1, 'chaque joueur ne voit que le sien');
});

test('limité aux dernières récompenses', async () => {
  for (let i = 0; i < TASK_HISTORY_LIMIT + 5; i++) await claim(b, `weekly:2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}:${weekly.id}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
  assert.equal((await b.get('/api/tasks/history')).body.history.length, TASK_HISTORY_LIMIT);
});
