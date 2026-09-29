'use strict';

// server.js n'exporte rien et démarre le serveur au chargement. Pour tester
// ses fonctions pures sans le lancer, on extrait leur code source et on
// l'évalue isolément. Solution temporaire jusqu'au découpage en modules
// (phase 3 de la feuille de route).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function functionSource(name) {
  const start = SOURCE.search(new RegExp(`(^|[;\\n}])function ${name}\\(`));
  if (start < 0) throw new Error(`Fonction ${name} introuvable dans server.js`);
  const from = SOURCE.indexOf('function ' + name + '(', start);
  let depth = 0;
  for (let i = SOURCE.indexOf('{', from); i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}' && --depth === 0) return SOURCE.slice(from, i + 1);
  }
  throw new Error(`Fin de la fonction ${name} introuvable`);
}

// Renvoie un objet { nom: fonction } ; `globals` fournit les constantes
// dont ces fonctions dépendent.
function loadFunctions(names, globals = {}) {
  const context = vm.createContext({ ...globals, Intl, Date, Math, Number, String });
  vm.runInContext(names.map(functionSource).join('\n') + `\n;globalThis.__out={${names.join(',')}};`, context);
  return context.__out;
}

module.exports = { loadFunctions };
