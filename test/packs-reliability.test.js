'use strict';

// Fiabilité des packs et pools : cartes LIMITED épuisées exclues du tirage, garantie de rareté
// impossible refusée (éditeur et tirage, rien débité), pools mal réglés refusés, suppression d'un
// pool utilisé expliquée, jamais de tirage dans tout le catalogue faute de réglage.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, setCoins, userRow } = require('./helpers');

let server, creator;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const packBody = extra => ({ action: 'pack_create', name: 'Pack fiable', price: 100, cards: 2, badge: '', description: 'test', guarantee: 'common', guaranteeCount: 0, conditions: {}, active: true, ...extra });
const poolBody = (type, config, extra = {}) => ({ action: 'pool_create', name: 'Pool fiable', type, price: 50, cards: 1, active: true, config, ...extra });
const coinsOf = async p => Number((await userRow(server, p.user.id)).coins);

async function limitedCard(id, maxSupply, issued) {
  await q(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,max_supply,card_order,is_active)
    VALUES($1,'2026-2027',$2,'ST','FC Limité','France','epic',85,85,85,85,85,85,85,'LIMITED',true,$3,1,true)`, [id, 'Limitée ' + id, maxSupply]);
  const owner = (await q('SELECT id FROM users LIMIT 1'))[0].id;
  for (let serial = 1; serial <= issued; serial++) {
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,is_limited,serial,max_supply,source)
      VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Limité','France','epic',true,$5,$6,'pack:test')`, [crypto.randomUUID(), id, owner, 'Limitée ' + id, serial, maxSupply]);
  }
}

test('LIMITED épuisée : exclue du tirage (jamais d\'échec au hasard) ; tout épuisé : 409 sans débit', async () => {
  await limitedCard('lim-vendue', 2, 2);   // 2 / 2 : épuisée
  await limitedCard('lim-dispo-a', 50, 0);
  await limitedCard('lim-dispo-b', 50, 0);
  const pool = await creator.post('/api/admin/packs', poolBody('manual', { cardIds: ['lim-vendue', 'lim-dispo-a', 'lim-dispo-b'], specialCount: 3, rareCount: 0, commonCount: 0 }));
  assert.equal(pool.status, 200, JSON.stringify(pool.body));
  const poolId = (await q("SELECT id FROM pack_pools WHERE name='Pool fiable'"))[0].id;
  const p = await newPlayer(server, 'Tireur');
  await setCoins(server, p.user.id, 100000);
  for (let i = 0; i < 25; i++) {
    const r = await p.post('/api/pools/open', { poolId });
    assert.equal(r.status, 200, 'tirage ' + i + ' : ' + JSON.stringify(r.body));
    assert.ok(r.body.cards.every(c => c.cardId !== 'lim-vendue'), 'carte épuisée jamais tirée');
  }
  // Tout épuisé : message clair, rien débité.
  const owner = (await q('SELECT id FROM users LIMIT 1'))[0].id;
  for (const id of ['lim-dispo-a', 'lim-dispo-b']) {
    await q('UPDATE catalog_cards SET max_supply=1,updated_at=now() WHERE id=$1', [id]);
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,is_limited,serial,max_supply,source)
      VALUES($1,$2,$3,'2026-2027','x','ST','FC Limité','France','epic',true,1,1,'pack:test')`, [crypto.randomUUID(), id, owner]);
  }
  const before = await coinsOf(p);
  const r = await p.post('/api/pools/open', { poolId });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(await coinsOf(p), before);
});

test('garantie impossible : refusée dans l\'éditeur ; à l\'ouverture, 409 sans débit', async () => {
  const bad = await creator.post('/api/admin/packs', packBody({ guarantee: 'icon', guaranteeCount: 1, conditions: { rarities: ['common'] } }));
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.match(bad.body.error, /garantie/);
  assert.equal((await creator.post('/api/admin/packs', packBody({ guarantee: 'rare', guaranteeCount: 1, conditions: { rarities: ['common', 'rare'] } }))).status, 200);
  // Pack déjà en base (ancienne configuration) : le tirage refuse plutôt que d'ignorer la garantie.
  await q("INSERT INTO pack_definitions(id,name,price,currency,cards,guarantee,guarantee_count,conditions,active) VALUES('pack-garantie','PACK GARANTIE',100,'coins',2,'icon',1,$1,true)", [JSON.stringify({ rarities: ['common'] })]);
  const p = await newPlayer(server, 'Garantie');
  const r = await p.post('/api/packs/open', { packId: 'pack-garantie' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /garantie/);
  assert.equal(await coinsOf(p), 1000);
  assert.equal((await p.get('/api/collection')).body.count, 3, 'seulement les cartes de bienvenue');
});

test('pools mal réglés refusés ; jamais de tirage dans tout le catalogue', async () => {
  for (const [type, config, re] of [['club', {}, /club/], ['season', {}, /saison/], ['rarity', { rarities: [] }, /raret/], ['club', { club: 'Club inexistant' }, /Aucune carte active/]]) {
    const r = await creator.post('/api/admin/packs', poolBody(type, config));
    assert.equal(r.status, 400, type + ' : ' + JSON.stringify(r.body));
    assert.match(r.body.error, re, type);
  }
  assert.equal((await creator.post('/api/admin/packs', poolBody('rarity', { rarities: ['rare'] }))).status, 200);
  // Pool « club » sans réglage déjà en base : aucun tirage possible (et non tout le catalogue).
  await q("INSERT INTO pack_pools(id,name,type,config,price,cards,active) VALUES('pool-sans-club','POOL SANS CLUB','club','{}',10,1,true)");
  const p = await newPlayer(server, 'Curieux');
  const r = await p.post('/api/pools/open', { poolId: 'pool-sans-club' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(await coinsOf(p), 1000);
});

test('suppression d\'un pool utilisé : message clair (409) ; libre : supprimé', async () => {
  const pool = await creator.post('/api/admin/packs', poolBody('rarity', { rarities: ['rare'] }, { name: 'Pool utilisé' }));
  const poolId = (await q("SELECT id FROM pack_pools WHERE name='Pool utilisé'"))[0].id;
  assert.equal(pool.status, 200);
  assert.equal((await creator.post('/api/admin/packs', packBody({ name: 'Pack du pool', poolId }))).status, 200);
  const del = await creator.post('/api/admin/packs', { action: 'pool_delete', id: poolId });
  assert.equal(del.status, 409, JSON.stringify(del.body));
  assert.match(del.body.error, /Pack du pool/);
  await q("DELETE FROM pack_definitions WHERE name='Pack du pool'");
  assert.equal((await creator.post('/api/admin/packs', { action: 'pool_delete', id: poolId })).status, 200);
});
