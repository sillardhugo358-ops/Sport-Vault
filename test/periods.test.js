'use strict';

// Réinitialisation des missions : quotidiennes à minuit (heure de Paris),
// hebdomadaires le lundi à minuit.

const test = require('node:test');
const assert = require('node:assert/strict');
const periods = require('../lib/periods');
const { auctionMinBid } = require('../lib/auction-rules');
const f = { ...periods, auctionMinBid };

test('jour : bascule à minuit heure de Paris (hiver, UTC+1)', () => {
  assert.equal(f.parisDayKey(new Date('2026-01-15T22:59:59Z')), '2026-01-15');
  assert.equal(f.parisDayKey(new Date('2026-01-15T23:00:00Z')), '2026-01-16');
});

test('jour : bascule à minuit heure de Paris (été, UTC+2)', () => {
  assert.equal(f.parisDayKey(new Date('2026-07-15T21:59:59Z')), '2026-07-15');
  assert.equal(f.parisDayKey(new Date('2026-07-15T22:00:00Z')), '2026-07-16');
});

test('semaine : commence le lundi à minuit heure de Paris', () => {
  // Lundi 5 octobre 2026, 00:00 à Paris = dimanche 4 octobre 22:00 UTC.
  assert.equal(f.parisWeekKey(new Date('2026-10-04T21:59:59Z')), '2026-09-28');
  assert.equal(f.parisWeekKey(new Date('2026-10-04T22:00:00Z')), '2026-10-05');
  // Dimanche reste dans la semaine commencée le lundi précédent.
  assert.equal(f.parisWeekKey(new Date('2026-10-11T12:00:00Z')), '2026-10-05');
});

test('période quotidienne : dure 24 h, de minuit à minuit (Paris)', () => {
  const p = f.periodInfo('daily', new Date('2026-01-15T12:00:00Z'));
  assert.equal(p.start.toISOString(), '2026-01-14T23:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-01-15T23:00:00.000Z');
});

test('période hebdomadaire : du lundi au lundi suivant (Paris)', () => {
  const p = f.periodInfo('weekly', new Date('2026-10-07T12:00:00Z'));
  assert.equal(p.start.toISOString(), '2026-10-04T22:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-10-11T22:00:00.000Z');
});

test('changement d\'heure : la journée du 25 octobre 2026 dure 25 h', () => {
  const p = f.periodInfo('daily', new Date('2026-10-25T12:00:00Z'));
  assert.equal(p.start.toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-10-25T23:00:00.000Z');
});

test('changement d\'heure : la journée du 29 mars 2026 dure 23 h', () => {
  const p = f.periodInfo('daily', new Date('2026-03-29T12:00:00Z'));
  assert.equal(p.start.toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-03-29T22:00:00.000Z');
});

test('enchère : palier minimal de +10 %, arrondi au supérieur', () => {
  assert.equal(f.auctionMinBid(100), 110);
  assert.equal(f.auctionMinBid(101), 112);
  assert.equal(f.auctionMinBid(1), 2);
  assert.equal(f.auctionMinBid(50), 55);
  assert.equal(f.auctionMinBid(200), 220);
  // Plus petit entier m tel que m >= 1,1 × n, vérifié en arithmétique entière.
  for (let n = 1; n <= 100000; n++) {
    const m = f.auctionMinBid(n);
    assert.ok(10 * m >= 11 * n && 10 * (m - 1) < 11 * n, `mise ${n} → ${m}`);
  }
});
