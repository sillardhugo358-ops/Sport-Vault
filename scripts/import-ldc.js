'use strict';

// Import de la Ligue des Champions (saisons 1991-92 à 2025-26) depuis data/ldc-1991-2026.json.gz,
// généré par scripts/build-ldc-data.py à partir du classeur fourni (notes du classeur conservées).
//
// - Identifiants stables « fv-c-… » : relancer l'import met à jour les mêmes cartes, sans doublon.
// - Saison des cartes « LDC 1991-92 » : une carte de Ligue des Champions est distincte de la carte
//   de championnat du même joueur, et l'album (qui rapproche saison + club) ne mélange pas les deux.
// - Rareté calculée par le barème officiel (lib/rarity.js), jamais celle du classeur.
// - Une carte désactivée par un admin reste désactivée ; les cartes retirées du fichier sont
//   désactivées, jamais supprimées.
// - Clubs réutilisés par nom normalisé (logo, album des championnats) ; les autres sont créés.
// - Import sauté si le fichier n'a pas changé depuis le dernier import réussi (table data_imports).
// Annulation : UPDATE catalog_cards SET is_active=false WHERE id LIKE 'fv-c-%';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { rarityFromOvr } = require('../lib/rarity');
const { normName } = require('../lib/club-key');

const DATA_FILE = path.join(__dirname, '..', 'data', 'ldc-1991-2026.json.gz');
const IMPORT_ID = 'ldc-1991-2026';
const EXPECTED_CARDS = 21446;
const COMPETITION = 'ligue-des-champions';
const FIRST_YEAR = 1991;
const BASE_ORDER = 40000000;
const BATCH = 1000;
const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];

// Noms corrigés depuis la première version du fichier : l'identifiant d'une carte reste calculé avec l'ancien nom (identifiants stables,
// exemplaires et albums intacts) et le club déjà en base est renommé sur place (voir ensureStructure).
const LEGACY_CLUB_NAMES = { 'FC Košice': 'FC Kosicee' };

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// « LDC 1991-92 » (11 caractères : competition_seasons.season est limité à 12).
const seasonOf = key => 'LDC ' + key.slice(0, 4) + '-' + key.slice(7);

function loadData(buffer = fs.readFileSync(DATA_FILE)) {
  const doc = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  const cards = doc.rows.map((r, i) => {
    const [season, clubIndex, name, position, ovr, pace, shooting, passing, dribbling, defending, physical, playerId, n, nation] = r;
    const club = doc.clubs[clubIndex];
    const stats = [ovr, pace, shooting, passing, dribbling, defending, physical];
    if (!/^\d{4}-\d{4}$/.test(season) || !club || !name || !POSITIONS.includes(position) || stats.some(v => !Number.isInteger(v) || v < 1 || v > 99)) throw new Error('Ligne invalide n°' + (i + 1));
    const key = [season, LEGACY_CLUB_NAMES[club] || club, name, playerId || ''].join('|');
    return {
      id: 'fv-c-' + crypto.createHash('sha1').update(n > 1 ? key + '|' + n : key).digest('hex').slice(0, 16),
      season: seasonOf(season), seasonKey: season, club, name, nation: nation || '', position,
      rarity: rarityFromOvr(ovr), ovr, pace, shooting, passing, dribbling, defending, physical,
      order: BASE_ORDER + i,
    };
  });
  if (new Set(cards.map(c => c.id)).size !== cards.length) throw new Error('Collision d\'identifiants.');
  return { cards, clubs: doc.clubs, seasons: doc.seasons };
}

async function ensureStructure(client, { cards, clubs, seasons }) {
  await client.query("UPDATE competitions SET status='available',updated_at=now() WHERE id=$1", [COMPETITION]);
  // Club corrigé : la ligne existante est renommée (même identifiant, même logo) au lieu d'en créer une seconde.
  for (const [name, legacy] of Object.entries(LEGACY_CLUB_NAMES)) {
    await client.query('UPDATE clubs SET name=$1,updated_at=now() WHERE name=$2 AND NOT EXISTS (SELECT 1 FROM clubs WHERE name=$1)', [name, legacy]);
  }
  const existing = new Map();
  for (const r of (await client.query('SELECT id,name FROM clubs ORDER BY sort_order,id')).rows) if (!existing.has(normName(r.name))) existing.set(normName(r.name), r);
  const clubIds = new Map();
  let created = 0;
  for (const name of clubs) {
    let row = existing.get(normName(name));
    if (!row) {
      let id = 'ldc-' + (slug(name).slice(0, 40) || 'club');
      if ((await client.query('SELECT 1 FROM clubs WHERE id=$1', [id])).rows.length) id = id.slice(0, 31) + '-' + crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
      const tag = slug(name).replace(/-/g, '').slice(0, 3).toUpperCase() || 'CLB';
      row = (await client.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,'Europe',$4) RETURNING id,name", [id, name, tag, 700 + created])).rows[0];
      existing.set(normName(name), row);
      created++;
    }
    clubIds.set(name, row.id);
  }
  let pos = 0;
  for (const name of clubs) await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [COMPETITION, clubIds.get(name), pos++]);
  for (const [key, clubIndexes] of seasons) {
    const id = COMPETITION + '-' + key;
    await client.query(`INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$4,'available',$5,$6)
      ON CONFLICT(competition_id,season) DO UPDATE SET status='available',updated_at=now()`,
    [id, COMPETITION, seasonOf(key), 'Saison ' + key, 'Ligue des Champions ' + key, Number(key.slice(0, 4)) - FIRST_YEAR]);
    const seasonId = (await client.query('SELECT id FROM competition_seasons WHERE competition_id=$1 AND season=$2', [COMPETITION, seasonOf(key)])).rows[0].id;
    for (let i = 0; i < clubIndexes.length; i++) await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [seasonId, clubIds.get(clubs[clubIndexes[i]]), i]);
  }
  return { clubs: clubs.length, newClubs: created, seasons: seasons.length };
}

