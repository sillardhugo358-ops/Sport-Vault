'use strict';

// Sets thématiques : éditeur admin (droits, validation, identifiant généré), progression (cartes possédées seulement),
// récompense unique selon la taille du set, journal des FC, plafond quotidien qui bloque sans rien consommer,
// demandes simultanées, cartes retirées du catalogue.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client, awayFromParisMidnight } = require('./helpers');
const { SET_DAILY_CAP_COINS } = require('../lib/game-config');

let server, creator, player;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const ids = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`);

async function give(p, cardIds) {
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
    SELECT gen_random_uuid(),c.id,$1,c.season,c.name,c.position,c.club,c.nation,c.rarity,'pack:test' FROM catalog_cards c WHERE c.id = ANY($2::text[])`, [p.user.id, cardIds]);
}
const coins = async p => Number((await q('SELECT coins FROM users WHERE id=$1', [p.user.id]))[0].coins);

test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
  player = await newPlayer(server, 'Collectionneur');
  await q(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr)
    SELECT 'set-' || n, '2026-2027', 'Joueur Set ' || n, 'ST', 'FC Set', 'France', 'common', 70 FROM generate_series(1,80) n`);
});
test.after(async () => { await server?.stop(); });

const save = body => creator.post('/api/admin/sets', body);
const create = (name, cardIds) => save({ action: 'create', name, description: 'Description du set.', cardIds });

test('admin : droits, validation par champ, identifiant généré et unique', async () => {
  assert.equal((await player.get('/api/admin/sets')).status, 403);
  assert.equal((await player.post('/api/admin/sets', { action: 'create', name: 'Pirate', description: 'x', cardIds: ids('set', 1, 3) })).status, 403);
  const bad = await save({ action: 'create', name: 'x', description: '', cardIds: ['set-1'] });
  assert.equal(bad.status, 400);
  for (const f of ['name', 'description', 'cardIds']) assert.ok(bad.body.errors[f], f);
  assert.ok((await create('Inconnues', ['set-1', 'nulle-part'])).body.errors.cardIds);
  assert.ok((await create('Doublons', ['set-1', 'set-1'])).body.errors.cardIds, 'doublons ignorés : une seule carte distincte');
  const a = await create('Mon Premier Set', ids('set', 1, 3));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.id, 'mon-premier-set');
  assert.equal((await create('Mon Premier Set', ids('set', 4, 6))).body.id, 'mon-premier-set-2');
  const list = (await creator.get('/api/admin/sets')).body;
  assert.equal(list.sets.length, 2);
  assert.deepEqual(list.sets[0].reward, { coins: 500, xp: 25, tier: 'PETIT' });
});

test('joueur : non connecté refusé ; progression sur les cartes possédées ; récompense unique', async () => {
  assert.equal((await client(server).get('/api/sets')).status, 401);
  assert.equal((await client(server).post('/api/sets/claim', { id: 'mon-premier-set' })).status, 401);
  let s = (await player.get('/api/sets')).body.sets.find(x => x.id === 'mon-premier-set');
  assert.equal(s.total, 3); assert.equal(s.owned, 0); assert.equal(s.claimable, false);
  assert.equal((await player.post('/api/sets/claim', { id: s.id })).status, 400);
  await give(player, ['set-1', 'set-2']);
  s = (await player.get('/api/sets')).body.sets.find(x => x.id === 'mon-premier-set');
  assert.equal(s.owned, 2); assert.equal(s.completed, false);
  const incomplete = await player.post('/api/sets/claim', { id: s.id });
  assert.equal(incomplete.status, 400); assert.match(incomplete.body.error, /2\/3/);
  // Une carte en vente aux enchères ne compte pas.
  await give(player, ['set-3']);
  await q("UPDATE card_instances SET status='auction' WHERE owner_id=$1 AND card_id='set-3'", [player.user.id]);
  assert.equal((await player.post('/api/sets/claim', { id: s.id })).status, 400);
  await q("UPDATE card_instances SET status='owned' WHERE owner_id=$1 AND card_id='set-3'", [player.user.id]);
  const before = await coins(player);
  const readyBefore = (await player.get('/api/notifications')).body.rewardsVault;
  const ok = await player.post('/api/sets/claim', { id: s.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await player.get('/api/notifications')).body.rewardsVault, readyBefore - 1, 'le set terminé est compté dans les récompenses du Vault, puis retiré une fois récupéré');
  assert.deepEqual(ok.body.reward, { coins: 500, xp: 25 });
  assert.equal(await coins(player), before + 500);
  const ledger = await q("SELECT amount,reason FROM coin_ledger WHERE user_id=$1 AND ref='set:mon-premier-set'", [player.user.id]);
  assert.deepEqual(ledger.map(r => [Number(r.amount), r.reason]), [[500, 'reward']]);
  assert.equal((await player.post('/api/sets/claim', { id: s.id })).status, 400, 'une seule récupération');
  assert.equal(await coins(player), before + 500);
  assert.equal((await q("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='set_claim'", [player.user.id]))[0].n, 1);
});

test('modifier un set déjà récupéré ne redonne pas de récompense', async () => {
  const r = await save({ action: 'update', id: 'mon-premier-set', name: 'Mon Premier Set', description: 'Nouvelle description.', cardIds: ids('set', 1, 4) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await give(player, ['set-4']);
  const s = (await player.get('/api/sets')).body.sets.find(x => x.id === 'mon-premier-set');
  assert.equal(s.total, 4); assert.equal(s.completed, true); assert.equal(s.claimed, true); assert.equal(s.claimable, false);
  const before = await coins(player);
  assert.equal((await player.post('/api/sets/claim', { id: s.id })).status, 400);
  assert.equal(await coins(player), before);
});

test('demandes simultanées : une seule récompense', async () => {
  const p = await newPlayer(server, 'Rafale');
  const set = await create('Set Rafale', ids('set', 10, 12));
  await give(p, ids('set', 10, 12));
  const before = await coins(p);
  const results = await Promise.all(Array.from({ length: 10 }, () => p.post('/api/sets/claim', { id: set.body.id })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(await coins(p), before + 500);
});

test('plafond quotidien : récupération refusée sans rien consommer, possible le lendemain', async () => {
  await awayFromParisMidnight();
  const p = await newPlayer(server, 'Plafond');
  const grand = [], grandIds = [ids('set', 21, 46), ids('set', 47, 72)];
  for (const [i, cardIds] of grandIds.entries()) grand.push((await create('Grand Set ' + (i + 1), cardIds)).body.id);
  const third = (await create('Troisième Grand Set', [...ids('set', 21, 30), ...ids('set', 47, 62)])).body.id; // 26 cartes déjà possédées
  const small = (await create('Petit Set Bloqué', ids('set', 73, 75))).body.id;
  await give(p, [...ids('set', 21, 72), ...ids('set', 73, 75)]);
  const before = await coins(p);
  for (const id of grand) assert.equal((await p.post('/api/sets/claim', { id })).status, 200);
  assert.equal(await coins(p), before + 10000);
  assert.equal(SET_DAILY_CAP_COINS, 10000);
  const info = (await p.get('/api/sets')).body;
  assert.equal(info.claimedToday, 10000); assert.equal(info.remainingToday, 0);
  const t = info.sets.find(x => x.id === third);
  assert.equal(t.completed, true); assert.equal(t.claimable, false); assert.equal(t.blockedByCap, true);
  const blocked = await p.post('/api/sets/claim', { id: third });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'daily_cap');
  assert.match(blocked.body.error, /reviens demain/);
  assert.equal((await p.post('/api/sets/claim', { id: small })).status, 409);
  assert.equal(await coins(p), before + 10000, 'rien de crédité');
  assert.equal((await q("SELECT count(*)::int AS n FROM reward_claims WHERE user_id=$1 AND claim_id=ANY($2::text[])", [p.user.id, ['set:' + third, 'set:' + small]]))[0].n, 0, 'récompense non consommée');
  // Le lendemain (jour de Paris suivant) : la même récompense est récupérable.
  await q("UPDATE coin_ledger SET created_at=created_at - interval '2 days' WHERE user_id=$1 AND ref LIKE 'set:%'", [p.user.id]);
  assert.equal((await p.post('/api/sets/claim', { id: third })).status, 200);
  assert.equal((await p.post('/api/sets/claim', { id: small })).status, 200);
});

test('cartes retirées du catalogue : ne comptent plus ; set de moins de 2 cartes masqué', async () => {
  const p = await newPlayer(server, 'Catalogue');
  const set = (await create('Set Fragile', ids('set', 76, 79))).body.id;
  await give(p, ids('set', 76, 78));
  await q("UPDATE catalog_cards SET is_active=false WHERE id='set-79'");
  let s = (await p.get('/api/sets')).body.sets.find(x => x.id === set);
  assert.equal(s.total, 3); assert.equal(s.completed, true, 'la carte retirée ne bloque plus la complétion');
  await q("UPDATE catalog_cards SET is_active=false WHERE id IN ('set-77','set-78')");
  assert.equal((await p.get('/api/sets')).body.sets.find(x => x.id === set), undefined);
  assert.equal((await p.post('/api/sets/claim', { id: set })).status, 404);
});

test('désactiver un set le masque aux joueurs', async () => {
  const p = await newPlayer(server, 'Visible');
  const id = (await create('Set Temporaire', ids('set', 5, 7))).body.id;
  assert.ok((await p.get('/api/sets')).body.sets.find(x => x.id === id));
  assert.equal((await save({ action: 'toggle', id, active: false })).status, 200);
  assert.equal((await p.get('/api/sets')).body.sets.find(x => x.id === id), undefined);
});
