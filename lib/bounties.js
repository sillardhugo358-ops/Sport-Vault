'use strict';

// Primes : un joueur offre des FC pour une carte du catalogue qu'il ne possède pas. Les FC sont BLOQUÉS à la création (users.reserved_coins, comme une
// mise d'enchère) ; sans preneur ils sont libérés à l'expiration (BOUNTY.days jours) ou si le joueur annule. Le premier joueur qui donne la carte la
// remet au demandeur et reçoit la prime moins BOUNTY.commissionPct % (commission détruite, jamais créditée). Cartes exclues : celles que les échanges
// refusent déjà (Legendary, Icon, éditions limitées, cartes de bienvenue, non échangeables, en vente ou engagées dans une offre d'échange).
// Tout est calculé ici : le client n'envoie que la carte et le montant. Règlement dans une transaction, joueurs verrouillés dans l'ordre des identifiants.

const crypto = require('node:crypto');
const { BOUNTY, TRADE } = require('./game-config');
const { notify } = require('./notifications');
const { recordCoins } = require('./ledger');

const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const commission = reward => Math.floor(reward * BOUNTY.commissionPct / 100);
const view = r => ({ id: r.id, reward: Number(r.reward), net: Number(r.reward) - commission(Number(r.reward)), status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
  card: { id: r.card_id, name: r.name, club: r.club, season: r.season, rarity: r.rarity, ovr: Number(r.ovr || 0), position: r.position } });
// Motif pour lequel une carte du catalogue ne peut jamais faire l'objet d'une prime (null si elle le peut).
const catalogProblem = c => {
  if (c.is_limited) return 'est une édition limitée : ces cartes ne s\'échangent pas';
  if (TRADE.blockedRarities.includes(String(c.rarity).toLowerCase())) return 'est Legendary ou Icon : ces cartes ne s\'échangent pas';
  return null;
};
// Exemplaire d'un joueur qui peut être donné : possédé, échangeable, hors bienvenue, hors offre d'échange ouverte. Paramètres : $1 joueur, $2 carte(s), $3 raretés exclues.
const GIVABLE = `ci.status='owned' AND ci.tradeable IS NOT FALSE AND ci.source IS DISTINCT FROM 'welcome' AND NOT COALESCE(ci.is_limited,false)
  AND lower(ci.rarity) <> ALL($3::text[]) AND NOT EXISTS (SELECT 1 FROM trade_offer_cards t WHERE t.instance_id=ci.instance_id AND t.open AND t.side='give')`;

