'use strict';

// Mesures des succès (lib/achievements-catalog.js) : toutes les valeurs d'un joueur en une passe
// de requêtes groupées, pour la liste (/api/achievements) comme pour la récupération (même calcul,
// donc aucune récompense possible sur une mesure différente de celle affichée).
// Cartes comptées : celles que le joueur possède (y compris en vente aux enchères).

const { clubKey } = require('./club-key');

// Valeur Vault d'une carte selon sa rareté (même barème que l'affichage, app.js rarityValue).
const VAULT_VALUES = { common: 100, rare: 300, epic: 700, legendary: 1800, icon: 4500 };
const VALUE_SQL = `CASE c.rarity WHEN 'icon' THEN 4500 WHEN 'legendary' THEN 1800 WHEN 'epic' THEN 700 WHEN 'rare' THEN 300 ELSE 100 END`;
const CURRENT_LIGUE1 = '2026-2027';
const DAY = 86400000;

// Libellés des conditions (console admin).
const ACHIEVEMENT_TYPES = {
  cards: 'Cartes possédées', uniqueCards: 'Cartes différentes', maxCopies: 'Exemplaires d’une même carte', catalogPct: '% du catalogue (cartes différentes)',
  rareCount: 'Cartes Rare', epicCount: 'Cartes Epic', legendaryCount: 'Cartes Legendary', iconCount: 'Cartes Icon',
  rarePlus: 'Cartes Rare ou mieux', epicPlus: 'Cartes Epic ou mieux', legendaryPlus: 'Cartes Legendary ou mieux', iconPlus: 'Cartes Icon (Icon ou mieux)',
  rainbowMin: 'Cartes de chaque rareté (minimum)',
  distinctClubs: 'Clubs différents', maxSameClub: 'Cartes d’un même club', ligue1Clubs: 'Clubs de Ligue 1 2026-2027',
  albumMaxPct: '% du meilleur album de club', albumsComplete: 'Albums de club complétés', allAlbums: 'Tous les albums complétés (1 = oui)',
  distinctNations: 'Nations différentes', distinctSeasons: 'Saisons différentes', allSeasons: 'Toutes les saisons (1 = oui)',
  goalkeepers: 'Gardiens', defenders: 'Défenseurs (CB, LB, RB)', midfielders: 'Milieux (DM, CM, AM)', attackers: 'Attaquants (RW, ST, LW)', distinctPositions: 'Postes différents',
  pace95: 'Joueur de champ 95+ Vitesse', shooting95: 'Joueur de champ 95+ Tir', passing95: 'Joueur de champ 95+ Passe', dribbling95: 'Joueur de champ 95+ Dribble',
  defending95: 'Joueur de champ 95+ Défense', physical95: 'Joueur de champ 95+ Physique', allStats80: 'Carte 80+ dans les 6 attributs', maxOvr: 'Meilleur OVR', statSpread: 'Écart max entre attributs',
  packs: 'Packs ouverts', allPackTypes: 'Chaque pack de la boutique ouvert (1 = oui)', packSpend: 'FC dépensés en packs', starterLegendary: 'Legendary+ dans un Starter',
  starterIcon: 'Icon dans un Starter', bestPackRare: 'Rare+ dans un même pack', bestPackLegendary: 'Legendary+ dans un même pack', dryStreak: 'Packs d’affilée sans Rare+',
  auctionsCreated: 'Cartes mises aux enchères', bidsPlaced: 'Offres placées', auctionsWon: 'Enchères remportées', salesDone: 'Ventes réussies',
  soldRarePlus: 'Ventes Rare ou mieux', soldEpicPlus: 'Ventes Epic ou mieux', soldLegendaryPlus: 'Ventes Legendary ou mieux', soldIcon: 'Ventes Icon',
  salesEarned: 'FC gagnés en ventes', goodDeal: 'Achats 30 % sous la valeur Vault', recordSale: 'Ventes à plus de 2 × la valeur Vault',
  lastSecondWin: 'Victoires avec une offre dans les 10 dernières secondes', maxBidsOneAuction: 'Offres sur une même enchère', activeAuctions: 'Ventes en cours simultanées',
  level: 'Niveau', xp: 'XP cumulés', coins: 'Solde FC', vaultValue: 'Valeur Vault', maxCardValue: 'Valeur de la meilleure carte',
  registered: 'Compte créé', accountDays: 'Jours depuis l’inscription', dailyStreak: 'Bonus quotidiens d’affilée', dailyClaims: 'Bonus quotidiens récupérés',
  missionsCompleted: 'Missions et tâches récupérées', weeklyCompleted: 'Tâches hebdomadaires récupérées', perfectDays: 'Journées parfaites', perfectWeeks: 'Semaines parfaites',
  achievementsClaimed: 'Succès récupérés', allOthers: 'Tous les autres succès (1 = oui)',
  nightOwl: 'Pack ouvert entre 2 h et 5 h', earlyBird: 'Pack ouvert entre 5 h et 7 h', newYear: 'Connexion un 1er janvier', friday13: 'Pack ouvert un vendredi 13',
  valenciennes: 'Cartes de Valenciennes FC', jerseyTwins: 'Cartes au même numéro', jersey10: 'Cartes n° 10', goalkeepersNumber1: 'Gardiens n° 1',
  palindromeOvr: 'Cartes à OVR palindrome', ovr99: 'Cartes à 99 OVR', ovr77: 'Cartes à 77 OVR', initials: 'Initiales différentes',
  legendarySameClub: 'Legendary+ d’un même club', comeback: 'Retour après 30 jours d’absence', noSaleDays: 'Jours sans vente', radin: '100 000 FC gardés 7 jours sans dépense',
  bigSpendDay: 'FC dépensés en un jour', pending: 'À venir (mesure non disponible)'
};

