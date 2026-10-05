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

test('rattachement : le fichier « <id>.png » vaut aussi pour le club « ldc-<id> » (Nantes, Bordeaux, Montpellier, Parma)', async () => {
  await q("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES('ldc-test-nantes','Test Nantes','TNA','France',902) ON CONFLICT (id) DO UPDATE SET logo_url=NULL");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  fs.writeFileSync(path.join(dir, 'test-nantes.png'), PNG);
  assert.deepEqual(await syncClubLogos(server.db, { dir, log: () => {} }), { files: 1, linked: 1 });
  assert.equal((await q("SELECT logo_url FROM clubs WHERE id='ldc-test-nantes'"))[0].logo_url, 'club-logos/test-nantes.png');
  await q("DELETE FROM clubs WHERE id='ldc-test-nantes'");
});

test('GET /api/club-logos : carte par clé de club (alias compris), clubs sans logo absents', async () => {
  await ensureTestClubs(server);
  const club = (await q('SELECT id,name FROM clubs ORDER BY id LIMIT 1'))[0];
  await q('UPDATE clubs SET logo_url=NULL');
  await q("UPDATE clubs SET logo_url='club-logos/test-a.png' WHERE id=$1", [club.id]);
  const r = await fetch(server.base + '/api/club-logos');
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(clubKey(club.name) in body.logos);
  assert.equal(body.logos[clubKey(club.name)], 'club-logos/test-a.png');
  assert.equal(body.aliases.angerssco, 'angers', 'les alias de l\'album sont fournis au navigateur');
});

test('GET /api/club-logos : un fichier du dossier sert de logo même sans club en base (Dijon FCO), la base reste prioritaire', async () => {
  await q('UPDATE clubs SET logo_url=NULL');
  await q("DELETE FROM clubs WHERE name ILIKE '%dijon%'");
  const body = await (await fetch(server.base + '/api/club-logos')).json();
  assert.equal(body.logos.dijonfco, 'club-logos/dijon-fco.png', 'fichier dijon-fco.png sans ligne en base');
  assert.equal(body.fallback.dijonfco, 'club-logos/dijon-fco.png');
  assert.equal(body.logos.fcnantes, 'club-logos/fc-nantes.png', 'préfixes ldc- ignorés dans la clé');
  assert.ok(!Object.keys(body.logos).some(k => k.startsWith('selection') || k.startsWith('ldc')), 'clés sans préfixe de fichier');
  assert.equal(body.logos.france, 'club-logos/selection-france.png', 'drapeau de sélection');
  await q("INSERT INTO clubs(id,name,tag,country,sort_order,logo_url) VALUES('dijon-fco','Dijon FCO','DIJ','France',903,'https://exemple.test/choisi.png') ON CONFLICT (id) DO UPDATE SET logo_url=EXCLUDED.logo_url");
  const again = await (await fetch(server.base + '/api/club-logos')).json();
  assert.equal(again.logos.dijonfco, 'https://exemple.test/choisi.png', 'logo choisi en base prioritaire');
  assert.equal(again.fallback.dijonfco, 'club-logos/dijon-fco.png', 'le fichier reste en repli');
  await q("DELETE FROM clubs WHERE id='dijon-fco'");
});

test('GET /api/club-logos : drapeaux, noms de pays équivalents et compétition de chaque club de championnat', async () => {
  const body = await (await fetch(server.base + '/api/club-logos')).json();
  // Drapeaux : fichiers selection-<pays>, clé = nom français normalisé ; les pays ajoutés pour la pastille de nationalité sont présents.
  assert.equal(body.flags.espagne, 'club-logos/selection-espagne.png');
  assert.equal(body.flags.albanie, 'club-logos/selection-albanie.png');
  // Noms anglais et codes ramenés au français (clés normalisées).
  assert.equal(body.nations.spain, 'espagne');
  assert.equal(body.nations.alb, 'albanie');
  assert.ok(!('espagne' in body.nations), 'un nom déjà français n\'a pas d\'alias');
  // Compétition des clubs de championnat : exactement celle de la table season_clubs, jamais Ligue des Champions ni sélections.
  const rows = await q("SELECT DISTINCT c.name,cs.competition_id FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id NOT IN ('ligue-des-champions','coupe-du-monde','ligue-des-nations')");
  assert.ok(rows.length > 0, 'des clubs de championnat existent en base de test');
  for (const r of rows) assert.equal(body.leagues[clubKey(r.name)], r.competition_id, r.name);
  assert.ok(Object.values(body.leagues).every(v => !['ligue-des-champions', 'coupe-du-monde', 'ligue-des-nations'].includes(v)));
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
