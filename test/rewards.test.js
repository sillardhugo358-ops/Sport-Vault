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
