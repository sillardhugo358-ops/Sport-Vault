'use strict';

// Import des cartes Premier League, LaLiga, Serie A et Bundesliga (2010-2011 à 2026-2027)
// depuis data/europe-2010-2027.json.gz (généré à partir du classeur
// cartes_FIFA_2010-11_a_2026-27.xlsx).
//
// - Identifiants stables « fv-e-… » (compétition, saison, club, nom, date de naissance) :
//   relancer l'import met à jour les mêmes cartes, sans doublon.
// - Rareté calculée par le barème officiel (lib/rarity.js), sauf cartes à rareté verrouillée.
// - Une carte désactivée par un admin reste désactivée.
// - Import sauté si le fichier n'a pas changé depuis le dernier import réussi (table data_imports).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { rarityFromOvr } = require('../lib/rarity');
const { frenchNation } = require('../lib/nations');

const DATA_FILE = path.join(__dirname, '..', 'data', 'europe-2010-2027.json.gz');
const IMPORT_ID = 'europe-2010-2027';
const COMPETITIONS = {
  'premier-league': { name: 'Premier League', tag: 'PL', country: 'Angleterre', sort: 1 },
  'la-liga': { name: 'La Liga', tag: 'LL', country: 'Espagne', sort: 4 },
  'serie-a': { name: 'Serie A', tag: 'SA', country: 'Italie', sort: 2 },
  'bundesliga': { name: 'Bundesliga', tag: 'BL', country: 'Allemagne', sort: 3 },
};
const EXPECTED_CARDS = 43781;
const BATCH = 1000;

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const seasonLabel = y => `${y}-${y + 1}`;

function loadCards(buffer = fs.readFileSync(DATA_FILE)) {
  const doc = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  const seen = new Set();
  const cards = doc.rows.map((r, i) => {
    const [comp, year, club, name, nation, birth, position, ovr, pace, shooting, passing, dribbling, defending, physical] = r;
    const competitionId = doc.competitions[comp];
    const clubName = doc.clubs[club];
    const season = seasonLabel(year);
    const key = [competitionId, season, clubName, name, birth].join('|');
    if (seen.has(key)) throw new Error('Carte en double dans le fichier : ' + key);
    seen.add(key);
    const stats = [ovr, pace, shooting, passing, dribbling, defending, physical].map(Number);
    if (!name || !clubName || !COMPETITIONS[competitionId] || stats.some(v => !Number.isInteger(v) || v < 1 || v > 99)) throw new Error('Ligne invalide n°' + (i + 1));
    return {
      id: 'fv-e-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16),
      competitionId, season, club: clubName, name, nation: frenchNation(doc.nations[nation]), position,
      rarity: rarityFromOvr(stats[0]), ovr: stats[0], pace: stats[1], shooting: stats[2], passing: stats[3],
      dribbling: stats[4], defending: stats[5], physical: stats[6],
      // Ordre : saison, puis ordre du classeur (club, poste).
      order: 10000000 + (year - 2010) * 100000 + i % 100000,
    };
  });
  const ids = new Set(cards.map(c => c.id));
  if (ids.size !== cards.length) throw new Error('Collision d\'identifiants.');
  return cards;
}

async function ensureStructure(client, cards) {
  const seasons = new Map(), clubs = new Map();
  for (const c of cards) {
    const seasonId = c.competitionId + '-' + c.season;
    if (!seasons.has(seasonId)) seasons.set(seasonId, { competitionId: c.competitionId, season: c.season, clubs: [] });
    const s = seasons.get(seasonId);
    if (!s.clubs.includes(c.club)) s.clubs.push(c.club);
    if (!clubs.has(c.club)) clubs.set(c.club, c.competitionId);
  }
  for (const [id, comp] of Object.entries(COMPETITIONS)) {
    await client.query(`INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES($1,$2,$3,$4,$5,'available',$6)
      ON CONFLICT(id) DO UPDATE SET status='available',updated_at=now()`, [id, comp.name, comp.tag, comp.country, 'Championnat ' + comp.name, comp.sort]);
  }
  const clubIds = new Map();
  let pos = 0;
  for (const [name, competitionId] of clubs) {
    let row = (await client.query('SELECT id FROM clubs WHERE lower(name)=lower($1) LIMIT 1', [name])).rows[0];
    if (!row) {
      let id = slug(name).slice(0, 42) || 'club';
      if ((await client.query('SELECT 1 FROM clubs WHERE id=$1', [id])).rows.length) id = id.slice(0, 41) + '-' + crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
      const tag = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || COMPETITIONS[competitionId].tag;
      row = (await client.query('INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id', [id, name, tag, COMPETITIONS[competitionId].country, pos])).rows[0];
    }
    clubIds.set(name, row.id);
    await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [competitionId, row.id, pos++]);
  }
  for (const [seasonId, s] of seasons) {
    const year = Number(s.season.slice(0, 4));
    await client.query(`INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$4,'available',$5,$6)
      ON CONFLICT(competition_id,season) DO UPDATE SET status='available',updated_at=now()`,
      [seasonId, s.competitionId, s.season, 'Saison ' + s.season, 'Saison ' + COMPETITIONS[s.competitionId].name + ' ' + s.season, year - 2010]);
    const actualId = (await client.query('SELECT id FROM competition_seasons WHERE competition_id=$1 AND season=$2', [s.competitionId, s.season])).rows[0].id;
    for (let i = 0; i < s.clubs.length; i++) await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [actualId, clubIds.get(s.clubs[i]), i]);
  }
  return { seasons: seasons.size, clubs: clubs.size };
}

