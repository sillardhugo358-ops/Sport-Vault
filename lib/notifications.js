'use strict';

// Notifications des joueurs (cloche de l'en-tête) : surenchère, fin d'enchère (vente, achat, sans offre),
// alerte de prix (lib/market.js).
// Écrites dans la même transaction que l'événement ; les récompenses disponibles sont calculées
// à la lecture (lib/routes/rewards.js), sans être stockées.

const KINDS = ['outbid', 'auction_won', 'auction_sold', 'auction_unsold', 'price_alert'];
const KEEP_DAYS = 60;

async function notify(db, userId, kind, title, body = '', link = null) {
  if (!db || !userId) return;
  if (!KINDS.includes(kind)) throw new Error('Type de notification inconnu : ' + kind);
  await db.query('INSERT INTO notifications(user_id,kind,title,body,link) VALUES($1,$2,$3,$4,$5)',
    [userId, kind, String(title).slice(0, 120), String(body || '').slice(0, 300), link ? String(link).slice(0, 120) : null]);
}

function createNotifications({ getPool }) {
  async function listNotifications(userId) {
    if (!getPool()) return { notifications: [], unread: 0 };
    const [rows, unread] = await Promise.all([
      getPool().query(`SELECT id,kind,title,body,link,created_at,read_at FROM notifications WHERE user_id=$1 AND created_at > now() - interval '${KEEP_DAYS} days' ORDER BY created_at DESC, id DESC LIMIT 30`, [userId]),
      getPool().query(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL AND created_at > now() - interval '${KEEP_DAYS} days'`, [userId])
    ]);
    return {
      notifications: rows.rows.map(r => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: !!r.read_at })),
      unread: unread.rows[0].n
    };
  }
  // Marque comme lues toutes les notifications du joueur (ou celles jusqu'à un identifiant donné).
  async function markNotificationsRead(userId, upToId = null) {
    if (!getPool()) return { ok: true };
    const id = Number.parseInt(upToId, 10);
    if (Number.isSafeInteger(id) && id > 0) await getPool().query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND id<=$2', [userId, id]);
    else await getPool().query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
    return { ok: true };
  }
  return { listNotifications, markNotificationsRead };
}

module.exports = { notify, createNotifications, NOTIFICATION_KINDS: KINDS };
