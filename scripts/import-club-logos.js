'use strict';

// Prépare les logos de clubs fournis dans un dossier (JPG/PNG/WEBP) : chaque fichier est rapproché d'un club par son
// nom (même clé que l'album : sans accents, casse ni ponctuation, avec les alias de lib/club-key.js) puis copié vers
// club-logos/<id du club>.<ext>. Le rattachement en base se fait au démarrage (scripts/sync-club-logos.js).
//
//   DATABASE_URL=… node scripts/import-club-logos.js <dossier>            copie les fichiers reconnus
//   DATABASE_URL=… node scripts/import-club-logos.js <dossier> --dry-run  rapport seul, rien n'est copié
//   DATABASE_URL=… node scripts/import-club-logos.js --list               écrit docs/CLUBS-LOGOS.csv (clubs et sélections,
//                                                                        avec « logo : oui/non ») pour nommer les fichiers
// Un fichier déjà présent dans club-logos/ n'est remplacé qu'avec --force. Les noms de fichier peuvent être le nom du
// club (« Paris Saint-Germain.jpg », « psg-logo.png » ne sera pas reconnu : voir le rapport) ou l'identifiant du club.

const fs = require('node:fs');
const path = require('node:path');
const { clubKey } = require('../lib/club-key');

const OUT_DIR = path.join(__dirname, '..', 'club-logos');
const CSV = path.join(__dirname, '..', 'docs', 'CLUBS-LOGOS.csv');
const IMAGE = /\.(jpe?g|png|webp)$/i;

// Suffixes courants des noms de fichiers de logos (« Arsenal logo », « Arsenal_FC_badge », « Arsenal (1) »).
const cleanBase = file => file.replace(IMAGE, '').replace(/\s*\(\d+\)\s*$/, '').replace(/[ _-]+(logo|badge|crest|ecusson|écusson|blason)$/i, '').trim();

// files : noms de fichiers ; clubs : lignes { id, name } ; renvoie { matched: [{file, club}], unmatched: [file], ambiguous: [file] }.
function matchLogoFiles(files, clubs) {
  const byId = new Map(clubs.map(c => [c.id, c]));
  const byKey = new Map();
  for (const c of clubs) { const k = clubKey(c.name); byKey.set(k, [...(byKey.get(k) || []), c]); }
  const matched = [], unmatched = [], ambiguous = [], used = new Set();
  for (const file of files.filter(f => IMAGE.test(f)).sort()) {
    const base = cleanBase(file);
    const found = byId.get(base) ? [byId.get(base)] : byKey.get(clubKey(base)) || [];
    if (!found.length) unmatched.push(file);
    else if (found.length > 1) ambiguous.push(file);
    else if (used.has(found[0].id)) ambiguous.push(file);   // deux fichiers pour le même club : le premier (ordre alphabétique) gagne
    else { used.add(found[0].id); matched.push({ file, club: found[0] }); }
  }
  return { matched, unmatched, ambiguous };
}

const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

async function main() {
  const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--')));
  const dir = args.find(a => !a.startsWith('--'));
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquante.'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 1 });
  try {
    const clubs = (await pool.query("SELECT id,name,country,COALESCE(logo_url,'') AS logo_url FROM clubs ORDER BY (country='International'),country,name")).rows;
    const have = new Set(fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).map(f => f.replace(IMAGE, '')) : []);
    if (flags.has('--list')) {
      const rows = ['"id";"nom";"type";"logo"', ...clubs.map(c => [c.id, c.name, c.country === 'International' ? 'sélection' : 'club', c.logo_url || have.has(c.id) ? 'oui' : 'non'].map(csvCell).join(';'))];
      fs.writeFileSync(CSV, '﻿' + rows.join('\n') + '\n');
      console.log(`${clubs.length} clubs et sélections écrits dans docs/CLUBS-LOGOS.csv (${clubs.filter(c => !(c.logo_url || have.has(c.id))).length} sans logo).`);
      return;
    }
    if (!dir || !fs.existsSync(dir)) { console.error('Dossier des logos introuvable. Usage : node scripts/import-club-logos.js <dossier> [--dry-run] [--force]'); process.exit(1); }
    const { matched, unmatched, ambiguous } = matchLogoFiles(fs.readdirSync(dir), clubs);
    let copied = 0, skipped = 0;
    if (!flags.has('--dry-run')) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const { file, club } of matched) {
      const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg');
      const target = path.join(OUT_DIR, club.id + ext);
      if (fs.existsSync(target) && !flags.has('--force')) { skipped++; continue; }
      if (!flags.has('--dry-run')) fs.copyFileSync(path.join(dir, file), target);
      copied++;
    }
    console.log(`${matched.length} fichier(s) reconnu(s) : ${copied} ${flags.has('--dry-run') ? 'à copier' : 'copié(s)'}, ${skipped} déjà présent(s) (--force pour remplacer).`);
    if (unmatched.length) console.log(`Non reconnus (${unmatched.length}) : ${unmatched.join(', ')}`);
    if (ambiguous.length) console.log(`Ambigus ou en double (${ambiguous.length}) : ${ambiguous.join(', ')}`);
    const left = clubs.filter(c => c.country !== 'International' && !c.logo_url && !have.has(c.id) && !matched.some(m => m.club.id === c.id));
    console.log(`Clubs encore sans logo : ${left.length} (liste complète : --list).`);
  } finally { await pool.end(); }
}

module.exports = { matchLogoFiles, cleanBase };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
