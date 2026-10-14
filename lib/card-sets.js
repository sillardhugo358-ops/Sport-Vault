'use strict';

// Sets thématiques : une liste de cartes du catalogue choisie par l'administration (ex. « Gardiens légendaires »).
// Un joueur qui possède (statut owned) chaque carte du set peut récupérer UNE FOIS la récompense (reward_claims « set:<id> »),
// calculée côté serveur d'après la taille du set (SET_TIERS). Les FC gagnés par les sets sont plafonnés par jour de Paris :
// au plafond, la récupération est refusée sans rien consommer (le set reste récupérable le lendemain).
// Les cartes d'un set qui ne sont plus au catalogue (désactivées ou supprimées) ne comptent plus.

const { SET_TIERS, SET_DAILY_CAP_COINS, SET_MIN_CARDS, SET_MAX_CARDS } = require('./game-config');
const { parisDayKey, parisLocalMidnight } = require('./periods');

const tierFor = size => SET_TIERS.find(t => size <= t.maxCards) || SET_TIERS[SET_TIERS.length - 1];
const rewardFor = size => { const t = tierFor(size); return { coins: t.coins, xp: t.xp, tier: t.name }; };
const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'set';

function createCardSets({ getPool, adminLog, applyReward, securityEvent }) {
  // Début du jour de Paris : les FC de sets gagnés depuis sont lus dans le journal des FOOTCOINS (écrit avec la récompense).
  const todayStart = () => parisLocalMidnight(parisDayKey());
  async function claimedToday(db, userId) {
    const r = await db.query("SELECT COALESCE(SUM(amount),0)::int AS n FROM coin_ledger WHERE user_id=$1 AND reason='reward' AND (ref LIKE 'set:%' OR ref LIKE 'goal:%') AND created_at >= $2", [userId, todayStart()]);
    return r.rows[0].n;
  }

  // Sets actifs avec leurs cartes encore au catalogue.
  async function loadSets(db, { onlyActive = true } = {}) {
    const sets = (await db.query(`SELECT id,name,description,active,sort_order FROM card_sets ${onlyActive ? 'WHERE active' : ''} ORDER BY sort_order,id`)).rows;
    const cards = (await db.query(`SELECT sc.set_id, c.id, c.name, c.club, c.season, c.rarity, c.position, sc.position AS pos FROM card_set_cards sc
      JOIN catalog_cards c ON c.id=sc.card_id AND c.is_active=true ORDER BY sc.set_id, sc.position, c.id`)).rows;
    const by = new Map();
    for (const c of cards) { const a = by.get(c.set_id) || []; a.push({ id: c.id, name: c.name, club: c.club, season: c.season, rarity: c.rarity, position: c.position }); by.set(c.set_id, a); }
    return sets.map(s => ({ id: s.id, name: s.name, description: s.description, active: s.active, cards: by.get(s.id) || [] }));
  }

  async function ownedIds(db, userId, ids) {
    if (!ids.length) return new Set();
    return new Set((await db.query("SELECT DISTINCT card_id FROM card_instances WHERE owner_id=$1 AND status='owned' AND card_id = ANY($2::text[])", [userId, ids])).rows.map(r => r.card_id));
  }

  async function listSets(userId) {
    const db = getPool();
    const meta = { dailyCap: SET_DAILY_CAP_COINS, claimedToday: 0, remainingToday: SET_DAILY_CAP_COINS };
    if (!db) return { sets: [], ...meta };
    const sets = (await loadSets(db)).filter(s => s.cards.length >= SET_MIN_CARDS);
    const owned = await ownedIds(db, userId, [...new Set(sets.flatMap(s => s.cards.map(c => c.id)))]);
    const claimed = new Set((await db.query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'set:%'", [userId])).rows.map(r => r.claim_id));
    meta.claimedToday = await claimedToday(db, userId);
    meta.remainingToday = Math.max(0, SET_DAILY_CAP_COINS - meta.claimedToday);
    return {
      ...meta,
      sets: sets.map(s => {
        const cards = s.cards.map(c => ({ ...c, owned: owned.has(c.id) }));
        const have = cards.filter(c => c.owned).length, reward = rewardFor(cards.length), done = claimed.has('set:' + s.id);
        const completed = have === cards.length;
        return { id: s.id, name: s.name, description: s.description, total: cards.length, owned: have, completed, claimed: done, reward,
          claimable: completed && !done && reward.coins <= meta.remainingToday, blockedByCap: completed && !done && reward.coins > meta.remainingToday, cards };
      })
    };
  }

  async function claimSet(userId, id) {
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Verrou du joueur : deux demandes simultanées ne peuvent ni doubler la récompense ni dépasser le plafond.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const set = (await loadSets(client)).find(s => s.id === String(id || ''));
      if (!set || set.cards.length < SET_MIN_CARDS) { await client.query('ROLLBACK'); return { error: 'Set introuvable.', status: 404 }; }
      const claimId = 'set:' + set.id;
      if ((await client.query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2', [userId, claimId])).rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const owned = await ownedIds(client, userId, set.cards.map(c => c.id));
      if (owned.size < set.cards.length) { await client.query('ROLLBACK'); return { error: `Set incomplet : ${owned.size}/${set.cards.length} cartes.`, status: 400, progress: owned.size, total: set.cards.length }; }
      const reward = rewardFor(set.cards.length);
      const today = await claimedToday(client, userId);
      if (today + reward.coins > SET_DAILY_CAP_COINS) {
        await client.query('ROLLBACK');
        const remaining = Math.max(0, SET_DAILY_CAP_COINS - today);
        return { error: `Plafond quotidien atteint : ${SET_DAILY_CAP_COINS.toLocaleString('fr-FR')} FC de sets par jour (il te reste ${remaining.toLocaleString('fr-FR')} FC aujourd'hui). Ton set reste à récupérer : reviens demain.`, code: 'daily_cap', status: 409, remainingToday: remaining };
      }
      const inserted = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, claimId]);
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const user = await applyReward(userId, { coins: reward.coins, xp: reward.xp }, client, claimId);
      await securityEvent(userId, null, 'set_claim', { setId: set.id, coins: reward.coins, xp: reward.xp }, client);
      await client.query('COMMIT');
      return { set: { id: set.id, name: set.name }, reward: { coins: reward.coins, xp: reward.xp }, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function adminSets() {
    const db = getPool();
    const sets = await loadSets(db, { onlyActive: false });
    const claims = new Map((await db.query("SELECT substr(claim_id,5) AS id, count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'set:%' GROUP BY 1")).rows.map(r => [r.id, r.n]));
    return {
      sets: sets.map(s => ({ id: s.id, name: s.name, description: s.description, active: s.active, cardIds: s.cards.map(c => c.id), cards: s.cards, reward: rewardFor(s.cards.length), claims: claims.get(s.id) || 0 })),
      tiers: SET_TIERS.map(t => ({ name: t.name, maxCards: Number.isFinite(t.maxCards) ? t.maxCards : null, coins: t.coins, xp: t.xp })),
      dailyCap: SET_DAILY_CAP_COINS, minCards: SET_MIN_CARDS, maxCards: SET_MAX_CARDS
    };
  }

  async function adminSaveSet(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    const db = getPool();
    if (action === 'toggle') {
      const r = await db.query('UPDATE card_sets SET active=$2, updated_at=now() WHERE id=$1 RETURNING id', [String(body.id || ''), body.active === true]);
      if (!r.rowCount) return { error: 'Set introuvable.', status: 404 };
      await adminLog(adminId, null, body.active === true ? 'card_set_enable' : 'card_set_disable', { setId: r.rows[0].id });
      return { ok: true };
    }
    const errors = {};
    const name = String(body.name || '').trim(), description = String(body.description || '').trim();
    const ids = Array.isArray(body.cardIds) ? [...new Set(body.cardIds.map(String))] : [];
    if (name.length < 2 || name.length > 80) errors.name = 'Nom : 2 à 80 caractères.';
    if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
    if (ids.length < SET_MIN_CARDS || ids.length > SET_MAX_CARDS) errors.cardIds = `Un set contient de ${SET_MIN_CARDS} à ${SET_MAX_CARDS} cartes.`;
    else {
      const found = (await db.query('SELECT id FROM catalog_cards WHERE is_active=true AND id = ANY($1::text[])', [ids])).rows.length;
      if (found !== ids.length) errors.cardIds = 'Une ou plusieurs cartes sont introuvables au catalogue.';
    }
    let id = String(body.id || '');
    if (action === 'update' && !(await db.query('SELECT 1 FROM card_sets WHERE id=$1', [id])).rowCount) return { error: 'Set introuvable.', status: 404 };
    if (Object.keys(errors).length) return { error: 'Formulaire incomplet ou invalide.', errors, status: 400 };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE card_sets IN SHARE ROW EXCLUSIVE MODE');
      if (action === 'create') {
        const base = slugify(name);
        id = base;
        for (let i = 2; (await client.query('SELECT 1 FROM card_sets WHERE id=$1', [id])).rowCount; i++) id = (base + '-' + i).slice(0, 50);
        await client.query('INSERT INTO card_sets(id,name,description,active,sort_order) VALUES($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM card_sets))', [id, name, description, body.active !== false]);
      } else {
        await client.query('UPDATE card_sets SET name=$2,description=$3,updated_at=now() WHERE id=$1', [id, name, description]);
        await client.query('DELETE FROM card_set_cards WHERE set_id=$1', [id]);
      }
      for (let i = 0; i < ids.length; i++) await client.query('INSERT INTO card_set_cards(set_id,card_id,position) VALUES($1,$2,$3)', [id, ids[i], i]);
      await adminLog(adminId, null, action === 'create' ? 'card_set_create' : 'card_set_update', { setId: id, name, cards: ids.length }, client);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
    return { ok: true, id };
  }

  return { listSets, claimSet, adminSets, adminSaveSet };
}

module.exports = { createCardSets, rewardFor, tierFor };
