'use strict';

// Défis thématiques et packs à durée limitée : éditeur admin (droits, validation), progression
// limitée à la période, récompense unique et journalisée, pack limité invisible et non ouvrable
// hors de sa période, premier défi « Semaine Serie A ».

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer } = require('./helpers');
const { seedSerieAWeek } = require('../lib/challenges');

let server, creator, player;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const iso = ms => new Date(Date.now() + ms).toISOString();
const H = 3600_000;

async function give(p, cardId, { source = 'pack:test', acquiredAt = null } = {}) {
  const c = (await q('SELECT * FROM catalog_cards WHERE id=$1', [cardId]))[0];
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,acquired_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()))`,
  [crypto.randomUUID(), c.id, p.user.id, c.season, c.name, c.position, c.club, c.nation, c.rarity, source, acquiredAt]);
}

test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  player = await newPlayer(server, 'Défieur');
  // Petit championnat de test : une saison, un club, trois cartes.
  await q("INSERT INTO competitions(id,name,tag,status) VALUES('coupe-defi','Coupe Défi','CD','available')");
  await q("INSERT INTO competition_seasons(id,competition_id,season,label,status) VALUES('coupe-defi-2026','coupe-defi','2026-2027','2026-2027','available')");
  await q("INSERT INTO clubs(id,name,tag) VALUES('fc-defi','FC Défi','FCD')");
  await q("INSERT INTO season_clubs(season_id,club_id,position) VALUES('coupe-defi-2026','fc-defi',0)");
  for (const i of [1, 2, 3]) await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Défi','France','common',70)", ['defi-' + i, 'Joueur défi ' + i]);
});
test.after(async () => { await server?.stop(); });

const save = body => creator.post('/api/admin/challenges', body);
const base = { title: 'Semaine Coupe Défi', description: 'Obtiens 2 cartes de la Coupe Défi.', type: 'competitionCards', competitionId: 'coupe-defi', target: 2, coins: 300, xp: 30 };

test('admin : droits, validation par champ, identifiant généré', async () => {
  assert.equal((await player.get('/api/admin/challenges')).status, 403);
  assert.equal((await player.post('/api/admin/challenges', { ...base, action: 'create', startsAt: iso(-H), endsAt: iso(24 * H) })).status, 403);
  const bad = await save({ action: 'create', title: 'x', description: '', type: 'packOpens', packId: 'inconnu', target: 0, coins: 0, xp: 0, startsAt: iso(H), endsAt: iso(-H) });
  assert.equal(bad.status, 400);
  for (const f of ['title', 'description', 'target', 'coins', 'endsAt', 'packId']) assert.ok(bad.body.errors[f], f);
  assert.ok((await save({ ...base, action: 'create', competitionId: 'nulle-part', startsAt: iso(-H), endsAt: iso(H) })).body.errors.competitionId);
  const r = await save({ ...base, action: 'create', startsAt: iso(-H), endsAt: iso(24 * H) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.challenge.id, 'semaine-coupe-defi');
});

test('progression : seules les cartes du championnat obtenues pendant le défi comptent', async () => {
  await give(player, 'defi-1', { acquiredAt: iso(-2 * H) }); // avant le début
  await give(player, 'defi-2', { source: 'welcome' });        // carte de bienvenue
  await give(player, 'defi-3', { source: 'admin_grant' });    // don de l'admin
  let c = (await player.get('/api/challenges')).body.current.find(x => x.id === 'semaine-coupe-defi');
  assert.equal(c.progress, 0);
  assert.equal((await player.post('/api/challenges/claim', { id: c.id })).status, 400);
  await give(player, 'defi-1');
  await give(player, 'defi-2');
  c = (await player.get('/api/challenges')).body.current.find(x => x.id === 'semaine-coupe-defi');
  assert.deepEqual([c.progress, c.completed, c.claimable, c.competitionName], [2, true, true, 'Coupe Défi']);
  assert.ok((await player.get('/api/notifications')).body.rewardsReady >= 1);
});

test('récompense : une seule fois même en rafale, journalisée, visible au profil', async () => {
  const before = Number((await q('SELECT coins FROM users WHERE id=$1', [player.user.id]))[0].coins);
  const results = await Promise.all(Array.from({ length: 6 }, () => player.post('/api/challenges/claim', { id: 'semaine-coupe-defi' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const after = Number((await q('SELECT coins FROM users WHERE id=$1', [player.user.id]))[0].coins);
  assert.equal(after - before, 300);
  assert.deepEqual((await q("SELECT amount FROM coin_ledger WHERE ref='challenge:semaine-coupe-defi'")).map(r => r.amount), [300]);
  const c = (await player.get('/api/challenges')).body.current.find(x => x.id === 'semaine-coupe-defi');
  assert.deepEqual([c.claimed, c.claimable], [true, false]);
  assert.equal((await creator.get('/api/admin/challenges')).body.challenges.find(x => x.id === 'semaine-coupe-defi').claims, 1);
  assert.ok((await player.get('/api/profile')).body.history.some(h => h.label === 'Défi réussi' && h.amount === 300));
});

test('défi « ouvrir un pack », défis à venir et terminés', async () => {
  const r = await save({ action: 'create', title: 'Deux starters', description: 'Ouvre 2 Starter Packs.', type: 'packOpens', packId: 'starter', target: 2, coins: 0, xp: 40, startsAt: iso(-H), endsAt: iso(H) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = await newPlayer(server, 'Ouvreur');
  await p.post('/api/packs/open', { packId: 'starter' });
  await p.post('/api/packs/open', { packId: 'starter' });
  const list = (await p.get('/api/challenges')).body;
  assert.deepEqual(list.current.find(x => x.id === 'deux-starters').progress, 2);
  await save({ ...base, action: 'create', title: 'Bientôt', startsAt: iso(48 * H), endsAt: iso(72 * H) });
  await save({ ...base, action: 'create', title: 'Fini raté', startsAt: iso(-72 * H), endsAt: iso(-48 * H) });
  const l2 = (await p.get('/api/challenges')).body;
  assert.ok(l2.upcoming.some(x => x.id === 'bientot'));
  assert.ok(![...l2.current, ...l2.ended].some(x => x.id === 'fini-rate'), 'défi terminé non réussi encore affiché');
  assert.equal((await p.post('/api/challenges/claim', { id: 'bientot' })).status, 404);
  // Désactivation.
  assert.equal((await save({ action: 'toggle', id: 'deux-starters', active: false })).status, 200);
  assert.ok(!(await p.get('/api/challenges')).body.current.some(x => x.id === 'deux-starters'));
});

test('pack limité : invisible et non ouvrable hors période, rien débité', async () => {
  const mk = (id, from, until) => creator.post('/api/admin/packs', { action: 'pack_create', id, name: 'Limité ' + id, price: 100, cards: 1, guarantee: 'common', guaranteeCount: 0, conditions: {}, active: true, availableFrom: from, availableUntil: until });
  assert.equal((await mk('lim-invalide', iso(H), iso(-H))).status, 400);
  assert.equal((await mk('lim-fini', iso(-48 * H), iso(-H))).status, 200);
  assert.equal((await mk('lim-futur', iso(H), iso(48 * H))).status, 200);
  assert.equal((await mk('lim-ouvert', iso(-H), iso(48 * H))).status, 200);
  const p = await newPlayer(server, 'Acheteur');
  const listed = (await p.get('/api/packs')).body.packs;
  assert.ok(listed.some(x => x.id === 'lim-ouvert' && x.availableUntil));
  assert.ok(!listed.some(x => x.id === 'lim-fini' || x.id === 'lim-futur'));
  const coins = Number((await q('SELECT coins FROM users WHERE id=$1', [p.user.id]))[0].coins);
  for (const id of ['lim-fini', 'lim-futur']) assert.equal((await p.post('/api/packs/open', { packId: id })).status, 409, id);
  assert.equal(Number((await q('SELECT coins FROM users WHERE id=$1', [p.user.id]))[0].coins), coins);
  assert.equal((await p.post('/api/packs/open', { packId: 'lim-ouvert' })).status, 200);
});

test('Semaine Serie A : créée avec son pack limité si la Serie A a des cartes, une seule fois', async () => {
  const client = await server.db.connect();
  try {
    assert.deepEqual(await seedSerieAWeek(client), { created: false }); // pas encore de Serie A rattachée
    await client.query("INSERT INTO competition_seasons(id,competition_id,season,label,status) VALUES('serie-a-2026-2027','serie-a','2026-2027','2026-2027','available') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO season_clubs(season_id,club_id,position) VALUES('serie-a-2026-2027','fc-defi',0)");
    assert.equal((await seedSerieAWeek(client)).created, true);
    await seedSerieAWeek(client);
  } finally { client.release(); }
  assert.equal((await q("SELECT count(*)::int AS n FROM challenges WHERE id='semaine-serie-a'"))[0].n, 1);
  const pack = (await q("SELECT available_from, available_until FROM pack_definitions WHERE id='pack-semaine-serie-a'"))[0];
  assert.ok(pack.available_from < new Date() && pack.available_until > new Date());
  const p = await newPlayer(server, 'Tifoso');
  assert.ok((await p.get('/api/challenges')).body.current.some(x => x.id === 'semaine-serie-a'));
  assert.ok((await p.get('/api/packs')).body.packs.some(x => x.id === 'pack-semaine-serie-a'));
});
