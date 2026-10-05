'use strict';

// Import de la Coupe du monde (1930-2026) et de la Ligue des Nations (phases finales 2019-2025)
// depuis data/international-2026.json.gz, généré par scripts/build-international-data.py
// à partir des deux classeurs fournis (notes de la Coupe du monde relevées par la courbe LIFT, Ligue des Nations inchangée).
//
// - Identifiants stables « fv-w-… » (Coupe du monde) et « fv-n-… » (Ligue des Nations) : relancer
//   l'import met à jour les mêmes cartes, sans doublon.
// - Rareté calculée par le barème officiel (lib/rarity.js), jamais celle du classeur.
// - Une carte désactivée par un admin reste désactivée ; les cartes retirées du fichier sont
//   désactivées, jamais supprimées.
// - Chaque sélection nationale est un « club » de la compétition (noms en français, lib/nations.js).
// - Import sauté si le fichier n'a pas changé depuis le dernier import réussi (table data_imports).
// Annulation : UPDATE catalog_cards SET is_active=false WHERE id LIKE 'fv-w-%' OR id LIKE 'fv-n-%';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { rarityFromOvr } = require('../lib/rarity');
const { frenchNation } = require('../lib/nations');

const DATA_FILE = path.join(__dirname, '..', 'data', 'international-2026.json.gz');
const IMPORT_ID = 'international-2026';
const EXPECTED_CARDS = 12586;
const BATCH = 1000;
const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];
const COMPETITIONS = {
  'coupe-du-monde': { name: 'Coupe du Monde', tag: 'CDM', country: 'International', sort: 6, prefix: 'fv-w-', base: 20000000, first: 1930 },
  'ligue-des-nations': { name: 'Ligue des Nations', tag: 'LN', country: 'Europe', sort: 7, prefix: 'fv-n-', base: 30000000, first: 2018 },
};
const LABEL = { 'coupe-du-monde': 'Édition ', 'ligue-des-nations': 'Phase finale ' };

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function loadCards(buffer = fs.readFileSync(DATA_FILE)) {
  const doc = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  const seen = new Map();
  const cards = doc.rows.map((r, i) => {
    const [competitionId, season, teamIndex, name, position, number, age, ovr, pace, shooting, passing, dribbling, defending, physical] = r;
    const comp = COMPETITIONS[competitionId];
    const team = frenchNation(doc.teams[teamIndex]);
    const stats = [ovr, pace, shooting, passing, dribbling, defending, physical].map(Number);
    if (!comp || !name || !team || !POSITIONS.includes(position) || stats.some(v => !Number.isInteger(v) || v < 1 || v > 99)) throw new Error('Ligne invalide n°' + (i + 1));
    // Deux joueurs de même nom dans une même sélection et édition (ex. Gary Stevens, 1986) : compteur dans la clé.
    const base = [competitionId, season, team, name].join('|');
    const dup = seen.get(base) || 0;
    seen.set(base, dup + 1);
    return {
      id: comp.prefix + crypto.createHash('sha1').update(dup ? base + '|' + (dup + 1) : base).digest('hex').slice(0, 16),
      competitionId, season, club: team, name, nation: team, position,
      jerseyNumber: Number.isInteger(number) && number > 0 && number < 100 ? number : null, age: age ?? null,
      rarity: rarityFromOvr(stats[0]), ovr: stats[0], pace: stats[1], shooting: stats[2], passing: stats[3],
      dribbling: stats[4], defending: stats[5], physical: stats[6],
      order: comp.base + i,
    };
  });
  const ids = new Set(cards.map(c => c.id));
  if (ids.size !== cards.length) throw new Error('Collision d\'identifiants.');
  return cards;
}

async function ensureStructure(client, cards) {
  const seasons = new Map(), teams = new Map();
  for (const c of cards) {
    const key = c.competitionId + '|' + c.season;
    if (!seasons.has(key)) seasons.set(key, { competitionId: c.competitionId, season: c.season, clubs: [] });
    const s = seasons.get(key);
    if (!s.clubs.includes(c.club)) s.clubs.push(c.club);
    if (!teams.has(c.club)) teams.set(c.club, new Set());
    teams.get(c.club).add(c.competitionId);
  }
  for (const [id, comp] of Object.entries(COMPETITIONS)) {
    await client.query(`INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES($1,$2,$3,$4,$5,'available',$6)
      ON CONFLICT(id) DO UPDATE SET status='available',updated_at=now()`, [id, comp.name, comp.tag, comp.country, comp.name, comp.sort]);
  }
  const clubIds = new Map();
  let pos = 0;
  for (const [name, competitionIds] of teams) {
    let row = (await client.query('SELECT id FROM clubs WHERE lower(name)=lower($1) ORDER BY sort_order,id LIMIT 1', [name])).rows[0];
    if (!row) {
      let id = 'selection-' + (slug(name).slice(0, 40) || 'equipe');
      if ((await client.query('SELECT 1 FROM clubs WHERE id=$1', [id])).rows.length) id = id.slice(0, 31) + '-' + crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
      const tag = slug(name).replace(/-/g, '').slice(0, 3).toUpperCase() || 'SEL';
      row = (await client.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,'International',$4) RETURNING id", [id, name, tag, 600 + pos])).rows[0];
    }
    clubIds.set(name, row.id);
    for (const competitionId of competitionIds) {
      await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [competitionId, row.id, pos]);
    }
    pos++;
  }
  for (const s of seasons.values()) {
    const year = Number(s.season.slice(0, 4));
    const comp = COMPETITIONS[s.competitionId];
    await client.query(`INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$4,'available',$5,$6)
      ON CONFLICT(competition_id,season) DO UPDATE SET status='available',updated_at=now()`,
      [s.competitionId + '-' + s.season, s.competitionId, s.season, LABEL[s.competitionId] + s.season, comp.name + ' ' + s.season, year - comp.first]);
    const seasonId = (await client.query('SELECT id FROM competition_seasons WHERE competition_id=$1 AND season=$2', [s.competitionId, s.season])).rows[0].id;
    for (let i = 0; i < s.clubs.length; i++) {
      await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [seasonId, clubIds.get(s.clubs[i]), i]);
    }
  }
  return { seasons: seasons.size, clubs: teams.size };
}

