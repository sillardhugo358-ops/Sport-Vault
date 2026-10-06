'use strict';

// Récompenses : jamais attribuées deux fois, même en cas de clics simultanés.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow, awayFromParisMidnight, forceRotation, missionId } = require('./helpers');

let server;
test.before(async () => { await awayFromParisMidnight(); server = await startServer(); });
test.after(async () => { await server?.stop(); });

const coinsOf = async p => Number((await userRow(server, p.user.id)).coins);

test('bonus quotidien : +150 FC, une seule fois par jour', async () => {
  const p = await newPlayer(server, 'Quotidien');
  const first = await p.post('/api/rewards/daily');
  assert.equal(first.status, 200);
  assert.equal(await coinsOf(p), 1150);
  const second = await p.post('/api/rewards/daily');
  assert.equal(second.status, 400);
  assert.equal(await coinsOf(p), 1150);
});

test('bonus quotidien : 10 demandes simultanées, 1 seule accordée', async () => {
  const p = await newPlayer(server, 'Rafale');
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/rewards/daily')));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coinsOf(p), 1150);
});

test('bonus quotidien : de nouveau disponible le lendemain', async () => {
  const p = await newPlayer(server, 'Lendemain');
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  await server.db.query("UPDATE users SET daily_claimed_at=now()-interval '2 days' WHERE id=$1", [p.user.id]);
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  assert.equal(await coinsOf(p), 1300);
});

// Série de connexion : +10 FC par jour de série (plafonné à +100), paliers 7 et 30 jours, remise à zéro après un jour manqué.
const setStreak = (p, days, streak) => server.db.query(`UPDATE users SET daily_claimed_at=now()-interval '${days} days', daily_streak=$2, best_streak=$2 WHERE id=$1`, [p.user.id, streak]);
const streakOf = async p => { const u = await userRow(server, p.user.id); return { streak: Number(u.daily_streak), best: Number(u.best_streak) }; };

test('série de connexion : premier jour 150 FC, jour suivant +10 FC', async () => {
  const p = await newPlayer(server, 'Serie1');
  assert.equal((await p.post('/api/rewards/daily')).status, 200);
  assert.deepEqual(await streakOf(p), { streak: 1, best: 1 });
  await setStreak(p, 1, 3);
  const r = await p.post('/api/rewards/daily');
  assert.equal(r.status, 200);
  assert.equal(r.body.reward.coins, 180);
  assert.equal(r.body.streak, 4);
  assert.equal(await coinsOf(p), 1000 + 150 + 180);
  assert.deepEqual(await streakOf(p), { streak: 4, best: 4 });
});

test('série de connexion : bonus plafonné à +100 FC, palier de 7 jours à +500 FC', async () => {
  const capped = await newPlayer(server, 'SerieMax');
  await setStreak(capped, 1, 20);
  assert.equal((await capped.post('/api/rewards/daily')).body.reward.coins, 250);
  const seven = await newPlayer(server, 'SerieSept');
  await setStreak(seven, 1, 6);
  const r = await seven.post('/api/rewards/daily');
  assert.equal(r.body.reward.coins, 150 + 60 + 500);
  assert.equal(r.body.reward.milestone, 500);
  const thirty = await newPlayer(server, 'SerieTrente');
  await setStreak(thirty, 1, 29);
  assert.equal((await thirty.post('/api/rewards/daily')).body.reward.coins, 150 + 100 + 2000);
});

test('série de connexion : remise à zéro après un jour manqué, record conservé', async () => {
  const p = await newPlayer(server, 'SerieCoupee');
  await setStreak(p, 2, 5);
  const r = await p.post('/api/rewards/daily');
  assert.equal(r.body.reward.coins, 150);
  assert.deepEqual(await streakOf(p), { streak: 1, best: 5 });
});

test('série de connexion : 10 demandes simultanées, un seul palier accordé', async () => {
  const p = await newPlayer(server, 'SerieRafale');
  await setStreak(p, 1, 6);
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/rewards/daily')));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coinsOf(p), 1000 + 710);
  assert.equal((await streakOf(p)).streak, 7);
});

test('série de connexion : la progression annonce la série et la prochaine récompense', async () => {
  const p = await newPlayer(server, 'SerieVue');
  await setStreak(p, 1, 6);
  let d = (await p.get('/api/progression')).body.daily;
  assert.equal(d.claimed, false);
  assert.equal(d.streak, 6);
  assert.equal(d.reward.coins, 710);
  await p.post('/api/rewards/daily');
  d = (await p.get('/api/progression')).body.daily;
  assert.equal(d.claimed, true);
  assert.equal(d.streak, 7);
  await setStreak(p, 3, 7);
  d = (await p.get('/api/progression')).body.daily;
  assert.equal(d.streak, 0, 'série interrompue');
  assert.equal(d.reward.coins, 150);
});

