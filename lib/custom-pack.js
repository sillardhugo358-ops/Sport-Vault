'use strict';

// Pack sur mesure : validation de la demande et prix, calculés côté serveur (le client n'envoie que ses choix).

const { CUSTOM_PACK } = require('./game-config');

const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];
const FILTERS = ['competitions', 'seasons', 'clubs', 'positions'];
const fail = (error, status = 400) => ({ error, status });

function normalize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const cards = Number(b.cards);
  if (!Number.isInteger(cards) || cards < CUSTOM_PACK.minCards || cards > CUSTOM_PACK.maxCards) return fail('Un pack contient de ' + CUSTOM_PACK.minCards + ' à ' + CUSTOM_PACK.maxCards + ' cartes.');
  const minRarity = String(b.minRarity || 'common');
  if (!(minRarity in CUSTOM_PACK.perCard)) return fail('Rareté minimale invalide.');
  const src = b.filters && typeof b.filters === 'object' ? b.filters : {};
  const filters = {};
  for (const key of FILTERS) {
    const v = src[key];
    if (v == null) { filters[key] = []; continue; }
    if (!Array.isArray(v)) return fail('Filtre invalide : ' + key + '.');
    const list = [...new Set(v.map(x => String(x).trim()).filter(Boolean))];
    if (list.length > CUSTOM_PACK.maxValues) return fail('Trop de valeurs dans le filtre ' + key + ' (' + CUSTOM_PACK.maxValues + ' au maximum).');
    if (list.some(x => x.length > 80)) return fail('Valeur de filtre trop longue.');
    if (key === 'positions' && list.some(x => !POSITIONS.includes(x))) return fail('Poste inconnu.');
    filters[key] = list;
  }
  return { spec: { cards, minRarity, filters } };
}

function price(spec) {
  const active = FILTERS.filter(k => spec.filters[k].length).length;
  // Entiers uniquement : pas d'erreur d'arrondi flottant sur le prix.
  return Math.ceil(spec.cards * CUSTOM_PACK.perCard[spec.minRarity] * (100 + CUSTOM_PACK.filterBonusPct * active) / 100);
}

module.exports = { normalize, price, POSITIONS, FILTERS };
