'use strict';

// Comparaison à temps constant (empreintes SHA-256 de même longueur) : un jeton ne se devine pas par mesure du temps de réponse.

const crypto = require('node:crypto');

function sameToken(given, expected) {
  const h = v => crypto.createHash('sha256').update(String(v ?? '')).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

module.exports = { sameToken };