test('mission : non terminée refusée, terminée accordée une fois', async () => {
  const p = await newPlayer(server, 'Missionnaire');
  // 3 cartes de bienvenue : « Première collection » (5 cartes) pas encore atteinte.
  assert.equal((await p.post('/api/missions/claim', { missionId: 'collect-5' })).status, 400);
  assert.equal((await p.post('/api/packs/open', { packId: 'starter' })).status, 200);
  const before = await coinsOf(p);
  const ok = await p.post('/api/missions/claim', { missionId: 'collect-5' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await coinsOf(p), before + 150);
  assert.equal((await p.post('/api/missions/claim', { missionId: 'collect-5' })).status, 400);
  assert.equal(await coinsOf(p), before + 150);
});

test('mission : 10 demandes simultanées, 1 seule accordée', async () => {
  const p = await newPlayer(server, 'Doublon');
  await p.post('/api/packs/open', { packId: 'starter' });
  const before = await coinsOf(p);
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/missions/claim', { missionId: 'collect-5' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coinsOf(p), before + 150);
});

test('mission : verrouillée tant que la précédente n\'est pas récupérée', async () => {
  const p = await newPlayer(server, 'Pressé');
  await p.post('/api/packs/open', { packId: 'starter' });
  // « Première ouverture » exige d'avoir récupéré « Première collection ».
  assert.equal((await p.post('/api/missions/claim', { missionId: 'open-1' })).status, 403);
  assert.equal((await p.post('/api/missions/claim', { missionId: 'collect-5' })).status, 200);
  assert.equal((await p.post('/api/missions/claim', { missionId: 'open-1' })).status, 200);
});

test('mission quotidienne : accordée une fois par jour, même en rafale ; hors tirage refusée', async () => {
  const open1 = missionId('daily', 3), open2 = missionId('daily', 4);
  await forceRotation(server, 'daily', [open1, missionId('daily', 1), missionId('daily', 26)]);
  const p = await newPlayer(server, 'Tâcheron');
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: open1 })).status, 400);
  await p.post('/api/packs/open', { packId: 'starter' });
  await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: open2 })).status, 404, 'mission non tirée aujourd’hui');
  const before = await coinsOf(p);
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/tasks/claim', { kind: 'daily', taskId: open1 })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coinsOf(p), before + 100);
});

test('mission hebdomadaire et mensuelle : accordées une fois par période', async () => {
  const w = missionId('weekly', 3), m = missionId('monthly', 9);
  await forceRotation(server, 'weekly', [w]);
  await forceRotation(server, 'monthly', [m]);
  const p = await newPlayer(server, 'Semaine');
  for (let i = 0; i < 5; i++) await p.post('/api/packs/open', { packId: 'starter' });
  const before = await coinsOf(p);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'weekly', taskId: w })).status, 200);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'weekly', taskId: w })).status, 400);
  assert.equal(await coinsOf(p), before + 400);
  // « Gagne un niveau » ce mois-ci : mesuré depuis la première consultation des missions.
  assert.equal((await p.post('/api/tasks/claim', { kind: 'monthly', taskId: m })).status, 400);
  await server.db.query('UPDATE users SET xp=xp+5000 WHERE id=$1', [p.user.id]);
  const r = await p.post('/api/tasks/claim', { kind: 'monthly', taskId: m });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reward.coins, 1500);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'monthly', taskId: m })).status, 400);
});

test('journal de sécurité en échec : la récompense reste acquise', async () => {
  const p = await newPlayer(server, 'Journal');
  await p.post('/api/packs/open', { packId: 'starter' });
  // Simule un échec d'écriture du journal pour cet événement uniquement.
  await server.db.query("ALTER TABLE security_events ADD CONSTRAINT test_refuse_mission CHECK (event <> 'mission_reward_claim') NOT VALID");
  try {
    const before = await coinsOf(p);
    const r = await p.post('/api/missions/claim', { missionId: 'collect-5' });
    assert.equal(r.status, 200);
    assert.equal(await coinsOf(p), before + 150);
    assert.equal((await p.post('/api/missions/claim', { missionId: 'collect-5' })).status, 400);
  } finally {
    await server.db.query('ALTER TABLE security_events DROP CONSTRAINT test_refuse_mission');
  }
});
