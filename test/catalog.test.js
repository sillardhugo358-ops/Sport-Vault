'use strict';

// Catalogue : rareté imposée par le barème (sauf carte spéciale) et
// migration des données existantes au démarrage.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server, creator, context;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  // Un club rattaché à une saison disponible, requis pour créer une carte.
  context = (await server.db.query(`SELECT cs.id AS season_id, cs.competition_id, cs.season, c.name AS club
    FROM competition_seasons cs JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id
    WHERE cs.status='available' LIMIT 1`)).rows[0];
  if (!context) {
    await server.db.query("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES('test-fc','Test FC','TFC','France',0) ON CONFLICT DO NOTHING");
    const season = (await server.db.query("SELECT id,competition_id,season FROM competition_seasons WHERE status='available' LIMIT 1")).rows[0];
    await server.db.query('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,0) ON CONFLICT DO NOTHING', [season.id, 'test-fc']);
    context = { season_id: season.id, competition_id: season.competition_id, season: season.season, club: 'Test FC' };
  }
});
test.after(async () => { await server?.stop(); });

const cardBody = (extra = {}) => ({
  name: 'Joueur Test', position: 'ST', jerseyNumber: 9, club: context.club, nation: 'France',
  season: context.season, competitionId: context.competition_id, seasonId: context.season_id,
  ovr: 85, pace: 80, shooting: 80, passing: 80, dribbling: 80, defending: 40, physical: 70,
  rarity: 'common', ...extra
});
const catalogRow = async id => (await server.db.query('SELECT rarity,rarity_locked,ovr FROM catalog_cards WHERE id=$1', [id])).rows[0];

test('création : la rareté suit la note, quelle que soit la valeur envoyée', async () => {
  const r = await creator.post('/api/admin/cards/create', cardBody({ ovr: 85, rarity: 'common' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.card?.id || r.body.id;
  assert.deepEqual(await catalogRow(id), { rarity: 'epic', rarity_locked: false, ovr: 85 });
});

test('carte spéciale : rareté manuelle conservée', async () => {
  const r = await creator.post('/api/admin/cards/create', cardBody({ name: 'Special Test', ovr: 80, rarity: 'icon', rarityLocked: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.card?.id || r.body.id;
  assert.deepEqual(await catalogRow(id), { rarity: 'icon', rarity_locked: true, ovr: 80 });
});

test('modification : la rareté suit la nouvelle note, sauf carte spéciale', async () => {
  const made = await creator.post('/api/admin/cards/create', cardBody({ name: 'Evolution Test', ovr: 79 }));
  const id = made.body.card?.id || made.body.id;
  assert.equal((await catalogRow(id)).rarity, 'rare');
  const up = await creator.post('/api/admin/cards', { ...cardBody({ name: 'Evolution Test', ovr: 91 }), id });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await catalogRow(id)).rarity, 'legendary');
  // Verrouillage, puis changement de note : la rareté reste celle choisie.
  await creator.post('/api/admin/cards', { ...cardBody({ name: 'Evolution Test', ovr: 91, rarity: 'icon', rarityLocked: true }), id });
  await creator.post('/api/admin/cards', { ...cardBody({ name: 'Evolution Test', ovr: 70, rarity: 'icon' }), id });
  assert.deepEqual(await catalogRow(id), { rarity: 'icon', rarity_locked: true, ovr: 70 });
});

test('carte spéciale : rareté invalide refusée', async () => {
  const r = await creator.post('/api/admin/cards/create', cardBody({ name: 'Invalide Test', rarity: 'mythique', rarityLocked: true }));
  assert.equal(r.status, 400);
});

test('migration : cartes hors barème verrouillées, poste LM converti en LW', async () => {
  const insert = `INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,is_active)
    VALUES($1,'2012-2013',$2,$3,'Club Test','France',$4,$5,true)`;
  await server.db.query(insert, ['fv-test-mater', 'R. Test', 'RB', 'icon', 90]);
  await server.db.query(insert, ['fv-test-lm', 'L. Milieu', 'LM', 'rare', 80]);
  await server.db.query(insert, ['fv-test-ok', 'N. Normal', 'CB', 'epic', 85]);
  await server.db.query("DELETE FROM app_migrations WHERE id='rarity-scale-lm-2026-09-29'");
  await server.restart();
  assert.match(server.logs(), /Barème des raretés : 1 carte\(s\) spéciale\(s\) verrouillée\(s\) \(fv-test-mater\)/);
  assert.deepEqual(await catalogRow('fv-test-mater'), { rarity: 'icon', rarity_locked: true, ovr: 90 });
  assert.deepEqual(await catalogRow('fv-test-ok'), { rarity: 'epic', rarity_locked: false, ovr: 85 });
  const lm = (await server.db.query("SELECT position FROM catalog_cards WHERE id='fv-test-lm'")).rows[0];
  assert.equal(lm.position, 'LW');
  // Migration ponctuelle : un nouveau redémarrage ne change plus rien.
  await server.restart();
  assert.doesNotMatch(server.logs(), /Barème des raretés/);
});