async function upsertCards(client, cards) {
  const cols = ['id', 'season', 'name', 'position', 'club', 'nation', 'rarity', 'ovr', 'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'card_order'];
  const types = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'];
  const pick = { card_order: 'order' };
  for (let i = 0; i < cards.length; i += BATCH) {
    const chunk = cards.slice(i, i + BATCH);
    const arrays = cols.map(c => chunk.map(card => card[pick[c] || c]));
    await client.query(`INSERT INTO catalog_cards(${cols.join(',')},distribution_type,is_limited,max_supply,is_active)
      SELECT *,'STANDARD',false,NULL::int,true FROM unnest(${types.map((t, j) => `$${j + 1}::${t}[]`).join(',')})
      ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,club=excluded.club,nation=excluded.nation,
        rarity=CASE WHEN catalog_cards.rarity_locked THEN catalog_cards.rarity ELSE excluded.rarity END,ovr=excluded.ovr,pace=excluded.pace,
        shooting=excluded.shooting,passing=excluded.passing,dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,
        card_order=excluded.card_order,updated_at=now()`, arrays);
  }
}

async function importLdc(pool, { force = false, log = console.log } = {}) {
  const buffer = fs.readFileSync(DATA_FILE);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const data = loadData(buffer);
  if (data.cards.length !== EXPECTED_CARDS) throw new Error('Fichier Ligue des Champions invalide : ' + data.cards.length + ' cartes.');
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS data_imports(id varchar(80) PRIMARY KEY,checksum varchar(64) NOT NULL,cards integer NOT NULL,imported_at timestamptz NOT NULL DEFAULT now())');
    const done = (await client.query('SELECT checksum FROM data_imports WHERE id=$1', [IMPORT_ID])).rows[0];
    if (done?.checksum === checksum && !force) { log(`[FOOTVAULT] Import Ligue des Champions déjà à jour (${data.cards.length} cartes).`); return { skipped: true, cards: data.cards.length }; }
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [IMPORT_ID]);
    const structure = await ensureStructure(client, data);
    await upsertCards(client, data.cards);
    const retired = await client.query("UPDATE catalog_cards SET is_active=false,updated_at=now() WHERE id LIKE 'fv-c-%' AND is_active AND NOT (id = ANY($1::text[]))", [data.cards.map(c => c.id)]);
    const synced = await client.query(`UPDATE card_instances ci SET season=cc.season,name=cc.name,position=cc.position,club=cc.club,nation=cc.nation,rarity=cc.rarity,
      ovr=cc.ovr,pace=cc.pace,shooting=cc.shooting,passing=cc.passing,dribbling=cc.dribbling,defending=cc.defending,physical=cc.physical
      FROM catalog_cards cc WHERE ci.card_id=cc.id AND cc.id LIKE 'fv-c-%'`);
    await client.query(`INSERT INTO data_imports(id,checksum,cards) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum,cards=excluded.cards,imported_at=now()`, [IMPORT_ID, checksum, data.cards.length]);
    await client.query('COMMIT');
    log(`[FOOTVAULT] Import Ligue des Champions : ${data.cards.length} cartes, ${structure.clubs} clubs (${structure.newClubs} créés), ${structure.seasons} saisons ; ${retired.rowCount} retirées, ${synced.rowCount} exemplaires resynchronisés.`);
    return { skipped: false, cards: data.cards.length, ...structure, retired: retired.rowCount };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

module.exports = { loadData, importLdc, EXPECTED_CARDS, LEGACY_CLUB_NAMES };

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquante.'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 1 });
  importLdc(pool, { force: process.argv.includes('--force') })
    .catch(e => { console.error('[FOOTVAULT] Import Ligue des Champions error:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
