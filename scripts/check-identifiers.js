'use strict';

// Contrôle statique : signale tout identifiant utilisé mais déclaré nulle
// part (variable ou fonction supprimée, faute de frappe). Une telle erreur
// ne se voit qu'à l'exécution de la branche concernée, parfois en production.
// Usage : node scripts/check-identifiers.js fichier.js [...]

const fs = require('node:fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis).concat([
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'URL', 'fetch', 'arguments'
]));

function unresolved(file) {
  const ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
  const declared = new Set();
  const add = p => {
    if (!p) return;
    if (p.type === 'Identifier') declared.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(q => add(q.value || q.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(add);
    else if (p.type === 'AssignmentPattern') add(p.left);
    else if (p.type === 'RestElement') add(p.argument);
  };
  walk.full(ast, n => {
    if (n.type === 'VariableDeclarator') add(n.id);
    if (/Function/.test(n.type)) { n.params.forEach(add); if (n.id) add(n.id); }
    if (n.type === 'CatchClause') add(n.param);
    if (n.type === 'ClassDeclaration') add(n.id);
  });
  const found = new Map();
  walk.ancestor(ast, {
    Identifier(n, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent && parent.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand) return;
      if (declared.has(n.name) || GLOBALS.has(n.name)) return;
      found.set(n.name, (found.get(n.name) || 0) + 1);
    }
  });
  return found;
}

let failed = false;
for (const file of process.argv.slice(2)) {
  const found = unresolved(file);
  if (found.size) {
    failed = true;
    console.error(`${file} : identifiant(s) non déclaré(s) : ${[...found].map(([k, v]) => `${k} (${v}×)`).join(', ')}`);
  }
}
if (failed) process.exit(1);
console.log('Identifiants : tous déclarés.');
