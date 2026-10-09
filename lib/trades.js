'use strict';

// Échanges de cartes entre joueurs : un joueur propose 1 à 3 de ses cartes contre 1 à 3 cartes d'un autre joueur (désigné par son
// code d'échange), qui accepte ou refuse. Le serveur valide tout (propriété, raretés, plafonds) et refait ces contrôles à l'acceptation.
// Règles : Legendary et Icon non échangeables ; cartes de bienvenue et cartes non échangeables exclues (comme aux enchères) ; 5 offres
// ouvertes par joueur, 10 offres reçues ouvertes, 10 échanges conclus par jour de Paris et par joueur ; offre valable 7 jours.
// Une carte offerte reste « owned » (profil, succès et classement ne changent pas) mais est engagée : l'index unique
// trade_open_give_idx l'empêche d'être dans deux offres, et createAuction (lib/auctions.js) refuse les cartes engagées.
// Une carte reçue garde sa date d'obtention et sa source : elle compte pour le classement et les albums, pas comme « nouvelle » pour les
// tâches et défis (même comportement qu'une enchère gagnée).

const crypto = require('node:crypto');
const { TRADE } = require('./game-config');
const { notify } = require('./notifications');
const { parisDayKey, parisLocalMidnight } = require('./periods');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const sortIds = ids => [...ids].sort();
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });

const cardView = c => ({ instanceId: c.instance_id, cardId: c.card_id, name: c.name, club: c.club, season: c.season, rarity: c.rarity, ovr: Number(c.ovr || 72), position: c.position });

