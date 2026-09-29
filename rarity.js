'use strict';

// Barème officiel des raretés (CLAUDE.md) : la note générale détermine la
// rareté, sans chevauchement. Seule exception : une carte marquée
// « rareté manuelle » (catalog_cards.rarity_locked), pour les cartes spéciales.

const RARITY_SCALE = [
  ['icon', 92],
  ['legendary', 90],
  ['epic', 84],
  ['rare', 78],
  ['common', -Infinity]
];

function rarityFromOvr(ovr) {
  const n = Number(ovr);
  if (!Number.isFinite(n)) throw new Error('Note générale invalide : ' + ovr);
  return RARITY_SCALE.find(([, min]) => n >= min)[0];
}

// Même barème en SQL, pour les contrôles et migrations en base.
const RARITY_SQL = "CASE WHEN ovr>=92 THEN 'icon' WHEN ovr>=90 THEN 'legendary' WHEN ovr>=84 THEN 'epic' WHEN ovr>=78 THEN 'rare' ELSE 'common' END";

module.exports = { rarityFromOvr, RARITY_SQL };