function createBounties({ getPool, securityEvent }) {
  const db = () => getPool();

  // Libère les FC des primes expirées (appelé avant chaque lecture ou écriture, et toutes les minutes par le serveur).
  async function expireAll(client = db()) {
    if (!client) return 0;
    const done = (await client.query(`WITH e AS (UPDATE bounties SET status='expired',closed_at=now() WHERE id IN
        (SELECT id FROM bounties WHERE status='open' AND expires_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED) RETURNING poster_id,reward,card_id)
      SELECT * FROM e`)).rows;
    for (const e of done) {
      await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2', [Number(e.reward), e.poster_id]);
      await notify(client, e.poster_id, 'bounty', 'Prime expirée : FC débloqués', Number(e.reward).toLocaleString('fr-FR') + ' FC sont de nouveau disponibles.', '#primes');
    }
    return done.length;
  }

  const SELECT = `SELECT b.*,c.name,c.club,c.season,c.rarity,c.ovr,c.position,u.name AS poster_name FROM bounties b JOIN catalog_cards c ON c.id=b.card_id JOIN users u ON u.id=b.poster_id`;

  async function list(userId) {
    const cfg = { ...BOUNTY, blockedRarities: [...TRADE.blockedRarities] };
    if (!db()) return { open: [], mine: [], config: cfg };
    await expireAll();
    const mine = (await db().query(SELECT + ' WHERE b.poster_id=$1 ORDER BY b.created_at DESC LIMIT 20', [userId])).rows.map(r => view(r));
    const others = (await db().query(SELECT + ` WHERE b.status='open' AND b.poster_id<>$1 ORDER BY b.reward DESC, b.created_at DESC LIMIT $2`, [userId, BOUNTY.listLimit])).rows;
    // Mêmes paramètres que le règlement : $1 joueur, $2 cartes, $3 raretés exclues.
    const have = new Set((await db().query(`SELECT DISTINCT ci.card_id FROM card_instances ci WHERE ci.owner_id=$1 AND ci.card_id = ANY($2::text[]) AND ${GIVABLE}`,
      [userId, others.map(r => r.card_id), [...TRADE.blockedRarities]])).rows.map(r => r.card_id));
    return { open: others.map(r => ({ ...view(r), poster: r.poster_name, canFulfil: have.has(r.card_id) })), mine, config: cfg };
  }

  async function create(userId, body) {
    const cardId = String(body?.cardId || '').slice(0, 32), reward = body?.reward;
    if (!cardId) return fail('Choisis une carte.');
    if (!Number.isSafeInteger(reward) || reward < BOUNTY.minReward || reward > BOUNTY.maxReward) return fail(`La prime doit être un nombre entier de FC entre ${BOUNTY.minReward} et ${BOUNTY.maxReward.toLocaleString('fr-FR')}.`);
    if (!db()) return fail('Indisponible.', 503);
    const card = (await db().query('SELECT id,name,rarity,is_limited FROM catalog_cards WHERE id=$1 AND is_active=true', [cardId])).rows[0];
    if (!card) return fail('Carte introuvable.', 404);
    const problem = catalogProblem(card);
    if (problem) return fail(card.name + ' ' + problem + '.');
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await expireAll(client);
      const u = (await client.query('SELECT coins,reserved_coins FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!u) { await client.query('ROLLBACK'); return fail('Utilisateur introuvable.', 404); }
      if ((await client.query("SELECT 1 FROM card_instances WHERE owner_id=$1 AND card_id=$2 AND status IN ('owned','auction')", [userId, cardId])).rowCount) { await client.query('ROLLBACK'); return fail('Tu possèdes déjà cette carte.', 409, { code: 'already_owned' }); }
      if ((await client.query("SELECT count(*)::int AS n FROM bounties WHERE poster_id=$1 AND status='open'", [userId])).rows[0].n >= BOUNTY.maxOpen) { await client.query('ROLLBACK'); return fail(`Tu as déjà ${BOUNTY.maxOpen} primes ouvertes.`, 409, { code: 'too_many' }); }
      if (Number(u.coins) - Number(u.reserved_coins || 0) < reward) { await client.query('ROLLBACK'); return fail('FOOTCOINS disponibles insuffisants.', 400, { code: 'coins' }); }
      const id = crypto.randomUUID();
      try { await client.query("INSERT INTO bounties(id,poster_id,card_id,reward,expires_at) VALUES($1,$2,$3,$4, now() + ($5 || ' days')::interval)", [id, userId, cardId, reward, String(BOUNTY.days)]); }
      catch (e) { await client.query('ROLLBACK'); if (e.code === '23505') return fail('Tu as déjà une prime ouverte pour cette carte.', 409, { code: 'duplicate' }); throw e; }
      await client.query('UPDATE users SET reserved_coins=reserved_coins+$1 WHERE id=$2', [reward, userId]);
      await securityEvent(userId, null, 'bounty_create', { bounty: id, card: cardId, reward }, client);
      await client.query('COMMIT');
      return { id, reward, card: { id: card.id, name: card.name } };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function cancel(userId, idRaw) {
    const id = String(idRaw || '').match(/^[0-9a-f-]{36}$/i) ? idRaw : '00000000-0000-0000-0000-000000000000';
    if (!db()) return fail('Indisponible.', 503);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const b = (await client.query('SELECT * FROM bounties WHERE id=$1 AND poster_id=$2 FOR UPDATE', [id, userId])).rows[0];
      if (!b) { await client.query('ROLLBACK'); return fail('Prime introuvable.', 404); }
      if (b.status !== 'open') { await client.query('ROLLBACK'); return fail('Cette prime n\'est plus ouverte.', 409); }
      await client.query("UPDATE bounties SET status='cancelled',closed_at=now() WHERE id=$1", [id]);
      await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2', [Number(b.reward), userId]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function fulfil(userId, idRaw) {
    const id = String(idRaw || '').match(/^[0-9a-f-]{36}$/i) ? idRaw : '00000000-0000-0000-0000-000000000000';
    if (!db()) return fail('Indisponible.', 503);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await expireAll(client);
      const peek = (await client.query('SELECT poster_id FROM bounties WHERE id=$1', [id])).rows[0];
      if (!peek) { await client.query('ROLLBACK'); return fail('Prime introuvable.', 404); }
      if (peek.poster_id === userId) { await client.query('ROLLBACK'); return fail('Tu ne peux pas remplir ta propre prime.'); }
      // Verrous des deux joueurs dans l'ordre des identifiants : deux règlements croisés ne peuvent pas s'interbloquer.
      for (const uid of [peek.poster_id, userId].sort()) await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [uid]);
      const b = (await client.query('SELECT * FROM bounties WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (b.status !== 'open') { await client.query('ROLLBACK'); return fail('Cette prime n\'est plus ouverte.', 409, { code: 'closed' }); }
      const card = (await client.query(`SELECT ci.instance_id,ci.name FROM card_instances ci WHERE ci.owner_id=$1 AND ci.card_id=$2 AND ${GIVABLE} ORDER BY ci.acquired_at DESC LIMIT 1 FOR UPDATE OF ci`, [userId, b.card_id, [...TRADE.blockedRarities]])).rows[0];
      if (!card) { await client.query('ROLLBACK'); return fail('Tu n\'as aucun exemplaire de cette carte qui puisse être donné.', 409, { code: 'no_card' }); }
      const reward = Number(b.reward), net = reward - commission(reward);
      const paid = await client.query('UPDATE users SET coins=coins-$1,reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2 AND coins>=$1', [reward, b.poster_id]);
      if (!paid.rowCount) {
        // Le demandeur n'a plus les FC (retrait administrateur…) : la prime est annulée proprement.
        await client.query("UPDATE bounties SET status='cancelled',closed_at=now() WHERE id=$1", [id]);
        await client.query('UPDATE users SET reserved_coins=GREATEST(0,reserved_coins-$1) WHERE id=$2', [reward, b.poster_id]);
        await client.query('COMMIT');
        return fail('Prime annulée : le demandeur n\'a plus les FC.', 409, { code: 'poster_broke' });
      }
      const gain = (await client.query('UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING *', [net, userId])).rows[0];
      await recordCoins(client, b.poster_id, -reward, 'bounty', id);
      await recordCoins(client, userId, net, 'bounty', id);
      await client.query('UPDATE card_instances SET owner_id=$2 WHERE instance_id=$1', [card.instance_id, b.poster_id]);
      await client.query("UPDATE bounties SET status='fulfilled',fulfilled_by=$2,closed_at=now() WHERE id=$1", [id, userId]);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, b.poster_id, 'bounty', `${me.name} a rempli ta prime : ${card.name}`, `La carte rejoint ta collection pour ${reward.toLocaleString('fr-FR')} FC.`, '#collection');
      await securityEvent(userId, null, 'bounty_fulfil', { bounty: id, poster: b.poster_id, instance: card.instance_id, reward, net }, client);
      await client.query('COMMIT');
      return { ok: true, reward: net, fee: reward - net, card: { name: card.name }, user: gain };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { list, create, cancel, fulfil, expireAll };
}

module.exports = { createBounties, commission };
