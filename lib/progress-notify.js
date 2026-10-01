'use strict';

// Notification « terminé » quand un succès ou une mission (de progression, quotidienne,
// hebdomadaire, mensuelle) vient d'être atteint. Détecté à la lecture de la cloche
// (GET /api/notifications, lib/routes/rewards.js), au plus toutes les 10 s par joueur.
// Chaque objectif n'est signalé qu'une fois (table progress_notified, clé unique par joueur) ;
// à la première vérification d'un joueur, ce qu'il avait déjà atteint est marqué sans notification.

const { notify } = require('./notifications');

const THROTTLE_MS = 10000;
const GROUP_ABOVE = 3; // au-delà, une seule notification groupée
const INIT_KEY = '__init';

function createProgressNotify({ getPool }) {
  const lastCheck = new Map();

  // loadItems() : [{ key, kind: 'achievement_done' | 'mission_done', title, link }], appelé seulement hors limitation.
  async function check(userId, loadItems) {
    const db = getPool();
    if (!db) return [];
    const now = Date.now();
    if (now - (lastCheck.get(userId) || 0) < THROTTLE_MS) return [];
    lastCheck.set(userId, now);
    if (lastCheck.size > 50000) lastCheck.clear();

    const items = await loadItems();
    const keys = [...new Set(items.map(i => String(i.key).slice(0, 160)))];
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const first = (await client.query('INSERT INTO progress_notified(user_id,key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING key', [userId, INIT_KEY])).rowCount > 0;
      const fresh = keys.length ? (await client.query(
        'INSERT INTO progress_notified(user_id,key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING RETURNING key', [userId, keys])).rows.map(r => r.key) : [];
      const added = first ? [] : items.filter(i => fresh.includes(String(i.key).slice(0, 160)));
      if (added.length > GROUP_ABOVE) {
        const ach = added.filter(i => i.kind === 'achievement_done').length, mis = added.length - ach;
        const parts = [ach && ach + ' succès', mis && mis + ' mission' + (mis > 1 ? 's' : '')].filter(Boolean).join(' et ');
        await notify(client, userId, ach ? 'achievement_done' : 'mission_done', parts + ' terminé' + (added.length > 1 ? 's' : '') + ' !',
          'Récupère tes récompenses.', ach ? '#successes' : '#vault');
      } else {
        for (const i of added) await notify(client, userId, i.kind, i.title, 'Récompense à récupérer.', i.link);
      }
      // Clés des périodes passées (missions quotidiennes, hebdomadaires, mensuelles) : inutiles après 40 jours.
      if (Math.random() < 0.02) await client.query("DELETE FROM progress_notified WHERE user_id=$1 AND key ~ '^(daily|weekly|monthly):' AND created_at<now()-interval '40 days'", [userId]);
      await client.query('COMMIT');
      return added;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      lastCheck.delete(userId);
      throw e;
    } finally { client.release(); }
  }

  return { checkProgress: check };
}

module.exports = { createProgressNotify };
