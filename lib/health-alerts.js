'use strict';

// Alertes affichées sur la page d'état (admin) : base de données, latence, erreurs serveur, récupérations en échec.
// Seuils au même endroit pour pouvoir les relire et les tester. Niveaux : « critical » (agir maintenant) et « warning » (à surveiller).

const THRESHOLDS = { latencyWarnMs: 500, latencyCriticalMs: 1500, errorsHourWarn: 1, errorsHourCritical: 5, claimErrors24hWarn: 1 };

function buildAlerts({ ready, database, serverErrors }) {
  const alerts = [];
  const add = (level, code, message) => alerts.push({ level, code, message });
  if (!ready) add('critical', 'db_starting', 'La base de données n\'est pas prête : le serveur retente la connexion tout seul.');
  else if (database && !database.ok) add('critical', 'db_down', 'La base de données ne répond pas' + (database.error ? ' (' + database.error + ')' : '') + '.');
  else if (database && Number.isFinite(database.latencyMs)) {
    if (database.latencyMs >= THRESHOLDS.latencyCriticalMs) add('critical', 'db_latency', 'La base répond très lentement : ' + database.latencyMs + ' ms.');
    else if (database.latencyMs >= THRESHOLDS.latencyWarnMs) add('warning', 'db_latency', 'La base répond lentement : ' + database.latencyMs + ' ms.');
  }
  const e = serverErrors || {};
  if (e.lastHour >= THRESHOLDS.errorsHourCritical) add('critical', 'server_errors', e.lastHour + ' erreurs serveur depuis moins d\'une heure : voir le journal Render.');
  else if (e.lastHour >= THRESHOLDS.errorsHourWarn) add('warning', 'server_errors', e.lastHour + ' erreur' + (e.lastHour > 1 ? 's' : '') + ' serveur depuis moins d\'une heure.');
  if (e.claimLast24h >= THRESHOLDS.claimErrors24hWarn) add('warning', 'claim_errors', e.claimLast24h + ' récupération' + (e.claimLast24h > 1 ? 's' : '') + ' de récompense en erreur serveur ces dernières 24 h : des joueurs ont pu être bloqués.');
  return alerts;
}

module.exports = { buildAlerts, THRESHOLDS };
