'use strict';

// Nationalités en français : migration des données existantes, saisie admin, import européen.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');
const { frenchNation } = require('../lib/nations');
const { loadCards } = require('../scripts/import-europe');

test('correspondance : anglais, code FIFA et variantes ramenés au français ; inconnu conservé', () => {
  assert.equal(frenchNation('Spain'), 'Espagne');
  assert.equal(frenchNation('FRA'), 'France');
  assert.equal(frenchNation("Cote d'Ivoire"), "Côte d'Ivoire");
  assert.equal(frenchNation('Türkiye'), 'Turquie');
  assert.equal(frenchNation('Korea, South'), 'Corée du Sud');
  assert.equal(frenchNation('Espagne'), 'Espagne');
  assert.equal(frenchNation('Atlantide'), 'Atlantide');
  assert.equal(frenchNation(null), '');
});

test('import européen : aucune nationalité anglaise', () => {
  const nations = new Set(loadCards().map(c => c.nation));
  for (const en of ['Spain', 'England', 'Germany', 'Italy', 'Brazil', 'United States']) assert.ok(!nations.has(en), en);
  assert.ok(nations.has('Espagne') && nations.has('Angleterre'));
});

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('migration : catalogue et exemplaires convertis au redémarrage ; saisie admin normalisée', async () => {
  const card = (await server.db.query('SELECT id FROM catalog_cards WHERE is_active ORDER BY id LIMIT 1')).rows[0].id;
  const p = await newPlayer(server, 'Supporter');
  await server.db.query("UPDATE catalog_cards SET nation='Spain' WHERE id=$1", [card]);
  await server.db.query("UPDATE card_instances SET nation='England' WHERE owner_id=$1", [p.user.id]);
  await server.db.query("DELETE FROM app_migrations WHERE id='nations-fr-2026-09-30'");
  await server.restart();
  assert.equal((await server.db.query('SELECT nation FROM catalog_cards WHERE id=$1', [card])).rows[0].nation, 'Espagne');
  const inst = (await server.db.query('SELECT DISTINCT nation FROM card_instances WHERE owner_id=$1', [p.user.id])).rows.map(r => r.nation);
  assert.deepEqual(inst, ['Angleterre']);
  const creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  const ctx = (await server.db.query(`SELECT cs.id AS season_id, cs.competition_id, cs.season, c.name AS club FROM competition_seasons cs
    JOIN season_clubs sc ON sc.season_id=cs.id JOIN clubs c ON c.id=sc.club_id WHERE cs.status='available' LIMIT 1`)).rows[0];
  const r = await creator.post('/api/admin/cards/create', { name: 'Joueur Brésilien', position: 'ST', jerseyNumber: 10, club: ctx.club, nation: 'Brazil',
    season: ctx.season, competitionId: ctx.competition_id, seasonId: ctx.season_id, ovr: 75, pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 40, physical: 60 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const saved = (await server.db.query("SELECT nation FROM catalog_cards WHERE name='Joueur Brésilien'")).rows[0];
  assert.equal(saved.nation, 'Brésil');
});
