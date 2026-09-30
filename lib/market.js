'use strict';

// Marché plus lisible : prix de référence et historique des ventes par carte, ventes récentes,
// alertes de prix. Une « vente » est une enchère terminée avec un acheteur (les enchères sans offre
// ne comptent pas). Le prix de référence est la médiane des 20 dernières ventes de la carte.
// Les alertes (table price_alerts) préviennent un joueur, via la cloche, quand une enchère s'ouvre
// sur une carte suivie avec une mise de départ inférieure ou égale à son prix maximum.

const { notify } = require('./notifications');

const REFERENCE_SALES = 20;
const MAX_ALERTS = 30;
const fc = n => Number(n).toLocaleString('fr-FR') + ' FC';

// Sous-requête SQL : médiane des dernières ventes de la carte désignée par `cardIdExpr`.
const referenceSql = cardIdExpr => `(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.price) FROM (
    SELECT aa.current_bid AS price FROM auctions aa JOIN card_instances cc ON cc.instance_id=aa.card_instance_id
    WHERE aa.status='completed' AND aa.current_bidder_id IS NOT NULL AND cc.card_id=${cardIdExpr}
    ORDER BY COALESCE(aa.completed_at,aa.ends_at) DESC LIMIT ${REFERENCE_SALES}) s)`;

