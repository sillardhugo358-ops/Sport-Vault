'use strict';

// Rattache les logos du dossier club-logos/ aux clubs : un fichier « <id du club>.jpg|png|webp » devient
// clubs.logo_url = « club-logos/<fichier> » quand le club n'a pas encore de logo. Idempotent ; ne remplace jamais
// un logo déjà renseigné (par un administrateur ou une exécution précédente) ; ne supprime rien. Le fichier
// « fc-nantes.png » vaut aussi pour le club « ldc-fc-nantes » (identifiant préfixé par l'import Ligue des Champions).
// Lancé au démarrage par ligue1-launcher.js (sans fichier, aucun effet).

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'club-logos');
const IMAGE = /^(.+)\.(jpe?g|png|webp)$/i;

function logoFiles(dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => !f.startsWith('.') && IMAGE.test(f)).map(f => ({ file: f, clubId: f.replace(IMAGE, '$1') }));
}

async function syncClubLogos(pool, { dir = DIR, log = console.log } = {}) {
  const files = logoFiles(dir);
  if (!files.length) return { files: 0, linked: 0 };
  let linked = 0;
  for (const { file, clubId } of files) {
    // Les clubs créés par l'import Ligue des Champions peuvent porter l'identifiant « ldc-<nom du fichier> ».
    const r = await pool.query("UPDATE clubs SET logo_url=$1,updated_at=now() WHERE id=ANY($2) AND (logo_url IS NULL OR logo_url='')", ['club-logos/' + file, [clubId, 'ldc-' + clubId]]);
    linked += r.rowCount;
  }
  log(`[FOOTVAULT] Logos de clubs : ${files.length} fichier(s), ${linked} rattaché(s).`);
  return { files: files.length, linked };
}

module.exports = { syncClubLogos, logoFiles };

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquante.'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool(require('../lib/db-ssl').poolConfig({max: 1}));
  syncClubLogos(pool)
    .catch(e => { console.error('[FOOTVAULT] Logos de clubs error:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
