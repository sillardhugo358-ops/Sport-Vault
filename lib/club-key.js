'use strict';

// Clé de rapprochement des noms de clubs (album, rattachement des saisons) : sans accents, casse
// ni ponctuation, avec les alias connus (« Angers SCO » = « Angers », « Stade Brestois 29 » = « Brest »,
// « Parma FC » = « Parma Calcio 1913 »…). Deux noms de même clé désignent un seul club (lib/club-merge.js).

const ALIASES = { troyes: 'estactroyes', estac: 'estactroyes', estactroyes: 'estactroyes', losclille: 'lille', losc: 'lille', lilleosc: 'lille', angerssco: 'angers', scoangers: 'angers', stadebrestois: 'brest', stadebrestois29: 'brest',
  // Même club sous deux noms dans le classeur Europe.
  parmafc: 'parmacalcio1913', spal2013: 'spal',
  // Anciennes clés (faute de frappe d'origine), gardées sans effet de bord.
  stadebretois: 'brest', stadebretois29: 'brest' };

function normName(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function clubKey(value) {
  const n = normName(value);
  return ALIASES[n] || n;
}

module.exports = { clubKey, normName, CLUB_ALIASES: ALIASES };
