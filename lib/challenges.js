'use strict';

// Défis thématiques : objectif à atteindre pendant une période (ex. « Semaine Serie A : obtiens
// 10 cartes de Serie A »), récompense unique (reward_claims « challenge:<id> »), éditables dans
// la console admin. Seules comptent les cartes obtenues pendant la période (hors cartes de
// bienvenue et dons de l'admin) et les packs ouverts pendant la période.

const { clubKey } = require('./club-key');
const { periodInfo } = require('./periods');

const TYPES = {
  competitionCards: 'Cartes obtenues d\'un championnat',
  cardsObtained: 'Cartes obtenues',
  rarePlusCards: 'Cartes Rare ou mieux obtenues',
  packOpens: 'Ouvertures d\'un pack'
};
const RARE_PLUS = ['rare', 'epic', 'legendary', 'icon'];
const CLAIM_GRACE_DAYS = 7; // un défi réussi peut être récupéré jusqu'à 7 jours après sa fin
const LIMIT = 1000000;

const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'defi';

const fromRow = r => ({
  id: r.id, title: r.title, description: r.description, type: r.type,
  competitionId: r.competition_id || null, packId: r.pack_id || null, target: Number(r.target),
  reward: { coins: Number(r.coins), xp: Number(r.xp) }, startsAt: r.starts_at, endsAt: r.ends_at, active: Boolean(r.active)
});

