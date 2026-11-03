'use strict';

// Club de cœur : un club par saison de classement (lib/leaderboard.js), choix gratuit, sans aucune récompense en FC.
// Premier choix possible à tout moment ; changement possible seulement pendant les HEART_CLUB.changeDays premiers jours de la saison.
// Classement des clubs : somme, sur les supporters du club, des cartes différentes de ce club qu'ils possèdent (statut owned).

const { HEART_CLUB } = require('./game-config');
const { clubKey } = require('./club-key');
const { seasonInfo } = require('./leaderboard');

const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const DAY = 86400000;

function createHeartClub({ getPool, now = () => new Date() }) {
  const db = () => getPool();
  let clubsCache = { at: 0, byKey: new Map() };

  // Clubs du catalogue actif, regroupés par clé (deux noms de même clé = un seul club) ; le nom affiché est le plus fréquent.
  async function clubs(force = false) {
    if (!force && Date.now() - clubsCache.at < HEART_CLUB.cacheMs && clubsCache.byKey.size) return clubsCache.byKey;
    const rows = (await db().query('SELECT club, count(*)::int AS n FROM catalog_cards WHERE is_active=true AND club IS NOT NULL AND club<>$1 GROUP BY club', [''])).rows;
    const byKey = new Map();
    for (const r of rows) {
      const k = clubKey(r.club);
      if (!k) continue;
      const e = byKey.get(k) || { key: k, name: r.club, best: 0, names: [], cards: 0 };
      e.names.push(r.club); e.cards += r.n;
      if (r.n > e.best) { e.best = r.n; e.name = r.club; }
      byKey.set(k, e);
    }
    for (const [k, e] of byKey) if (e.cards < HEART_CLUB.minCards) byKey.delete(k);
    clubsCache = { at: Date.now(), byKey };
    return byKey;
  }

  const seasonOf = () => {
    const s = seasonInfo(now());
    return { key: s.number ? s.key : 'season-0', start: s.start, upcoming: s.upcoming };
  };
  const canChange = (season, row) => !row || season.upcoming || now().getTime() < new Date(season.start).getTime() + HEART_CLUB.changeDays * DAY;

  async function mine(userId) {
    const season = seasonOf();
    const row = (await db().query('SELECT club_key,club_name,chosen_at FROM heart_clubs WHERE user_id=$1 AND season=$2', [userId, season.key])).rows[0] || null;
    return { season: season.key, club: row ? { key: row.club_key, name: row.club_name, chosenAt: row.chosen_at } : null, canChange: canChange(season, row),
      changeUntil: season.upcoming ? null : new Date(new Date(season.start).getTime() + HEART_CLUB.changeDays * DAY).toISOString() };
  }

  async function choose(userId, keyRaw) {
    const key = clubKey(keyRaw);
    const known = (await clubs()).get(key);
    if (!key || !known) return fail('Club inconnu.', 404);
    const season = seasonOf();
    const cur = (await db().query('SELECT club_key FROM heart_clubs WHERE user_id=$1 AND season=$2', [userId, season.key])).rows[0];
    if (cur && cur.club_key === key) return { ...(await mine(userId)), unchanged: true };
    if (!canChange(season, cur)) return fail('Ton club de cœur ne peut plus changer cette saison : rendez-vous à la prochaine.', 403, { locked: true });
    // Garde-fou de concurrence : l'insertion et la mise à jour restent atomiques, une seule ligne par joueur et par saison.
    await db().query(`INSERT INTO heart_clubs(user_id,season,club_key,club_name) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,season) DO UPDATE SET club_key=EXCLUDED.club_key,club_name=EXCLUDED.club_name,chosen_at=now()`, [userId, season.key, key, known.name]);
    return mine(userId);
  }

  async function ranking(userId) {
    const season = seasonOf(), byKey = await clubs();
    const fans = (await db().query('SELECT user_id,club_key FROM heart_clubs WHERE season=$1', [season.key])).rows;
    const stat = new Map();
    for (const f of fans) { const e = stat.get(f.club_key) || { fans: 0, cards: 0 }; e.fans++; stat.set(f.club_key, e); }
    if (fans.length) {
      const names = new Set();
      for (const k of stat.keys()) for (const n of byKey.get(k)?.names || []) names.add(n);
      const owned = (await db().query(`SELECT ci.owner_id,cc.club,count(DISTINCT ci.card_id)::int AS n FROM card_instances ci
        JOIN catalog_cards cc ON cc.id=ci.card_id AND cc.is_active=true
        WHERE ci.owner_id = ANY($1::uuid[]) AND ci.status='owned' AND cc.club = ANY($2::text[]) GROUP BY ci.owner_id,cc.club`, [fans.map(f => f.user_id), [...names]])).rows;
      const clubOfFan = new Map(fans.map(f => [f.user_id, f.club_key]));
      for (const o of owned) if (clubKey(o.club) === clubOfFan.get(o.owner_id)) stat.get(clubOfFan.get(o.owner_id)).cards += o.n;
    }
    const list = [...stat.entries()].map(([key, s]) => ({ key, name: byKey.get(key)?.name || key, fans: s.fans, cards: s.cards, pool: byKey.get(key)?.cards || 0 }))
      .sort((a, b) => b.cards - a.cards || b.fans - a.fans || a.name.localeCompare(b.name, 'fr')).slice(0, HEART_CLUB.top).map((r, i) => ({ rank: i + 1, ...r }));
    return { season: season.key, clubs: list, mine: await mine(userId) };
  }

  async function search(q) {
    const t = clubKey(q);
    if (t.length < 2) return { clubs: [] };
    const find = byKey => [...byKey.values()].filter(c => c.key.includes(t)).sort((a, b) => b.cards - a.cards).slice(0, 20).map(c => ({ key: c.key, name: c.name, cards: c.cards }));
    let list = find(await clubs());
    // Rien de trouvé : un club ajouté depuis le dernier chargement doit être cherchable sans attendre la fin du cache (rechargement au plus toutes les 5 s).
    if (!list.length && Date.now() - clubsCache.at > HEART_CLUB.refreshMs) list = find(await clubs(true));
    return { clubs: list };
  }

  return { mine, choose, ranking, search };
}

module.exports = { createHeartClub };
