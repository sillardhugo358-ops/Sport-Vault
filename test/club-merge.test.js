'use strict';

// Fusion des clubs en double (lib/club-merge.js, migration clubs-dedup-2026-10-01) : un seul club
// par clé, rattachements transférés, noms unifiés sur les cartes, exemplaires et packs,
// sauvegarde complète, une seule fois, et plus de nouveau doublon possible depuis la console.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('doublons fusionnés une fois, rien de perdu, plus de doublon possible', async () => {
  const p = await newPlayer(server, 'Lillois');
  // Deux clubs pour Lille : l'ancien (saison 2010) et celui de la saison en cours, avec logo.
  await q("INSERT INTO clubs(id,name,tag,country,sort_order) VALUES('losc-lille','LOSC Lille','LOS','France',500),('lille-osc','Lille OSC','LIL','France',1)");
  await q("UPDATE clubs SET logo_url='https://example.org/lille.png' WHERE id='lille-osc'");
  await q("INSERT INTO competition_seasons(id,competition_id,season,label,status) VALUES('l1-2010','ligue-1','2010-2011','2010-2011','available'),('l1-2026','ligue-1','2026-2027','2026-2027','available') ON CONFLICT DO NOTHING");
  const s2010 = (await q("SELECT id FROM competition_seasons WHERE competition_id='ligue-1' AND season='2010-2011'"))[0].id;
  const s2026 = (await q("SELECT id FROM competition_seasons WHERE competition_id='ligue-1' AND season='2026-2027'"))[0].id;
  await q("INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,'losc-lille',90),($2,'lille-osc',90)", [s2010, s2026]);
  await q("INSERT INTO competition_clubs(competition_id,club_id,position) VALUES('ligue-1','losc-lille',90) ON CONFLICT DO NOTHING");
  await q(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,card_order,is_active)
    VALUES('fv-h-test-1','2010-2011','Eden Test','LW','LOSC Lille','Belgique','rare',80,80,80,80,80,80,80,'STANDARD',false,1,true),
          ('fv-h-test-2','2026-2027','Jonathan Test','ST','Lille OSC','Canada','rare',80,80,80,80,80,80,80,'STANDARD',false,2,true)`);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
    VALUES(gen_random_uuid(),'fv-h-test-1',$1,'2010-2011','Eden Test','LW','LOSC Lille','Belgique','rare','pack:test')`, [p.user.id]);
  await q(`UPDATE pack_definitions SET conditions=conditions||'{"clubs":["LOSC Lille","Lille OSC"]}'::jsonb WHERE id='starter'`);
  await q("DELETE FROM app_migrations WHERE id='clubs-dedup-2026-10-01'");
  await q('DELETE FROM club_merge_backup');
  await server.restart();

  const clubs = await q("SELECT id FROM clubs WHERE name ILIKE '%lille%'");
  assert.deepEqual(clubs.map(c => c.id), ['lille-osc'], 'un seul club gardé : celui de la saison la plus récente');
  const linked = (await q("SELECT season_id FROM season_clubs WHERE club_id='lille-osc'")).map(r => r.season_id);
  assert.ok(linked.includes(s2010) && linked.includes(s2026), 'saisons de l’ancien club transférées');
  assert.equal((await q("SELECT count(*)::int AS n FROM competition_clubs WHERE club_id='lille-osc' AND competition_id='ligue-1'"))[0].n, 1);
  assert.deepEqual((await q("SELECT DISTINCT club FROM catalog_cards WHERE id LIKE 'fv-h-test-%'")).map(r => r.club), ['Lille OSC']);
  assert.equal((await q('SELECT club FROM card_instances WHERE owner_id=$1 AND card_id=$2', [p.user.id, 'fv-h-test-1']))[0].club, 'Lille OSC');
  assert.deepEqual((await q("SELECT conditions->'clubs' AS c FROM pack_definitions WHERE id='starter'"))[0].c, ['Lille OSC']);
  const backup = await q("SELECT kind,data FROM club_merge_backup WHERE migration_id='clubs-dedup-2026-10-01'");
  const removed = backup.find(b => b.kind === 'club');
  assert.equal(removed.data.club.name, 'LOSC Lille');
  assert.equal(removed.data.mergedInto, 'lille-osc');
  assert.ok(removed.data.seasonClubs.some(r => r.season_id === s2010));
  assert.ok(backup.some(b => b.kind === 'rename' && b.data.from === 'LOSC Lille' && b.data.catalogCards === 1 && b.data.cardInstances === 1));
  assert.ok(backup.some(b => b.kind === 'pack'));
  // Une seule fois.
  await server.restart();
  assert.equal((await q('SELECT count(*)::int AS n FROM club_merge_backup'))[0].n, backup.length);

  // Console : un club de même clé ne peut plus être créé, ni obtenu en renommant un autre club.
  const creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  const created = await creator.post('/api/admin/competitions', { action: 'club_create', clubName: 'LOSC Lille', competitionIds: ['ligue-1'] });
  assert.equal(created.status, 409, JSON.stringify(created.body));
  const other = (await q("SELECT id FROM clubs WHERE id<>'lille-osc' LIMIT 1"))[0].id;
  const renamed = await creator.post('/api/admin/competitions', { action: 'club_update', id: other, clubName: 'lille osc', competitionIds: ['ligue-1'] });
  assert.equal(renamed.status, 409, JSON.stringify(renamed.body));
});
