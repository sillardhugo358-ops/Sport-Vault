'use strict';

// Roue des éditions limitées : seules les cartes spéciales (rareté verrouillée) d'un pool la déclenchent ; la limitée gagnée
// s'ajoute aux cartes tirées ; une édition épuisée devient une case « rien » ; les limitées ne s'échangent pas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins } = require('./helpers');

let server, p;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const card = (id, rarity, extra = {}) => q(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,rarity_locked,is_limited,max_supply)
  VALUES($1,'2026-2027',$2,'ST','FC Roue','France',$3,70,$4,$5,$6)`, [id, 'Carte ' + id, rarity, !!extra.locked, !!extra.limited, extra.supply ?? null]);
const pool = (id, ids) => q("INSERT INTO pack_pools(id,name,type,config,price,cards,active) VALUES($1,$2,'manual',$3,0,1,true)", [id, 'Pool ' + id, JSON.stringify({ cardIds: ids })]);

test.before(async () => {
  server = await startServer({ env: { WHEEL_TEST_CHANCES: '{"5":100}', NODE_ENV: 'test' } });
  p = await newPlayer(server, 'Rouleur');
  await setCoins(server, p.user.id, 1000);
  await card('roue-spec', 'icon', { locked: true });
  await card('roue-norm', 'common');
  await card('roue-lim5', 'epic', { limited: true, supply: 5 });
  await pool('roue-pool-spec', ['roue-spec']);
  await pool('roue-pool-norm', ['roue-norm']);
});
test.after(async () => { await server.stop?.(); });

test('carte normale : pas de roue', async () => {
  const r = await p.post('/api/pools/open', { poolId: 'roue-pool-norm' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.wheels, []);
  assert.equal(r.body.cards.length, 1);
});

test('carte spéciale : la roue donne la limitée EN PLUS, numérotée, jamais échangeable', async () => {
  const r = await p.post('/api/pools/open', { poolId: 'roue-pool-spec' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.wheels.length, 1);
  const w = r.body.wheels[0];
  assert.equal(w.tier, 5, JSON.stringify(r.body.wheels));
  assert.equal(w.segments[w.index].label, '/5');
  assert.equal(r.body.cards.length, 2);
  const bonus = r.body.cards.find(c => c.bonus);
  assert.equal(bonus.cardId, 'roue-lim5');
  assert.equal(bonus.serial, 1);
  assert.equal(bonus.maxSupply, 5);
  assert.equal(bonus.serialLabel, '1/5');
  const rows = await q("SELECT serial,source FROM card_instances WHERE card_id='roue-lim5'");
  assert.equal(rows.length, 1);
});

test('stock épuisé : la case devient « rien », aucune limitée, la carte spéciale reste acquise', async () => {
  for (let i = 0; i < 4; i++) {
    const r = await p.post('/api/pools/open', { poolId: 'roue-pool-spec' });
    assert.equal(r.body.wheels[0].tier, 5);
  }
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE card_id='roue-lim5'"))[0].n, 5);
  const r = await p.post('/api/pools/open', { poolId: 'roue-pool-spec' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = r.body.wheels[0];
  assert.equal(w.tier, null);
  assert.ok(w.segments.every(s => s.tier === null));
  assert.equal(w.segments[w.index].label, 'RIEN');
  assert.equal(r.body.cards.length, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE card_id='roue-lim5'"))[0].n, 5);
});
