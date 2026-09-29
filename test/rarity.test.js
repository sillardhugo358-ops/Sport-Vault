'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rarityFromOvr } = require('../lib/rarity');

test('barème officiel : seuils sans chevauchement', () => {
  const expected = [
    [1, 'common'], [77, 'common'],
    [78, 'rare'], [83, 'rare'],
    [84, 'epic'], [89, 'epic'],
    [90, 'legendary'], [91, 'legendary'],
    [92, 'icon'], [99, 'icon']
  ];
  for (const [ovr, rarity] of expected) assert.equal(rarityFromOvr(ovr), rarity, `note ${ovr}`);
});

test('barème : une seule rareté par note de 1 à 99', () => {
  const order = ['common', 'rare', 'epic', 'legendary', 'icon'];
  let previous = 0;
  for (let ovr = 1; ovr <= 99; ovr++) {
    const rank = order.indexOf(rarityFromOvr(ovr));
    assert.ok(rank >= previous, `la rareté baisse à la note ${ovr}`);
    previous = rank;
  }
});

test('barème : note invalide refusée', () => {
  assert.throws(() => rarityFromOvr('abc'));
});
