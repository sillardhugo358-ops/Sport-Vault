'use strict';

// Tableau de bord statistique de la console admin (GET /api/admin/stats).
// Lecture seule : activité (security_events), économie (coin_ledger), packs, marché, raretés tirées.
// Les jours sont comptés en heure de Paris, comme les missions quotidiennes.

const PERIODS = [7, 14, 30, 90];
const TZ = 'Europe/Paris';

function statsPeriod(value) {
  const n = Number(value);
  return PERIODS.includes(n) ? n : 14;
}

function createStats({ getPool }) {
  async function adminStats(daysValue) {
    const days = statsPeriod(daysValue);
    const db = getPool();
    if (!db) return { days, unavailable: true };
    const since = `now() - make_interval(days => $1)`;
    const q = (sql, params = [days]) => db.query(sql, params).then(r => r.rows);
    const [active, series, packs, flows, market, rarity, topPlayers, ledgerStart] = await Promise.all([
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
    ]);
    const num = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v]));
    const flowRows = flows.map(num);
    return {
      days,
      periods: PERIODS,
      activePlayers: active[0] || { d1: 0, d7: 0, d30: 0 },
      series: series.map(num),
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
    };
  }
  return { adminStats };
}

module.exports = { createStats, statsPeriod, STATS_PERIODS: PERIODS };
