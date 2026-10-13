'use strict';

// Atelier : vente rapide des doublons contre des FOOTCOINS et fusion de 5 doublons en 1 carte de rareté supérieure.
// Tout est décidé ici (prix, éligibilité, tirage) : le client n'envoie que « quelle carte, combien ». Une carte éligible est un doublon :
// on garde toujours au moins un exemplaire de chaque carte ; sont exclus les cartes de bienvenue ou non échangeables, les éditions limitées,
// Legendary et Icon, les exemplaires aux enchères, dans une offre d'échange ouverte ou en vitrine (favoris).

const crypto = require('node:crypto');
const { ECONOMY } = require('./game-config');
const { recordCoins } = require('./ledger');
const { referenceSql } = require('./market');
const { parisDayKey, parisLocalMidnight } = require('./periods');

const STATS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];
const fail = (error, status = 400) => ({ error, status });
const unitPrice = (rarity, median) => Math.max(1, median != null ? Math.round(Number(median) * ECONOMY.sellRatio) : ECONOMY.fixedPrices[rarity] || 1);

function createEconomy({ getPool, securityEvent, buildInstance, createCardInstance, activeCatalogCards, safeUser, getUserById }) {
  const db = () => getPool();

  // Doublons vendables ou fusionnables : une ligne par carte avec le nombre d'exemplaires « de trop » (spare).
  const SPARE_SQL = `
    SELECT x.card_id,x.name,x.club,x.season,x.position,x.rarity,x.ovr,LEAST(x.eligible, x.total - 1) AS spare
    FROM (SELECT ci.card_id, max(ci.name) AS name, max(ci.club) AS club, max(ci.season) AS season, max(ci.position) AS position, max(ci.rarity) AS rarity, max(ci.ovr) AS ovr,
            count(*) FILTER (WHERE ci.status IN ('owned','auction')) AS total,
            count(*) FILTER (WHERE ci.status='owned' AND ci.source<>'welcome' AND ci.tradeable IS NOT FALSE AND ci.is_limited IS NOT TRUE
              AND NOT EXISTS(SELECT 1 FROM trade_offer_cards t WHERE t.instance_id=ci.instance_id AND t.open AND t.side='give')
              AND NOT EXISTS(SELECT 1 FROM favorite_cards f WHERE f.instance_id=ci.instance_id)) AS eligible
          FROM card_instances ci WHERE ci.owner_id=$1 AND ci.rarity = ANY($2::text[]) GROUP BY ci.card_id) x
    WHERE x.total >= 2 AND LEAST(x.eligible, x.total - 1) > 0`;

  async function fusionsToday(client, userId) {
    return (await client.query("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='card_fusion' AND created_at >= $2", [userId, parisLocalMidnight(parisDayKey())])).rows[0].n;
  }

  // Cartes que la fusion peut donner : de la rareté visée, pas limitées, et que le joueur ne possède pas encore.
  async function freshPool(client, userId, to) {
    const owned = new Set((await client.query('SELECT DISTINCT card_id FROM card_instances WHERE owner_id=$1', [userId])).rows.map(r => r.card_id));
    return (await activeCatalogCards(client)).filter(c => c.rarity === to && !c.isLimited && !c.rarityLocked && !owned.has(c.id));
  }

  async function info(userId) {
    if (!db()) return { cards: [], fusion: {} };
    const rows = (await db().query(`SELECT s.*,${referenceSql('s.card_id')} AS median FROM (${SPARE_SQL}) s ORDER BY s.rarity, s.ovr DESC, s.name`, [userId, ECONOMY.sellable])).rows;
    const cards = rows.map(r => ({ cardId: r.card_id, name: r.name, club: r.club, season: r.season, position: r.position, rarity: r.rarity, ovr: Number(r.ovr), spare: Number(r.spare), unitPrice: unitPrice(r.rarity, r.median) }));
    const left = Math.max(0, ECONOMY.fusion.perDay - await fusionsToday(db(), userId));
    const fusion = Object.fromEntries(await Promise.all(Object.entries(ECONOMY.fusion.next).map(async ([from, to]) => [from, { to, available: cards.filter(c => c.rarity === from).reduce((n, c) => n + c.spare, 0), fresh: (await freshPool(db(), userId, to)).length }])));
    return { cards, fusion: { cost: ECONOMY.fusion.cost, perDay: ECONOMY.fusion.perDay, left, rules: fusion }, sellRatio: ECONOMY.sellRatio };
  }

  // Exemplaires à retirer pour une carte : les plus récents d'abord ; verrouillés pour la durée de la transaction.
  async function lockSpare(client, userId, cardId, count) {
    const spare = (await client.query(`SELECT s.spare FROM (${SPARE_SQL}) s WHERE s.card_id=$3`, [userId, ECONOMY.sellable, cardId])).rows[0];
    if (!spare || Number(spare.spare) < count) return null;
    return (await client.query(`SELECT ci.instance_id FROM card_instances ci WHERE ci.owner_id=$1 AND ci.card_id=$2 AND ci.status='owned' AND ci.source<>'welcome' AND ci.tradeable IS NOT FALSE AND ci.is_limited IS NOT TRUE
        AND NOT EXISTS(SELECT 1 FROM trade_offer_cards t WHERE t.instance_id=ci.instance_id AND t.open AND t.side='give')
        AND NOT EXISTS(SELECT 1 FROM favorite_cards f WHERE f.instance_id=ci.instance_id)
      ORDER BY ci.acquired_at DESC, ci.instance_id LIMIT $3 FOR UPDATE`, [userId, cardId, count])).rows.map(r => r.instance_id);
  }

  async function quickSell(userId, body) {
    const cardId = String(body?.cardId || ''), count = Math.floor(Number(body?.count));
    if (!cardId || !Number.isSafeInteger(count) || count < 1 || count > 100) return fail('Quantité invalide.');
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const row = (await client.query(`SELECT s.rarity,${referenceSql('s.card_id')} AS median FROM (${SPARE_SQL}) s WHERE s.card_id=$3`, [userId, ECONOMY.sellable, cardId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return fail('Cette carte n\'a pas de doublon vendable.'); }
      const ids = await lockSpare(client, userId, cardId, count);
      if (!ids) { await client.query('ROLLBACK'); return fail('Tu n\'as pas assez de doublons vendables de cette carte.'); }
      const unit = unitPrice(row.rarity, row.median), total = unit * count;
      await client.query('DELETE FROM card_instances WHERE instance_id=ANY($1::uuid[])', [ids]);
      await client.query('UPDATE users SET coins=coins+$2 WHERE id=$1', [userId, total]);
      await recordCoins(client, userId, total, 'quick_sell', cardId);
      await securityEvent(userId, null, 'quick_sell', { cardId, count, unit, total }, client);
      await client.query('COMMIT');
      return { ok: true, sold: count, unit, total, user: safeUser(await getUserById(userId)) };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function fuse(userId, body) {
    const from = String(body?.rarity || ''), to = ECONOMY.fusion.next[from], cost = ECONOMY.fusion.cost;
    if (!to) return fail('Cette rareté ne se fusionne pas.');
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (await fusionsToday(client, userId) >= ECONOMY.fusion.perDay) { await client.query('ROLLBACK'); return fail('Limite atteinte : ' + ECONOMY.fusion.perDay + ' fusions par jour. Rien n\'a été consommé.'); }
      const sources = (await client.query(`SELECT s.card_id,s.spare FROM (${SPARE_SQL}) s WHERE s.rarity=$3 ORDER BY s.spare DESC, s.card_id`, [userId, ECONOMY.sellable, from])).rows;
      let need = cost; const take = [];
      if (body && body.picks !== undefined) {
        // Choix du joueur : { cardId: nombre } ; chaque carte doit être de la bonne rareté et avoir assez de doublons, le total vaut exactement le coût.
        const picks = body.picks && typeof body.picks === 'object' && !Array.isArray(body.picks) ? Object.entries(body.picks) : null;
        if (!picks || picks.length > cost) { await client.query('ROLLBACK'); return fail('Choix de doublons invalide.'); }
        const spareOf = new Map(sources.map(x => [x.card_id, Number(x.spare)]));
        for (const [cardId, raw] of picks) {
          const n = Number(raw);
          if (!Number.isSafeInteger(n) || n < 1) { await client.query('ROLLBACK'); return fail('Choix de doublons invalide.'); }
          if (!spareOf.has(cardId) || spareOf.get(cardId) < n) { await client.query('ROLLBACK'); return fail('Tu n\'as pas assez de doublons ' + from + ' pour ce choix.'); }
          take.push([cardId, n]); need -= n;
        }
        if (need !== 0) { await client.query('ROLLBACK'); return fail('Choisis exactement ' + cost + ' doublons ' + from + '.'); }
      } else {
        for (const s of sources) { const n = Math.min(need, Number(s.spare)); if (n > 0) { take.push([s.card_id, n]); need -= n; } if (!need) break; }
        if (need) { await client.query('ROLLBACK'); return fail('Il te faut ' + cost + ' doublons ' + from + ' (tu en as ' + (cost - need) + ').'); }
      }
      const ids = [];
      for (const [cardId, n] of take) { const got = await lockSpare(client, userId, cardId, n); if (!got) { await client.query('ROLLBACK'); return fail('Tes doublons ont changé : réessaie.', 409); } ids.push(...got); }
      const pool = await freshPool(client, userId, to);
      if (!pool.length) { await client.query('ROLLBACK'); return fail('Tu possèdes déjà toutes les cartes ' + to + ' que la fusion peut donner : aucune carte nouvelle à obtenir pour le moment. Rien n\'a été consommé.', 409); }
      const card = pool[crypto.randomInt(0, pool.length)];
      await client.query('DELETE FROM card_instances WHERE instance_id=ANY($1::uuid[])', [ids]);
      const instance = await buildInstance(card, userId, 'fusion', client);
      await createCardInstance(instance, client);
      await securityEvent(userId, null, 'card_fusion', { from, to, consumed: ids.length, cardId: card.id }, client);
      await client.query('COMMIT');
      return { ok: true, consumed: cost, card: { instanceId: instance.instanceId, cardId: card.id, name: card.name, club: card.club, season: card.season, rarity: card.rarity, ovr: card.ovr, position: card.position, nation: card.nation, ...Object.fromEntries(STATS.map(k => [k, Number(instance[k] ?? card[k] ?? 0)])) } };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { info, quickSell, fuse };
}

module.exports = { createEconomy };