async function upsertCards(client, cards) {
  const cols = ['id', 'season', 'name', 'position', 'club', 'nation', 'rarity', 'ovr', 'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'card_order'];
  const types = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'];
  const pick = { card_order: 'order' };
  for (let i = 0; i < cards.length; i += BATCH) {
    const chunk = cards.slice(i, i + BATCH);
    const arrays = cols.map(c => chunk.map(card => card[pick[c] || c]));
    await client.query(`INSERT INTO catalog_cards(${cols.join(',')},jersey_number,distribution_type,is_limited,max_supply,is_active)
      SELECT *,NULL::int,'STANDARD',false,NULL::int,true FROM unnest(${types.map((t, j) => `$${j + 1}::${t}[]`).join(',')})
      ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,club=excluded.club,nation=excluded.nation,
        rarity=CASE WHEN catalog_cards.rarity_locked THEN catalog_cards.rarity ELSE excluded.rarity END,ovr=excluded.ovr,pace=excluded.pace,
        shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,
        card_order=excluded.card_order,updated_at=now()`, arrays);
  }
}

async function importEurope(pool, { force = false, log = console.log } = {}) {
  const buffer = fs.readFileSync(DATA_FILE);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const cards = loadCards(buffer);
  if (cards.length !== EXPECTED_CARDS) throw new Error('Fichier Europe invalide : ' + cards.length + ' cartes.');
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS data_imports(id varchar(80) PRIMARY KEY,checksum varchar(64) NOT NULL,cards integer NOT NULL,imported_at timestamptz NOT NULL DEFAULT now())');
    const done = (await client.query('SELECT checksum FROM data_imports WHERE id=$1', [IMPORT_ID])).rows[0];
    if (done?.checksum === checksum && !force) { log(`[FOOTVAULT] Import Europe déjà à jour (${cards.length} cartes).`); return { skipped: true, cards: cards.length }; }
    await client.query('BEGIN');
    // Un seul import à la fois (plusieurs instances au démarrage).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [IMPORT_ID]);
    const structure = await ensureStructure(client, cards);
    await upsertCards(client, cards);
    // Cartes retirées du fichier depuis l'import précédent : désactivées, jamais supprimées.
    const retired = await client.query("UPDATE catalog_cards SET is_active=false,updated_at=now() WHERE id LIKE 'fv-e-%' AND is_active AND NOT (id = ANY($1::text[]))", [cards.map(c => c.id)]);
    const synced = await client.query(`UPDATE card_instances ci SET season=cc.season,name=cc.name,position=cc.position,club=cc.club,nation=cc.nation,rarity=cc.rarity,
      ovr=cc.ovr,pace=cc.pace,shooting=cc.shooting,passing=cc.passing,dribbling=cc.dribbling,defending=cc.defending,physical=cc.physical
      FROM catalog_cards cc WHERE ci.card_id=cc.id AND cc.id LIKE 'fv-e-%'`);
    await client.query(`INSERT INTO data_imports(id,checksum,cards) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum,cards=excluded.cards,imported_at=now()`, [IMPORT_ID, checksum, cards.length]);
    await client.query('COMMIT');
    log(`[FOOTVAULT] Import Europe : ${cards.length} cartes, ${structure.clubs} clubs, ${structure.seasons} saisons ; ${retired.rowCount} retirées, ${synced.rowCount} exemplaires resynchronisés.`);
    return { skipped: false, cards: cards.length, ...structure, retired: retired.rowCount };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

module.exports = { loadCards, importEurope };

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquante.'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 1 });
  importEurope(pool, { force: process.argv.includes('--force') })
    .catch(e => { console.error('[FOOTVAULT] Import Europe error:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
