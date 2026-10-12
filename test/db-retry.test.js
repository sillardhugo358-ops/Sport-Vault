'use strict';

// Démarrage de la base avec nouvelles tentatives : attente croissante plafonnée, arrêt dès le succès, arrêt demandé,
// erreurs définitives sans nouvelle tentative ; puis un serveur réel dont la base est injoignable continue de retenter.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { createDbRetry } = require('../lib/db-retry');

// Minuterie fictive : les échéances sont déclenchées à la main, sans attente réelle.
function fakeTimers() {
  const pending = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; pending.push(t); return t; },
    clearTimer: t => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    pending,
    async fire() { const t = pending.shift(); await t.fn(); }
  };
}

test('attente croissante (5, 10, 20, 40 s) plafonnée à 60 s, puis succès : plus aucune échéance', async () => {
  const timers = fakeTimers(), delays = [], results = [];
  let fails = 7;
  const retry = createDbRetry({
    attempt: async n => { if (n <= fails) throw new Error('ECONNREFUSED'); return 'ok'; },
    onFail: (e, n, ms) => delays.push(ms), onSuccess: (r, n) => results.push([r, n]),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer
  });
  await retry.start();
  assert.deepEqual(retry.status(), { attempts: 1, nextInMs: 5000 });
  for (let i = 0; i < 6; i++) await timers.fire();
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000, 60000], 'plafonné à 60 s');
  await timers.fire();   // 8e tentative : succès
  assert.deepEqual(results, [['ok', 8]]);
  assert.equal(timers.pending.length, 0, 'plus d\'échéance après le succès');
  assert.deepEqual(retry.status(), { attempts: 8, nextInMs: null });
});

test('arrêt demandé : plus de tentative, échéance annulée ; erreur définitive : aucune nouvelle tentative', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const stoppable = createDbRetry({ attempt: async () => { calls++; throw new Error('x'); }, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await stoppable.start();
  assert.equal(timers.pending.length, 1);
  stoppable.stop();
  assert.equal(timers.pending.length, 0, 'échéance annulée');
  assert.equal(calls, 1);
  const seen = [];
  const final = createDbRetry({ attempt: async () => { throw new Error('DATABASE_URL manquante'); }, shouldRetry: () => false, onFail: (e, n, ms) => seen.push(ms), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await final.start();
  assert.deepEqual(seen, [null], 'signalé sans nouvelle échéance');
  assert.equal(timers.pending.length, 0);
});

test('serveur réel : base injoignable au démarrage → le serveur répond, signale la panne et retente tout seul', async () => {
  const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const TOKEN = 'jeton-sante-retry-0123456789';
  const child = spawn(process.execPath, ['-r', './security-bootstrap.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x', PORT: String(port), NODE_ENV: 'production', ADMIN_EMAILS: '', HEALTH_TOKEN: TOKEN, DB_RETRY_BASE_MS: '200' },
    stdio: 'ignore'
  });
  try {
    let h = null;
    const read = () => fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Authorization: 'Bearer ' + TOKEN } }).then(r => r.json()).catch(() => null);
    for (let i = 0; i < 80 && !(h && h.databaseRetry && h.databaseRetry.attempts >= 3); i++) { await new Promise(r => setTimeout(r, 250)); h = await read(); }
    assert.equal(h.ok, false);
    assert.equal(h.storage, 'unavailable');
    assert.ok(h.databaseRetry.attempts >= 3, 'plusieurs tentatives : ' + JSON.stringify(h.databaseRetry));
    assert.ok(h.databaseRetry.nextInMs >= 200, 'prochaine tentative annoncée');
    const api = await fetch(`http://127.0.0.1:${port}/api/packs`);
    assert.equal(api.status, 503, 'les routes répondent 503 en attendant la base');
    const pub = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal('databaseRetry' in pub, false, 'détails non publics');
  } finally {
    child.kill('SIGTERM');
  }
});
