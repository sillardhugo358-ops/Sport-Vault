'use strict';

// Tableau de bord statistique de la console admin (GET /api/admin/stats).
// Lecture seule : activité (security_events), économie (coin_ledger), packs, marché, raretés tirées,
// progression (récompenses récupérées : reward_claims), classement récompensé, fidélité à 7 jours.
// Les jours sont comptés en heure de Paris, comme les missions quotidiennes.

const PERIODS = [7, 14, 30, 90];
const TZ = 'Europe/Paris';

function statsPeriod(value) {
  const n = Number(value);
  return PERIODS.includes(n) ? n : 14;
}

// Type d'une récompense récupérée, d'après son identifiant (reward_claims.claim_id).
const CLAIM_KIND_SQL = `CASE
  WHEN claim_id LIKE 'achievement:%' THEN 'achievement'
  WHEN claim_id LIKE 'daily:%' THEN 'daily'
  WHEN claim_id LIKE 'weekly:%' THEN 'weekly'
  WHEN claim_id LIKE 'monthly:%' THEN 'monthly'
  WHEN claim_id LIKE 'leaderboard-week:%' THEN 'leaderboard'
  WHEN claim_id LIKE 'challenge:%' THEN 'challenge'
  WHEN claim_id LIKE 'album%' THEN 'album'
  ELSE 'mission' END`;

