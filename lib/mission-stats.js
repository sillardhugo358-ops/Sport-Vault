'use strict';

// Mesure des missions quotidiennes, hebdomadaires et mensuelles (lib/missions-catalog.js) :
// activité du joueur dans la fenêtre de la période (heure de Paris), en quelques requêtes groupées.
// Les gains (XP, niveaux, valeur Vault, albums) se comparent à un instantané pris la première fois
// que le joueur consulte ses missions dans la période (table period_snapshots) : ce qui a été gagné
// avant cette première consultation de la période n'est pas compté.

const { periodInfo, taskClaimId, parisDayKey } = require('./periods');
const { rotationFor } = require('./missions-catalog');

const DONE_KINDS = ['daily', 'weekly', 'monthly'];

// Libellés des conditions (console admin).
const MISSION_TASK_TYPES = {
  visitDays: 'Jours de connexion', dailyBonus: 'Bonus quotidiens récupérés', packsOpened: 'Packs ouverts', packsBeforeNoon: 'Packs ouverts avant midi',
  packsAfter20: 'Packs ouverts après 20 h', starterOpened: 'Starter Packs ouverts', proOpened: 'Pro Packs ouverts', allPackTypesOpened: 'Un pack de chaque type (1 = oui)',
  cardsObtained: 'Cartes obtenues', rarePlusObtained: 'Cartes Rare ou mieux obtenues', epicPlusObtained: 'Cartes Epic ou mieux obtenues',
  legendaryPlusObtained: 'Cartes Legendary ou mieux obtenues', iconObtained: 'Cartes Icon obtenues', distinctClubsObtained: 'Clubs différents obtenus',
  gkObtained: 'Gardiens obtenus', attObtained: 'Attaquants obtenus', defObtained: 'Défenseurs obtenus', midObtained: 'Milieux obtenus',
  ovr75Obtained: 'Cartes 75+ OVR obtenues', ovr80Obtained: 'Cartes 80+ OVR obtenues', ovr85Obtained: 'Cartes 85+ OVR obtenues',
  newCardsObtained: 'Nouvelles cartes (jamais possédées)', duplicateObtained: 'Doublons obtenus',
  bidsPlaced: 'Offres placées', auctionsCreated: 'Cartes mises en vente', salesDone: 'Ventes réussies', salesRarePlus: 'Ventes Rare ou mieux',
  salesEarned: 'FC gagnés en ventes', auctionsWon: 'Enchères remportées', coinsSpent: 'FC dépensés',
  xpGained: 'XP gagnés', levelsGained: 'Niveaux gagnés', vaultGain: 'Hausse de la valeur Vault (FC)', albumProgressPct: 'Progression d’un album (%)', albumsCompleted: 'Albums complétés',
  albumViews: 'Visites de l’album', cardViews: 'Fiches carte ouvertes', rankingViews: 'Visites du classement', marketViews: 'Visites du Market',
  favoritesAdded: 'Cartes ajoutées en favori', fixedMissionsClaimed: 'Missions de progression récupérées', dailyMissionsClaimed: 'Missions quotidiennes récupérées',
  weeklyMissionsClaimed: 'Missions hebdomadaires récupérées', allPeriodMissions: 'Toutes les autres missions de la période (1 = oui)', pending: 'À venir (mesure non disponible)'
};
const PAGE_VIEWS = { album: 'albumViews', card: 'cardViews', classement: 'rankingViews', market: 'marketViews' };

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });
const parisHour = d => Number(hourFmt.format(new Date(d)));

