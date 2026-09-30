'use strict';

// Saisons historiques de Ligue 1 (cartes fv-h-) : migration au démarrage qui crée les saisons,
// rattache les clubs (existants réutilisés, alias compris) et les rend visibles dans l'album et le Pack Ligue 1.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');
const { linkLigue1History } = require('../lib/ligue1-history');
const { clubKey } = require('../lib/club-key');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const CARDS = [
  ['fv-h-2015-2016-00001', '2015-2016', 'Angers SCO'],
  ['fv-h-2015-2016-00002', '2015-2016', 'FC Nantes'],
  ['fv-h-2015-2016-00003', '2015-2016', 'FC Nantes'],
  ['fv-h-2016-2017-00001', '2016-2017', 'Stade Brestois 29'],
  ['fv-h-2016-2017-00002', '2016-2017', 'LOSC Lille']
];

test.before(async () => {
  server = await startServer();
  // Clubs de 2026-2027 déjà en base sous un autre nom.
  await q("INSERT INTO clubs(id,name,tag,country) VALUES('sco-angers','SCO Angers','SCO','France'),('stade-brestois','Stade Brestois','SB','France'),('lille-osc','Lille OSC','LIL','France') ON CONFLICT DO NOTHING");
  for (const [id, season, club] of CARDS) {
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,$2,$3,'CM',$4,'France','common',70)", [id, season, 'Joueur ' + id, club]);
  }
  await q("DELETE FROM app_migrations WHERE id='ligue1-history-seasons-2026-09-30'");
  await server.restart();
});
test.after(async () => { await server?.stop(); });

test('alias : même clé pour les deux noms d\'un club', () => {
  assert.equal(clubKey('Angers SCO'), clubKey('SCO Angers'));
  assert.equal(clubKey('Stade Brestois 29'), clubKey('Stade Brestois'));
  assert.equal(clubKey('LOSC Lille'), clubKey('Lille OSC'));
  assert.notEqual(clubKey('FC Nantes'), clubKey('FC Metz'));
});

test('migration : saisons créées, clubs existants réutilisés, clubs manquants créés', async () => {
  const seasons = await q("SELECT season FROM competition_seasons WHERE competition_id='ligue-1' AND description LIKE 'Saison Ligue 1 historique%' ORDER BY season");
  assert.deepEqual(seasons.map(s => s.season), ['2015-2016', '2016-2017']);
  const links = await q("SELECT cs.season, c.id FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id='ligue-1' AND cs.season IN ('2015-2016','2016-2017') ORDER BY 1,2");
  assert.deepEqual(links.map(l => l.season + ':' + l.id), ['2015-2016:fc-nantes', '2015-2016:sco-angers', '2016-2017:lille-osc', '2016-2017:stade-brestois']);
  assert.equal((await q("SELECT count(*)::int AS n FROM clubs WHERE name IN ('Angers SCO','Stade Brestois 29','LOSC Lille')"))[0].n, 0, 'doublon de club créé');
  assert.equal((await q("SELECT count(*)::int AS n FROM competition_clubs WHERE competition_id='ligue-1' AND club_id='fc-nantes'"))[0].n, 1);
});

test('idempotence : un second passage n\'ajoute rien', async () => {
  const client = await server.db.connect();
  try { assert.deepEqual(await linkLigue1History(client), { seasons: 2, clubs: 0, links: 0, created: 0 }); }
  finally { client.release(); }
  await server.restart();
  assert.equal((await q("SELECT count(*)::int AS n FROM competition_seasons WHERE competition_id='ligue-1' AND season='2015-2016'"))[0].n, 1);
});

test('album et Pack Ligue 1 : les saisons historiques apparaissent, cartes comprises', async () => {
  const p = await newPlayer(server, 'Historien');
  const album = (await p.get('/api/album')).body;
  const l1 = album.album.competitions.find(c => c.id === 'ligue-1');
  const s15 = l1.seasons.find(s => s.season === '2015-2016');
  assert.deepEqual(s15.clubs.map(c => [c.name, c.total]).sort(), [['FC Nantes', 2], ['SCO Angers', 1]]);
  // Pack Ligue 1 : les cartes historiques (alias compris) sont tirables.
  const { configuredPackCards } = require('../lib/cards').createCards({ getPool: () => server.db, memory: {}, catalog: () => [], getUserById: async () => null, safeUser: x => x, securityEvent: async () => {} });
  const pack = (await q("SELECT * FROM pack_definitions WHERE id='pack-ligue-1'"))[0];
  assert.ok(pack, 'pack-ligue-1 absent');
  const eligible = new Set((await configuredPackCards(pack)).map(c => c.id));
  for (const [id] of CARDS) assert.ok(eligible.has(id), id + ' absente du Pack Ligue 1');
});
