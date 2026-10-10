'use strict';

// Amis et profils publics. Amitié par code d'échange (celui des échanges) et acceptation : personne n'est ajouté sans accord.
// Profil public : niveau, rang du classement général, succès, vitrine (5 cartes favorites), sets et albums terminés ; jamais de solde,
// d'e-mail ni de collection complète. Visibilité réglable (public = tous les joueurs connectés, par défaut ; amis ; privé).

const { FRIENDS } = require('./game-config');
const { notify } = require('./notifications');

const VISIBILITIES = ['public', 'friends', 'private'];
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const validCode = c => /^[A-Z0-9]{8}$/.test(c);

function createFriends({ getPool, ensureCode, listFavorites, levelProgressFromXp, rankOf }) {
  const db = () => getPool();

  async function visibleUser(code) {
    return (await db().query("SELECT id,name,xp,created_at,profile_visibility,trade_code FROM users WHERE trade_code=$1 AND account_status <> 'banned'", [code])).rows[0] || null;
  }
  async function between(a, b) {
    const [lo, hi] = pair(a, b);
    return (await db().query('SELECT id,requester,status FROM friendships WHERE user_low=$1 AND user_high=$2', [lo, hi])).rows[0] || null;
  }
  async function counts(userId) {
    const r = (await db().query(`SELECT count(*) FILTER (WHERE status='accepted')::int AS friends,
        count(*) FILTER (WHERE status='pending' AND requester=$1)::int AS outgoing,
        count(*) FILTER (WHERE status='pending' AND requester<>$1)::int AS incoming
      FROM friendships WHERE user_low=$1 OR user_high=$1`, [userId])).rows[0];
    return r;
  }

  // Page « Amis » : mon code, mes amis, demandes reçues et envoyées, ma visibilité.
  async function summary(userId) {
    if (!db()) return { code: null, visibility: 'public', friends: [], incoming: [], outgoing: [], limits: FRIENDS };
    const code = await ensureCode(userId);
    const me = (await db().query('SELECT profile_visibility FROM users WHERE id=$1', [userId])).rows[0];
    const rows = (await db().query(`SELECT f.id,f.status,f.requester,f.created_at,u.name,u.trade_code,u.xp FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_low=$1 THEN f.user_high ELSE f.user_low END
      WHERE (f.user_low=$1 OR f.user_high=$1) AND u.account_status <> 'banned' ORDER BY u.name`, [userId])).rows;
    const view = r => ({ id: Number(r.id), name: r.name, code: r.trade_code, level: levelProgressFromXp(r.xp).level, at: r.created_at });
    return {
      code, visibility: me?.profile_visibility || 'public', limits: FRIENDS,
      friends: rows.filter(r => r.status === 'accepted').map(view),
      incoming: rows.filter(r => r.status === 'pending' && r.requester !== userId).map(view),
      outgoing: rows.filter(r => r.status === 'pending' && r.requester === userId).map(view)
    };
  }

  async function request(userId, codeRaw) {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!validCode(code)) return fail('Code d\'échange invalide (8 caractères).');
    await ensureCode(userId);
    const other = await visibleUser(code);
    if (!other) return fail('Aucun joueur avec ce code.', 404);
    if (other.id === userId) return fail('C\'est ton propre code.');
    const cur = await between(userId, other.id);
    if (cur?.status === 'accepted') return fail('Vous êtes déjà amis.');
    if (cur && cur.requester === userId) return fail('Demande déjà envoyée.');
    if (cur) return respond(userId, Number(cur.id), 'accept');   // l'autre joueur avait déjà demandé : l'amitié est confirmée
    const mine = await counts(userId), theirs = await counts(other.id);
    if (mine.friends >= FRIENDS.maxFriends) return fail('Tu as atteint la limite d\'amis (' + FRIENDS.maxFriends + ').');
    if (mine.outgoing >= FRIENDS.maxOutgoing) return fail('Trop de demandes en attente (' + FRIENDS.maxOutgoing + ') : annule-en une ou attends une réponse.');
    if (theirs.incoming >= FRIENDS.maxIncoming) return fail('Ce joueur a trop de demandes en attente pour le moment.');
    const [lo, hi] = pair(userId, other.id);
    try { await db().query('INSERT INTO friendships(user_low,user_high,requester) VALUES($1,$2,$3)', [lo, hi, userId]); }
    catch (e) { if (e.code === '23505') return fail('Demande déjà envoyée.'); throw e; }
    const me = (await db().query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
    await notify(db(), other.id, 'friend_request', me.name + ' veut devenir ton ami', 'Accepte ou refuse la demande depuis la page Amis.', '#amis');
    return { ok: true, name: other.name };
  }

  // accept / decline (le destinataire), cancel (l'auteur de la demande).
  async function respond(userId, id, action) {
    const row = (await db().query('SELECT * FROM friendships WHERE id=$1 AND status=\'pending\'', [Number(id) || 0])).rows[0];
    if (!row || (row.user_low !== userId && row.user_high !== userId)) return fail('Demande introuvable.', 404);
    const other = row.user_low === userId ? row.user_high : row.user_low;
    if (action === 'cancel') {
      if (row.requester !== userId) return fail('Seul l\'auteur de la demande peut l\'annuler.', 403);
      await db().query('DELETE FROM friendships WHERE id=$1', [row.id]);
      return { ok: true };
    }
    if (row.requester === userId) return fail('Cette demande attend la réponse de l\'autre joueur.', 403);
    if (action === 'decline') { await db().query('DELETE FROM friendships WHERE id=$1', [row.id]); return { ok: true }; }
    if ((await counts(userId)).friends >= FRIENDS.maxFriends) return fail('Tu as atteint la limite d\'amis (' + FRIENDS.maxFriends + ').');
    if ((await counts(other)).friends >= FRIENDS.maxFriends) return fail('Ce joueur a atteint la limite d\'amis.');
    const r = await db().query("UPDATE friendships SET status='accepted',responded_at=now() WHERE id=$1 AND status='pending'", [row.id]);
    if (!r.rowCount) return fail('Demande introuvable.', 404);
    const me = (await db().query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
    await notify(db(), other, 'friend_accepted', me.name + ' a accepté ta demande', 'Vous êtes maintenant amis.', '#amis');
    return { ok: true };
  }

  async function remove(userId, id) {
    const r = await db().query("DELETE FROM friendships WHERE id=$1 AND status='accepted' AND (user_low=$2 OR user_high=$2)", [Number(id) || 0, userId]);
    return r.rowCount ? { ok: true } : fail('Ami introuvable.', 404);
  }

  async function setVisibility(userId, value) {
    if (!VISIBILITIES.includes(value)) return fail('Visibilité inconnue.');
    await db().query('UPDATE users SET profile_visibility=$2 WHERE id=$1', [userId, value]);
    return { ok: true, visibility: value };
  }

  async function publicProfile(viewerId, codeRaw) {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!validCode(code)) return fail('Code invalide (8 caractères).');
    const u = await visibleUser(code);
    if (!u) return fail('Joueur introuvable.', 404);
    const link = u.id === viewerId ? null : await between(viewerId, u.id);
    const relation = u.id === viewerId ? 'self' : !link ? 'none' : link.status === 'accepted' ? 'friend' : link.requester === viewerId ? 'pending_out' : 'pending_in';
    const head = { name: u.name, code: u.trade_code, relation };
    const allowed = relation === 'self' || u.profile_visibility === 'public' || (u.profile_visibility === 'friends' && relation === 'friend');
    if (!allowed) return fail('Ce profil n\'est pas visible.', 403, { player: head });
    const [rank, favorites, ach, sets, albums] = await Promise.all([
      rankOf(u.id), listFavorites(u.id),
      db().query("SELECT count(*)::int AS n FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'achievement:%'", [u.id]),
      db().query("SELECT s.name FROM reward_claims c JOIN card_sets s ON 'set:'||s.id=c.claim_id WHERE c.user_id=$1 ORDER BY s.name", [u.id]),
      db().query("SELECT count(*)::int AS n FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'album%'", [u.id])
    ]);
    return {
      player: { ...head, level: levelProgressFromXp(u.xp).level, rank, memberSince: u.created_at, achievements: ach.rows[0].n, albums: albums.rows[0].n, sets: sets.rows.map(r => r.name), visibility: u.profile_visibility },
      favorites
    };
  }

  // Flux d'activité des amis : événements marquants seulement (carte Epic ou mieux, set terminé, succès), des 14 derniers jours,
  // sans montants de FC ; lu dans les tables existantes (pas de table de plus). Les amis au profil privé n'apparaissent pas,
  // les succès cachés ne sont pas dévoilés, les cartes offertes ou de bienvenue et celles reçues par échange ne comptent pas.
  async function activity(userId) {
    if (!db()) return { events: [] };
    const rows = (await db().query(`
      WITH fr AS (
        SELECT u.id,u.name,u.trade_code FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user_low=$1 THEN f.user_high ELSE f.user_low END
        WHERE f.status='accepted' AND (f.user_low=$1 OR f.user_high=$1) AND u.account_status <> 'banned' AND u.profile_visibility <> 'private')
      SELECT * FROM (
        SELECT 'card' AS kind, fr.name, fr.trade_code AS code, ci.name AS label, ci.rarity AS extra,
               CASE WHEN ci.is_limited AND ci.serial IS NOT NULL THEN ci.serial||'/'||ci.max_supply END AS serial, ci.acquired_at AS at
        FROM card_instances ci JOIN fr ON fr.id=ci.owner_id
        WHERE ci.rarity IN ('epic','legendary','icon') AND ci.source NOT IN ('welcome','admin_grant') AND ci.status IN ('owned','auction')
          AND ci.acquired_at > now() - interval '14 days'
          AND NOT EXISTS (SELECT 1 FROM trade_offer_cards t JOIN trade_offers o ON o.id=t.offer_id WHERE t.instance_id=ci.instance_id AND o.status='accepted')
        UNION ALL
        SELECT 'set', fr.name, fr.trade_code, s.name, NULL, NULL, c.claimed_at
        FROM reward_claims c JOIN fr ON fr.id=c.user_id JOIN card_sets s ON c.claim_id='set:'||s.id
        WHERE c.claimed_at > now() - interval '14 days'
        UNION ALL
        SELECT 'achievement', fr.name, fr.trade_code, a.name, NULL, NULL, c.claimed_at
        FROM reward_claims c JOIN fr ON fr.id=c.user_id JOIN achievements a ON c.claim_id='achievement:'||a.id
        WHERE a.hidden IS NOT TRUE AND c.claimed_at > now() - interval '14 days'
      ) e ORDER BY at DESC LIMIT 30`, [userId])).rows;
    return { events: rows.map(r => ({ kind: r.kind, name: r.name, code: r.code, label: r.label, rarity: r.kind === 'card' ? r.extra : null, serial: r.serial, at: r.at })) };
  }

  return { summary, request, respond, remove, setVisibility, publicProfile, activity };
}

module.exports = { createFriends, VISIBILITIES };
