'use strict';

// Import idempotent du classeur FIFA des quatre championnats.
// Usage : DATABASE_URL=... node scripts/import-four-leagues.js /chemin/classeur.xlsx

const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const { rarityFromOvr } = require('../lib/rarity');

const COMPS = {
  'Premier League': { id: 'premier-league', short: 'pl', tag: 'EPL', country: 'England', desc: 'Championnat d’Angleterre' },
  LaLiga: { id: 'laliga', short: 'll', tag: 'LL', country: 'Spain', desc: 'Championnat d’Espagne' },
  'Serie A': { id: 'serie-a', short: 'sa', tag: 'SA', country: 'Italy', desc: 'Championnat d’Italie' },
  Bundesliga: { id: 'bundesliga', short: 'bl', tag: 'BUN', country: 'Germany', desc: 'Championnat d’Allemagne' }
};
const POSITIONS = { GB:'GK', DD:'RB', DC:'CB', DG:'LB', MDC:'DM', MC:'CM', MOC:'AM', AD:'RW', AG:'LW', BU:'ST', AT:'ST', MG:'LW', MD:'RW' };
const HEADERS = { season:'Saison', competition:'Championnat', club:'Club', name:'Joueur', nation:'Nationalité', position:'Poste', ovr:'Note', pace:'VIT / PLO', shooting:'TIR / JMA', passing:'PAS / JPI', dribbling:'DRI / RÉF', defending:'DEF / VIT', physical:'PHY / PLA' };

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return String(v.text || '').trim();
  return String(v).trim();
}
function parseSeason(value) {
  const m = cellText(value).match(/^(\d{4})[/-](\d{2}|\d{4})$/);
  if (!m) throw new Error('Saison invalide : ' + value);
  const start = Number(m[1]), end = m[2].length === 2 ? Number(m[1].slice(0,2) + m[2]) : Number(m[2]);
  if (end !== start + 1) throw new Error('Saison incohérente : ' + value);
  return { season: start + '-' + end, start };
}
function intVal(value, label, row) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error('Valeur invalide (' + label + ') ligne ' + row + ' : ' + value);
  return n;
}
function slug(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-+$/g, '').slice(0, 40) || 'club';
}

async function readGroups(filePath) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(filePath);
  const sheet = book.getWorksheet('Cartes');
  if (!sheet) throw new Error('Feuille "Cartes" introuvable.');
  const headerMap = new Map();
  sheet.getRow(1).eachCell((cell, col) => headerMap.set(cellText(cell.value), col));
  for (const header of Object.values(HEADERS)) if (!headerMap.has(header)) throw new Error('Colonne absente : ' + header);

  const groups = new Map(), seenComps = new Set();
  for (let rn = 2; rn <= sheet.rowCount; rn++) {
    const row = sheet.getRow(rn);
    if (!row.hasValues) continue;
    const val = key => row.getCell(headerMap.get(HEADERS[key])).value;
    const compName = cellText(val('competition')), comp = COMPS[compName];
    if (!comp) throw new Error('Championnat inconnu ligne ' + rn + ' : ' + compName);
    const { season, start } = parseSeason(val('season'));
    const club = cellText(val('club')), name = cellText(val('name'));
    const posRaw = cellText(val('position')).toUpperCase(), position = POSITIONS[posRaw];
    if (!club || !name) throw new Error('Club ou joueur manquant ligne ' + rn);
    if (!position) throw new Error('Poste inconnu ligne ' + rn + ' : ' + posRaw);
    const ovr = intVal(val('ovr'), HEADERS.ovr, rn), key = comp.id + '|' + season;
    const group = groups.get(key) || { comp, season, start, cards: [] };
    const order = group.cards.length + 1;
    group.cards.push({
      id: 'fv-' + comp.short + '-' + start + '-' + String(order).padStart(5, '0'),
      season, name, position, jersey_number: null, club, nation: cellText(val('nation')),
      rarity: rarityFromOvr(ovr), ovr,
      pace: intVal(val('pace'), HEADERS.pace, rn), shooting: intVal(val('shooting'), HEADERS.shooting, rn),
      passing: intVal(val('passing'), HEADERS.passing, rn), dribbling: intVal(val('dribbling'), HEADERS.dribbling, rn),
      defending: intVal(val('defending'), HEADERS.defending, rn), physical: intVal(val('physical'), HEADERS.physical, rn),
      distribution_type: 'STANDARD', is_limited: false, max_supply: null,
      card_order: 1000000 + (start - 2010) * 50000 + order, is_active: true
    });
    groups.set(key, group);
    seenComps.add(compName);
  }
  if (seenComps.size !== 4 || Object.keys(COMPS).some(name => !seenComps.has(name))) {
    throw new Error('Le classeur doit contenir Premier League, LaLiga, Serie A et Bundesliga.');
  }
  return [...groups.values()];
}

