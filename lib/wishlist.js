'use strict';

// Liste de souhaits : cartes du catalogue que le joueur cherche (50 au maximum). Une notification (cloche, et push si activé) le prévient
// quand l'une d'elles est mise aux enchères ; un joueur qui a déjà une alerte de prix qui s'applique n'est pas prévenu deux fois.

const { WISHLIST_MAX } = require('./game-config');
const { notify } = require('./notifications');

const fail = (error, status = 400) => ({ error, status });
const cardView = r => ({ id: r.id, name: r.name, club: r.club, season: r.season, position: r.position, nation: r.nation, rarity: r.rarity, ovr: Number(r.ovr || 0), limited: !!r.is_limited });

// Appelée à la création d'une enchère, dans sa transaction.
async function triggerWishlistAlerts(client, { auctionId, cardId, sellerId, startingBid, cardName }) {
  const r = await client.query(`SELECT w.user_id FROM wishlist w WHERE w.card_id=$1 AND w.user_id<>$2
    AND NOT EXISTS(SELECT 1 FROM price_alerts p WHERE p.user_id=w.user_id AND p.card_id=$1 AND p.max_price>=$3)`, [cardId, sellerId, startingBid]);
  for (const row of r.rows) {
    await notify(client, row.user_id, 'wishlist_auction', 'Une carte de tes souhaits est en vente : ' + cardName,
      'Enchère ouverte à ' + Number(startingBid).toLocaleString('fr-FR') + ' FC.', '#market?auction=' + auctionId);
  }
  return r.rowCount;
}

function createWishlist({ getPool }) {
  const db = () => getPool();

  async function list(userId) {
    if (!db()) return { cards: [], max: WISHLIST_MAX };
    const rows = (await db().query(`SELECT c.id,c.name,c.club,c.season,c.position,c.nation,c.rarity,c.ovr,c.is_limited,w.created_at,
        (SELECT count(*)::int FROM card_instances i WHERE i.owner_id=$1 AND i.card_id=c.id AND i.status IN ('owned','auction')) AS owned,
        (SELECT count(*)::int FROM auctions a JOIN card_instances i ON i.instance_id=a.card_instance_id WHERE a.status='active' AND a.ends_at>now() AND i.card_id=c.id AND a.seller_id<>$1) AS selling,
        (SELECT a.id FROM auctions a JOIN card_instances i ON i.instance_id=a.card_instance_id WHERE a.status='active' AND a.ends_at>now() AND i.card_id=c.id AND a.seller_id<>$1 ORDER BY a.current_bid, a.ends_at LIMIT 1) AS auction_id,
        (SELECT min(a.current_bid) FROM auctions a JOIN card_instances i ON i.instance_id=a.card_instance_id WHERE a.status='active' AND a.ends_at>now() AND i.card_id=c.id AND a.seller_id<>$1) AS from_price
      FROM wishlist w JOIN catalog_cards c ON c.id=w.card_id AND c.is_active=true WHERE w.user_id=$1 ORDER BY w.created_at DESC, c.id`, [userId])).rows;
    return { max: WISHLIST_MAX, cards: rows.map(r => ({ ...cardView(r), owned: r.owned, selling: r.selling, auctionId: r.selling ? r.auction_id : null, fromPrice: r.selling ? Number(r.from_price) : null })) };
  }

  async function search(userId, qRaw) {
    const q = String(qRaw || '').trim().slice(0, 40);
    if (q.length < 2 || !db()) return { cards: [] };
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const rows = (await db().query(`SELECT c.id,c.name,c.club,c.season,c.position,c.nation,c.rarity,c.ovr,c.is_limited,
        EXISTS(SELECT 1 FROM wishlist w WHERE w.user_id=$1 AND w.card_id=c.id) AS wished
      FROM catalog_cards c WHERE c.is_active=true AND (c.name ILIKE $2 OR c.club ILIKE $2) ORDER BY c.ovr DESC, c.name, c.id LIMIT 20`, [userId, like])).rows;
    return { cards: rows.map(r => ({ ...cardView(r), wished: r.wished })) };
  }

  async function add(userId, cardId) {
    const id = String(cardId || '');
    const card = (await db().query('SELECT id FROM catalog_cards WHERE id=$1 AND is_active=true', [id])).rows[0];
    if (!card) return fail('Carte introuvable.', 404);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const have = (await client.query('SELECT count(*)::int AS n, bool_or(card_id=$2) AS has FROM wishlist WHERE user_id=$1', [userId, id])).rows[0];
      if (have.has) { await client.query('ROLLBACK'); return { ok: true, already: true }; }
      if (have.n >= WISHLIST_MAX) { await client.query('ROLLBACK'); return fail('Ta liste de souhaits est pleine (' + WISHLIST_MAX + ' cartes maximum).'); }
      await client.query('INSERT INTO wishlist(user_id,card_id) VALUES($1,$2)', [userId, id]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function remove(userId, cardId) {
    await db().query('DELETE FROM wishlist WHERE user_id=$1 AND card_id=$2', [userId, String(cardId || '')]);
    return { ok: true };
  }

  return { list, search, add, remove };
}

module.exports = { createWishlist, triggerWishlistAlerts };
