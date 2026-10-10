'use strict';

// Profil joueur (GET /api/profile) : identité, collection, progression et historique.
// Lecture seule. L'historique s'appuie sur le journal des FOOTCOINS (lib/ledger.js, depuis le
// 30/09/2026) et sur les ouvertures de packs (security_events).

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'icon'];

function createProfile({ getPool, levelProgressFromXp }) {
  async function playerProfile(user) {
    const db = getPool();
    const { level, currentXp, xpToNext } = levelProgressFromXp(user.xp);
    const base = {
      name: user.name, memberSince: user.created_at || user.createdAt || null, level, currentXp, xpToNext,
      xp: Number(user.xp || 0), coins: Number(user.coins || 0), reservedCoins: Number(user.reserved_coins || 0), gems: Number(user.gems || 0),
      packsOpened: Number(user.packs_opened || 0)
    };
    if (!db) return { profile: base, collection: { cards: 0, unique: 0, rarities: [], clubs: 0, seasons: [] }, progress: {}, history: [] };
    const [col, rar, seasons, market, claims, history, best] = await Promise.all([
      db.query("SELECT count(*)::int AS cards,count(DISTINCT card_id)::int AS uniq,count(DISTINCT club)::int AS clubs FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction')", [user.id]),
      db.query("SELECT rarity,count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') GROUP BY rarity", [user.id]),
      db.query("SELECT season,count(DISTINCT card_id)::int AS n FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') GROUP BY season ORDER BY season DESC LIMIT 6", [user.id]),
      db.query(`SELECT count(*) FILTER (WHERE seller_id=$1 AND status='completed' AND current_bidder_id IS NOT NULL)::int AS sold,
                       count(*) FILTER (WHERE current_bidder_id=$1 AND status='completed')::int AS won,
                       count(*) FILTER (WHERE seller_id=$1 AND status='active')::int AS selling
                FROM auctions WHERE seller_id=$1 OR current_bidder_id=$1`, [user.id]),
      db.query(`SELECT count(*) FILTER (WHERE claim_id LIKE 'achievement:%')::int AS achievements,
                       count(*) FILTER (WHERE claim_id IN (SELECT id FROM missions))::int AS missions,
                       count(*) FILTER (WHERE claim_id LIKE 'daily:%' OR claim_id LIKE 'weekly:%')::int AS tasks,
                       count(*) FILTER (WHERE claim_id LIKE 'album%')::int AS albums
                FROM reward_claims WHERE user_id=$1`, [user.id]),
      db.query(`SELECT l.id,l.amount,l.reason,l.ref,l.created_at,
                       COALESCE(p.name, pp.name) AS pack_name, ci.name AS card_name
                FROM coin_ledger l
                LEFT JOIN pack_definitions p ON l.reason='pack' AND p.id=l.ref
                LEFT JOIN pack_pools pp ON l.reason='pool' AND pp.id=l.ref
                LEFT JOIN auctions a ON l.reason IN ('auction_buy','auction_sale') AND a.id::text=l.ref
                LEFT JOIN card_instances ci ON ci.instance_id=a.card_instance_id
                WHERE l.user_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT 30`, [user.id]),
      db.query("SELECT card_id,name,club,season,rarity,ovr FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') ORDER BY ovr DESC, acquired_at LIMIT 3", [user.id])
    ]);
    const byRarity = new Map(rar.rows.map(r => [r.rarity, r.n]));
    const c = col.rows[0], m = market.rows[0], k = claims.rows[0];
    return {
      profile: base,
      collection: {
        cards: c.cards, unique: c.uniq, clubs: c.clubs,
        rarities: RARITY_ORDER.map(r => ({ rarity: r, count: byRarity.get(r) || 0 })),
        seasons: seasons.rows.map(r => ({ season: r.season, unique: r.n })),
        best: best.rows.map(r => ({ id: r.card_id, name: r.name, club: r.club, season: r.season, rarity: r.rarity, ovr: Number(r.ovr) }))
      },
      progress: { achievements: k.achievements, missions: k.missions, tasks: k.tasks, albums: k.albums, auctionsSold: m.sold, auctionsWon: m.won, auctionsActive: m.selling },
      history: history.rows.map(h => ({
        id: Number(h.id), amount: Number(h.amount), reason: h.reason, createdAt: h.created_at,
        label: historyLabel(h)
      }))
    };
  }
  return { playerProfile };
}

// Libellé lisible d'un mouvement du journal (les références techniques ne sont pas exposées).
function historyLabel(h) {
  const ref = String(h.ref || '');
  switch (h.reason) {
    case 'signup': return 'Bonus de bienvenue';
    case 'pack': return 'Ouverture : ' + (h.pack_name || 'pack');
    case 'pool': return 'Tirage : ' + (h.pack_name || 'pool');
    case 'auction_buy': return 'Achat aux enchères' + (h.card_name ? ' : ' + h.card_name : '');
    case 'auction_sale': return 'Vente aux enchères' + (h.card_name ? ' : ' + h.card_name : '');
    case 'admin': return 'Ajustement de l’équipe FOOTVAULT';
    case 'quick_sell': return 'Vente rapide';
    case 'reward':
      if (ref === 'daily') return 'Bonus quotidien';
      if (ref.startsWith('daily:')) return 'Tâche quotidienne';
      if (ref.startsWith('weekly:')) return 'Tâche hebdomadaire';
      if (ref.startsWith('achievement:')) return 'Succès débloqué';
      if (ref.startsWith('album:')) return 'Album : club complété';
      if (ref.startsWith('album-season:')) return 'Album : saison complétée';
      if (ref.startsWith('album-competition:')) return 'Album : championnat complété';
      if (ref.startsWith('mission:')) return 'Mission accomplie';
      if (ref.startsWith('challenge:')) return 'Défi réussi';
      return 'Récompense';
    default: return 'Mouvement';
  }
}

module.exports = { createProfile, historyLabel };
