'use strict';

// Prêts de cartes : un joueur prête une de ses cartes Common ou Rare à un AMI ACCEPTÉ pour LOAN.days jours. La carte reste la propriété du prêteur mais passe
// au statut « loaned » : elle sort de ses décomptes et ne peut plus être vendue, échangée ni donnée pendant le prêt (tout le code qui exige « owned » la refuse).
// L'emprunteur ne peut l'utiliser que dans son équipe type (lib/team.js). Retour AUTOMATIQUE à l'échéance, à la demande du prêteur ou de l'emprunteur, ou si
// l'amitié prend fin ; un balayage répare aussi toute carte restée « loaned » sans prêt actif. Aucune récompense : les décomptes, sets et albums n'y gagnent rien.

const crypto = require('node:crypto');
const { LOAN } = require('./game-config');
const { notify } = require('./notifications');

const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const uuid = v => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? String(v) : '00000000-0000-0000-0000-000000000000');
const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const cardView = r => ({ instanceId: r.instance_id, cardId: r.card_id, name: r.name, club: r.club, season: r.season, rarity: r.rarity, ovr: Number(r.ovr || 0), position: r.position });
// Exemplaire prêtable : possédé, échangeable, ni bienvenue ni limité, Common ou Rare, hors offre d'échange ouverte. Paramètre $1 : joueur, $2 : raretés.
const LENDABLE = `ci.owner_id=$1 AND ci.status='owned' AND ci.tradeable IS NOT FALSE AND ci.source IS DISTINCT FROM 'welcome' AND NOT COALESCE(ci.is_limited,false)
  AND lower(ci.rarity) = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM trade_offer_cards t WHERE t.instance_id=ci.instance_id AND t.open AND t.side='give')`;

