'use strict';

// Thème jour : theme-light.css est GÉNÉRÉ (scripts/build-light-theme.js) ; le fichier commité doit être à jour, bien formé,
// et ne pas toucher à l'art des cartes ni au terrain de l'équipe type.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build, OUT } = require('../scripts/build-light-theme');

test('theme-light.css est à jour (node scripts/build-light-theme.js après toute modification de styles*.css)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), build());
});

test('theme-light.css : accolades équilibrées, tout est sous html[data-theme="light"], cartes et terrain épargnés', () => {
  const css = fs.readFileSync(OUT, 'utf8');
  let depth = 0;
  for (const c of css) { if (c === '{') depth++; if (c === '}') depth--; assert.ok(depth >= 0, 'accolade fermante en trop'); }
  assert.equal(depth, 0);
  const rules = css.split('\n').filter(l => l && !l.startsWith('/*') && !l.startsWith('@media') && l !== '}');
  assert.ok(rules.length > 500, 'beaucoup de règles générées');
  assert.ok(rules.every(l => l.startsWith('html[data-theme="light"]')), 'chaque règle est préfixée');
  assert.ok(!/\.tcg-card|\.v4-|\.team-pitch\s*\{[^}]*rgba\(38/.test(css.replace(/\.team-pitch\{background:repeating[^}]*\}/, '')), 'art des cartes inchangé');
});