function createTrades({ getPool, securityEvent }) {
  const todayStart = () => parisLocalMidnight(parisDayKey());

  // Libère les cartes des offres expirées (appelé avant chaque lecture ou écriture).
  async function expireOffers(db) {
    // SKIP LOCKED : deux transactions qui expirent en même temps ne s'attendent pas (pas d'interblocage).
    await db.query(`WITH e AS (UPDATE trade_offers SET status='expired', resolved_at=now() WHERE id IN
        (SELECT id FROM trade_offers WHERE status='open' AND expires_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED) RETURNING id)
      UPDATE trade_offer_cards SET open=false WHERE open AND offer_id IN (SELECT id FROM e)`);
  }

  async function tradesToday(db, userId) {
    return (await db.query("SELECT count(*)::int AS n FROM trade_offers WHERE status='accepted' AND resolved_at >= $1 AND (from_user=$2 OR to_user=$2)", [todayStart(), userId])).rows[0].n;
  }

  async function ensureCode(db, userId) {
    const cur = (await db.query('SELECT trade_code FROM users WHERE id=$1', [userId])).rows[0];
    if (!cur) return null;
    if (cur.trade_code) return cur.trade_code;
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      try {
        const r = await db.query('UPDATE users SET trade_code=$2 WHERE id=$1 AND trade_code IS NULL RETURNING trade_code', [userId, code]);
        if (r.rowCount) return r.rows[0].trade_code;
        return (await db.query('SELECT trade_code FROM users WHERE id=$1', [userId])).rows[0].trade_code;
      } catch (e) { if (e.code !== '23505') throw e; }
    }
    throw new Error('Code d\'échange : génération impossible.');
  }

  // Motif pour lequel une carte ne peut pas être échangée (null si elle le peut) ; la ligne doit être verrouillée par l'appelant.
  const cardProblem = c => {
    if (c.status !== 'owned') return 'n\'est pas disponible (en vente aux enchères ?)';
    if (c.tradeable === false || c.source === 'welcome') return 'ne peut pas être échangée';
    if (c.is_limited) return 'est une édition limitée : ces cartes ne s\'échangent pas';
    if (TRADE.blockedRarities.includes(String(c.rarity).toLowerCase())) return 'est Legendary ou Icon : ces cartes ne s\'échangent pas';
    return null;
  };

  async function info(userId) {
    const db = getPool();
    await expireOffers(db);
    const code = await ensureCode(db, userId);
    const [sent, received, today] = await Promise.all([
      db.query("SELECT count(*)::int AS n FROM trade_offers WHERE from_user=$1 AND status='open'", [userId]),
      db.query("SELECT count(*)::int AS n FROM trade_offers WHERE to_user=$1 AND status='open'", [userId]),
      tradesToday(db, userId)
    ]);
    return { code, limits: { ...TRADE, blockedRarities: [...TRADE.blockedRarities] }, openSent: sent.rows[0].n, openReceived: received.rows[0].n, tradesToday: today, remainingToday: Math.max(0, TRADE.dailyLimit - today) };
  }

  // Cartes échangeables d'un joueur désigné par son code (pour composer une offre) et ses propres cartes échangeables.
  async function tradeableCards(db, ownerId) {
    return (await db.query(`SELECT c.* FROM card_instances c WHERE c.owner_id=$1 AND c.status='owned' AND c.tradeable IS NOT FALSE AND c.is_limited IS NOT TRUE AND c.source<>'welcome'
      AND lower(c.rarity) <> ALL($2::text[]) AND NOT EXISTS(SELECT 1 FROM trade_offer_cards t WHERE t.instance_id=c.instance_id AND t.open AND t.side='give')
      ORDER BY c.ovr DESC, c.name, c.instance_id LIMIT 300`, [ownerId, TRADE.blockedRarities])).rows.map(cardView);
  }
  async function lookupPlayer(userId, codeRaw) {
    const db = getPool();
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return fail('Code d\'échange invalide (8 caractères).', 400);
    const other = (await db.query('SELECT id,name FROM users WHERE trade_code=$1', [code])).rows[0];
    if (!other) return fail('Aucun joueur avec ce code.', 404);
    if (other.id === userId) return fail('C\'est ton propre code.', 400);
    return { player: { name: other.name, code }, cards: await tradeableCards(db, other.id) };
  }
  async function myTradeableCards(userId) { return { cards: await tradeableCards(getPool(), userId) }; }

  async function lockUsers(client, ids) { for (const id of sortIds(ids)) await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]); }
  async function lockCards(client, ids) {
    const rows = (await client.query('SELECT * FROM card_instances WHERE instance_id = ANY($1::uuid[]) ORDER BY instance_id FOR UPDATE', [ids])).rows;
    return new Map(rows.map(r => [r.instance_id, r]));
  }
  const validUuids = list => Array.isArray(list) && list.every(x => /^[0-9a-f-]{36}$/i.test(String(x)));

  async function createOffer(userId, body) {
    const db = getPool();
    const give = Array.isArray(body.give) ? [...new Set(body.give.map(String))] : [], ask = Array.isArray(body.ask) ? [...new Set(body.ask.map(String))] : [];
    if (!validUuids(give) || !validUuids(ask)) return fail('Cartes invalides.', 400);
    if (give.length < 1 || ask.length < 1 || give.length > TRADE.maxCardsPerSide || ask.length > TRADE.maxCardsPerSide) return fail(`Une offre contient de 1 à ${TRADE.maxCardsPerSide} cartes de chaque côté.`, 400);
    if (give.some(id => ask.includes(id))) return fail('Une carte ne peut pas être des deux côtés.', 400);
    const code = String(body.toCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return fail('Code d\'échange invalide (8 caractères).', 400);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireOffers(client);
      const other = (await client.query('SELECT id,name FROM users WHERE trade_code=$1', [code])).rows[0];
      if (!other) { await client.query('ROLLBACK'); return fail('Aucun joueur avec ce code.', 404); }
      if (other.id === userId) { await client.query('ROLLBACK'); return fail('Tu ne peux pas échanger avec toi-même.', 400); }
      await lockUsers(client, [userId, other.id]);
      if ((await client.query("SELECT count(*)::int AS n FROM trade_offers WHERE from_user=$1 AND status='open'", [userId])).rows[0].n >= TRADE.maxOpenSent) { await client.query('ROLLBACK'); return fail(`Limite atteinte : ${TRADE.maxOpenSent} offres ouvertes maximum. Annule-en une ou attends une réponse.`, 409, { code: 'open_limit' }); }
      if ((await client.query("SELECT count(*)::int AS n FROM trade_offers WHERE to_user=$1 AND status='open'", [other.id])).rows[0].n >= TRADE.maxOpenReceived) { await client.query('ROLLBACK'); return fail('Ce joueur a déjà trop d\'offres en attente. Réessaie plus tard.', 409, { code: 'recipient_busy' }); }
      const cards = await lockCards(client, [...give, ...ask]);
      for (const id of give) {
        const c = cards.get(id);
        if (!c || c.owner_id !== userId) { await client.query('ROLLBACK'); return fail('Une des cartes offertes ne t\'appartient pas.', 400); }
        const p = cardProblem(c); if (p) { await client.query('ROLLBACK'); return fail(`${c.name} ${p}.`, 400); }
      }
      for (const id of ask) {
        const c = cards.get(id);
        if (!c || c.owner_id !== other.id) { await client.query('ROLLBACK'); return fail('Une des cartes demandées n\'appartient pas à ce joueur.', 400); }
        const p = cardProblem(c); if (p) { await client.query('ROLLBACK'); return fail(`${c.name} ${p}.`, 400); }
      }
      const engaged = (await client.query("SELECT instance_id FROM trade_offer_cards WHERE open AND side='give' AND instance_id = ANY($1::uuid[])", [[...give, ...ask]])).rows;
      if (engaged.length) { await client.query('ROLLBACK'); return fail('Une des cartes est déjà engagée dans une autre offre d\'échange.', 409); }
      const id = crypto.randomUUID();
      await client.query("INSERT INTO trade_offers(id,from_user,to_user,expires_at) VALUES($1,$2,$3, now() + make_interval(days => $4))", [id, userId, other.id, TRADE.expiresDays]);
      for (const c of give) await client.query("INSERT INTO trade_offer_cards(offer_id,instance_id,side) VALUES($1,$2,'give')", [id, c]);
      for (const c of ask) await client.query("INSERT INTO trade_offer_cards(offer_id,instance_id,side) VALUES($1,$2,'ask')", [id, c]);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, other.id, 'trade_offer', `Offre d'échange de ${me.name}`, `${give.length} carte(s) contre ${ask.length} de tes cartes.`, '#trades');
      await securityEvent(userId, null, 'trade_offer_create', { offerId: id, toUserId: other.id, give, ask }, client);
      await client.query('COMMIT');
      return { ok: true, offerId: id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return fail('Une des cartes est déjà engagée dans une autre offre d\'échange.', 409);
      throw e;
    } finally { client.release(); }
  }

  const OFFER_SQL = `SELECT o.id,o.status,o.created_at,o.expires_at,o.resolved_at,o.from_user,o.to_user,f.name AS from_name,t.name AS to_name FROM trade_offers o
    JOIN users f ON f.id=o.from_user JOIN users t ON t.id=o.to_user`;
  async function withCards(db, offers) {
    if (!offers.length) return [];
    const lines = (await db.query(`SELECT l.offer_id,l.side,c.instance_id,c.card_id,c.name,c.club,c.season,c.rarity,c.ovr,c.position FROM trade_offer_cards l
      JOIN card_instances c ON c.instance_id=l.instance_id WHERE l.offer_id = ANY($1::uuid[]) ORDER BY c.ovr DESC, c.name`, [offers.map(o => o.id)])).rows;
    return offers.map(o => ({
      id: o.id, status: o.status, createdAt: o.created_at, expiresAt: o.expires_at, resolvedAt: o.resolved_at, fromName: o.from_name, toName: o.to_name,
      give: lines.filter(l => l.offer_id === o.id && l.side === 'give').map(cardView), ask: lines.filter(l => l.offer_id === o.id && l.side === 'ask').map(cardView)
    }));
  }
  async function listOffers(userId) {
    const db = getPool();
    await expireOffers(db);
    const [sent, received, history] = await Promise.all([
      db.query(`${OFFER_SQL} WHERE o.from_user=$1 AND o.status='open' ORDER BY o.created_at DESC`, [userId]),
      db.query(`${OFFER_SQL} WHERE o.to_user=$1 AND o.status='open' ORDER BY o.created_at DESC`, [userId]),
      db.query(`${OFFER_SQL} WHERE (o.from_user=$1 OR o.to_user=$1) AND o.status<>'open' ORDER BY o.resolved_at DESC NULLS LAST LIMIT 20`, [userId])
    ]);
    return { sent: await withCards(db, sent.rows), received: await withCards(db, received.rows), history: await withCards(db, history.rows) };
  }

  // Clôture une offre ouverte (annulation, refus) ; who = 'from' ou 'to'.
  async function closeOffer(userId, offerId, who) {
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireOffers(client);
      const o = (await client.query('SELECT * FROM trade_offers WHERE id=$1 FOR UPDATE', [String(offerId || '').match(/^[0-9a-f-]{36}$/i) ? offerId : '00000000-0000-0000-0000-000000000000'])).rows[0];
      if (!o || (who === 'from' ? o.from_user : o.to_user) !== userId) { await client.query('ROLLBACK'); return fail('Offre introuvable.', 404); }
      if (o.status !== 'open') { await client.query('ROLLBACK'); return fail('Cette offre n\'est plus ouverte.', 409); }
      const status = who === 'from' ? 'cancelled' : 'declined';
      await client.query('UPDATE trade_offers SET status=$2, resolved_at=now() WHERE id=$1', [o.id, status]);
      await client.query('UPDATE trade_offer_cards SET open=false WHERE offer_id=$1', [o.id]);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, who === 'from' ? o.to_user : o.from_user, who === 'from' ? 'trade_cancelled' : 'trade_declined',
        who === 'from' ? `${me.name} a annulé son offre d'échange` : `${me.name} a refusé ton offre d'échange`, 'Tes cartes sont de nouveau libres.', '#trades');
      await securityEvent(userId, null, who === 'from' ? 'trade_offer_cancel' : 'trade_offer_decline', { offerId: o.id }, client);
      await client.query('COMMIT');
      return { ok: true, status };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  const cancelOffer = (userId, offerId) => closeOffer(userId, offerId, 'from');
  const declineOffer = (userId, offerId) => closeOffer(userId, offerId, 'to');

  async function acceptOffer(userId, offerId) {
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireOffers(client);
      const id = String(offerId || '').match(/^[0-9a-f-]{36}$/i) ? offerId : '00000000-0000-0000-0000-000000000000';
      const peek = (await client.query('SELECT from_user,to_user FROM trade_offers WHERE id=$1', [id])).rows[0];
      if (!peek || peek.to_user !== userId) { await client.query('ROLLBACK'); return fail('Offre introuvable.', 404); }
      await lockUsers(client, [peek.from_user, peek.to_user]);
      const o = (await client.query('SELECT * FROM trade_offers WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (o.status !== 'open') { await client.query('ROLLBACK'); return fail('Cette offre n\'est plus ouverte.', 409); }
      for (const [uid, who] of [[o.to_user, 'Tu as'], [o.from_user, 'L\'autre joueur a']]) {
        if (await tradesToday(client, uid) >= TRADE.dailyLimit) { await client.query('ROLLBACK'); return fail(`${who} atteint la limite de ${TRADE.dailyLimit} échanges par jour. L'offre reste ouverte : réessaie demain.`, 409, { code: 'daily_limit' }); }
      }
      const lines = (await client.query('SELECT instance_id,side FROM trade_offer_cards WHERE offer_id=$1', [o.id])).rows;
      const give = lines.filter(l => l.side === 'give').map(l => l.instance_id), ask = lines.filter(l => l.side === 'ask').map(l => l.instance_id);
      const cards = await lockCards(client, [...give, ...ask]);
      const invalid = async reason => {
        // L'offre ne peut plus être honorée : elle est annulée et les cartes libérées.
        await client.query("UPDATE trade_offers SET status='cancelled', resolved_at=now() WHERE id=$1", [o.id]);
        await client.query('UPDATE trade_offer_cards SET open=false WHERE offer_id=$1', [o.id]);
        await notify(client, o.from_user, 'trade_cancelled', 'Une offre d\'échange n\'est plus valable', reason, '#trades');
        await client.query('COMMIT');
        return fail(`Offre annulée : ${reason}`, 409, { code: 'offer_invalid' });
      };
      for (const cid of give) { const c = cards.get(cid); if (!c || c.owner_id !== o.from_user) return invalid('une carte offerte a changé de propriétaire.'); const p = cardProblem(c); if (p) return invalid(`${c.name} ${p}.`); }
      for (const cid of ask) {
        const c = cards.get(cid); if (!c || c.owner_id !== o.to_user) return invalid('une carte demandée a changé de propriétaire.'); const p = cardProblem(c); if (p) return invalid(`${c.name} ${p}.`);
        const eng = (await client.query("SELECT 1 FROM trade_offer_cards WHERE open AND side='give' AND instance_id=$1 AND offer_id<>$2", [cid, o.id])).rowCount;
        if (eng) { await client.query('ROLLBACK'); return fail(`${c.name} est engagée dans une autre de tes offres : annule-la d'abord.`, 409, { code: 'card_engaged' }); }
      }
      await client.query('UPDATE card_instances SET owner_id=$2 WHERE instance_id = ANY($1::uuid[])', [give, o.to_user]);
      await client.query('UPDATE card_instances SET owner_id=$2 WHERE instance_id = ANY($1::uuid[])', [ask, o.from_user]);
      await client.query("UPDATE trade_offers SET status='accepted', resolved_at=now() WHERE id=$1", [o.id]);
      await client.query('UPDATE trade_offer_cards SET open=false WHERE offer_id=$1', [o.id]);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, o.from_user, 'trade_accepted', `${me.name} a accepté ton offre d'échange`, `${give.length} carte(s) échangée(s) contre ${ask.length}.`, '#trades');
      await securityEvent(userId, null, 'trade_accept', { offerId: o.id, fromUserId: o.from_user, give, ask }, client);
      await client.query('COMMIT');
      return { ok: true, status: 'accepted', received: ask.map(c => cardView(cards.get(c))).map(v => ({ ...v })), };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { info, lookupPlayer, myTradeableCards, createOffer, listOffers, cancelOffer, declineOffer, acceptOffer };
}

module.exports = { createTrades };
