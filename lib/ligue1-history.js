'use strict';

// Rattachement des saisons historiques de Ligue 1 (cartes « fv-h- », 2010-2011 à 2025-2026) à l'album
// et aux packs : une saison par édition présente au catalogue, et ses clubs. Les clubs existants sont
// réutilisés (même clé que l'album, lib/club-key.js) ; les autres sont créés. Uniquement des ajouts.
// Annulation : DELETE FROM competition_seasons WHERE description LIKE 'Saison Ligue 1 historique%';

const crypto = require('node:crypto');
const { clubKey } = require('./club-key');

const COMPETITION = 'ligue-1';
const slug = v => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function linkLigue1History(client) {
  if (!(await client.query('SELECT 1 FROM competitions WHERE id=$1', [COMPETITION])).rowCount) return { seasons: 0, clubs: 0, links: 0, created: 0 };
  const rows = (await client.query(
    "SELECT season, club, count(*)::int AS n FROM catalog_cards WHERE id LIKE 'fv-h-%' AND is_active AND club<>'' GROUP BY season, club ORDER BY season, n DESC, club"
  )).rows;
  if (!rows.length) return { seasons: 0, clubs: 0, links: 0, created: 0 };

  // Clubs existants par clé ; ceux déjà rattachés à la Ligue 1 sont préférés en cas d'homonymie.
  const existing = (await client.query(
    `SELECT c.id, c.name, EXISTS(SELECT 1 FROM competition_clubs cc WHERE cc.club_id=c.id AND cc.competition_id=$1) AS l1
     FROM clubs c ORDER BY l1 DESC, c.sort_order, c.id`, [COMPETITION])).rows;
  const byKey = new Map();
  for (const c of existing) if (!byKey.has(clubKey(c.name))) byKey.set(clubKey(c.name), c.id);

  let created = 0, links = 0;
  const clubIdFor = async name => {
    const key = clubKey(name);
    if (byKey.has(key)) return byKey.get(key);
    let id = slug(name).slice(0, 42) || 'club';
    if ((await client.query('SELECT 1 FROM clubs WHERE id=$1', [id])).rowCount) id = id.slice(0, 41) + '-' + crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
    const tag = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'L1';
    await client.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,'France',500)", [id, name, tag]);
    byKey.set(key, id);
    created++;
    return id;
  };

  const bySeason = new Map();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season).push(r.club);
  }
  const clubsSeen = new Set();
  for (const [season, clubs] of bySeason) {
    const year = Number(String(season).slice(0, 4)) || 2010;
    await client.query(
      `INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order)
       VALUES($1,$2,$3,$3,'available',$4,$5) ON CONFLICT(competition_id,season) DO NOTHING`,
      [COMPETITION + '-' + season, COMPETITION, season, 'Saison Ligue 1 historique ' + season, 2026 - year]);
    const seasonId = (await client.query('SELECT id FROM competition_seasons WHERE competition_id=$1 AND season=$2', [COMPETITION, season])).rows[0].id;
    const already = new Set((await client.query('SELECT c.name FROM season_clubs sc JOIN clubs c ON c.id=sc.club_id WHERE sc.season_id=$1', [seasonId])).rows.map(r => clubKey(r.name)));
    let position = already.size;
    for (const name of clubs) {
      const key = clubKey(name);
      if (already.has(key)) continue;
      already.add(key);
      const clubId = await clubIdFor(name);
      clubsSeen.add(clubId);
      await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [COMPETITION, clubId, 100 + position]);
      links += (await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [seasonId, clubId, position++])).rowCount;
    }
  }
  return { seasons: bySeason.size, clubs: clubsSeen.size, links, created };
}

module.exports = { linkLigue1History };
