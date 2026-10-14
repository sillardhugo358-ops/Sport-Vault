'use strict';

// Erreurs serveur (réponses 5xx) gardées en mémoire pour le tableau d'alertes de l'état du site (admin).
// Aucune donnée de joueur : seulement l'heure, la méthode, le chemin (sans paramètres) et le type de l'erreur (code ou nom).

const HOUR = 3600_000, DAY = 24 * HOUR;
// Routes de récupération de récompenses : une erreur serveur ici bloque un joueur sur de l'argent virtuel.
const CLAIM_PATH = /\/claim|^\/api\/rewards\//;

function createServerErrorLog({ max = 50, now = () => Date.now() } = {}) {
  const list = [];
  let total = 0;
  function record({ method, path, status, error }) {
    total++;
    const p = String(path || '').split('?')[0].slice(0, 120);
    list.push({ at: now(), method: String(method || '').slice(0, 8), path: p, status: Number(status) || 500, kind: String((error && (error.code || error.name)) || 'Error').slice(0, 40), claim: CLAIM_PATH.test(p) });
    if (list.length > max) list.shift();
  }
  function snapshot() {
    const t = now();
    const within = ms => list.filter(e => t - e.at <= ms);
    return {
      total,
      lastHour: within(HOUR).length,
      last24h: within(DAY).length,
      claimLast24h: within(DAY).filter(e => e.claim).length,
      recent: list.slice(-10).reverse().map(e => ({ at: new Date(e.at).toISOString(), method: e.method, path: e.path, status: e.status, kind: e.kind }))
    };
  }
  return { record, snapshot };
}

module.exports = { createServerErrorLog, CLAIM_PATH };