function createMissionStats({ getPool, progressSnapshot, listMissions, listTasks }) {
  // Instantané de début de période (créé une fois, puis relu).
  async function snapshotFor(user, kind, key) {
    const db = getPool();
    const existing = (await db.query('SELECT * FROM period_snapshots WHERE user_id=$1 AND kind=$2 AND period_key=$3', [user.id, kind, key])).rows[0];
    if (existing) return existing;
    const s = await progressSnapshot(user);
    await db.query(`INSERT INTO period_snapshots(user_id,kind,period_key,xp,level,vault,albums,albums_complete) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT DO NOTHING`, [user.id, kind, key, s.xp, s.level, s.vault, JSON.stringify(s.albums), s.albumsComplete]);
    return (await db.query('SELECT * FROM period_snapshots WHERE user_id=$1 AND kind=$2 AND period_key=$3', [user.id, kind, key])).rows[0];
  }

  // Valeurs de toutes les conditions pour une période { key, start, end } (lib/periods.js periodInfo).
  async function periodStats(user, kind, period) {
    const db = getPool();
    if (!db) return {};
    const args = [user.id, period.start, period.end];
    const [cards, events, visits, views, market, bids, spent, favs, claims, snap, now, missionIds] = await Promise.all([
      db.query(`SELECT ci.card_id, ci.rarity, ci.position, ci.club, ci.ovr,
          EXISTS (SELECT 1 FROM card_instances o WHERE o.owner_id=$1 AND o.card_id=ci.card_id AND o.instance_id<>ci.instance_id AND o.acquired_at<ci.acquired_at) AS had
        FROM card_instances ci WHERE ci.owner_id=$1 AND ci.status IN ('owned','auction') AND ci.source<>'welcome' AND ci.acquired_at>=$2 AND ci.acquired_at<$3`, args),
      db.query(`SELECT event, details->>'packId' AS pack, created_at FROM security_events
        WHERE user_id=$1 AND event IN ('pack_open','pool_draw','daily_reward_claim') AND created_at>=$2 AND created_at<$3`, args),
      db.query('SELECT count(*)::int AS n FROM user_visits WHERE user_id=$1 AND day>=($2::timestamptz AT TIME ZONE \'Europe/Paris\')::date AND day<($3::timestamptz AT TIME ZONE \'Europe/Paris\')::date', args),
      db.query('SELECT page, count(*)::int AS n FROM page_views WHERE user_id=$1 AND created_at>=$2 AND created_at<$3 GROUP BY page', args),
      db.query(`SELECT count(*) FILTER (WHERE a.seller_id=$1 AND a.created_at>=$2 AND a.created_at<$3)::int AS created,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND a.completed_at>=$2 AND a.completed_at<$3)::int AS sold,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND a.completed_at>=$2 AND a.completed_at<$3 AND c.rarity IN ('rare','epic','legendary','icon'))::int AS sold_rare,
          COALESCE(sum(a.current_bid) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND a.completed_at>=$2 AND a.completed_at<$3),0)::bigint AS earned,
          count(*) FILTER (WHERE a.current_bidder_id=$1 AND a.status='completed' AND a.completed_at>=$2 AND a.completed_at<$3)::int AS won
        FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.seller_id=$1 OR a.current_bidder_id=$1`, args),
      db.query('SELECT count(*)::int AS n FROM auction_bids WHERE bidder_id=$1 AND created_at>=$2 AND created_at<$3', args),
      db.query('SELECT COALESCE(-sum(amount),0)::bigint AS n FROM coin_ledger WHERE user_id=$1 AND amount<0 AND created_at>=$2 AND created_at<$3', args),
      db.query('SELECT count(*)::int AS n FROM favorite_cards WHERE user_id=$1 AND created_at>=$2 AND created_at<$3', args),
      db.query('SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claimed_at>=$2 AND claimed_at<$3', args),
      snapshotFor(user, kind, period.key),
      progressSnapshot(user),
      listMissions ? listMissions({ includeInactive: true }).then(l => new Set(l.map(m => m.id))).catch(() => new Set()) : Promise.resolve(new Set())
    ]);

    const c = cards.rows, order = { rare: 2, epic: 3, legendary: 4, icon: 5 };
    const atLeast = n => c.filter(x => (order[x.rarity] || 1) >= n).length;
    const pos = list => c.filter(x => list.includes(x.position)).length;
    const packs = events.rows.filter(e => e.event === 'pack_open' || e.event === 'pool_draw');
    const packIds = new Set(events.rows.filter(e => e.event === 'pack_open' && e.pack).map(e => e.pack));
    const viewCounts = Object.fromEntries(views.rows.map(r => [PAGE_VIEWS[r.page], r.n]).filter(([k]) => k));
    const m = market.rows[0];
    const claimIds = claims.rows.map(r => r.claim_id);
    const albumGain = Object.entries(now.albums).reduce((best, [k, pct]) => Math.max(best, pct - Number((snap.albums || {})[k] || 0)), 0);

    return {
      visitDays: visits.rows[0].n,
      dailyBonus: events.rows.filter(e => e.event === 'daily_reward_claim').length,
      packsOpened: packs.length,
      packsBeforeNoon: packs.filter(e => parisHour(e.created_at) < 12).length,
      packsAfter20: packs.filter(e => parisHour(e.created_at) >= 20).length,
      starterOpened: events.rows.filter(e => e.event === 'pack_open' && e.pack === 'starter').length,
      proOpened: events.rows.filter(e => e.event === 'pack_open' && e.pack === 'pro').length,
      allPackTypesOpened: now.packIds && now.packIds.length && now.packIds.every(id => packIds.has(id)) ? 1 : 0,
      cardsObtained: c.length, rarePlusObtained: atLeast(2), epicPlusObtained: atLeast(3), legendaryPlusObtained: atLeast(4), iconObtained: atLeast(5),
      distinctClubsObtained: new Set(c.map(x => x.club).filter(Boolean)).size,
      gkObtained: pos(['GK']), attObtained: pos(['RW', 'ST', 'LW']), defObtained: pos(['CB', 'LB', 'RB']), midObtained: pos(['DM', 'CM', 'AM']),
      ovr75Obtained: c.filter(x => Number(x.ovr) >= 75).length, ovr80Obtained: c.filter(x => Number(x.ovr) >= 80).length, ovr85Obtained: c.filter(x => Number(x.ovr) >= 85).length,
      newCardsObtained: new Set(c.filter(x => !x.had).map(x => x.card_id)).size, duplicateObtained: c.filter(x => x.had).length,
      bidsPlaced: bids.rows[0].n, auctionsCreated: m.created, salesDone: m.sold, salesRarePlus: m.sold_rare, salesEarned: Number(m.earned), auctionsWon: m.won,
      coinsSpent: Number(spent.rows[0].n),
      xpGained: Math.max(0, now.xp - Number(snap.xp)), levelsGained: Math.max(0, now.level - Number(snap.level)), vaultGain: Math.max(0, now.vault - Number(snap.vault)),
      albumProgressPct: Math.max(0, albumGain), albumsCompleted: Math.max(0, now.albumsComplete - Number(snap.albums_complete)),
      albumViews: viewCounts.albumViews || 0, cardViews: viewCounts.cardViews || 0, rankingViews: viewCounts.rankingViews || 0, marketViews: viewCounts.marketViews || 0,
      favoritesAdded: favs.rows[0].n,
      fixedMissionsClaimed: claimIds.filter(id => missionIds.has(id)).length,
      dailyMissionsClaimed: claimIds.filter(id => id.startsWith('daily:')).length,
      weeklyMissionsClaimed: claimIds.filter(id => id.startsWith('weekly:')).length,
      pending: 0
    };
  }

  // Jour de visite (mission « Connecte-toi ») : une écriture par joueur et par jour au plus,
  // depuis chaque requête authentifiée (server.js), sans jamais bloquer ni faire échouer la requête.
  const visited = new Map();
  function recordVisit(userId) {
    const day = parisDayKey(), db = getPool();
    if (!db || visited.get(userId) === day) return;
    visited.set(userId, day);
    if (visited.size > 50000) visited.clear();
    db.query('INSERT INTO user_visits(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId, day])
      .catch(e => { visited.delete(userId); console.error('FOOTVAULT visite :', e.message); });
  }

  // Page consultée (album, fiche carte, classement, Market) : au plus une par page toutes les 3 s
  // et 300 par jour et par joueur, pour qu'un script ne remplisse pas la table.
  const lastView = new Map();
  async function recordPageView(userId, page) {
    if (!PAGE_VIEWS[page]) return { error: 'Page inconnue.', status: 400 };
    const db = getPool();
    if (!db) return { ok: true };
    const k = userId + ':' + page, now = Date.now();
    if (now - (lastView.get(k) || 0) < 3000) return { ok: true, counted: false };
    lastView.set(k, now);
    if (lastView.size > 50000) lastView.clear();
    const r = await db.query(`INSERT INTO page_views(user_id,page) SELECT $1,$2
      WHERE (SELECT count(*) FROM page_views WHERE user_id=$1 AND created_at>now()-interval '1 day')<300 RETURNING id`, [userId, page]);
    return { ok: true, counted: r.rowCount > 0 };
  }

  // Tirage de la période, enregistré au premier affichage (table period_rotations) : il ne change
  // plus jusqu'à la période suivante, même si une mission est ajoutée dans la console. Une mission
  // tirée puis désactivée disparaît ; une mission ajoutée entre dans le tirage suivant.
  async function drawFor(kind, key) {
    const active = (await listTasks(kind)).filter(t => t.type !== 'pending');
    const db = getPool();
    if (!db) return rotationFor(kind, key, active);
    let row = (await db.query('SELECT task_ids FROM period_rotations WHERE kind=$1 AND period_key=$2', [kind, key])).rows[0];
    if (!row) {
      const ids = rotationFor(kind, key, active).map(t => t.id);
      await db.query('INSERT INTO period_rotations(kind,period_key,task_ids) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [kind, key, JSON.stringify(ids)]);
      row = (await db.query('SELECT task_ids FROM period_rotations WHERE kind=$1 AND period_key=$2', [kind, key])).rows[0];
    }
    const ids = new Set(row.task_ids);
    return active.filter(t => ids.has(t.id));
  }

  // Missions proposées au joueur pour la période en cours : sélection tournante, progression,
  // état terminé / récupéré. Sert à l'affichage, à la récupération et aux notifications.
  async function periodMissions(user, kind, claimed, date = new Date()) {
    const period = periodInfo(kind, date);
    const drawn = await drawFor(kind, period.key);
    if (!drawn.length) return { period, tasks: [] };
    const stats = getPool() ? await periodStats(user, kind, period) : {};
    if (!claimed && getPool()) claimed = new Set((await getPool().query('SELECT claim_id FROM reward_claims WHERE user_id=$1 AND claim_id LIKE $2',
      [user.id, kind + ':' + period.key + ':%'])).rows.map(r => r.claim_id));
    const has = t => claimed ? claimed.has(taskClaimId(kind, period.key, t.id)) : false;
    const tasks = drawn.map(t => {
      const value = t.type === 'allPeriodMissions' ? drawn.filter(o => o.id !== t.id && has(o)).length : Number(stats[t.type] || 0);
      const target = t.type === 'allPeriodMissions' ? Math.max(1, drawn.length - 1) : t.target;
      return { ...t, target, progress: Math.min(value, target), completed: value >= target, claimed: has(t), period: period.key };
    });
    return { period, tasks };
  }

  return { periodStats, periodMissions, drawFor, recordVisit, recordPageView };
}

module.exports = { createMissionStats, MISSION_TASK_TYPES, PAGE_VIEWS, DONE_KINDS };