function createMarket({ getPool, publicCard, settleExpiredAuctions }) {
  const db = () => getPool();

  async function cardMarket(cardId, userId = null) {
    cardId = String(cardId || '').slice(0, 32);
    if (!db() || !cardId) return { cardId, reference: null, sales: [], active: 0, alert: null };
    await settleExpiredAuctions();
    const [sales, stats, active, alert] = await Promise.all([
      db().query(`SELECT a.current_bid AS price, COALESCE(a.completed_at,a.ends_at) AS sold_at, c.serial, c.max_supply, c.is_limited
        FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
        WHERE a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.card_id=$1
        ORDER BY sold_at DESC LIMIT 10`, [cardId]),
      db().query(`SELECT ${referenceSql('$1')} AS median, count(*)::int AS n, min(a.current_bid)::int AS low, max(a.current_bid)::int AS high
        FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
        WHERE a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.card_id=$1`, [cardId]),
      db().query(`SELECT count(*)::int AS n, min(a.current_bid)::int AS low FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
        WHERE a.status='active' AND a.ends_at>now() AND c.card_id=$1`, [cardId]),
      userId ? db().query('SELECT max_price FROM price_alerts WHERE user_id=$1 AND card_id=$2', [userId, cardId]) : { rows: [] }
    ]);
    const s = stats.rows[0];
    return {
      cardId,
      reference: s.n ? { median: Math.round(Number(s.median)), sales: s.n, low: s.low, high: s.high } : null,
      sales: sales.rows.map(r => ({ price: Number(r.price), soldAt: r.sold_at, serial: r.is_limited && r.serial ? r.serial + '/' + r.max_supply : null })),
      active: active.rows[0].n, lowestActive: active.rows[0].low,
      alert: alert.rows[0] ? { maxPrice: Number(alert.rows[0].max_price) } : null
    };
  }

  // Dernières ventes de tout le marché (onglet « Historique »), sans identité des joueurs.
  async function recentSales(limit = 30) {
    if (!db()) return [];
    await settleExpiredAuctions();
    const r = await db().query(`SELECT a.id, a.current_bid, COALESCE(a.completed_at,a.ends_at) AS sold_at,
        c.card_id, c.name, c.position, c.club, c.nation, c.rarity, c.season, c.is_limited, c.serial, c.max_supply, c.source, c.ovr, c.jersey_number,
        ${referenceSql('c.card_id')} AS reference_median
      FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
      WHERE a.status='completed' AND a.current_bidder_id IS NOT NULL
      ORDER BY sold_at DESC LIMIT $1`, [Math.min(50, Math.max(1, limit))]);
    return r.rows.map(x => ({ id: x.id, price: Number(x.current_bid), soldAt: x.sold_at, referencePrice: x.reference_median == null ? null : Math.round(Number(x.reference_median)), card: publicCard(x) }));
  }

  async function listAlerts(userId) {
    if (!db()) return [];
    const r = await db().query(`SELECT p.card_id, p.max_price, p.created_at, p.last_notified_at, k.name, k.club, k.season, k.rarity, k.ovr,
        ${referenceSql('p.card_id')} AS reference_median,
        (SELECT min(a.current_bid)::int FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.status='active' AND a.ends_at>now() AND c.card_id=p.card_id) AS lowest_active
      FROM price_alerts p LEFT JOIN catalog_cards k ON k.id=p.card_id
      WHERE p.user_id=$1 ORDER BY p.created_at DESC`, [userId]);
    return r.rows.map(x => ({
      cardId: x.card_id, maxPrice: Number(x.max_price), createdAt: x.created_at, lastNotifiedAt: x.last_notified_at,
      name: x.name || x.card_id, club: x.club || '', season: x.season || '', rarity: x.rarity || 'common', ovr: x.ovr == null ? null : Number(x.ovr),
      referencePrice: x.reference_median == null ? null : Math.round(Number(x.reference_median)), lowestActive: x.lowest_active
    }));
  }

  // Crée ou met à jour l'alerte (une par carte et par joueur).
  async function setAlert(userId, cardId, maxPrice) {
    cardId = String(cardId || '').slice(0, 32);
    const price = Number(maxPrice);
    if (!db()) return { error: 'Marché indisponible.', status: 503 };
    if (!Number.isSafeInteger(price) || price < 1 || price > 100_000_000) return { error: 'Prix maximum : un nombre entier de FOOTCOINS supérieur à 0.', status: 400 };
    if (!(await db().query('SELECT 1 FROM catalog_cards WHERE id=$1', [cardId])).rowCount) return { error: 'Carte introuvable.', status: 404 };
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Verrou par joueur : la limite d'alertes tient même avec des requêtes simultanées.
      await client.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const exists = (await client.query('SELECT 1 FROM price_alerts WHERE user_id=$1 AND card_id=$2', [userId, cardId])).rowCount > 0;
      if (!exists && Number((await client.query('SELECT count(*)::int AS n FROM price_alerts WHERE user_id=$1', [userId])).rows[0].n) >= MAX_ALERTS) {
        await client.query('ROLLBACK');
        return { error: 'Limite atteinte : ' + MAX_ALERTS + ' alertes de prix maximum.', status: 400 };
      }
      await client.query(`INSERT INTO price_alerts(user_id,card_id,max_price) VALUES($1,$2,$3)
        ON CONFLICT(user_id,card_id) DO UPDATE SET max_price=EXCLUDED.max_price`, [userId, cardId, price]);
      await client.query('COMMIT');
      return { ok: true, alert: { cardId, maxPrice: price } };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  async function deleteAlert(userId, cardId) {
    if (!db()) return { error: 'Marché indisponible.', status: 503 };
    await db().query('DELETE FROM price_alerts WHERE user_id=$1 AND card_id=$2', [userId, String(cardId || '').slice(0, 32)]);
    return { ok: true };
  }

  return { cardMarket, recentSales, listAlerts, setAlert, deleteAlert };
}

// Appelée dans la transaction de création d'une enchère : prévient les joueurs qui suivent la carte
// (hors vendeur) si la mise de départ ne dépasse pas leur prix maximum. Une notification par enchère.
async function triggerPriceAlerts(client, { auctionId, cardId, sellerId, startingBid, cardName }) {
  const r = await client.query(`UPDATE price_alerts SET last_notified_at=now()
    WHERE card_id=$1 AND user_id<>$2 AND max_price>=$3 RETURNING user_id, max_price`, [cardId, sellerId, startingBid]);
  for (const a of r.rows) {
    await notify(client, a.user_id, 'price_alert', 'Alerte de prix : ' + cardName,
      'Enchère ouverte à ' + fc(startingBid) + ' (ton prix max : ' + fc(a.max_price) + ').', '#market?auction=' + auctionId);
  }
  return r.rowCount;
}

module.exports = { createMarket, triggerPriceAlerts, referenceSql, MAX_ALERTS };
