'use strict';

// Affine les postes des cartes Coupe du monde / Ligue des Nations (data/international-2026.json.gz).
// Les classeurs d'origine ne donnent que DF / MF / FW : sans le côté, un défenseur reste CB et un attaquant ST.
// Ce script rapproche chaque CB / ST d'un joueur de championnat ou de Ligue des Champions déjà présent dans
// le catalogue (même nom ET même sélection nationale) et reprend son poste précis (RB, LB, RW, LW) quand
// il est sans ambiguïté. Rien n'est inventé : sans correspondance unique, le poste ne change pas.
//
// Usage : DATABASE_URL=... node scripts/refine-international-positions.js [--write]
//   sans --write : rapport à sec (comptages) ; avec --write : réécrit le fichier de données et docs/POSTES-CDM-LDN.csv.
// Après --write, l'import suivant (checksum du fichier modifié) met à jour les cartes et leurs exemplaires.
// Annulation : git checkout data/international-2026.json.gz.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { normName } = require('../lib/club-key');

const DATA_FILE = path.join(__dirname, '..', 'data', 'international-2026.json.gz');
const REPORT_FILE = path.join(__dirname, '..', 'docs', 'POSTES-CDM-LDN.csv');
const REFINES = { CB: ['RB', 'LB'], ST: ['RW', 'LW'] };
const COL = { team: 2, name: 3, position: 4 };

// refs : [{ name, nation, position }] cartes de référence (hors Coupe du monde / Ligue des Nations).
function refinePositions(doc, refs) {
  const index = new Map();
  for (const ref of refs) {
    const key = normName(ref.name) + '|' + normName(ref.nation);
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(ref.position);
  }
  const changes = [];
  doc.rows.forEach((row, i) => {
    const allowed = REFINES[row[COL.position]];
    if (!allowed) return;
    const found = index.get(normName(row[COL.name]) + '|' + normName(doc.teams[row[COL.team]]));
    if (!found) return;
    const hits = allowed.filter(p => found.has(p));
    if (hits.length !== 1) return;            // aucune correspondance, ou RB et LB à la fois : on ne devine pas
    changes.push({ line: i, competition: row[0], season: row[1], team: doc.teams[row[COL.team]], name: row[COL.name], from: row[COL.position], to: hits[0] });
    row[COL.position] = hits[0];
  });
  return changes;
}

async function main() {
  const write = process.argv.includes('--write');
  const { Pool } = require('pg');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: refs } = await pool.query(`SELECT name, nation, position FROM catalog_cards
      WHERE is_active AND id NOT LIKE 'fv-w-%' AND id NOT LIKE 'fv-n-%' AND position IN ('RB','LB','RW','LW') AND nation <> ''`);
    const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(DATA_FILE)).toString('utf8'));
    const candidates = doc.rows.filter(r => REFINES[r[COL.position]]).length;
    const changes = refinePositions(doc, refs);
    const by = {};
    for (const c of changes) by[c.to] = (by[c.to] || 0) + 1;
    console.log(`Cartes de référence : ${refs.length} ; candidates (CB/ST) : ${candidates} ; postes affinés : ${changes.length}`, by);
    if (!write) return console.log('Rapport à sec : rien n\'est écrit (ajouter --write).');
    fs.writeFileSync(DATA_FILE, zlib.gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }));
    const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    fs.writeFileSync(REPORT_FILE, ['compétition,édition,sélection,joueur,poste avant,poste après', ...changes.map(c => [c.competition, c.season, c.team, c.name, c.from, c.to].map(esc).join(','))].join('\n') + '\n');
    console.log('Écrit :', DATA_FILE, 'et', REPORT_FILE);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { refinePositions };
