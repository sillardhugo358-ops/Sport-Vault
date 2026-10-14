'use strict';

// Objectifs de saison : pour chaque saison du catalogue, des paliers de complétion (25/50/75/100 % des cartes actives que le joueur possède,
// statut owned, exemplaires distincts) donnent chacun UNE récompense (reward_claims « goal:<saison>:<palier> »), calculée côté serveur.
// Barème validé par le propriétaire le 14/10/2026 (SEASON_GOALS). Les FC gagnés ici comptent dans le même plafond quotidien que les sets
// (SET_DAILY_CAP_COINS, jour de Paris) : au plafond la récupération est refusée sans rien consommer.

const { SEASON_GOALS, SET_DAILY_CAP_COINS } = require('./game-config');
const { parisDayKey, parisLocalMidnight } = require('./periods');

const reached = (owned, total, pct) => total > 0 && owned * 100 >= pct * total;
const claimId = (season, pct) => 'goal:' + season + ':' + pct;

function createSeasonGoals({ getPool, applyReward, securityEvent }) {
  async function claimedToday(db, userId) {
    const r = await db.query("SELECT COALESCE(SUM(amount),0)::int AS n FROM coin_ledger WHERE user_id=$1 AND reason='reward' AND (ref LIKE 'set:%' OR ref LIKE 'goal:%') AND created_at >= $2", [userId, parisLocalMidnight(parisDayKey())]);
    return r.rows[0].n;
  }
  // Total de cartes actives et cartes possédées par saison.
  async function counts(db, userId) {
    const totals = (await db.query('SELECT season, count(*)::int AS total FROM catalog_cards WHERE is_active=true GROUP BY season')).rows;
    const owned = new Map((await db.query("SELECT cc.season, count(DISTINCT cc.id)::int AS owned FROM card_instances ci JOIN catalog_cards cc ON cc.id=ci.card_id AND cc.is_active=true WHERE ci.owner_id=$1 AND ci.status='owned' GROUP BY cc.season", [userId])).rows.map(r => [String(r.season), r.owned]));
    return totals.filter(t => t.total >= SEASON_GOALS.minCards).map(t => ({ season: String(t.season), total: t.total, owned: owned.get(String(t.season)) || 0 }))
      .sort((a, b) => b.season.localeCompare(a.season));
  }

  async function list(userId) {
    const db = getPool();
    const meta = { dailyCap: SET_DAILY_CAP_COINS, remainingToday: SET_DAILY_CAP_COINS };
    if (!db) return { seasons: [], ...meta };
    const today = await claimedToday(db, userId);
    meta.remainingToday = Math.max(0, SET_DAILY_CAP_COINS - today);
    const claimed = new Set((await db.query("SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE 'goal:%'", [userId])).rows.map(r => r.claim_id));
    const seasons = (await counts(db, userId)).map(s => ({
      ...s,
      tiers: SEASON_GOALS.tiers.map(t => {
        const ok = reached(s.owned, s.total, t.pct), done = claimed.has(claimId(s.season, t.pct));
        return { pct: t.pct, coins: t.coins, xp: t.xp, reached: ok, claimed: done, claimable: ok && !done && t.coins <= meta.remainingToday, blockedByCap: ok && !done && t.coins > meta.remainingToday };
      })
    }));
    return { seasons, ...meta };
  }

  async function claim(userId, season, pct) {
    const tier = SEASON_GOALS.tiers.find(t => t.pct === Number(pct));
    season = String(season || '').slice(0, 20);
    if (!tier || !season) return { error: 'Objectif introuvable.', status: 404 };
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Verrou du joueur : deux demandes simultanées ne peuvent ni doubler la récompense ni dépasser le plafond.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const s = (await counts(client, userId)).find(x => x.season === season);
      if (!s) { await client.query('ROLLBACK'); return { error: 'Saison introuvable.', status: 404 }; }
      const id = claimId(season, tier.pct);
      if ((await client.query('SELECT 1 FROM reward_claims WHERE user_id=$1 AND claim_id=$2', [userId, id])).rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      if (!reached(s.owned, s.total, tier.pct)) { await client.query('ROLLBACK'); return { error: `Objectif non atteint : ${s.owned}/${s.total} cartes (il en faut ${tier.pct} %).`, status: 400 }; }
      const today = await claimedToday(client, userId);
      if (today + tier.coins > SET_DAILY_CAP_COINS) {
        await client.query('ROLLBACK');
        return { error: `Plafond quotidien atteint : ${SET_DAILY_CAP_COINS.toLocaleString('fr-FR')} FC de sets et d'objectifs par jour. Ton objectif reste récupérable : reviens demain.`, status: 409, code: 'daily_cap' };
      }
      const inserted = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, id]);
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const user = await applyReward(userId, { coins: tier.coins, xp: tier.xp }, client, id);
      await securityEvent(userId, null, 'season_goal_claim', { season, pct: tier.pct, coins: tier.coins, xp: tier.xp }, client);
      await client.query('COMMIT');
      return { season, pct: tier.pct, reward: { coins: tier.coins, xp: tier.xp }, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { list, claim };
}

module.exports = { createSeasonGoals, reached };