function createLoans({ getPool, securityEvent }) {
  const db = () => getPool();

  // Rend les cartes dont le prêt est échu ou dont l'amitié a pris fin, puis répare les cartes « loaned » sans prêt actif.
  async function sweep(client = db()) {
    if (!client) return 0;
    const done = (await client.query(`WITH e AS (UPDATE card_loans l SET status='returned',returned_at=now(),returned_by=CASE WHEN l.expires_at <= now() THEN 'auto' ELSE 'friendship' END
        WHERE l.id IN (SELECT x.id FROM card_loans x WHERE x.status='active' AND (x.expires_at <= now() OR NOT EXISTS (SELECT 1 FROM friendships f WHERE f.status='accepted'
          AND f.user_low = LEAST(x.lender_id,x.borrower_id) AND f.user_high = GREATEST(x.lender_id,x.borrower_id)))
          ORDER BY x.id FOR UPDATE SKIP LOCKED) RETURNING l.instance_id,l.lender_id,l.borrower_id,l.returned_by)
      SELECT e.*,c.name FROM e JOIN card_instances c ON c.instance_id=e.instance_id`)).rows;
    for (const r of done) {
      await client.query("UPDATE card_instances SET status='owned' WHERE instance_id=$1 AND status='loaned'", [r.instance_id]);
      await notify(client, r.lender_id, 'loan', 'Carte rendue : ' + r.name, r.returned_by === 'auto' ? 'Le prêt est arrivé à échéance, la carte est revenue dans ta collection.' : 'L\'amitié a pris fin : la carte est revenue dans ta collection.', '#collection');
    }
    await client.query(`UPDATE card_instances ci SET status='owned' WHERE ci.status='loaned' AND NOT EXISTS (SELECT 1 FROM card_loans l WHERE l.instance_id=ci.instance_id AND l.status='active')`);
    return done.length;
  }

  const SELECT = `SELECT l.*,c.name,c.club,c.season,c.rarity,c.ovr,c.position,ul.name AS lender_name,ub.name AS borrower_name FROM card_loans l
    JOIN card_instances c ON c.instance_id=l.instance_id JOIN users ul ON ul.id=l.lender_id JOIN users ub ON ub.id=l.borrower_id`;
  const loanView = (r, me) => ({ id: r.id, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at, returnedAt: r.returned_at, returnedBy: r.returned_by, role: r.lender_id === me ? 'lender' : 'borrower',
    other: r.lender_id === me ? r.borrower_name : r.lender_name, card: cardView(r) });

  async function list(userId) {
    const cfg = { ...LOAN, rarities: [...LOAN.rarities] };
    if (!db()) return { lent: [], borrowed: [], config: cfg };
    await sweep();
    const rows = (await db().query(SELECT + ` WHERE (l.lender_id=$1 OR l.borrower_id=$1) AND (l.status='active' OR l.returned_at > now() - interval '14 days') ORDER BY l.status, l.created_at DESC LIMIT 40`, [userId])).rows;
    return { lent: rows.filter(r => r.lender_id === userId).map(r => loanView(r, userId)), borrowed: rows.filter(r => r.borrower_id === userId).map(r => loanView(r, userId)), config: cfg };
  }

  // Cartes que le joueur peut prêter (recherche par nom ou club, 2 caractères au moins).
  async function lendable(userId, q) {
    const t = String(q || '').trim().toLowerCase().slice(0, 40);
    if (t.length < 2 || !db()) return { cards: [] };
    const rows = (await db().query(`SELECT ci.instance_id,ci.card_id,ci.name,ci.club,ci.season,ci.rarity,ci.ovr,ci.position FROM card_instances ci WHERE ${LENDABLE}
      AND (lower(ci.name) LIKE $3 OR lower(ci.club) LIKE $3) ORDER BY ci.ovr DESC, ci.name LIMIT $4`, [userId, [...LOAN.rarities], '%' + t.replace(/[%_\\]/g, m => '\\' + m) + '%', LOAN.listLimit])).rows;
    return { cards: rows.map(cardView) };
  }

  async function lend(userId, body) {
    const code = String(body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return fail('Code invalide (8 caractères).');
    if (!db()) return fail('Indisponible.', 503);
    const other = (await db().query("SELECT id,name FROM users WHERE trade_code=$1 AND account_status <> 'banned'", [code])).rows[0];
    if (!other) return fail('Joueur introuvable.', 404);
    if (other.id === userId) return fail('Tu ne peux pas te prêter une carte à toi-même.');
    const [lo, hi] = pair(userId, other.id);
    if (!(await db().query("SELECT 1 FROM friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted'", [lo, hi])).rowCount) return fail('Tu ne peux prêter qu’à un ami accepté.', 403);
    const instanceId = uuid(body?.instanceId);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await sweep(client);
      for (const uid of [userId, other.id].sort()) await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [uid]);
      const card = (await client.query(`SELECT ci.* FROM card_instances ci WHERE ci.instance_id=$3 AND ${LENDABLE} FOR UPDATE OF ci`, [userId, [...LOAN.rarities], instanceId])).rows[0];
      if (!card) { await client.query('ROLLBACK'); return fail('Cette carte ne peut pas être prêtée (Common ou Rare, échangeable, libre).', 409, { code: 'not_lendable' }); }
      const lent = (await client.query("SELECT count(*)::int AS n FROM card_loans WHERE lender_id=$1 AND status='active'", [userId])).rows[0].n;
      if (lent >= LOAN.maxLent) { await client.query('ROLLBACK'); return fail(`Tu as déjà ${LOAN.maxLent} cartes prêtées.`, 409, { code: 'too_many_lent' }); }
      const borrowed = (await client.query("SELECT count(*)::int AS n FROM card_loans WHERE borrower_id=$1 AND status='active'", [other.id])).rows[0].n;
      if (borrowed >= LOAN.maxBorrowed) { await client.query('ROLLBACK'); return fail(other.name + ' a déjà ' + LOAN.maxBorrowed + ' cartes empruntées.', 409, { code: 'too_many_borrowed' }); }
      const id = crypto.randomUUID();
      await client.query("INSERT INTO card_loans(id,instance_id,card_id,lender_id,borrower_id,expires_at) VALUES($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)", [id, card.instance_id, card.card_id, userId, other.id, String(LOAN.days)]);
      await client.query("UPDATE card_instances SET status='loaned' WHERE instance_id=$1", [card.instance_id]);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, other.id, 'loan', me.name + ' te prête ' + card.name, 'Utilisable dans ton équipe type pendant ' + LOAN.days + ' jours, puis elle retourne chez son propriétaire.', '#equipe');
      await securityEvent(userId, null, 'card_loan', { loan: id, instance: card.instance_id, borrower: other.id }, client);
      await client.query('COMMIT');
      return { id, card: { name: card.name }, borrower: other.name, days: LOAN.days };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return fail('Cette carte est déjà prêtée.', 409, { code: 'not_lendable' }); throw e; }
    finally { client.release(); }
  }

  // Retour anticipé : le prêteur la reprend ou l'emprunteur la rend.
  async function giveBack(userId, idRaw) {
    if (!db()) return fail('Indisponible.', 503);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const l = (await client.query('SELECT * FROM card_loans WHERE id=$1 AND (lender_id=$2 OR borrower_id=$2) FOR UPDATE', [uuid(idRaw), userId])).rows[0];
      if (!l) { await client.query('ROLLBACK'); return fail('Prêt introuvable.', 404); }
      if (l.status !== 'active') { await client.query('ROLLBACK'); return fail('Ce prêt est déjà terminé.', 409); }
      const by = l.lender_id === userId ? 'lender' : 'borrower';
      await client.query("UPDATE card_loans SET status='returned',returned_at=now(),returned_by=$2 WHERE id=$1", [l.id, by]);
      await client.query("UPDATE card_instances SET status='owned' WHERE instance_id=$1 AND status='loaned'", [l.instance_id]);
      if (by === 'borrower') {
        const c = (await client.query('SELECT name FROM card_instances WHERE instance_id=$1', [l.instance_id])).rows[0];
        await notify(client, l.lender_id, 'loan', 'Carte rendue : ' + c.name, 'Ton ami t\'a rendu la carte, elle est revenue dans ta collection.', '#collection');
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { list, lendable, lend, giveBack, sweep };
}

module.exports = { createLoans };