// Heure, jour et date à Paris d'un instant.
const parisFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
function paris(date) {
  const p = Object.fromEntries(parisFmt.formatToParts(new Date(date)).map(x => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, month: Number(p.month), day: Number(p.day), hour: Number(p.hour), weekday: p.weekday };
}
// Plus longue suite de jours consécutifs (clés AAAA-MM-JJ).
function longestStreak(keys) {
  const days = [...new Set(keys)].map(k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10))).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev !== null && d - prev === DAY ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
const initialOf = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);

function createAchievementStats({ getPool, levelProgressFromXp, listMissions }) {
  // Données communes à tous les joueurs, gardées 60 s (catalogue, albums, packs, tâches).
  let shared = { at: 0, data: null };
  async function sharedData(db) {
    if (shared.data && Date.now() - shared.at < 60000) return shared.data;
    const [cat, seasons, albums, ligue1, packs, tasks] = await Promise.all([
      db.query('SELECT count(*)::int AS n FROM catalog_cards WHERE is_active=true'),
      db.query('SELECT count(DISTINCT season)::int AS n FROM catalog_cards WHERE is_active=true'),
      db.query('SELECT season,club,count(*)::int AS total FROM catalog_cards WHERE is_active=true GROUP BY season,club'),
      db.query("SELECT c.name FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id='ligue-1' AND cs.season=$1", [CURRENT_LIGUE1]),
      db.query('SELECT id FROM pack_definitions WHERE active=true AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())'),
      db.query('SELECT kind,count(*)::int AS n FROM period_tasks WHERE active=true GROUP BY kind')
    ]);
    // Plusieurs graphies d'un même club dans une saison : additionnées sous la même clé.
    const merged = new Map();
    for (const r of albums.rows) { const k = r.season + '|' + clubKey(r.club); merged.set(k, (merged.get(k) || 0) + r.total); }
    const taskCount = Object.fromEntries(tasks.rows.map(r => [r.kind, r.n]));
    shared = { at: Date.now(), data: {
      catalogCards: cat.rows[0].n, catalogSeasons: seasons.rows[0].n, albums: merged,
      ligue1Keys: new Set(ligue1.rows.map(r => clubKey(r.name))), packIds: packs.rows.map(r => r.id),
      dailyTasks: taskCount.daily || 0, weeklyTasks: taskCount.weekly || 0
    } };
    return shared.data;
  }

  async function userAchievementStats(user) {
    const db = getPool();
    const userId = user.id;
    if (!db) return { cards: 0, registered: 1 };
    const OWNED = "owner_id=$1 AND status IN ('owned','auction')";
    const [sh, agg, maxima, initials, owned, events, packGroups, money, market, bidStats, claims, missionIds] = await Promise.all([
      sharedData(db),
      db.query(`SELECT count(*)::int AS cards, count(DISTINCT card_id)::int AS uniq, count(DISTINCT club)::int AS clubs, count(DISTINCT nation)::int AS nations,
          count(DISTINCT season)::int AS seasons, count(DISTINCT position)::int AS positions,
          count(*) FILTER (WHERE rarity='common')::int AS common, count(*) FILTER (WHERE rarity='rare')::int AS rare, count(*) FILTER (WHERE rarity='epic')::int AS epic,
          count(*) FILTER (WHERE rarity='legendary')::int AS legendary, count(*) FILTER (WHERE rarity='icon')::int AS icon,
          count(*) FILTER (WHERE position='GK')::int AS gk, count(*) FILTER (WHERE position IN ('CB','LB','RB'))::int AS def,
          count(*) FILTER (WHERE position IN ('DM','CM','AM'))::int AS mid, count(*) FILTER (WHERE position IN ('RW','ST','LW'))::int AS att,
          COALESCE(max(ovr),0)::int AS max_ovr,
          count(*) FILTER (WHERE position<>'GK' AND pace>=95)::int AS pace95, count(*) FILTER (WHERE position<>'GK' AND shooting>=95)::int AS shooting95,
          count(*) FILTER (WHERE position<>'GK' AND passing>=95)::int AS passing95, count(*) FILTER (WHERE position<>'GK' AND dribbling>=95)::int AS dribbling95,
          count(*) FILTER (WHERE position<>'GK' AND defending>=95)::int AS defending95, count(*) FILTER (WHERE position<>'GK' AND physical>=95)::int AS physical95,
          count(*) FILTER (WHERE least(pace,shooting,passing,dribbling,defending,physical)>=80)::int AS all80,
          COALESCE(max(greatest(pace,shooting,passing,dribbling,defending,physical)-least(pace,shooting,passing,dribbling,defending,physical)),0)::int AS spread,
          count(*) FILTER (WHERE ovr BETWEEN 11 AND 99 AND ovr%11=0)::int AS palindrome, count(*) FILTER (WHERE ovr>=99)::int AS ovr99, count(*) FILTER (WHERE ovr=77)::int AS ovr77,
          count(*) FILTER (WHERE lower(club) LIKE 'valenciennes%')::int AS valenciennes, count(*) FILTER (WHERE jersey_number=10)::int AS j10,
          count(*) FILTER (WHERE position='GK' AND jersey_number=1)::int AS gk1
        FROM card_instances WHERE ${OWNED}`, [userId]),
      db.query(`SELECT
          (SELECT COALESCE(max(n),0)::int FROM (SELECT count(*) AS n FROM card_instances WHERE ${OWNED} GROUP BY card_id) s) AS copies,
          (SELECT COALESCE(max(n),0)::int FROM (SELECT count(*) AS n FROM card_instances WHERE ${OWNED} GROUP BY club) s) AS same_club,
          (SELECT COALESCE(max(n),0)::int FROM (SELECT count(*) AS n FROM card_instances WHERE ${OWNED} AND jersey_number IS NOT NULL GROUP BY jersey_number) s) AS same_jersey,
          (SELECT COALESCE(max(n),0)::int FROM (SELECT count(*) AS n FROM card_instances WHERE ${OWNED} AND rarity IN ('legendary','icon') GROUP BY club) s) AS legend_club`, [userId]),
      db.query(`SELECT DISTINCT left(name,3) AS n FROM card_instances WHERE ${OWNED}`, [userId]),
      db.query(`SELECT cc.season, cc.club, count(DISTINCT cc.id)::int AS owned FROM card_instances ci JOIN catalog_cards cc ON cc.id=ci.card_id AND cc.is_active=true
        WHERE ci.owner_id=$1 AND ci.status IN ('owned','auction') GROUP BY cc.season, cc.club`, [userId]),
      db.query(`SELECT event, details->>'packId' AS pack, created_at FROM security_events
        WHERE user_id=$1 AND event IN ('pack_open','pool_draw','login_success','daily_reward_claim','registration_success') ORDER BY created_at, id`, [userId]),
      db.query(`SELECT source, count(*) FILTER (WHERE rarity IN ('rare','epic','legendary','icon'))::int AS rare_plus,
          count(*) FILTER (WHERE rarity IN ('legendary','icon'))::int AS legend_plus, count(*) FILTER (WHERE rarity='icon')::int AS icons
        FROM card_instances WHERE ${OWNED} AND (source LIKE 'pack:%' OR source LIKE 'pool:%') GROUP BY source, acquired_at ORDER BY acquired_at`, [userId]),
      db.query(`SELECT COALESCE(-sum(amount) FILTER (WHERE reason IN ('pack','pool')),0)::bigint AS pack_spend,
          COALESCE(max(day_spend),0)::bigint AS day_spend,
          count(*) FILTER (WHERE amount<0 AND created_at > now() - interval '7 days')::int AS spent_week
        FROM (SELECT amount, reason, created_at, -sum(amount) FILTER (WHERE amount<0 AND reason IN ('pack','pool','auction_buy'))
                OVER (PARTITION BY (created_at AT TIME ZONE 'Europe/Paris')::date) AS day_spend
              FROM coin_ledger WHERE user_id=$1) l`, [userId]),
      db.query(`SELECT count(*) FILTER (WHERE a.seller_id=$1)::int AS created,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='active' AND a.ends_at>now())::int AS active,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL)::int AS sold,
          COALESCE(sum(a.current_bid) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL),0)::bigint AS earned,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.rarity IN ('rare','epic','legendary','icon'))::int AS sold_rare,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.rarity IN ('epic','legendary','icon'))::int AS sold_epic,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.rarity IN ('legendary','icon'))::int AS sold_legend,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND c.rarity='icon')::int AS sold_icon,
          count(*) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL AND a.current_bid > 2*${VALUE_SQL})::int AS record,
          max(COALESCE(a.completed_at,a.ends_at)) FILTER (WHERE a.seller_id=$1 AND a.status='completed' AND a.current_bidder_id IS NOT NULL) AS last_sale,
          count(*) FILTER (WHERE a.current_bidder_id=$1 AND a.status='completed')::int AS won,
          count(*) FILTER (WHERE a.current_bidder_id=$1 AND a.status='completed' AND a.current_bid <= 0.7*${VALUE_SQL})::int AS good,
          count(*) FILTER (WHERE a.current_bidder_id=$1 AND a.status='completed' AND EXISTS (SELECT 1 FROM auction_bids b WHERE b.auction_id=a.id AND b.bidder_id=$1 AND b.amount=a.current_bid AND b.remaining_ms IS NOT NULL AND b.remaining_ms<=10000))::int AS last_second
        FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id WHERE a.seller_id=$1 OR a.current_bidder_id=$1`, [userId]),
      db.query(`SELECT count(*)::int AS bids, COALESCE(max(n),0)::int AS max_one FROM (SELECT auction_id, count(*) OVER (PARTITION BY auction_id) AS n FROM auction_bids WHERE bidder_id=$1) b`, [userId]),
      db.query('SELECT claim_id FROM reward_claims WHERE user_id=$1', [userId]),
      listMissions ? listMissions({ includeInactive: true }).then(l => new Set(l.map(m => m.id))).catch(() => new Set()) : Promise.resolve(new Set())
    ]);

    const a = agg.rows[0], m = maxima.rows[0], mk = market.rows[0], mo = money.rows[0];
    const counts = { common: a.common, rare: a.rare, epic: a.epic, legendary: a.legendary, icon: a.icon };
    const vaultValue = Object.entries(counts).reduce((s, [r, n]) => s + n * VAULT_VALUES[r], 0);
    const maxCardValue = Object.entries(counts).filter(([, n]) => n > 0).reduce((s, [r]) => Math.max(s, VAULT_VALUES[r]), 0);

    // Albums (saison × club) : meilleur pourcentage et albums complets.
    const ownedByAlbum = new Map();
    const ownedSeasons = new Set(), ownedL1 = new Set();
    for (const r of owned.rows) {
      const k = r.season + '|' + clubKey(r.club);
      ownedByAlbum.set(k, (ownedByAlbum.get(k) || 0) + r.owned);
      ownedSeasons.add(String(r.season));
      if (String(r.season) === CURRENT_LIGUE1 && sh.ligue1Keys.has(clubKey(r.club))) ownedL1.add(clubKey(r.club));
    }
    let albumMaxPct = 0, albumsComplete = 0;
    for (const [k, n] of ownedByAlbum) {
      const total = sh.albums.get(k) || 0;
      if (!total) continue;
      albumMaxPct = Math.max(albumMaxPct, Math.floor(Math.min(n, total) / total * 100));
      if (n >= total) albumsComplete++;
    }
    const uniqueActive = owned.rows.reduce((s, r) => s + r.owned, 0);

    // Événements : packs (heures, types), connexions, bonus quotidiens.
    let nightOwl = 0, earlyBird = 0, friday13 = 0, newYear = 0, comeback = 0;
    const packTypes = new Set(), dailyDays = [];
    let lastLogin = null;
    for (const e of events.rows) {
      const p = paris(e.created_at);
      if (e.event === 'pack_open' || e.event === 'pool_draw') {
        if (e.event === 'pack_open' && e.pack) packTypes.add(e.pack);
        if (p.hour >= 2 && p.hour < 5) nightOwl = 1;
        if (p.hour >= 5 && p.hour < 7) earlyBird = 1;
        if (p.day === 13 && p.weekday === 'Fri') friday13 = 1;
      } else if (e.event === 'login_success' || e.event === 'registration_success') {
        if (p.month === 1 && p.day === 1) newYear = 1;
        const t = new Date(e.created_at).getTime();
        if (lastLogin !== null && t - lastLogin >= 30 * DAY) comeback = 1;
        lastLogin = t;
      } else if (e.event === 'daily_reward_claim') {
        dailyDays.push(p.key);
        if (p.month === 1 && p.day === 1) newYear = 1;
      }
    }

    // Packs reconstitués à partir des cartes possédées (même ouverture = même source et même instant).
    let bestPackRare = 0, bestPackLegendary = 0, dryStreak = 0, dry = 0, starterLegendary = 0, starterIcon = 0;
    for (const g of packGroups.rows) {
      bestPackRare = Math.max(bestPackRare, g.rare_plus);
      bestPackLegendary = Math.max(bestPackLegendary, g.legend_plus);
      if (g.source === 'pack:starter') { if (g.legend_plus) starterLegendary = 1; if (g.icons) starterIcon = 1; }
      dry = g.rare_plus ? 0 : dry + 1;
      dryStreak = Math.max(dryStreak, dry);
    }

    // Récompenses récupérées : succès, tâches quotidiennes/hebdo, missions de progression.
    let achievementsClaimed = 0, weeklyCompleted = 0, dailyTasks = 0, missionClaims = 0;
    const perDay = new Map(), perWeek = new Map();
    for (const { claim_id: id } of claims.rows) {
      if (id.startsWith('achievement:')) achievementsClaimed++;
      else if (/^daily:\d{4}-\d{2}-\d{2}:/.test(id)) { dailyTasks++; const d = id.slice(6, 16); perDay.set(d, (perDay.get(d) || 0) + 1); }
      else if (/^weekly:\d{4}-\d{2}-\d{2}:/.test(id)) { weeklyCompleted++; const w = id.slice(7, 17); perWeek.set(w, (perWeek.get(w) || 0) + 1); }
      else if (missionIds.has(id)) missionClaims++;
    }
    const perfectDays = sh.dailyTasks ? [...perDay.values()].filter(n => n >= sh.dailyTasks).length : 0;
    const perfectWeeks = sh.weeklyTasks ? [...perWeek.values()].filter(n => n >= sh.weeklyTasks).length : 0;

    const createdAt = new Date(user.created_at || user.createdAt || Date.now()).getTime();
    const accountDays = Math.floor((Date.now() - createdAt) / DAY);
    const lastSale = mk.last_sale ? new Date(mk.last_sale).getTime() : createdAt;
    const coins = Number(user.coins || 0), xp = Number(user.xp || 0);
    const inits = new Set(initials.rows.map(r => initialOf(r.n)).filter(Boolean));

    return {
      cards: a.cards, uniqueCards: a.uniq, maxCopies: m.copies,
      catalogPct: sh.catalogCards ? Math.floor(uniqueActive / sh.catalogCards * 100) : 0,
      rareCount: a.rare, epicCount: a.epic, legendaryCount: a.legendary, iconCount: a.icon,
      rarePlus: a.rare + a.epic + a.legendary + a.icon, epicPlus: a.epic + a.legendary + a.icon, legendaryPlus: a.legendary + a.icon, iconPlus: a.icon,
      rainbowMin: Math.min(a.common, a.rare, a.epic, a.legendary, a.icon),
      distinctClubs: a.clubs, maxSameClub: m.same_club, ligue1Clubs: ownedL1.size,
      albumMaxPct, albumsComplete, allAlbums: sh.albums.size && albumsComplete >= sh.albums.size ? 1 : 0,
      distinctNations: a.nations, distinctSeasons: a.seasons, allSeasons: sh.catalogSeasons && ownedSeasons.size >= sh.catalogSeasons ? 1 : 0,
      goalkeepers: a.gk, defenders: a.def, midfielders: a.mid, attackers: a.att, distinctPositions: a.positions,
      pace95: a.pace95, shooting95: a.shooting95, passing95: a.passing95, dribbling95: a.dribbling95, defending95: a.defending95, physical95: a.physical95,
      allStats80: a.all80, maxOvr: a.max_ovr, statSpread: a.spread,
      packs: Number(user.packs_opened || 0), allPackTypes: sh.packIds.length && sh.packIds.every(id => packTypes.has(id)) ? 1 : 0,
      packSpend: Number(mo.pack_spend), starterLegendary, starterIcon, bestPackRare, bestPackLegendary, dryStreak,
      auctionsCreated: mk.created, bidsPlaced: bidStats.rows[0].bids, auctionsWon: mk.won, salesDone: mk.sold,
      soldRarePlus: mk.sold_rare, soldEpicPlus: mk.sold_epic, soldLegendaryPlus: mk.sold_legend, soldIcon: mk.sold_icon,
      salesEarned: Number(mk.earned), goodDeal: mk.good, recordSale: mk.record, lastSecondWin: mk.last_second,
      maxBidsOneAuction: bidStats.rows[0].max_one, activeAuctions: mk.active,
      level: levelProgressFromXp(xp).level, xp, coins, vaultValue, maxCardValue,
      registered: 1, accountDays, dailyStreak: longestStreak(dailyDays), dailyClaims: dailyDays.length,
      missionsCompleted: dailyTasks + weeklyCompleted + missionClaims, weeklyCompleted, perfectDays, perfectWeeks, achievementsClaimed,
      nightOwl, earlyBird, newYear, friday13, valenciennes: a.valenciennes, jerseyTwins: m.same_jersey, jersey10: a.j10, goalkeepersNumber1: a.gk1,
      palindromeOvr: a.palindrome, ovr99: a.ovr99, ovr77: a.ovr77, initials: inits.size, legendarySameClub: m.legend_club,
      comeback, noSaleDays: Math.floor((Date.now() - lastSale) / DAY),
      radin: coins >= 100000 && accountDays >= 7 && mo.spent_week === 0 ? 1 : 0, bigSpendDay: Number(mo.day_spend),
      pending: 0
    };
  }

  // Progression de chaque succès ; « tous les autres succès » dépend de la liste elle-même.
  function achievementProgress(list, stats, claimed) {
    const others = list.filter(x => x.type !== 'allOthers' && x.type !== 'pending');
    const allOthers = others.length && others.every(x => claimed.has(x.id)) ? 1 : 0;
    return list.map(x => {
      const value = x.type === 'allOthers' ? allOthers : Number(stats[x.type] || 0);
      return { value, completed: x.type !== 'pending' && value >= Number(x.target) };
    });
  }

  return { userAchievementStats, achievementProgress };
}

module.exports = { createAchievementStats, ACHIEVEMENT_TYPES, VAULT_VALUES, longestStreak };
