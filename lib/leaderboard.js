'use strict';

// Classement des collectionneurs (GET /api/leaderboard).
// Score = cartes différentes possédées, pondérées par rareté (les doublons ne comptent pas).
// Cartes données par l'administration exclues ; comptes bannis exclus.
// « Semaine » : cartes obtenues depuis lundi minuit (heure de Paris), comme les tâches hebdomadaires.
// Récompenses : chaque lundi, le classement de la semaine écoulée est figé une seule fois
// (leaderboard_results) et les 50 premiers reçoivent une récompense à récupérer (LEADERBOARD_REWARDS),
// une fois par semaine (reward_claims « leaderboard-week:<semaine> »), avec une notification.

const { periodInfo } = require('./periods');
const { LEADERBOARD_REWARDS } = require('./game-config');
const { notify } = require('./notifications');

const RARITY_POINTS = { common: 1, rare: 3, epic: 8, legendary: 20, icon: 50 };
const TOP = 50;
// Recalcul au plus toutes les 60 s (LEADERBOARD_CACHE_MS, 0 dans les tests).
const CACHE_MS = Number(process.env.LEADERBOARD_CACHE_MS || 60_000) || 0;

const POINTS_SQL = `CASE rarity ${Object.entries(RARITY_POINTS).map(([r, p]) => `WHEN '${r}' THEN ${p}`).join(' ')} ELSE 0 END`;

// Première semaine récompensée (lundi, heure de Paris) : aucune semaine antérieure au lancement
// (LEADERBOARD_FIRST_WEEK, réglable pour les tests).
const FIRST_WEEK = process.env.LEADERBOARD_FIRST_WEEK || '2026-09-28';
const rewardForRank = rank => LEADERBOARD_REWARDS.find(t => rank >= t.from && rank <= t.to) || null;
const claimIdFor = week => 'leaderboard-week:' + week;

