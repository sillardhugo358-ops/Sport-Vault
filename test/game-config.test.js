'use strict';

// Cohérence de la configuration du jeu (lib/game-config.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { RARITIES, PACKS, THEMED_PACKS, PACK_WEIGHTS, MISSIONS, DEFAULT_ACHIEVEMENTS, DAILY_TASKS, WEEKLY_TASKS } = require('../lib/game-config');

const positive = r => Number(r.coins) >= 0 && Number(r.xp) >= 0 && Number(r.coins) + Number(r.xp) > 0;

test('missions : identifiants uniques, chaîne de prérequis sans trou ni boucle', () => {
  const ids = new Set(MISSIONS.map(m => m.id));
  assert.equal(ids.size, MISSIONS.length);
  for (const m of MISSIONS) {
    if (m.prerequisite) assert.ok(ids.has(m.prerequisite), `${m.id} : prérequis ${m.prerequisite} inconnu`);
    assert.ok(m.target > 0 && positive(m.reward), m.id);
  }
  // Chaque mission remonte jusqu'à une mission sans prérequis.
  for (const m of MISSIONS) {
    const seen = new Set();
    let cur = m;
    while (cur.prerequisite) {
      assert.ok(!seen.has(cur.id), `boucle de prérequis autour de ${cur.id}`);
      seen.add(cur.id);
      cur = MISSIONS.find(x => x.id === cur.prerequisite);
    }
  }
});

test('tâches quotidiennes et hebdomadaires : identifiants uniques, récompenses positives', () => {
  for (const list of [DAILY_TASKS, WEEKLY_TASKS]) {
    assert.equal(new Set(list.map(t => t.id)).size, list.length);
    for (const t of list) assert.ok(t.target > 0 && positive(t.reward), t.id);
  }
});

test('packs de secours : raretés connues, prix et nombre de cartes positifs', () => {
  for (const p of Object.values(PACKS)) {
    assert.ok(RARITIES[p.guarantee], `${p.id} : garantie ${p.guarantee}`);
    assert.ok(p.price > 0 && p.cards > 0, p.id);
  }
  for (const [rarity, weight] of PACK_WEIGHTS) assert.ok(RARITIES[rarity] && weight > 0, rarity);
});

test('succès par défaut : identifiants uniques, objectifs et récompenses positifs', () => {
  assert.equal(new Set(DEFAULT_ACHIEVEMENTS.map(a => a.id)).size, DEFAULT_ACHIEVEMENTS.length);
  for (const a of DEFAULT_ACHIEVEMENTS) assert.ok(a.target > 0 && positive(a), a.id);
});

test('packs thématiques : identifiants uniques, garantie possible, un critère compétition ou décennie', () => {
  assert.equal(new Set(THEMED_PACKS.map(p => p.id)).size, THEMED_PACKS.length);
  for (const p of THEMED_PACKS) {
    assert.ok(RARITIES[p.guarantee] && p.price > 0 && p.cards > 0 && p.guaranteeCount <= p.cards, p.id);
    assert.ok((p.conditions.competitions || []).length + (p.conditions.decades || []).length === 1, p.id);
  }
});