async function ensureComp(client, comp, order) {
  const name = Object.keys(COMPS).find(n => COMPS[n].id === comp.id);
  await client.query(
    'INSERT INTO competitions(id,name,tag,country,description,status,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) ' +
    'ON CONFLICT(id) DO UPDATE SET name=excluded.name,tag=excluded.tag,country=excluded.country,description=excluded.description,status=excluded.status,updated_at=now()',
    [comp.id, name, comp.tag, comp.country, comp.desc, 'available', order]
  );
}
async function ensureSeason(client, comp, season, start) {
  const id = comp.id + '-' + season;
  await client.query(
    'INSERT INTO competition_seasons(id,competition_id,season,label,status,description,sort_order) VALUES($1,$2,$3,$3,$4,$5,$6) ' +
    'ON CONFLICT(competition_id,season) DO UPDATE SET label=excluded.label,status=excluded.status,description=excluded.description,sort_order=excluded.sort_order,updated_at=now()',
    [id, comp.id, season, 'available', 'Saison ' + season + ' — ' + comp.desc, start - 2010]
  );
  return (await client.query('SELECT id FROM competition_seasons WHERE competition_id=$1 AND season=$2', [comp.id, season])).rows[0].id;
}

async function ensureClub(client, name, country, order, cache) {
  if (cache.has(name)) return cache.get(name);
  let found = (await client.query('SELECT id FROM clubs WHERE name=$1', [name])).rows[0];
  if (!found) {
    const base = 'club-' + slug(name);
    const conflict = (await client.query('SELECT name FROM clubs WHERE id=$1', [base])).rows[0];
    const id = conflict && conflict.name !== name ? base + '-' + crypto.createHash('sha1').update(name).digest('hex').slice(0,8) : base;
    const tag = name.replace(/[^A-Za-z0-9]/g, '').slice(0,12).toUpperCase() || 'CLUB';
    await client.query('INSERT INTO clubs(id,name,tag,country,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING', [id,name,tag,country,order]);
    found = (await client.query('SELECT id FROM clubs WHERE name=$1', [name])).rows[0];
  }
  if (!found) throw new Error('Impossible de créer le club : ' + name);
  cache.set(name, found.id);
  return found.id;
}

async function importGroups(client, groups) {
  const compsOrder = new Map(Object.values(COMPS).map((c,i) => [c.id, i + 1]));
  const clubCache = new Map(), summary = {};
  const cols = ['id','season','name','position','jersey_number','club','nation','rarity','ovr','pace','shooting','passing','dribbling','defending','physical','distribution_type','is_limited','max_supply','card_order','is_active'];
  for (const group of groups) {
    const { comp, season, start, cards } = group;
    await ensureComp(client, comp, compsOrder.get(comp.id));
    const seasonId = await ensureSeason(client, comp, season, start);
    const clubs = [...new Set(cards.map(c => c.club))];
    for (let i = 0; i < clubs.length; i++) {
      const clubId = await ensureClub(client, clubs[i], comp.country, i, clubCache);
      await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [comp.id,clubId,i]);
      await client.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [seasonId,clubId,i]);
    }
    for (let offset = 0; offset < cards.length; offset += 400) {
      const batch = cards.slice(offset, offset + 400), args = [];
      const tuples = batch.map((card, idx) => {
        const base = idx * cols.length;
        args.push(...cols.map(col => card[col]));
        return '(' + cols.map((_, j) => '$' + (base + j + 1)).join(',') + ')';
      }).join(',');
      const sql = 'INSERT INTO catalog_cards(' + cols.join(',') + ') VALUES ' + tuples +
        ' ON CONFLICT(id) DO UPDATE SET season=excluded.season,name=excluded.name,position=excluded.position,' +
        'jersey_number=excluded.jersey_number,club=excluded.club,nation=excluded.nation,' +
        'rarity=CASE WHEN catalog_cards.rarity_locked THEN catalog_cards.rarity ELSE excluded.rarity END,' +
        'ovr=excluded.ovr,pace=excluded.pace,shooting=excluded.shooting,passing=excluded.passing,' +
        'dribbling=excluded.dribbling,defending=excluded.defending,physical=excluded.physical,' +
        'distribution_type=excluded.distribution_type,is_limited=excluded.is_limited,max_supply=excluded.max_supply,' +
        'card_order=excluded.card_order,is_active=true,updated_at=now()';
      await client.query(sql, args);
    }
    summary[comp.id + ' ' + season] = cards.length;
    console.log('[FOOTVAULT] ' + comp.id + ' ' + season + ' : ' + cards.length + ' cartes.');
  }
  return summary;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Variable DATABASE_URL manquante.');
  if (!process.argv[2]) throw new Error('Indique le chemin du classeur .xlsx en argument.');
  const groups = await readGroups(path.resolve(process.argv[2]));
  const total = groups.reduce((sum, g) => sum + g.cards.length, 0);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 2 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const summary = await importGroups(client, groups);
    await client.query('COMMIT');
    console.log('[FOOTVAULT] Import terminé : ' + total + ' cartes, ' + groups.length + ' saisons championnat.');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}
main().catch(error => { console.error('[FOOTVAULT] Import quatre championnats échoué :', error.message); process.exitCode = 1; });
