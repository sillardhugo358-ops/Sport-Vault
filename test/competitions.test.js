'use strict';

// Administration des compétitions, saisons et clubs (rapport du 27/09 : création, modification,
// persistance, doublons, droits, suppression).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server, creator, admin;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  admin = await newPlayer(server, 'Admin');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  await server.db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
});
test.after(async () => { await server?.stop(); });

const post = (who, body) => who.post('/api/admin/competitions', body);
const q = async (sql, params) => (await server.db.query(sql, params)).rows;

test('droits : seul le Créateur modifie les compétitions', async () => {
  const r = await post(admin, { action: 'create', id: 'coupe-test', name: 'Coupe Test', tag: 'CT', status: 'available' });
  assert.equal(r.status, 403);
  assert.equal((await q("SELECT 1 FROM competitions WHERE id='coupe-test'")).length, 0);
});

test('compétition : création, doublon refusé, modification persistée', async () => {
  const c = await post(creator, { action: 'create', id: 'coupe-test', name: 'Coupe Test', tag: 'ct', country: 'France', status: 'available' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await post(creator, { action: 'create', id: 'coupe-test', name: 'Autre', tag: 'AT', status: 'available' })).status, 409);
  assert.equal((await post(creator, { action: 'create', id: 'X', name: 'Id invalide', tag: 'X', status: 'available' })).status, 400);
  const u = await post(creator, { action: 'update', id: 'coupe-test', name: 'Coupe Test 2', tag: 'CT2', country: 'France', status: 'available' });
  assert.equal(u.status, 200);
  const row = (await q("SELECT name,tag FROM competitions WHERE id='coupe-test'"))[0];
  assert.deepEqual([row.name, row.tag], ['Coupe Test 2', 'CT2']);
  const list = (await creator.get('/api/admin/competitions')).body.competitions;
  assert.ok(list.some(x => x.id === 'coupe-test' && x.name === 'Coupe Test 2'));
});

test('saison et clubs : création, rattachement, logo, doublons et validations', async () => {
  const s = await post(creator, { action: 'season_create', competitionId: 'coupe-test', season: '2026-2027', seasonStatus: 'available' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const seasonId = s.body.seasonId;
  assert.equal((await post(creator, { action: 'season_update', seasonId, competitionId: 'coupe-test', season: 'mauvais', seasonStatus: 'available' })).status, 400);

  const logo = 'https://example.org/logo-test.png';
  assert.equal((await post(creator, { action: 'club_create', clubName: 'FC Essai', logoUrl: 'javascript:alert(1)', competitionIds: ['coupe-test'] })).status, 400);
  const club = await post(creator, { action: 'club_create', clubName: 'FC Essai', logoUrl: logo, competitionIds: ['coupe-test'] });
  assert.equal(club.status, 200, JSON.stringify(club.body));
  assert.equal((await post(creator, { action: 'club_create', clubName: 'fc essai', competitionIds: ['coupe-test'] })).status, 409);
  const clubRow = (await q("SELECT id,logo_url FROM clubs WHERE name='FC Essai'"))[0];
  assert.equal(clubRow.logo_url, logo);

  const set = await post(creator, { action: 'season_set_clubs', seasonId, clubIds: [clubRow.id] });
  assert.equal(set.status, 200);
  assert.equal((await post(creator, { action: 'season_set_clubs', seasonId, clubIds: ['club-inexistant'] })).status, 400);
  assert.deepEqual((await q('SELECT club_id FROM season_clubs WHERE season_id=$1', [seasonId])).map(r => r.club_id), [clubRow.id]);

  // Renommage du club : les cartes du catalogue suivent (rattachement album conservé).
  await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES('test-essai-1','2026-2027','Joueur Essai','ST','FC Essai','France','common',70)");
  const up = await post(creator, { action: 'club_update', id: clubRow.id, clubName: 'FC Essai Renommé', logoUrl: '', competitionIds: ['coupe-test'] });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await q("SELECT club FROM catalog_cards WHERE id='test-essai-1'"))[0].club, 'FC Essai Renommé');
  assert.equal((await q('SELECT logo_url FROM clubs WHERE id=$1', [clubRow.id]))[0].logo_url, null);
});

test('suppressions : club puis saison puis compétition, tracées ; introuvable → 404', async () => {
  const clubId = (await q("SELECT id FROM clubs WHERE name='FC Essai Renommé'"))[0].id;
  const seasonId = (await q("SELECT id FROM competition_seasons WHERE competition_id='coupe-test'"))[0].id;
  assert.equal((await post(creator, { action: 'club_delete', id: clubId })).status, 200);
  assert.equal((await post(creator, { action: 'club_delete', id: clubId })).status, 404);
  // La carte historique du club est conservée (rapport du 24/09).
  assert.equal((await q("SELECT count(*)::int AS n FROM catalog_cards WHERE id='test-essai-1'"))[0].n, 1);
  assert.equal((await post(creator, { action: 'season_delete', seasonId, competitionId: 'coupe-test' })).status, 200);
  assert.equal((await post(creator, { action: 'delete', id: 'coupe-test' })).status, 200);
  assert.equal((await post(creator, { action: 'delete', id: 'coupe-test' })).status, 404);
  const logs = (await q("SELECT action FROM admin_logs WHERE action LIKE 'competition%' OR action LIKE 'club%'")).map(r => r.action);
  for (const a of ['competition_create', 'competition_update', 'club_create', 'club_update', 'club_delete', 'competition_delete']) assert.ok(logs.includes(a), a);
});