function createChallenges({ getPool, adminLog, applyReward, securityEvent }) {
  async function competitionKeys(db, competitionId) {
    const rows = (await db.query('SELECT cs.season, c.name FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id=$1', [competitionId])).rows;
    return new Set(rows.map(r => r.season + '|' + clubKey(r.name)));
  }

  // Progression d'un joueur sur un défi (bornée à l'objectif).
  async function progressOf(db, userId, ch) {
    if (ch.type === 'packOpens') {
      const r = await db.query("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='pack_open' AND details->>'packId'=$2 AND created_at >= $3 AND created_at < $4", [userId, ch.packId, ch.startsAt, ch.endsAt]);
      return Math.min(ch.target, r.rows[0].n);
    }
    const cards = (await db.query("SELECT season, club, rarity FROM card_instances WHERE owner_id=$1 AND source NOT IN ('welcome','admin_grant') AND acquired_at >= $2 AND acquired_at < $3", [userId, ch.startsAt, ch.endsAt])).rows;
    let n = cards.length;
    if (ch.type === 'rarePlusCards') n = cards.filter(c => RARE_PLUS.includes(c.rarity)).length;
    if (ch.type === 'competitionCards') {
      const keys = await competitionKeys(db, ch.competitionId);
      n = cards.filter(c => keys.has(c.season + '|' + clubKey(c.club))).length;
    }
    return Math.min(ch.target, n);
  }

  // Défis visibles par un joueur : en cours, à venir (14 jours) et terminés récemment (réclamables).
  async function listChallenges(userId) {
    const db = getPool();
    if (!db) return { current: [], upcoming: [], ended: [] };
    const rows = (await db.query(`SELECT * FROM challenges WHERE active
      AND starts_at < now() + interval '14 days' AND ends_at > now() - interval '${CLAIM_GRACE_DAYS} days'
      ORDER BY ends_at, starts_at, id`)).rows.map(fromRow);
    const claimed = new Set((await db.query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'challenge:%'", [userId])).rows.map(r => r.claim_id));
    const packs = new Map((await db.query('SELECT id, name FROM pack_definitions')).rows.map(p => [p.id, p.name]));
    const comps = new Map((await db.query('SELECT id, name FROM competitions')).rows.map(c => [c.id, c.name]));
    const now = Date.now(), out = { current: [], upcoming: [], ended: [] };
    for (const ch of rows) {
      const started = new Date(ch.startsAt).getTime() <= now, ended = new Date(ch.endsAt).getTime() <= now;
      const progress = started ? await progressOf(db, userId, ch) : 0;
      const item = {
        ...ch, progress, completed: progress >= ch.target, claimed: claimed.has('challenge:' + ch.id),
        packName: ch.packId ? packs.get(ch.packId) || null : null, competitionName: ch.competitionId ? comps.get(ch.competitionId) || null : null
      };
      item.claimable = item.completed && !item.claimed;
      if (!started) out.upcoming.push(item);
      else if (!ended) out.current.push(item);
      else if (item.completed) out.ended.push(item); // défis finis non réussis : plus affichés
    }
    return out;
  }

  async function claimChallenge(userId, id) {
    const db = getPool();
    const ch = (await db.query("SELECT * FROM challenges WHERE id=$1 AND active AND starts_at <= now() AND ends_at > now() - make_interval(days => $2)", [String(id || ''), CLAIM_GRACE_DAYS])).rows.map(fromRow)[0];
    if (!ch) return { error: 'Défi introuvable ou terminé.', status: 404 };
    const progress = await progressOf(db, userId, ch);
    if (progress < ch.target) return { error: `Défi non terminé : ${progress}/${ch.target}.`, status: 400, progress, target: ch.target };
    const claimId = 'challenge:' + ch.id;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, claimId]);
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const user = await applyReward(userId, ch.reward, client, claimId);
      await securityEvent(userId, null, 'challenge_claim', { challengeId: ch.id, coins: ch.reward.coins, xp: ch.reward.xp }, client);
      await client.query('COMMIT');
      return { challenge: ch, reward: ch.reward, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  async function adminChallenges() {
    const rows = (await getPool().query('SELECT * FROM challenges ORDER BY starts_at DESC, id')).rows.map(fromRow);
    const claims = new Map((await getPool().query("SELECT substr(claim_id, 11) AS id, count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'challenge:%' GROUP BY 1")).rows.map(r => [r.id, r.n]));
    const competitions = (await getPool().query("SELECT id, name FROM competitions ORDER BY sort_order, name")).rows;
    const packs = (await getPool().query('SELECT id, name, active, available_from, available_until FROM pack_definitions ORDER BY sort_order, id')).rows;
    return { challenges: rows.map(c => ({ ...c, claims: claims.get(c.id) || 0 })), types: TYPES, competitions, packs };
  }

  async function adminSaveChallenge(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    const db = getPool();
    if (action === 'toggle') {
      const r = await db.query('UPDATE challenges SET active=$2, updated_at=now() WHERE id=$1 RETURNING *', [String(body.id || ''), body.active === true]);
      if (!r.rowCount) return { error: 'Défi introuvable.', status: 404 };
      await adminLog(adminId, null, body.active === true ? 'challenge_enable' : 'challenge_disable', { challengeId: r.rows[0].id });
      return { ok: true, challenge: fromRow(r.rows[0]) };
    }
    const errors = {};
    const title = String(body.title || '').trim(), description = String(body.description || '').trim(), type = String(body.type || '');
    const num = (v, min) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= LIMIT ? n : null; };
    const target = num(body.target, 1), coins = num(body.coins, 0), xp = num(body.xp, 0);
    const date = v => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d : null; };
    const startsAt = date(body.startsAt), endsAt = date(body.endsAt);
    const competitionId = type === 'competitionCards' ? String(body.competitionId || '') || null : null;
    const packId = type === 'packOpens' ? String(body.packId || '') || null : null;
    if (title.length < 2 || title.length > 100) errors.title = 'Titre : 2 à 100 caractères.';
    if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
    if (!TYPES[type]) errors.type = 'Condition inconnue.';
    if (target === null) errors.target = 'Objectif : nombre entier d\'au moins 1.';
    if (coins === null) errors.coins = 'FC : nombre entier positif ou nul.';
    if (xp === null) errors.xp = 'XP : nombre entier positif ou nul.';
    if (coins === 0 && xp === 0) errors.coins = 'Une récompense (FC ou XP) est nécessaire.';
    if (!startsAt) errors.startsAt = 'Date de début obligatoire.';
    if (!endsAt) errors.endsAt = 'Date de fin obligatoire.';
    else if (startsAt && endsAt <= startsAt) errors.endsAt = 'La fin doit suivre le début.';
    if (type === 'competitionCards' && !(competitionId && (await db.query('SELECT 1 FROM competitions WHERE id=$1', [competitionId])).rowCount)) errors.competitionId = 'Championnat introuvable.';
    if (type === 'packOpens' && !(packId && (await db.query('SELECT 1 FROM pack_definitions WHERE id=$1', [packId])).rowCount)) errors.packId = 'Pack introuvable.';
    let id = String(body.id || '');
    if (action === 'update' && !(await db.query('SELECT 1 FROM challenges WHERE id=$1', [id])).rowCount) return { error: 'Défi introuvable.', status: 404 };
    if (Object.keys(errors).length) return { error: 'Formulaire incomplet ou invalide.', errors, status: 400 };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE challenges IN SHARE ROW EXCLUSIVE MODE');
      if (action === 'create') {
        const base = slugify(title);
        id = base;
        for (let i = 2; (await client.query('SELECT 1 FROM challenges WHERE id=$1', [id])).rowCount; i++) id = base + '-' + i;
        await client.query('INSERT INTO challenges(id,title,description,type,competition_id,pack_id,target,coins,xp,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [id, title, description, type, competitionId, packId, target, coins, xp, startsAt, endsAt, body.active !== false]);
      } else {
        await client.query('UPDATE challenges SET title=$2,description=$3,type=$4,competition_id=$5,pack_id=$6,target=$7,coins=$8,xp=$9,starts_at=$10,ends_at=$11,updated_at=now() WHERE id=$1',
          [id, title, description, type, competitionId, packId, target, coins, xp, startsAt, endsAt]);
      }
      await adminLog(adminId, null, action === 'create' ? 'challenge_create' : 'challenge_update', { challengeId: id, title }, client);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
    return { ok: true, challenge: fromRow((await db.query('SELECT * FROM challenges WHERE id=$1', [id])).rows[0]) };
  }

  return { listChallenges, claimChallenge, adminChallenges, adminSaveChallenge };
}

// Premier défi : « Semaine Serie A » sur la semaine en cours (heure de Paris), avec son pack limité.
// Créé une seule fois, seulement si la Serie A a des cartes rattachées. Ajouts uniquement.
async function seedSerieAWeek(client) {
  const { start, end } = periodInfo('weekly');
  const eligible = (await client.query("SELECT count(*)::int AS n FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id WHERE cs.competition_id='serie-a'")).rows[0].n;
  if (!eligible) return { created: false };
  await client.query(`INSERT INTO pack_definitions(id,name,price,currency,cards,badge,description,guarantee,guarantee_count,pool_id,conditions,active,sort_order,available_from,available_until)
    VALUES('pack-semaine-serie-a','Pack Semaine Serie A',150,'coins',5,'ÉDITION LIMITÉE','5 cartes de Serie A, dont 1 Rare ou mieux. Disponible pendant la Semaine Serie A seulement.','rare',1,NULL,$1,true,
      (SELECT COALESCE(MIN(sort_order),0)-1 FROM pack_definitions),$2,$3) ON CONFLICT(id) DO NOTHING`,
    [JSON.stringify({ competitions: ['serie-a'], standardOnly: true }), start, end]);
  await client.query(`INSERT INTO challenges(id,title,description,type,competition_id,pack_id,target,coins,xp,starts_at,ends_at,active)
    VALUES('semaine-serie-a','SEMAINE SERIE A','Obtiens 10 cartes de Serie A cette semaine (Pack Semaine Serie A, Pack Serie A ou tout autre pack).','competitionCards','serie-a',NULL,10,500,50,$1,$2,true)
    ON CONFLICT(id) DO NOTHING`, [start, end]);
  return { created: true, start, end };
}

module.exports = { createChallenges, seedSerieAWeek, CHALLENGE_TYPES: TYPES };
