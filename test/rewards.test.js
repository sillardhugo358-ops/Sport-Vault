'use strict';

// Récompenses : jamais attribuées deux fois, même en cas de clics simultanés.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
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

test('tâche quotidienne : accordée une fois par jour, même en rafale', async () => {
  const p = await newPlayer(server, 'Tâcheron');
  assert.equal((await p.post('/api/tasks/claim', { kind: 'daily', taskId: 'open-1' })).status, 400);
  await p.post('/api/packs/open', { packId: 'starter' });
  const before = await coinsOf(p);
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/tasks/claim', { kind: 'daily', taskId: 'open-1' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coinsOf(p), before + 100);
});

test('tâche hebdomadaire : accordée une fois par semaine', async () => {
  const p = await newPlayer(server, 'Semaine');
  for (let i = 0; i < 5; i++) await p.post('/api/packs/open', { packId: 'starter' });
  const before = await coinsOf(p);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'weekly', taskId: 'open-5' })).status, 200);
  assert.equal((await p.post('/api/tasks/claim', { kind: 'weekly', taskId: 'open-5' })).status, 400);
  assert.equal(await coinsOf(p), before + 400);
});
