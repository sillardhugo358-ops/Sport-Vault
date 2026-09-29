'use strict';

// Import des 4 championnats européens (scripts/import-europe.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { startServer, newPlayer } = require('./helpers');
const { loadCards, importEurope } = require('../scripts/import-europe');
const { rarityFromOvr } = require('../lib/rarity');

const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];
const quiet = () => {};

test('fichier Europe : 43 781 cartes valides, postes officiels, rareté du barème', () => {
  const cards = loadCards();
  assert.equal(cards.length, 43781);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  for (const c of cards) {
    assert.ok(POSITIONS.includes(c.position), c.position);
    assert.equal(c.rarity, rarityFromOvr(c.ovr));
    assert.match(c.season, /^20\d\d-20\d\d$/);
  }
  assert.deepEqual([...new Set(cards.map(c => c.competitionId))].sort(), ['bundesliga', 'la-liga', 'premier-league', 'serie-a']);
  // Gardien : colonnes du classeur PLO, JMA, JPI, RÉF, VIT, PLA -> shooting, passing, dribbling, defending, pace, physical.
  const gk = cards.find(c => c.name === 'Gorka Iraizoz' && c.season === '2010-2011');
  assert.deepEqual([gk.position, gk.shooting, gk.passing, gk.dribbling, gk.defending, gk.pace, gk.physical], ['GK', 76, 74, 64, 78, 47, 75]);
  // Code pays (saison 2026-2027) converti en nom, comme les autres saisons.
  assert.ok(!cards.some(c => /^[A-Z]{3}$/.test(c.nation)));
});

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('import Europe : cartes, compétitions, saisons ; relance sans effet ; synchro Ligue 1 sans impact', async () => {
  const first = await importEurope(server.db, { log: quiet });
  assert.equal(first.skipped, false);
  assert.equal(first.cards, 43781);
  const count = async () => Number((await server.db.query("SELECT count(*) FROM catalog_cards WHERE id LIKE 'fv-e-%' AND is_active")).rows[0].count);
  assert.equal(await count(), 43781);
  const comps = (await server.db.query("SELECT id FROM competitions WHERE status='available' ORDER BY id")).rows.map(r => r.id);
  for (const id of ['bundesliga', 'la-liga', 'premier-league', 'serie-a']) assert.ok(comps.includes(id), id);
  const seasons = Number((await server.db.query("SELECT count(*) FROM competition_seasons WHERE id ~ '^(premier-league|la-liga|serie-a|bundesliga)-20[0-9]{2}-20[0-9]{2}$'")).rows[0].count);
  assert.equal(seasons, 68);

  // Relance : sautée (fichier inchangé), puis forcée : aucune carte en double.
  assert.equal((await importEurope(server.db, { log: quiet })).skipped, true);
  await server.db.query("UPDATE catalog_cards SET is_active=false WHERE id=(SELECT min(id) FROM catalog_cards WHERE id LIKE 'fv-e-%')");
  await importEurope(server.db, { force: true, log: quiet });
  assert.equal(await count(), 43780, 'une carte désactivée par un admin reste désactivée');
  assert.equal(Number((await server.db.query("SELECT count(*) FROM catalog_cards WHERE id LIKE 'fv-e-%'")).rows[0].count), 43781);

  // La synchro Ligue 1 2026-2027 ne désactive plus les autres championnats de la même saison.
  await new Promise((resolve, reject) => execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-ligue1-2026-27.js')],
    { env: { ...process.env, DATABASE_URL: server.databaseUrl, NODE_ENV: 'test' } }, e => e ? reject(e) : resolve()));
  assert.equal(await count(), 43780);
});

test('accueil : résumé du catalogue léger ; packs tirés dans tout le catalogue', async () => {
  const r = await fetch(server.base + '/api/catalog/summary');
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(body.cards >= 43780, String(body.cards));
  assert.equal(body.featured.length, 3);
  assert.ok(body.featured.every(c => c.ovr >= 92), 'les 3 meilleures cartes sont Icon');
  const p = await newPlayer(server, 'Europeen');
  const open = await p.post('/api/packs/open', { packId: 'starter' });
  assert.equal(open.status, 200, JSON.stringify(open.body));
  assert.equal(open.body.cards.length, 5);
});