function createLeaderboard({ getPool, applyReward, securityEvent }) {
  const cache = new Map();
  let settledWeek = null;

  // Scores sur une fenêtre (semaine) ou sur toute la collection.
  async function scores(db, info) {
    const params = [];
    let window = '';
    if (info) {
      params.push(info.start, info.end);
      window = 'AND ci.acquired_at >= $1 AND ci.acquired_at < $2';
    }
    return (await db.query(`
      WITH owned AS (
        SELECT DISTINCT ON (ci.owner_id, ci.card_id) ci.owner_id, ci.card_id, ci.rarity
        FROM card_instances ci
        WHERE ci.status IN ('owned','auction') AND ci.source <> 'admin_grant' ${window}
      ), scores AS (
        SELECT u.id, u.name, u.created_at,
               sum(${POINTS_SQL})::int AS score,
               count(*)::int AS unique_cards,
               count(*) FILTER (WHERE o.rarity IN ('legendary','icon'))::int AS top_cards
        FROM owned o JOIN users u ON u.id = o.owner_id
        WHERE u.account_status <> 'banned'
        GROUP BY u.id
      )
      SELECT id, name, score, unique_cards, top_cards,
             rank() OVER (ORDER BY score DESC, unique_cards DESC)::int AS rank
      FROM scores WHERE score > 0
      ORDER BY rank, created_at, id`, params)).rows;
  }

  async function ranking(period) {
    const hit = cache.get(period);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const info = period === 'week' ? periodInfo('weekly') : null;
    const rows = await scores(getPool(), info);
    const value = { rows, period: info ? { start: info.start, end: info.end, key: info.key } : null };
    cache.set(period, { at: Date.now(), value });
    return value;
  }

  // Fige la semaine écoulée (une seule fois, même avec plusieurs instances) et prévient les gagnants.
  async function settleLastWeek(now = new Date()) {
    const db = getPool();
    if (!db) return null;
    const current = periodInfo('weekly', now);
    const last = periodInfo('weekly', new Date(new Date(current.start).getTime() - 1000));
    if (last.key < FIRST_WEEK || settledWeek === last.key) return null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['leaderboard-week:' + last.key]);
      if ((await client.query('SELECT 1 FROM leaderboard_weeks WHERE week_key=$1', [last.key])).rowCount) {
        await client.query('COMMIT'); settledWeek = last.key; return null;
      }
      const all = await scores(client, last), winners = all.filter(r => rewardForRank(r.rank));
      for (const r of winners) {
        const reward = rewardForRank(r.rank);
        await client.query('INSERT INTO leaderboard_results(week_key,user_id,rank,score,unique_cards,coins,xp) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [last.key, r.id, r.rank, r.score, r.unique_cards, reward.coins, reward.xp]);
        await notify(client, r.id, 'leaderboard_reward', `Classement de la semaine : ${r.rank}${r.rank === 1 ? 'er' : 'e'} !`,
          `${reward.coins} FC et ${reward.xp} XP à récupérer.`, '#classement?periode=semaine');
      }
      await client.query('INSERT INTO leaderboard_weeks(week_key,players,rewarded) VALUES($1,$2,$3)', [last.key, all.length, winners.length]);
      await client.query('COMMIT');
      settledWeek = last.key;
      return { week: last.key, rewarded: winners.length };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  // Récompenses du joueur : figées, récupérées ou non.
  async function myRewards(userId) {
    if (!getPool() || !userId) return [];
    const rows = (await getPool().query(`SELECT r.week_key,r.rank,r.score,r.coins,r.xp,(c.claim_id IS NOT NULL) AS claimed
      FROM leaderboard_results r LEFT JOIN reward_claims c ON c.user_id=r.user_id AND c.claim_id='leaderboard-week:'||r.week_key
      WHERE r.user_id=$1 ORDER BY r.week_key DESC LIMIT 10`, [userId])).rows;
    return rows.map(r => ({ week: r.week_key, rank: r.rank, score: r.score, reward: { coins: r.coins, xp: r.xp }, claimed: r.claimed }));
  }

  // Récupération : une fois par semaine et par joueur, même en rafale ; journalisée.
  async function claimLeaderboardReward(userId, week) {
    if (!getPool()) return { error: 'Indisponible.', status: 503 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT coins,xp,rank FROM leaderboard_results WHERE week_key=$1 AND user_id=$2', [String(week || ''), userId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return { error: 'Aucune récompense de classement pour cette semaine.', status: 404 }; }
      const claimId = claimIdFor(week);
      const ins = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, claimId]);
      if (!ins.rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const reward = { coins: Number(row.coins), xp: Number(row.xp) };
      const user = await applyReward(userId, reward, client, claimId);
      await securityEvent(userId, null, 'leaderboard_reward_claim', { week, rank: row.rank, ...reward }, client);
      await client.query('COMMIT');
      return { reward, rank: row.rank, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  // Classement public : noms et scores seulement (jamais d'identifiant ni d'e-mail).
  async function leaderboard(periodValue, viewerId = null) {
    const period = periodValue === 'week' ? 'week' : 'all';
    const view = r => ({ rank: r.rank, name: r.name, score: r.score, uniqueCards: r.unique_cards, topCards: r.top_cards });
    if (!getPool()) return { period, players: 0, top: [], me: null, points: RARITY_POINTS, rewards: LEADERBOARD_REWARDS, myRewards: [] };
    await settleLastWeek().catch(e => console.error('FOOTVAULT classement de la semaine :', e.message));
    const [{ rows, period: info }, mineRewards] = await Promise.all([ranking(period), myRewards(viewerId)]);
    const mine = viewerId ? rows.find(r => r.id === viewerId) : null;
    return {
      period, week: info, players: rows.length, points: RARITY_POINTS, rewards: LEADERBOARD_REWARDS, myRewards: mineRewards,
      top: rows.slice(0, TOP).map(r => ({ ...view(r), me: r.id === viewerId })),
      me: mine ? view(mine) : (viewerId ? { rank: null, score: 0, uniqueCards: 0, topCards: 0 } : null)
    };
  }

  return { leaderboard, settleLastWeek, myRewards, claimLeaderboardReward, clearLeaderboardCache: () => cache.clear() };
}

module.exports = { createLeaderboard, RARITY_POINTS };
