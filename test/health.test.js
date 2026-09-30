'use strict';

// Exploitation : /api/health (version déployée, état de la base) et durée des sessions (SESSION_TTL_DAYS).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { sessionDays } = require('../lib/auth');

let server;
test.before(async () => { server = await startServer({ env: { RENDER_GIT_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12', SESSION_TTL_DAYS: '0.5' } }); });
test.after(async () => { await server?.stop(); });

test('santé : version déployée, démarrage, base joignable', async () => {
  const h = await (await fetch(server.base + '/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.commit, 'abcdef123456');
  assert.ok(Date.parse(h.startedAt) <= Date.now());
  assert.ok(Number.isInteger(h.uptimeSeconds));
  assert.equal(h.database.ok, true);
  assert.ok(h.database.latencyMs >= 0);
  assert.ok(!JSON.stringify(h).includes('postgresql://'), 'aucune adresse de base exposée');
});

test('session : durée lue dans SESSION_TTL_DAYS, cookie en secondes entières', async () => {
  const r = await fetch(server.base + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': server.newIp() },
    body: JSON.stringify({ name: 'Durée', email: 'duree@test.fr', password: 'motdepasse123' })
  });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /Max-Age=43200(;|$)/);
  const [{ hours }] = (await server.db.query("SELECT round(extract(epoch FROM expires_at-now())/3600) AS hours FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email='duree@test.fr'")).rows;
  assert.equal(Number(hours), 12);
});

test('durée de session : valeur par défaut et bornes', () => {
  assert.equal(sessionDays(undefined), 2 / 24);
  assert.equal(sessionDays('abc'), 2 / 24);
  assert.equal(sessionDays('-1'), 2 / 24);
  assert.equal(sessionDays('0.0833333333'), 0.0833333333);
  assert.equal(sessionDays('365'), 30);
  assert.equal(sessionDays('0.0001'), 5 / 1440);
});
