'use strict';

// Tableau de bord : statistiques de progression (récompenses récupérées par type et par jour,
// succès et missions les plus récupérés), classement récompensé, fidélité à 7 jours et FC en circulation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, forceRotation, missionId } = require('./helpers');

let server, admin;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
test.before(async () => {
  server = await startServer();
  admin = await newPlayer(server, 'Admin');
  await q("UPDATE users SET role='creator' WHERE id=$1", [admin.user.id]);
});
test.after(async () => { await server?.stop(); });

test('récompenses récupérées : par type, par jour, succès et missions les plus récupérés', async () => {
  const mission = missionId('daily', 3);
  await forceRotation(server, 'daily', [mission]);
  const players = [await newPlayer(server, 'Un'), await newPlayer(server, 'Deux')];
  for (const p of players) {
    await p.post('/api/packs/open', { packId: 'starter' });
    assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: mission })).status, 200);
    const ach = (await p.get('/api/achievements')).body.achievements.find(a => a.code === 146); // « Bienvenue »
    assert.equal((await p.post('/api/achievements/claim', { id: ach.id })).status, 200);
  }
  const s = (await admin.get('/api/admin/stats?days=7')).body;
  assert.equal(s.progress.byKind.daily, 2);
  assert.equal(s.progress.byKind.achievement, 2);
  assert.equal(s.progress.total, 4);
  assert.deepEqual(s.progress.topMissions.map(m => [m.kind, m.n]), [['daily', 2]]);
  assert.equal(s.progress.topAchievements[0].n, 2);
  const today = s.series[s.series.length - 1];
  assert.deepEqual([today.tasks, today.achievements], [2, 2]);
  // Totaux de la série = totaux par type.
  assert.equal(s.series.reduce((t, d) => t + d.tasks + d.achievements + d.others, 0), s.progress.total);
});

test('classement récompensé, fidélité et circulation', async () => {
  await q("INSERT INTO leaderboard_weeks(week_key,players,rewarded) VALUES('2026-09-28',10,2)");
  const [a, b] = (await q('SELECT id FROM users ORDER BY created_at LIMIT 2')).map(r => r.id);
  await q("INSERT INTO leaderboard_results(week_key,user_id,rank,score,unique_cards,coins,xp) VALUES('2026-09-28',$1,1,50,10,5000,500),('2026-09-28',$2,2,30,8,3000,300)", [a, b]);
  await q("INSERT INTO reward_claims(user_id,claim_id) VALUES($1,'leaderboard-week:2026-09-28')", [a]);
  // Inscrit il y a 10 jours et actif depuis : revenu ; inscrit il y a 10 jours sans activité : non revenu.
  const back = await newPlayer(server, 'Revenu');
  const gone = await newPlayer(server, 'Parti');
  await q("UPDATE users SET created_at=now()-interval '10 days' WHERE id=ANY($1)", [[back.user.id, gone.user.id]]);
  await q('DELETE FROM security_events WHERE user_id=$1', [gone.user.id]);
  await q("INSERT INTO security_events(user_id,event,details) VALUES($1,'login','{}')", [back.user.id]);
  const s = (await admin.get('/api/admin/stats?days=7')).body;
  assert.deepEqual(s.leaderboard.map(w => [w.week_key, w.rewarded, w.claimed, w.coins]), [['2026-09-28', 2, 1, 8000]]);
  assert.deepEqual(s.retention, { cohort: 2, returned: 1 });
  const [{ total, n }] = await q("SELECT COALESCE(sum(coins),0)::int AS total, count(*)::int AS n FROM users WHERE account_status<>'banned'");
  assert.deepEqual([s.circulation.total, s.circulation.players], [total, n]);
  assert.ok(s.circulation.median > 0);
});
