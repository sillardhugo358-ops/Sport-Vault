'use strict';

// Classement des collectionneurs (GET /api/leaderboard).
// Score = cartes différentes possédées, pondérées par rareté (les doublons ne comptent pas).
// Cartes données par l'administration exclues ; comptes bannis exclus.
// « Semaine » : cartes obtenues depuis lundi minuit (heure de Paris), comme les tâches hebdomadaires.

const { periodInfo } = require('./periods');

const RARITY_POINTS = { common: 1, rare: 3, epic: 8, legendary: 20, icon: 50 };
const TOP = 50;
// Recalcul au plus toutes les 60 s (LEADERBOARD_CACHE_MS, 0 dans les tests).
const CACHE_MS = Number(process.env.LEADERBOARD_CACHE_MS || 60_000) || 0;

const POINTS_SQL = `CASE rarity ${Object.entries(RARITY_POINTS).map(([r, p]) => `WHEN '${r}' THEN ${p}`).join(' ')} ELSE 0 END`;

function createLeaderboard({ getPool }) {
  const cache = new Map();

  async function ranking(period) {
    const hit = cache.get(period);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const params = [];
    let window = '', info = null;
    if (period === 'week') {
      info = periodInfo('weekly');
      params.push(info.start, info.end);
      window = 'AND ci.acquired_at >= $1 AND ci.acquired_at < $2';
    }
    const rows = (await getPool().query(`
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
    const value = { rows, period: info ? { start: info.start, end: info.end, key: info.key } : null };
    cache.set(period, { at: Date.now(), value });
    return value;
  }

  // Classement public : noms et scores seulement (jamais d'identifiant ni d'e-mail).
  async function leaderboard(periodValue, viewerId = null) {
    const period = periodValue === 'week' ? 'week' : 'all';
    const view = r => ({ rank: r.rank, name: r.name, score: r.score, uniqueCards: r.unique_cards, topCards: r.top_cards });
    if (!getPool()) return { period, players: 0, top: [], me: null, points: RARITY_POINTS };
    const { rows, period: info } = await ranking(period);
    const mine = viewerId ? rows.find(r => r.id === viewerId) : null;
    return {
      period, week: info, players: rows.length, points: RARITY_POINTS,
      top: rows.slice(0, TOP).map(r => ({ ...view(r), me: r.id === viewerId })),
      me: mine ? view(mine) : (viewerId ? { rank: null, score: 0, uniqueCards: 0, topCards: 0 } : null)
    };
  }

  return { leaderboard, clearLeaderboardCache: () => cache.clear() };
}

module.exports = { createLeaderboard, RARITY_POINTS };
