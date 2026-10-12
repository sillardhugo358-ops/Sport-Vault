'use strict';

// Démarrage de la base avec nouvelles tentatives : si PostgreSQL est injoignable au lancement (redémarrage de la base, coupure réseau
// brève, pic de charge), le serveur retente tout seul avec une attente croissante (5 s, 10 s, 20 s… plafonnée à 60 s) au lieu de rester
// en panne jusqu'à un redémarrage manuel. S'arrête dès que l'initialisation réussit, ou immédiatement si l'erreur n'a aucune chance de
// disparaître (shouldRetry). L'initialisation est idempotente (CREATE … IF NOT EXISTS, migrations enregistrées).

function createDbRetry({ attempt, onFail, onSuccess, shouldRetry = () => true, baseMs = 5000, maxMs = 60000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let tries = 0, timer = null, stopped = false, nextInMs = null;
  const delay = n => Math.min(maxMs, baseMs * 2 ** Math.min(n - 1, 20));
  async function run() {
    timer = null; nextInMs = null;
    if (stopped) return;
    tries++;
    try {
      const result = await attempt(tries);
      if (stopped) return;
      onSuccess?.(result, tries);
    } catch (error) {
      if (stopped) return;
      if (!shouldRetry(error)) { onFail?.(error, tries, null); return; }
      nextInMs = delay(tries);
      onFail?.(error, tries, nextInMs);
      timer = setTimer(run, nextInMs);
      timer.unref?.();
    }
  }
  return {
    start: run,
    stop() { stopped = true; if (timer) clearTimer(timer); timer = null; },
    status: () => ({ attempts: tries, nextInMs })
  };
}

module.exports = { createDbRetry };