function createStats({ getPool }) {
  async function adminStats(daysValue) {
    const days = statsPeriod(daysValue);
    const db = getPool();
    if (!db) return { days, unavailable: true };
    const since = `now() - make_interval(days => $1)`;
    const q = (sql, params = [days]) => db.query(sql, params).then(r => r.rows);
    const [active, series, packs, flows, market, rarity, topPlayers, ledgerStart, claimDays, topAchievements, topMissions, leaderboard, retention, circulation] = await Promise.all([
      q(`SELECT
          count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '1 day')::int AS d1,
          count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days')::int AS d7,
          count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '30 days')::int AS d30
        FROM security_events WHERE user_id IS NOT NULL AND created_at > now() - interval '30 days'`, []),
      q(`WITH d AS (
           SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - ($1::int - 1), (now() AT TIME ZONE '${TZ}')::date, interval '1 day')::date AS day)
         SELECT to_char(d.day,'YYYY-MM-DD') AS day,
           (SELECT count(*)::int FROM users u WHERE (u.created_at AT TIME ZONE '${TZ}')::date = d.day) AS signups,
           (SELECT count(DISTINCT e.user_id)::int FROM security_events e WHERE e.user_id IS NOT NULL AND (e.created_at AT TIME ZONE '${TZ}')::date = d.day) AS active,
           (SELECT count(*)::int FROM security_events e WHERE e.event IN ('pack_open','pool_draw') AND (e.created_at AT TIME ZONE '${TZ}')::date = d.day) AS packs,
           (SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0),0)::bigint FROM coin_ledger l WHERE (l.created_at AT TIME ZONE '${TZ}')::date = d.day) AS coins_in,
           (SELECT COALESCE(-sum(amount) FILTER (WHERE amount < 0),0)::bigint FROM coin_ledger l WHERE (l.created_at AT TIME ZONE '${TZ}')::date = d.day) AS coins_out
         FROM d ORDER BY d.day`),
      q(`SELECT COALESCE(e.details->>'packId', 'pool:' || (e.details->>'poolId')) AS id,
           COALESCE(p.name, pp.name, e.details->>'packId', e.details->>'poolId') AS name,
           count(*)::int AS opens, COALESCE(sum((e.details->>'price')::int),0)::bigint AS coins
         FROM security_events e
         LEFT JOIN pack_definitions p ON p.id = e.details->>'packId'
         LEFT JOIN pack_pools pp ON pp.id = e.details->>'poolId'
         WHERE e.event IN ('pack_open','pool_draw') AND e.created_at > ${since}
         GROUP BY 1,2 ORDER BY opens DESC, name LIMIT 20`),
      q(`SELECT reason, count(*)::int AS moves,
           COALESCE(sum(amount) FILTER (WHERE amount > 0),0)::bigint AS gained,
           COALESCE(-sum(amount) FILTER (WHERE amount < 0),0)::bigint AS spent
         FROM coin_ledger WHERE created_at > ${since} GROUP BY reason ORDER BY reason`),
      q(`SELECT count(*) FILTER (WHERE created_at > ${since})::int AS created,
           count(*) FILTER (WHERE status='completed' AND completed_at > ${since} AND current_bidder_id IS NOT NULL)::int AS sold,
           COALESCE(sum(current_bid) FILTER (WHERE status='completed' AND completed_at > ${since} AND current_bidder_id IS NOT NULL),0)::bigint AS volume,
           count(*) FILTER (WHERE status='active' AND ends_at > now())::int AS active
         FROM auctions`),
      q(`SELECT rarity, count(*)::int AS n FROM card_instances
         WHERE acquired_at > ${since} AND source <> 'welcome' AND source NOT LIKE 'admin%'
         GROUP BY rarity`),
      q(`SELECT u.name, sum(-l.amount)::bigint AS spent
         FROM coin_ledger l JOIN users u ON u.id = l.user_id
         WHERE l.amount < 0 AND l.created_at > ${since} GROUP BY u.id, u.name ORDER BY spent DESC LIMIT 5`),
      q('SELECT min(created_at) AS first FROM coin_ledger', []),
      // Récompenses récupérées par jour et par type (une seule passe sur la période).
      q(`SELECT to_char((claimed_at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS day, ${CLAIM_KIND_SQL} AS kind, count(*)::int AS n
         FROM reward_claims WHERE claimed_at > ${since} GROUP BY 1,2`),
      q(`SELECT a.id, a.name, count(*)::int AS n FROM reward_claims c JOIN achievements a ON c.claim_id = 'achievement:' || a.id
         WHERE c.claimed_at > ${since} GROUP BY a.id, a.name ORDER BY n DESC, a.name LIMIT 8`),
      q(`SELECT t.kind, t.title AS name, count(*)::int AS n FROM reward_claims c
         JOIN period_tasks t ON split_part(c.claim_id,':',1) = t.kind AND split_part(c.claim_id,':',3) = t.id
         WHERE c.claim_id ~ '^(daily|weekly|monthly):' AND c.claimed_at > ${since} GROUP BY t.kind, t.id, t.title ORDER BY n DESC, t.title LIMIT 8`),
      q(`SELECT w.week_key, w.players, w.rewarded,
           (SELECT count(*)::int FROM reward_claims c WHERE c.claim_id = 'leaderboard-week:' || w.week_key) AS claimed,
           COALESCE((SELECT sum(r.coins) FROM leaderboard_results r WHERE r.week_key = w.week_key),0)::bigint AS coins
         FROM leaderboard_weeks w ORDER BY w.week_key DESC LIMIT 6`, []),
      // Fidélité : parmi les joueurs inscrits il y a 7 à 14 jours, ceux revus depuis moins de 7 jours.
      q(`SELECT count(*)::int AS cohort,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM security_events e WHERE e.user_id = u.id AND e.created_at > now() - interval '7 days'))::int AS returned
         FROM users u WHERE u.account_status <> 'banned' AND u.created_at BETWEEN now() - interval '14 days' AND now() - interval '7 days'`, []),
      q(`SELECT COALESCE(sum(coins),0)::bigint AS total, count(*)::int AS players,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY coins),0)::int AS median
         FROM users WHERE account_status <> 'banned'`, []),
    ]);
    const num = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v]));
    const flowRows = flows.map(num);
    // Récompenses récupérées : total par type et série par jour (tâches, succès, autres).
    const byKind = {};
    const claimSeries = new Map();
    for (const r of claimDays) {
      byKind[r.kind] = (byKind[r.kind] || 0) + r.n;
      const row = claimSeries.get(r.day) || { tasks: 0, achievements: 0, others: 0 };
      if (['daily', 'weekly', 'monthly'].includes(r.kind)) row.tasks += r.n;
      else if (r.kind === 'achievement') row.achievements += r.n;
      else row.others += r.n;
      claimSeries.set(r.day, row);
    }
    return {
      days,
      periods: PERIODS,
      activePlayers: active[0] || { d1: 0, d7: 0, d30: 0 },
      series: series.map(num).map(r => ({ ...r, ...(claimSeries.get(r.day) || { tasks: 0, achievements: 0, others: 0 }) })),
      packs: packs.map(num),
      economy: {
        byReason: flowRows,
        gained: flowRows.reduce((s, r) => s + r.gained, 0),
        spent: flowRows.reduce((s, r) => s + r.spent, 0),
        ledgerSince: ledgerStart[0]?.first || null,
      },
      market: num(market[0] || {}),
      rarity: rarity.map(num),
      topSpenders: topPlayers.map(num),
      progress: { byKind, total: Object.values(byKind).reduce((t, n) => t + n, 0), topAchievements: topAchievements.map(num), topMissions: topMissions.map(num) },
      leaderboard: leaderboard.map(num),
      retention: { cohort: retention[0]?.cohort || 0, returned: retention[0]?.returned || 0 },
      circulation: num(circulation[0] || { total: 0, players: 0, median: 0 }),
    };
  }
  return { adminStats };
}

module.exports = { createStats, statsPeriod, STATS_PERIODS: PERIODS };
