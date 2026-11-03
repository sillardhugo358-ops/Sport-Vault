'use strict';

// Club de cœur : un club par saison, choix gratuit, classement des clubs (cartes distinctes du club possédées par ses supporters),
// changement limité aux premiers jours de la saison (horloge injectée : le serveur de test tourne à la date réelle).

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { startServer, newPlayer, client, userRow } = require('./helpers');
const { createHeartClub } = require('../lib/heart-club');

let server, a, b, c, pool;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const A = 'FC Cœur Test', B = 'AS Rival Test';
const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}-${i}`);
async function give(p, cardIds, status = 'owned') {
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,status)
    SELECT gen_random_uuid(),c.id,$1,c.season,c.name,c.position,c.club,c.nation,c.rarity,'pack:test',$3 FROM catalog_cards c WHERE c.id = ANY($2::text[])`, [p.user.id, cardIds, status]);
}

test.before(async () => {
  server = await startServer();
  for (const [club, p] of [[A, 'hca'], [B, 'hcb']]) for (const id of ids(p, 12)) {
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST',$3,'France','common',70)", [id, 'Joueur ' + id, club]);
  }
  [a, b, c] = [await newPlayer(server, 'Alma'), await newPlayer(server, 'Boris'), await newPlayer(server, 'Cleo')];
});
test.after(async () => { await pool?.end(); await server.stop?.(); });

test('droits, recherche, club inconnu, choix gratuit', async () => {
  assert.equal((await client(server).get('/api/heart-club')).status, 401);
  assert.equal((await client(server).post('/api/heart-club/choose', { club: A })).status, 401);
  assert.deepEqual((await a.get('/api/heart-club/search?q=c')).body.clubs, [], '2 caractères au moins');
  const s = (await a.get('/api/heart-club/search?q=' + encodeURIComponent('Cœur Test'))).body.clubs;
  assert.equal(s.length, 1);
  assert.equal(s[0].name, A);
  assert.equal((await a.post('/api/heart-club/choose', { club: 'Club Imaginaire' })).status, 404);
  assert.equal((await a.post('/api/heart-club/choose', {})).status, 404);
  const coins = (await userRow(server, a.user.id)).coins;
  const r = await a.post('/api/heart-club/choose', { club: A });
  assert.equal(r.status, 200);
  assert.equal(r.body.club.name, A);
  assert.equal((await userRow(server, a.user.id)).coins, coins, 'gratuit : aucun FC débité ni versé');
  assert.equal((await a.post('/api/heart-club/choose', { club: A })).body.unchanged, true, 'même club : rien ne change');
  assert.equal((await q('SELECT count(*)::int AS n FROM heart_clubs WHERE user_id=$1', [a.user.id]))[0].n, 1, 'une ligne par saison');
});

test('classement : cartes distinctes du club, possédées, par supporters', async () => {
  await b.post('/api/heart-club/choose', { club: A });
  await c.post('/api/heart-club/choose', { club: B });
  await give(a, ids('hca', 3));
  await give(a, ids('hca', 1)); // doublon : une seule carte distincte
  await give(a, ids('hcb', 4)); // cartes d'un autre club : pas comptées
  await give(a, ['hca-9'], 'archived'); // pas possédée
  await give(b, ids('hca', 2));
  await give(c, ids('hcb', 1));
  const d = (await a.get('/api/heart-club')).body;
  const top = d.clubs.filter(x => [A, B].includes(x.name));
  assert.deepEqual(top.map(x => [x.name, x.fans, x.cards]), [[A, 2, 5], [B, 1, 1]]);
  assert.ok(top[0].rank < top[1].rank);
  assert.equal(d.mine.club.name, A);
});

test('un club de cœur par saison ; changement seulement en début de saison', async () => {
  pool = new Pool({ connectionString: server.databaseUrl, max: 2 });
  pool.on('error', () => {});
  const t = async (iso, user, club) => createHeartClub({ getPool: () => pool, now: () => new Date(iso) }).choose(user, club);
  const clubs = createHeartClub({ getPool: () => pool });
  const key = (await clubs.search('Rival Test')).clubs[0].key;
  const user = (await newPlayer(server, 'Dora')).user.id;
  // Saison 1 : lundi 12/10/2026 (heure de Paris) → 8 semaines.
  assert.equal((await t('2026-10-30T10:00:00Z', user, A)).club.name, A, 'premier choix possible à tout moment');
  const late = await t('2026-10-30T10:00:00Z', user, key);
  assert.equal(late.status, 403, 'changement refusé après la première semaine');
  assert.equal(late.locked, true);
  assert.equal((await t('2026-10-15T10:00:00Z', user, key)).club.name, B, 'changement accepté la première semaine');
  // Saison 2 : une nouvelle ligne, l'ancien choix reste en archive.
  assert.equal((await t('2026-12-08T10:00:00Z', user, A)).club.name, A);
  assert.deepEqual((await q('SELECT season FROM heart_clubs WHERE user_id=$1 ORDER BY season', [user])).map(r => r.season), ['season-1', 'season-2']);
});