async function upsertCards(client, cards) {
  const cols = ['id', 'season', 'name', 'position', 'club', 'nation', 'rarity', 'ovr', 'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'jersey_number', 'card_order'];
  const types = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'];
  const pick = { card_order: 'order', jersey_number: 'jerseyNumber' };
  for (let i = 0; i < cards.length; i += BATCH) {
    const chunk = cards.slice(i, i + BATCH);
    const arrays = cols.map(c => chunk.map(card => card[pick[c] || c]));
    await client.query(`INSERT INTO catalog_cards(${cols.join(',')},distribution_type,is_limited,max_supply,is_active)
      SELECT *,'STANDARD',false,NULL::int,true FROM unnest(${types.map((t, j) => `$${j + 1}::${t}[]`).join(',')})
      ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,club=excluded.club,nation=excluded.nation,
        rarity=CASE WHEN catalog_cards.rarity_locked THEN catalog_cards.rarity ELSE excluded.rarity END,ovr=excluded.ovr,pace=excluded.pace,
        shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,
        jersey_number=excluded.jersey_number,card_order=excluded.card_order,updated_at=now()`, arrays);
  }
}

async function importInternational(pool, { force = false, log = console.log } = {}) {
  const buffer = fs.readFileSync(DATA_FILE);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const cards = loadCards(buffer);
  if (cards.length !== EXPECTED_CARDS) throw new Error('Fichier international invalide : ' + cards.length + ' cartes.');
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS data_imports(id varchar(80) PRIMARY KEY,checksum varchar(64) NOT NULL,cards integer NOT NULL,imported_at timestamptz NOT NULL DEFAULT now())');
    const done = (await client.query('SELECT checksum FROM data_imports WHERE id=$1', [IMPORT_ID])).rows[0];
    if (done?.checksum === checksum && !force) { log(`[FOOTVAULT] Import international déjà à jour (${cards.length} cartes).`); return { skipped: true, cards: cards.length }; }
    await client.query('BEGIN');
    // Un seul import à la fois (plusieurs instances au démarrage).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [IMPORT_ID]);
    const structure = await ensureStructure(client, cards);
    await upsertCards(client, cards);
    const retired = await client.query("UPDATE catalog_cards SET is_active=false,updated_at=now() WHERE (id LIKE 'fv-w-%' OR id LIKE 'fv-n-%') AND is_active AND NOT (id = ANY($1::text[]))", [cards.map(c => c.id)]);
    const synced = await client.query(`UPDATE card_instances ci SET season=cc.season,name=cc.name,position=cc.position,club=cc.club,nation=cc.nation,rarity=cc.rarity,
      ovr=cc.ovr,pace=cc.pace,shooting=cc.shooting,passing=cc.passing,dribbling=cc.dribbling,defending=cc.defending,physical=cc.physical
      FROM catalog_cards cc WHERE ci.card_id=cc.id AND (cc.id LIKE 'fv-w-%' OR cc.id LIKE 'fv-n-%')`);
    await client.query(`INSERT INTO data_imports(id,checksum,cards) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum,cards=excluded.cards,imported_at=now()`, [IMPORT_ID, checksum, cards.length]);
    await client.query('COMMIT');
    log(`[FOOTVAULT] Import international : ${cards.length} cartes, ${structure.clubs} sélections, ${structure.seasons} éditions ; ${retired.rowCount} retirées, ${synced.rowCount} exemplaires resynchronisés.`);
    return { skipped: false, cards: cards.length, ...structure, retired: retired.rowCount };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

module.exports = { loadCards, importInternational, EXPECTED_CARDS };

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquante.'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool(require('../lib/db-ssl').poolConfig({max: 1}));
  importInternational(pool, { force: process.argv.includes('--force') })
    .catch(e => { console.error('[FOOTVAULT] Import international error:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
