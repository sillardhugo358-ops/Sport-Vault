'use strict';

// Défis collectifs : une jauge commune à toute la communauté, alimentée par les actions de tous les joueurs pendant la période
// (packs ouverts, cartes obtenues en packs, enchères conclues, échanges conclus). Des paliers de récompense (FC + XP) se réclament
// un par un, une seule fois (reward_claims « collective:<défi>:<palier> »), par les joueurs qui ont contribué au moins une fois.
// Les compteurs sont lus dans les tables existantes (pas de compteur à tenir à jour) ; le total est mis en cache 30 s pour l'affichage,
// mais jamais pour une récompense : la réclamation relit tout.

const { COLLECTIVE } = require('./game-config');

const METRICS = {
  packs: 'Packs ouverts',
  cards: 'Cartes obtenues en packs',
  auctions: 'Enchères conclues',
  trades: 'Échanges conclus'
};
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'defi-collectif';

const fromRow = r => ({
  id: r.id, title: r.title, description: r.description, metrics: r.metrics, tiers: r.tiers.map(t => ({ at: Number(t.at), coins: Number(t.coins), xp: Number(t.xp) })),
  target: Math.max(...r.tiers.map(t => Number(t.at))), startsAt: r.starts_at, endsAt: r.ends_at, active: Boolean(r.active)
});

// Compteurs d'une métrique sur la période ; userId = null pour le total de la communauté.
const COUNTERS = {
  packs: (db, c, u) => db.query("SELECT count(*)::int AS n FROM security_events WHERE event IN ('pack_open','pool_draw') AND created_at >= $1 AND created_at < $2 AND ($3::uuid IS NULL OR user_id=$3)", [c.startsAt, c.endsAt, u]),
  cards: (db, c, u) => db.query("SELECT COALESCE(sum((details->>'cards')::int),0)::int AS n FROM security_events WHERE event IN ('pack_open','pool_draw') AND created_at >= $1 AND created_at < $2 AND ($3::uuid IS NULL OR user_id=$3)", [c.startsAt, c.endsAt, u]),
  auctions: (db, c, u) => db.query("SELECT count(*)::int AS n FROM auctions WHERE status='completed' AND current_bidder_id IS NOT NULL AND completed_at >= $1 AND completed_at < $2 AND ($3::uuid IS NULL OR seller_id=$3 OR current_bidder_id=$3)", [c.startsAt, c.endsAt, u]),
  trades: (db, c, u) => db.query("SELECT count(*)::int AS n FROM trade_offers WHERE status='accepted' AND resolved_at >= $1 AND resolved_at < $2 AND ($3::uuid IS NULL OR from_user=$3 OR to_user=$3)", [c.startsAt, c.endsAt, u])
};

