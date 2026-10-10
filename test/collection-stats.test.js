'use strict';

// Statistiques de collection : droits, répartition par rareté et par poste, valeur indicative (médiane des ventes, cartes sans vente exclues),
// % complété par compétition et décennie d'après l'album.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client } = require('./helpers');

let server, p;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
async function give(owner, { rarity, position = 'ST', name, ovr = 80 }) {
  n++;
  const cardId = 'stat-' + n, id = crypto.randomUUID(), nm = name || 'Carte Stat ' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,$3,'FC Stat','France',$4,$5)", [cardId, nm, position, rarity, ovr]);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
    VALUES($1,$2,$3,'2026-2027',$4,$5,'FC Stat','France',$6,$7,'pack:test')`, [id, cardId, owner.user.id, nm, position, rarity, ovr]);
  return { cardId, id };
}

test.before(async () => { server = await startServer(); p = await newPlayer(server, 'Statisticien'); });
test.after(async () => { await server.stop?.(); });

test('droits et forme de la réponse', async () => {
  assert.equal((await client(server).get('/api/collection/stats')).status, 401);
  const r = await p.get('/api/collection/stats');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const k of ['totals', 'competitions', 'decades', 'rarities', 'positions', 'value']) assert.ok(k in r.body, k);
  assert.deepEqual(r.body.rarities.map(x => x.rarity), ['icon', 'legendary', 'epic', 'rare', 'common']);
});

test('rareté, poste et valeur indicative (sans vente = pas de prix)', async () => {
  const before = (await p.get('/api/collection/stats')).body;
  const a = await give(p, { rarity: 'epic', position: 'GK', name: 'Gardien Cher' });
  await give(p, { rarity: 'epic', position: 'GK', name: 'Gardien Sans Vente' });
  const b = await give(p, { rarity: 'common', position: 'CB', name: 'Défenseur Vendu' });
  // deux ventes terminées pour a (médiane 300) et une pour b (50), via un second joueur
  const buyer = await newPlayer(server, 'Acheteur');
  for (const [card, price] of [[a, 200], [a, 400], [b, 50]]) {
    const inst = crypto.randomUUID();
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
      SELECT $1,card_id,$3,season,name,position,club,nation,rarity,ovr,'pack:test' FROM card_instances WHERE instance_id=$2`, [inst, card.id, buyer.user.id]);
    await q(`INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,current_bidder_id,status,starts_at,ends_at,completed_at)
      VALUES($1,$2,$3,$4,$4,$5,'completed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour')`, [crypto.randomUUID(), inst, p.user.id, price, buyer.user.id]);
  }
  const r = (await p.get('/api/collection/stats')).body;
  const rar = k => r.rarities.find(x => x.rarity === k), rar0 = k => before.rarities.find(x => x.rarity === k);
  assert.equal(rar('epic').unique - rar0('epic').unique, 2);
  assert.equal(rar('common').unique - rar0('common').unique, 1);
  const pos = k => r.positions.find(x => x.position === k)?.unique || 0, pos0 = k => before.positions.find(x => x.position === k)?.unique || 0;
  assert.equal(pos('GK') - pos0('GK'), 2);
  assert.equal(pos('CB') - pos0('CB'), 1);
  assert.equal(r.value.estimated - before.value.estimated, 300 + 50, 'médiane 300 pour a, 50 pour b');
  assert.equal(r.value.unpriced - before.value.unpriced, 1, 'la carte jamais vendue n\'a pas de prix');
  assert.equal(r.value.top[0].name, 'Gardien Cher');
  assert.equal(r.value.top[0].price, 300);
  assert.equal(r.totals.unique - before.totals.unique, 3);
});

test('compétitions et décennies : pourcentages cohérents avec l\'album', async () => {
  const r = (await p.get('/api/collection/stats')).body;
  for (const c of [...r.competitions, ...r.decades]) {
    assert.ok(c.total > 0 && c.owned >= 0 && c.owned <= c.total, JSON.stringify(c));
    assert.ok(c.pct >= 0 && c.pct <= 100);
  }
  const album = (await p.get('/api/album')).body.album;
  const sum = album.competitions.reduce((n, c) => n + c.seasons.reduce((m, s) => m + (s.clubs || []).reduce((k, cl) => k + cl.owned, 0), 0), 0);
  assert.equal(r.competitions.reduce((n, c) => n + c.owned, 0), sum, 'mêmes cartes possédées que l\'album');
});
