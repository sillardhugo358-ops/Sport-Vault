'use strict';

// Alertes de la page d'état (admin) : journal des erreurs serveur et seuils d'alerte.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerErrorLog } = require('../lib/server-errors');
const { buildAlerts, THRESHOLDS } = require('../lib/health-alerts');

const HOUR = 3600_000;

test('journal : compte par fenêtre, repère les erreurs de récupération, ne garde que les 10 dernières, sans données de joueur', () => {
  let t = 1_000_000_000;
  const log = createServerErrorLog({ max: 50, now: () => t });
  assert.deepEqual(log.snapshot(), { total: 0, lastHour: 0, last24h: 0, claimLast24h: 0, recent: [] });
  log.record({ method: 'POST', path: '/api/missions/claim?token=secret', status: 500, error: Object.assign(new Error('mot de passe=abc'), { code: '57P01' }) });
  t += 2 * HOUR;
  log.record({ method: 'GET', path: '/api/market', status: 500, error: new TypeError('x') });
  const s = log.snapshot();
  assert.equal(s.total, 2);
  assert.equal(s.lastHour, 1, 'la première erreur date de plus d\'une heure');
  assert.equal(s.last24h, 2);
  assert.equal(s.claimLast24h, 1);
  assert.equal(s.recent[0].path, '/api/market', 'la plus récente d\'abord');
  assert.equal(s.recent[1].path, '/api/missions/claim', 'paramètres d\'adresse retirés');
  assert.equal(s.recent[1].kind, '57P01', 'seulement le code ou le nom de l\'erreur');
  assert.ok(!JSON.stringify(s).includes('secret') && !JSON.stringify(s).includes('mot de passe'));
  t += 25 * HOUR;
  assert.equal(log.snapshot().last24h, 0, 'sorties de la fenêtre de 24 h');
});

test('journal : borné, jamais plus de 10 erreurs récentes renvoyées', () => {
  const log = createServerErrorLog({ max: 20 });
  for (let i = 0; i < 30; i++) log.record({ method: 'GET', path: '/api/x/' + i, status: 500, error: new Error('e') });
  const s = log.snapshot();
  assert.equal(s.total, 30);
  assert.equal(s.last24h, 20, 'mémoire bornée à 20');
  assert.equal(s.recent.length, 10);
});

test('alertes : rien quand tout va bien', () => {
  assert.deepEqual(buildAlerts({ ready: true, database: { ok: true, latencyMs: 40 }, serverErrors: { lastHour: 0, claimLast24h: 0 } }), []);
});

test('alertes : base absente, base hors service, latence (à surveiller puis urgent)', () => {
  assert.deepEqual(buildAlerts({ ready: false, database: null, serverErrors: {} }).map(a => [a.level, a.code]), [['critical', 'db_starting']]);
  assert.deepEqual(buildAlerts({ ready: true, database: { ok: false, error: 'délai dépassé' }, serverErrors: {} }).map(a => [a.level, a.code]), [['critical', 'db_down']]);
  const at = ms => buildAlerts({ ready: true, database: { ok: true, latencyMs: ms }, serverErrors: {} }).map(a => a.level);
  assert.deepEqual(at(THRESHOLDS.latencyWarnMs - 1), []);
  assert.deepEqual(at(THRESHOLDS.latencyWarnMs), ['warning']);
  assert.deepEqual(at(THRESHOLDS.latencyCriticalMs), ['critical']);
});

test('alertes : erreurs serveur (1 = à surveiller, 5 = urgent) et récupérations en erreur', () => {
  const ok = { ok: true, latencyMs: 10 };
  const a = e => buildAlerts({ ready: true, database: ok, serverErrors: e });
  assert.deepEqual(a({ lastHour: 1, claimLast24h: 0 }).map(x => [x.level, x.code]), [['warning', 'server_errors']]);
  assert.deepEqual(a({ lastHour: 5, claimLast24h: 0 }).map(x => [x.level, x.code]), [['critical', 'server_errors']]);
  const both = a({ lastHour: 0, claimLast24h: 2 });
  assert.deepEqual(both.map(x => [x.level, x.code]), [['warning', 'claim_errors']]);
  assert.match(both[0].message, /2 récupérations/);
});
