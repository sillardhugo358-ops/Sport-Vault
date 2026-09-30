'use strict';

// Boutique : pack ou pool sans carte éligible (message clair, rien débité), composition des
// pools manuels respectée au tirage, validations de l'éditeur de packs et de pools.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins, userRow } = require('./helpers');

let server, creator;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const packBody = extra => ({ action: 'pack_create', name: 'Pack test', price: 100, cards: 3, badge: '', description: 'test', guarantee: 'common', guaranteeCount: 0, conditions: {}, active: true, ...extra });

test('pack sans carte éligible : message métier (409), rien débité, rien ajouté', async () => {
  await server.db.query("INSERT INTO pack_definitions(id,name,price,currency,cards,guarantee,guarantee_count,conditions,active) VALUES('pack-vide','PACK VIDE',100,'coins',3,'common',0,$1,true)", [JSON.stringify({ minOvr: 200 })]);
  const p = await newPlayer(server, 'Malchanceux');
  const r = await p.post('/api/packs/open', { packId: 'pack-vide' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /Aucune carte/);
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1000);
  assert.equal((await p.get('/api/collection')).body.count, 3);
});

test('éditeur de packs : pack actif impossible à ouvrir refusé ; inactif accepté', async () => {
  const bad = await creator.post('/api/admin/packs', packBody({ conditions: { minOvr: 200 } }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Aucune carte active/);
  assert.equal((await creator.post('/api/admin/packs', packBody({ conditions: { minOvr: 200 }, active: false }))).status, 200);
  assert.equal((await creator.post('/api/admin/packs', packBody({ conditions: { rarities: ['common'] } }))).status, 200);
});

async function poolCards(rare, common) {
  const pick = async (r, n) => (await server.db.query('SELECT id FROM catalog_cards WHERE is_active AND rarity=$1 ORDER BY id LIMIT $2', [r, n])).rows.map(x => x.id);
  return { rareIds: await pick('rare', rare), commonIds: await pick('common', common) };
}
const poolBody = (ids, composition, extra = {}) => ({ action: 'pool_create', name: 'Pool test', type: 'manual', price: 0, cards: 1, active: true, config: { cardIds: ids, ...composition }, ...extra });

test('éditeur de pools : composition différente de la sélection refusée ; pool sans carte active refusé', async () => {
  const { rareIds, commonIds } = await poolCards(1, 4);
  const mismatch = await creator.post('/api/admin/packs', poolBody([...rareIds, ...commonIds], { specialCount: 0, rareCount: 1, commonCount: 9 }));
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /composition/);
  const empty = await creator.post('/api/admin/packs', poolBody(['absente-1'], { specialCount: 0, rareCount: 0, commonCount: 1 }));
  assert.equal(empty.status, 400);
});

test('pool manuel : la composition est respectée (1 rare sur 20 cartes, 5 cartes par tirage)', async () => {
  const { rareIds, commonIds } = await poolCards(1, 19);
  const r = await creator.post('/api/admin/packs', poolBody([...rareIds, ...commonIds], { specialCount: 0, rareCount: 1, commonCount: 19 }, { cards: 5 }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const poolId = (await server.db.query("SELECT id FROM pack_pools WHERE name='Pool test' ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  const p = await newPlayer(server, 'Tireur');
  await setCoins(server, p.user.id, 0);
  let rare = 0; const N = 40;
  for (let i = 0; i < N; i++) {
    const d = await p.post('/api/pools/open', { poolId });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    if (d.body.cards.some(c => c.rarity === 'rare')) rare++;
  }
  // Tirage uniforme : la rare sort dans 5 cartes sur 20, soit 25 % des tirages (~10 sur 40).
  // Avec les probabilités globales (21 % de rare par carte), elle sortait dans ~69 % des tirages (~28).
  assert.ok(rare <= 19, `trop de tirages avec la rare : ${rare}/${N}`);
  assert.ok(rare >= 2, `pas assez de tirages avec la rare : ${rare}/${N}`);
});