function createCollective({ getPool, adminLog, applyReward, securityEvent }) {
  const db = () => getPool();
  const cache = new Map();   // id -> { at, total }

  async function count(c, userId) {
    let n = 0;
    for (const m of c.metrics) n += Number((await COUNTERS[m](db(), c, userId || null)).rows[0].n);
    return n;
  }
  async function total(c, fresh = false) {
    const hit = cache.get(c.id);
    if (!fresh && hit && Date.now() - hit.at < COLLECTIVE.cacheMs) return hit.total;
    const t = await count(c, null);
    cache.set(c.id, { at: Date.now(), total: t });
    return t;
  }
  const state = c => { const now = Date.now(); return now < +new Date(c.startsAt) ? 'upcoming' : now < +new Date(c.endsAt) ? 'live' : 'ended'; };
  const claimUntil = c => new Date(+new Date(c.endsAt) + COLLECTIVE.claimGraceDays * 86400000);

  // Page « Défis collectifs » : défis actifs, à venir ou terminés depuis moins de 7 jours (récompenses encore réclamables).
  async function list(userId) {
    if (!db()) return { challenges: [] };
    const rows = (await db().query("SELECT * FROM collective_challenges WHERE active AND ends_at > now() - make_interval(days => $1) ORDER BY starts_at DESC", [COLLECTIVE.claimGraceDays])).rows.map(fromRow);
    const claimed = new Set((await db().query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'collective:%'", [userId])).rows.map(r => r.claim_id));
    const out = [];
    for (const c of rows) {
      const st = state(c);
      const tot = st === 'upcoming' ? 0 : await total(c);
      const mine = st === 'upcoming' ? 0 : await count(c, userId);
      out.push({
        id: c.id, title: c.title, description: c.description, state: st, startsAt: c.startsAt, endsAt: c.endsAt, claimUntil: claimUntil(c),
        metrics: c.metrics.map(m => ({ id: m, label: METRICS[m] })), total: tot, target: c.target, mine,
        tiers: c.tiers.map((t, i) => ({ index: i, at: t.at, coins: t.coins, xp: t.xp, reached: tot >= t.at, claimed: claimed.has('collective:' + c.id + ':' + i), claimable: tot >= t.at && mine >= 1 && !claimed.has('collective:' + c.id + ':' + i) && st !== 'upcoming' }))
      });
    }
    return { challenges: out, metricLabels: METRICS };
  }

  async function claim(userId, body) {
    const id = String(body?.id || ''), tier = Number(body?.tier);
    const c = (await db().query('SELECT * FROM collective_challenges WHERE id=$1 AND active', [id])).rows.map(fromRow)[0];
    if (!c) return fail('Défi introuvable.', 404);
    if (!Number.isInteger(tier) || tier < 0 || tier >= c.tiers.length) return fail('Palier inconnu.');
    const st = state(c);
    if (st === 'upcoming') return fail('Ce défi n\'a pas encore commencé.');
    if (Date.now() > +claimUntil(c)) return fail('Le délai pour récupérer cette récompense est dépassé.', 409);
    const t = c.tiers[tier];
    const tot = await total(c, true);
    if (tot < t.at) return fail('Palier non atteint : ' + tot + '/' + t.at + '.', 400, { total: tot, at: t.at });
    if ((await count(c, userId)) < 1) return fail('Il faut avoir contribué au défi (au moins une action pendant la période) pour récupérer sa récompense.', 403);
    const claimId = 'collective:' + c.id + ':' + tier;
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, claimId]);
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return fail('Récompense déjà récupérée.'); }
      const user = await applyReward(userId, { coins: t.coins, xp: t.xp }, client, claimId);
      await securityEvent(userId, null, 'collective_claim', { challengeId: c.id, tier, coins: t.coins, xp: t.xp }, client);
      await client.query('COMMIT');
      return { ok: true, reward: { coins: t.coins, xp: t.xp }, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function adminList() {
    const rows = (await db().query('SELECT * FROM collective_challenges ORDER BY starts_at DESC, id')).rows.map(fromRow);
    const claims = new Map((await db().query("SELECT split_part(claim_id,':',2) AS id, count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'collective:%' GROUP BY 1")).rows.map(r => [r.id, r.n]));
    const out = [];
    for (const c of rows) out.push({ ...c, state: state(c), total: state(c) === 'upcoming' ? 0 : await total(c), claims: claims.get(c.id) || 0 });
    return { challenges: out, metrics: METRICS, limits: COLLECTIVE };
  }

  async function adminSave(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle'].includes(action)) return fail('Action inconnue.');
    if (action === 'toggle') {
      const r = await db().query('UPDATE collective_challenges SET active=$2, updated_at=now() WHERE id=$1 RETURNING *', [String(body.id || ''), body.active === true]);
      if (!r.rowCount) return fail('Défi introuvable.', 404);
      await adminLog(adminId, null, body.active === true ? 'collective_enable' : 'collective_disable', { challengeId: r.rows[0].id });
      return { ok: true, challenge: fromRow(r.rows[0]) };
    }
    const errors = {};
    const title = String(body.title || '').trim(), description = String(body.description || '').trim();
    const metrics = Array.isArray(body.metrics) ? [...new Set(body.metrics.map(String))] : [];
    const date = v => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d : null; };
    const startsAt = date(body.startsAt), endsAt = date(body.endsAt);
    const L = COLLECTIVE;
    const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
    const tiers = [];
    if (!Array.isArray(body.tiers) || !body.tiers.length || body.tiers.length > L.maxTiers) errors.tiers = 'De 1 à ' + L.maxTiers + ' paliers.';
    else {
      let prev = 0;
      for (const [i, t] of body.tiers.entries()) {
        const at = int(t?.at, 1, L.maxTarget), coins = int(t?.coins, 0, L.maxCoins), xp = int(t?.xp, 0, L.maxXp);
        if (at === null || coins === null || xp === null) { errors.tiers = 'Palier ' + (i + 1) + ' : objectif (1 à ' + L.maxTarget + '), FC (0 à ' + L.maxCoins + ') et XP (0 à ' + L.maxXp + ') entiers.'; break; }
        if (coins === 0 && xp === 0) { errors.tiers = 'Palier ' + (i + 1) + ' : une récompense (FC ou XP) est nécessaire.'; break; }
        if (at <= prev) { errors.tiers = 'Les paliers doivent être strictement croissants.'; break; }
        prev = at; tiers.push({ at, coins, xp });
      }
    }
    if (title.length < 2 || title.length > 100) errors.title = 'Titre : 2 à 100 caractères.';
    if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
    if (!metrics.length || metrics.some(m => !METRICS[m])) errors.metrics = 'Choisis au moins une action qui fait avancer la jauge.';
    if (!startsAt) errors.startsAt = 'Date de début obligatoire.';
    if (!endsAt) errors.endsAt = 'Date de fin obligatoire.';
    else if (startsAt && endsAt <= startsAt) errors.endsAt = 'La fin doit suivre le début.';
    let id = String(body.id || '');
    if (action === 'update' && !(await db().query('SELECT 1 FROM collective_challenges WHERE id=$1', [id])).rowCount) return fail('Défi introuvable.', 404);
    if (Object.keys(errors).length) return fail('Formulaire incomplet ou invalide.', 400, { errors });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE collective_challenges IN SHARE ROW EXCLUSIVE MODE');
      if (action === 'create') {
        const base = slugify(title); id = base;
        for (let i = 2; (await client.query('SELECT 1 FROM collective_challenges WHERE id=$1', [id])).rowCount; i++) id = base + '-' + i;
        await client.query('INSERT INTO collective_challenges(id,title,description,metrics,tiers,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)', [id, title, description, metrics, JSON.stringify(tiers), startsAt, endsAt, body.active !== false]);
      } else {
        // Palier déjà réclamé : on ne change plus les paliers (sinon les récompenses déjà versées n'auraient plus de sens).
        const claimed = (await client.query("SELECT 1 FROM reward_claims WHERE claim_id LIKE $1 LIMIT 1", ['collective:' + id + ':%'])).rowCount;
        if (claimed) {
          const cur = (await client.query('SELECT tiers,metrics FROM collective_challenges WHERE id=$1', [id])).rows[0];
          if (JSON.stringify(cur.tiers.map(t => [t.at, t.coins, t.xp])) !== JSON.stringify(tiers.map(t => [t.at, t.coins, t.xp])) || JSON.stringify(cur.metrics) !== JSON.stringify(metrics)) { await client.query('ROLLBACK'); return fail('Des récompenses ont déjà été récupérées : paliers et actions comptées ne sont plus modifiables.', 409); }
        }
        await client.query('UPDATE collective_challenges SET title=$2,description=$3,metrics=$4,tiers=$5::jsonb,starts_at=$6,ends_at=$7,updated_at=now() WHERE id=$1', [id, title, description, metrics, JSON.stringify(tiers), startsAt, endsAt]);
        cache.delete(id);
      }
      await adminLog(adminId, null, action === 'create' ? 'collective_create' : 'collective_update', { challengeId: id, title }, client);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
    return { ok: true, challenge: fromRow((await db().query('SELECT * FROM collective_challenges WHERE id=$1', [id])).rows[0]) };
  }

  return { list, claim, adminList, adminSave };
}

module.exports = { createCollective, METRICS };
