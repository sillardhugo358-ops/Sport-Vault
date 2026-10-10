'use strict';

// Classement des collectionneurs (GET /api/leaderboard).
// Score = cartes différentes possédées, pondérées par rareté (les doublons ne comptent pas).
// Cartes données par l'administration exclues ; comptes bannis exclus.
// « Semaine » : cartes obtenues depuis lundi minuit (heure de Paris), comme les tâches hebdomadaires.
// Récompenses : chaque lundi, le classement de la semaine écoulée est figé une seule fois
// (leaderboard_results) et les 50 premiers reçoivent une récompense à récupérer (LEADERBOARD_REWARDS),
// une fois par semaine (reward_claims « leaderboard-week:<semaine> »), avec une notification.
// Saisons : tranches de SEASON.weeks semaines à partir du lundi SEASON.firstStart (heure de Paris), score = cartes obtenues pendant la
// saison (même calcul que la semaine, sauf les cartes de bienvenue qui ne comptent pas). À la fin, le classement est figé une seule fois (leaderboard_season_results) : FC, XP et cartes
// exclusives du podium (table season_prizes, réglée par l'administration) à récupérer une fois (reward_claims « leaderboard-season:<saison> »).

const { periodInfo, parisDayKey, parisLocalMidnight } = require('./periods');
const { LEADERBOARD_REWARDS, SEASON } = require('./game-config');
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

// Saisons (calendrier fixe : jamais de saison « en cours » à créer, tout se déduit de la date).
const SEASON_START = process.env.LEADERBOARD_SEASON_START || SEASON.firstStart;
const SEASON_DAYS = SEASON.weeks * 7;
const addDays = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
const seasonKey = n => 'season-' + n;
function seasonWindow(n) {
  return { number: n, key: seasonKey(n), start: parisLocalMidnight(addDays(SEASON_START, (n - 1) * SEASON_DAYS)), end: parisLocalMidnight(addDays(SEASON_START, n * SEASON_DAYS)) };
}
// Saison à la date donnée : number 0 = avant la première saison (upcoming).
function seasonInfo(now = new Date()) {
  const diff = dayDiff(parisDayKey(now), SEASON_START);
  if (diff < 0) return { number: 0, key: null, upcoming: true, start: parisLocalMidnight(SEASON_START), end: null };
  return { ...seasonWindow(Math.floor(diff / SEASON_DAYS) + 1), upcoming: false };
}
const rewardForSeasonRank = rank => SEASON.rewards.find(t => rank >= t.from && rank <= t.to) || null;
const seasonClaimId = key => 'leaderboard-season:' + key;
const validSeasonKey = k => /^season-[1-9][0-9]{0,3}$/.test(String(k || ''));

