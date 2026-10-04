'use strict';

// Logos des clubs : rapprochement des fichiers fournis, rattachement au démarrage sans écrasement,
// carte des logos pour les cartes (GET /api/club-logos), service des images (dossier club-logos/ uniquement).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, ensureTestClubs } = require('./helpers');
const { matchLogoFiles, cleanBase } = require('../scripts/import-club-logos');
const { syncClubLogos } = require('../scripts/sync-club-logos');
const { clubKey } = require('../lib/club-key');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const LOGOS_DIR = path.join(__dirname, '..', 'club-logos');

test('rapprochement des fichiers : nom du club, identifiant, alias, suffixe « logo », ambigus et inconnus', () => {
  const clubs = [{ id: 'paris-saint-germain', name: 'Paris Saint-Germain' }, { id: 'scoangers', name: 'SCO Angers' }, { id: 'a1', name: 'Real Madrid' }, { id: 'a2', name: 'Real  Madrid' }];
  assert.equal(cleanBase('Arsenal_FC logo.jpg'), 'Arsenal_FC');
  assert.equal(cleanBase('Lyon (2).png'), 'Lyon');
  const r = matchLogoFiles(['Paris Saint-Germain.jpg', 'angers sco.JPG', 'paris-saint-germain.png', 'Real Madrid.jpg', 'Inconnu FC.jpg', 'notes.txt', 'scoangers-logo.webp'], clubs);
  assert.deepEqual(r.matched.map(m => [m.file, m.club.id]), [['Paris Saint-Germain.jpg', 'paris-saint-germain'], ['angers sco.JPG', 'scoangers']]);
  assert.deepEqual(r.unmatched, ['Inconnu FC.jpg'], 'notes.txt ignoré (pas une image)');
  assert.deepEqual(r.ambiguous.sort(), ['Real Madrid.jpg', 'paris-saint-germain.png', 'scoangers-logo.webp'].sort(), 'deux clubs de même nom, ou deux fichiers pour un club');
});

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });
const q = async (sql, params) => (await server.db.query(sql, params)).rows;

test('rattachement : logo posé seulement s\'il manque ; fichier sans club ignoré ; relance sans effet', async () => {
  await ensureTestClubs(server);
  const [a, b] = await q("SELECT id FROM clubs WHERE country<>'International' ORDER BY id LIMIT 2");
  await q("UPDATE clubs SET logo_url='https://exemple.test/choisi-par-un-admin.png' WHERE id=$1", [b.id]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  for (const f of [a.id + '.png', b.id + '.jpg', 'club-inexistant.png', '.cache.png', 'notes.txt']) fs.writeFileSync(path.join(dir, f), PNG);
  const quiet = () => {};
  assert.deepEqual(await syncClubLogos(server.db, { dir, log: quiet }), { files: 3, linked: 1 });
  const rows = Object.fromEntries((await q('SELECT id,logo_url FROM clubs WHERE id=ANY($1)', [[a.id, b.id]])).map(r => [r.id, r.logo_url]));
  assert.equal(rows[a.id], 'club-logos/' + a.id + '.png');
  assert.equal(rows[b.id], 'https://exemple.test/choisi-par-un-admin.png', 'logo choisi par un admin conservé');
  assert.deepEqual(await syncClubLogos(server.db, { dir, log: quiet }), { files: 3, linked: 0 });
  assert.deepEqual(await syncClubLogos(server.db, { dir: path.join(dir, 'absent'), log: quiet }), { files: 0, linked: 0 });
});

test('GET /api/club-logos : carte par clé de club (alias compris), clubs sans logo absents', async () => {
  await ensureTestClubs(server);
  const club = (await q('SELECT id,name FROM clubs ORDER BY id LIMIT 1'))[0];
  await q('UPDATE clubs SET logo_url=NULL');
  await q("UPDATE clubs SET logo_url='club-logos/test-a.png' WHERE id=$1", [club.id]);
  const r = await fetch(server.base + '/api/club-logos');
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(body.logos), [clubKey(club.name)]);
  assert.equal(body.logos[clubKey(club.name)], 'club-logos/test-a.png');
  assert.equal(body.aliases.angerssco, 'angers', 'les alias de l\'album sont fournis au navigateur');
});

test('images : seul le dossier club-logos/ est servi, formats image uniquement, pas de remontée de dossier', async () => {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
  const names = ['_test-ci.png', '_test-ci.JPG', '_test-ci.txt'];
  try {
    for (const n of names) fs.writeFileSync(path.join(LOGOS_DIR, n), PNG);
    const get = p => fetch(server.base + p);
    const png = await get('/club-logos/_test-ci.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal((await get('/club-logos/_test-ci.JPG')).headers.get('content-type'), 'image/jpeg');
    assert.equal((await get('/club-logos/_test-ci.txt')).status, 404);
    assert.equal((await get('/club-logos/..%2Fserver.js')).status, 404);
    assert.equal((await get('/club-logos/../server.js')).status, 404);
    assert.equal((await get('/club-logos/')).status, 404);
  } finally {
    for (const n of names) fs.rmSync(path.join(LOGOS_DIR, n), { force: true });
    if (!fs.readdirSync(LOGOS_DIR).length) fs.rmdirSync(LOGOS_DIR);
  }
});