function createLeaderboard({ getPool, applyReward, securityEvent, adminLog, grantCard }) {
  const cache = new Map();
  let settledWeek = null;
  let settledSeasonUpTo = 0;

  // Scores sur une fenêtre (semaine) ou sur toute la collection.
  // opts.noWelcome : les 3 cartes offertes à l'inscription ne comptent pas (saisons : un joueur inscrit en cours de saison n'a pas d'avance).
  async function scores(db, info, opts = {}) {
    const params = [];
    let window = '';
    if (info) {
      params.push(info.start, info.end);
      window = 'AND ci.acquired_at >= $1 AND ci.acquired_at < $2';
    }
    if (opts.noWelcome) window += " AND ci.source <> 'welcome'";
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
    const season = period === 'season' ? seasonInfo() : null;
    const info = period === 'week' ? periodInfo('weekly') : season && season.number ? season : null;
    const rows = period === 'season' && !season.number ? [] : await scores(getPool(), info, { noWelcome: period === 'season' });
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

  // Fige les saisons terminées (au plus les 3 dernières, une seule fois chacune, même avec plusieurs instances) et prévient les gagnants.
  async function settleSeasons(now = new Date()) {
    const db = getPool();
    if (!db) return null;
    const cur = seasonInfo(now), last = cur.number ? cur.number - 1 : 0;
    if (last < 1 || settledSeasonUpTo >= last) return null;
    const settled = [];
    for (let n = Math.max(1, last - 2); n <= last; n++) {
      const w = seasonWindow(n), client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['leaderboard-season:' + w.key]);
        if ((await client.query('SELECT 1 FROM leaderboard_seasons WHERE season_key=$1', [w.key])).rowCount) { await client.query('COMMIT'); continue; }
        const all = await scores(client, w, { noWelcome: true }), winners = all.filter(r => rewardForSeasonRank(r.rank));
        const prizes = (await client.query('SELECT rank_from,rank_to,card_id FROM season_prizes WHERE season_key=$1 ORDER BY card_id', [w.key])).rows;
        for (const r of winners) {
          const reward = rewardForSeasonRank(r.rank), cards = prizes.filter(p => r.rank >= p.rank_from && r.rank <= p.rank_to).map(p => p.card_id);
          await client.query('INSERT INTO leaderboard_season_results(season_key,user_id,rank,score,unique_cards,coins,xp,card_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
            [w.key, r.id, r.rank, r.score, r.unique_cards, reward.coins, reward.xp, JSON.stringify(cards)]);
          await notify(client, r.id, 'leaderboard_reward', `Saison ${n} terminée : ${r.rank}${r.rank === 1 ? 'er' : 'e'} !`,
            `${reward.coins} FC et ${reward.xp} XP${cards.length ? ' et ' + (cards.length > 1 ? cards.length + ' cartes exclusives' : 'une carte exclusive') : ''} à récupérer.`, '#classement?periode=saison');
        }
        await client.query('INSERT INTO leaderboard_seasons(season_key,starts_at,ends_at,players,rewarded) VALUES($1,$2,$3,$4,$5)', [w.key, w.start, w.end, all.length, winners.length]);
        await client.query('COMMIT');
        settled.push({ season: w.key, rewarded: winners.length });
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    }
    settledSeasonUpTo = last;
    return settled;
  }

  const cardRows = async (db, ids) => ids.length ? (await db.query('SELECT id,name,rarity,club,season FROM catalog_cards WHERE id = ANY($1::text[])', [ids])).rows : [];

  // Saisons passées du joueur : rang, récompense (FC, XP, cartes) et état de récupération.
  async function mySeasons(userId) {
    if (!getPool() || !userId) return [];
    const rows = (await getPool().query(`SELECT r.season_key,r.rank,r.score,r.coins,r.xp,r.card_ids,(c.claim_id IS NOT NULL) AS claimed
      FROM leaderboard_season_results r LEFT JOIN reward_claims c ON c.user_id=r.user_id AND c.claim_id='leaderboard-season:'||r.season_key
      WHERE r.user_id=$1 ORDER BY length(r.season_key) DESC, r.season_key DESC LIMIT 10`, [userId])).rows;
    const names = new Map((await cardRows(getPool(), [...new Set(rows.flatMap(r => r.card_ids))])).map(c => [c.id, c]));
    return rows.map(r => ({ season: r.season_key, number: Number(r.season_key.slice(7)), rank: r.rank, score: r.score, reward: { coins: r.coins, xp: r.xp },
      cards: r.card_ids.map(id => names.get(id)).filter(Boolean).map(c => ({ id: c.id, name: c.name, rarity: c.rarity })), claimed: r.claimed }));
  }

  // Récupération : une fois par saison et par joueur, même en rafale ; FC, XP puis cartes exclusives dans la même transaction.
  async function claimSeasonReward(userId, season) {
    if (!getPool()) return { error: 'Indisponible.', status: 503 };
    if (!validSeasonKey(season)) return { error: 'Saison inconnue.', status: 404 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const row = (await client.query('SELECT coins,xp,rank,card_ids FROM leaderboard_season_results WHERE season_key=$1 AND user_id=$2', [season, userId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return { error: 'Aucune récompense de saison.', status: 404 }; }
      const claimId = seasonClaimId(season);
      const ins = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [userId, claimId]);
      if (!ins.rowCount) { await client.query('ROLLBACK'); return { error: 'Récompense déjà récupérée.', status: 400 }; }
      const reward = { coins: Number(row.coins), xp: Number(row.xp) };
      const user = await applyReward(userId, reward, client, claimId);
      const granted = [];
      for (const cardId of row.card_ids) {
        // Une carte qui ne peut pas être créée (retirée du catalogue, quantité LIMITED épuisée) n'empêche pas le reste : tracée pour l'administration.
        await client.query('SAVEPOINT season_card');
        try { const inst = await grantCard(client, userId, cardId, 'season:' + season); if (inst) granted.push({ id: cardId, name: inst.name, serial: inst.serial ?? null }); await client.query('RELEASE SAVEPOINT season_card'); }
        catch (e) { await client.query('ROLLBACK TO SAVEPOINT season_card'); await securityEvent(userId, null, 'season_prize_failed', { season, cardId, reason: String(e.message).slice(0, 120) }, client); }
      }
      await securityEvent(userId, null, 'leaderboard_season_claim', { season, rank: row.rank, ...reward, cards: granted.map(c => c.id) }, client);
      await client.query('COMMIT');
      return { reward, rank: row.rank, cards: granted, user };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  // Cartes exclusives du podium d'une saison (publiques : c'est l'attrait de la saison).
  async function seasonPrizes(key) {
    if (!getPool() || !key) return [];
    const rows = (await getPool().query('SELECT rank_from,rank_to,card_id FROM season_prizes WHERE season_key=$1 ORDER BY rank_from,rank_to,card_id', [key])).rows;
    const cards = new Map((await cardRows(getPool(), [...new Set(rows.map(r => r.card_id))])).map(c => [c.id, c]));
    return rows.map(r => ({ from: r.rank_from, to: r.rank_to, card: cards.get(r.card_id) ? { id: r.card_id, name: cards.get(r.card_id).name, rarity: cards.get(r.card_id).rarity, club: cards.get(r.card_id).club } : { id: r.card_id } }));
  }

  // Administration : lire et régler les cartes exclusives (saison en cours ou à venir seulement, jamais une saison déjà réglée).
  async function adminSeasonPrizes() {
    const base = seasonInfo().number || 1, out = [];
    for (const n of [base, base + 1]) { const w = seasonWindow(n); out.push({ season: w.key, number: n, start: w.start, end: w.end, prizes: await seasonPrizes(w.key) }); }
    return { seasons: out, rewards: SEASON.rewards };
  }
  async function adminSetSeasonPrize(adminId, body) {
    const action = String(body.action || ''), key = String(body.season || '');
    if (!['add', 'remove'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    if (!validSeasonKey(key)) return { error: 'Saison inconnue.', status: 400 };
    const cur = seasonInfo(), n = Number(key.slice(7));
    if (cur.number && n < cur.number) return { error: 'Cette saison est terminée : ses récompenses sont figées.', status: 409 };
    const from = Number(body.from), to = Number(body.to ?? body.from), cardId = String(body.cardId || '');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 50) return { error: 'Rangs : de 1 à 50, début avant fin.', status: 400 };
    const db = getPool();
    if (action === 'add' && !(await db.query('SELECT 1 FROM catalog_cards WHERE id=$1 AND is_active=true', [cardId])).rowCount) return { error: 'Carte introuvable au catalogue.', status: 404 };
    if (action === 'add') await db.query('INSERT INTO season_prizes(season_key,rank_from,rank_to,card_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [key, from, to, cardId]);
    else await db.query('DELETE FROM season_prizes WHERE season_key=$1 AND rank_from=$2 AND rank_to=$3 AND card_id=$4', [key, from, to, cardId]);
    await adminLog(adminId, null, action === 'add' ? 'season_prize_add' : 'season_prize_remove', { season: key, from, to, cardId });
    return { ok: true, prizes: await seasonPrizes(key) };
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
    const period = periodValue === 'week' ? 'week' : periodValue === 'season' ? 'season' : 'all';
    const view = r => ({ rank: r.rank, name: r.name, score: r.score, uniqueCards: r.unique_cards, topCards: r.top_cards });
    if (!getPool()) return { period, players: 0, top: [], me: null, points: RARITY_POINTS, rewards: LEADERBOARD_REWARDS, myRewards: [] };
    await settleLastWeek().catch(e => console.error('FOOTVAULT classement de la semaine :', e.message));
    await settleSeasons().catch(e => console.error('FOOTVAULT saisons :', e.message));
    const [{ rows, period: info }, mineRewards, seasonsMine] = await Promise.all([ranking(period), myRewards(viewerId), mySeasons(viewerId)]);
    const mine = viewerId ? rows.find(r => r.id === viewerId) : null;
    const season = period === 'season' ? seasonInfo() : null;
    const seasonExtra = season ? {
      season: { number: season.number, key: season.key, upcoming: season.upcoming, start: season.start, end: season.end, weeks: SEASON.weeks, daysLeft: season.end ? Math.max(0, Math.ceil((new Date(season.end) - Date.now()) / 86400000)) : null },
      seasonRewards: SEASON.rewards, seasonPrizes: await seasonPrizes(season.number ? season.key : seasonKey(1))
    } : {};
    return {
      period, week: period === 'week' ? info : null, players: rows.length, points: RARITY_POINTS, rewards: LEADERBOARD_REWARDS, myRewards: mineRewards, mySeasons: seasonsMine, ...seasonExtra,
      top: rows.slice(0, TOP).map(r => ({ ...view(r), me: r.id === viewerId })),
      me: mine ? view(mine) : (viewerId ? { rank: null, score: 0, uniqueCards: 0, topCards: 0 } : null)
    };
  }

  // Rang d'un joueur au classement général (null s'il n'est pas classé).
  async function rankOf(userId) {
    if (!getPool() || !userId) return null;
    const row = (await ranking('all')).rows.find(r => r.id === userId);
    return row ? row.rank : null;
  }

  return { rankOf, leaderboard, settleLastWeek, settleSeasons, myRewards, claimLeaderboardReward, claimSeasonReward, adminSeasonPrizes, adminSetSeasonPrize, clearLeaderboardCache: () => cache.clear() };
}

module.exports = { createLeaderboard, RARITY_POINTS, seasonInfo, seasonWindow };
