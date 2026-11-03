'use strict';

// Mur des transferts : opt-in (désactivé par défaut), réciprocité (qui ne l'active pas ne le voit pas), pseudos seulement pour ceux qui l'ont activé,
// ventes terminées avec acheteur uniquement, fenêtre de 14 jours, rien de privé exposé.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client } = require('./helpers');

let server, seller, buyer, watcher, other, quiet;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
async function sale(from, to, price, { status = 'completed', daysAgo = 0, bidder = true } = {}) {
  n++;
  const inst = crypto.randomUUID();
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Mur','France','epic',86) ON CONFLICT DO NOTHING", ['wall-' + n, 'Carte Mur ' + n]);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,status)
    VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Mur','France','epic',86,'pack:test','owned')`, [inst, 'wall-' + n, to.user.id, 'Carte Mur ' + n]);
  await q(`INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,current_bidder_id,ends_at,status,completed_at)
    VALUES($1,$2,$3,$4,$4,$5,now() - interval '1 hour',$6, now() - ($7 || ' days')::interval)`, [crypto.randomUUID(), inst, from.user.id, price, bidder ? to.user.id : null, status, String(daysAgo)]);
}
const on = (p, v = true) => p.post('/api/transfer-wall/optin', { on: v });

test.before(async () => { server = await startServer(); [seller, buyer, watcher, other, quiet] = [await newPlayer(server, 'Vendeur'), await newPlayer(server, 'Acheteur'), await newPlayer(server, 'Curieux'), await newPlayer(server, 'Discret'), await newPlayer(server, 'Muet')]; });
test.after(async () => { await server.stop?.(); });

test('opt-in : désactivé par défaut, valeur booléenne stricte, connexion obligatoire', async () => {
  assert.equal((await client(server).get('/api/transfer-wall')).status, 401);
  assert.equal((await client(server).post('/api/transfer-wall/optin', { on: true })).status, 401);
  const d = (await seller.get('/api/transfer-wall')).body;
  assert.equal(d.optedIn, false);
  assert.deepEqual(d.items, []);
  assert.equal((await seller.post('/api/transfer-wall/optin', { on: 'oui' })).status, 400);
  assert.equal((await seller.post('/api/transfer-wall/optin', {})).status, 400);
  assert.equal((await on(seller)).body.optedIn, true);
  assert.equal((await seller.get('/api/transfer-wall')).body.optedIn, true);
  assert.equal((await on(seller, false)).body.optedIn, false);
});

test('mur : réciprocité, pseudos seulement pour ceux qui ont activé, ventes terminées récentes avec acheteur', async () => {
  await sale(seller, buyer, 4200);
  await sale(seller, buyer, 900, { daysAgo: 20 });            // trop ancienne
  await sale(seller, buyer, 700, { bidder: false });           // invendue
  await sale(seller, buyer, 650, { status: 'active' });        // pas terminée
  await sale(other, quiet, 800);                               // personne n'a activé : jamais affichée
  assert.deepEqual((await watcher.get('/api/transfer-wall')).body.items, [], 'pas activé : pas de mur');
  await on(seller);
  await on(watcher);
  const items = (await watcher.get('/api/transfer-wall')).body.items;
  assert.equal(items.length, 1, 'une seule vente éligible');
  assert.equal(items[0].price, 4200);
  assert.equal(items[0].seller, 'Vendeur', 'vendeur ayant activé : pseudo affiché');
  assert.equal(items[0].buyer, null, 'acheteur n’ayant pas activé : anonyme');
  await on(buyer);
  const both = (await watcher.get('/api/transfer-wall')).body.items[0];
  assert.equal(both.buyer, 'Acheteur');
  await on(seller, false); await on(buyer, false);
  assert.deepEqual((await watcher.get('/api/transfer-wall')).body.items, [], 'plus personne n’a activé : la vente disparaît');
  await on(buyer);
  const buyerOnly = (await watcher.get('/api/transfer-wall')).body.items[0];
  assert.equal(buyerOnly.seller, null);
  assert.equal(buyerOnly.buyer, 'Acheteur');
});

test('aucune information privée dans la réponse', async () => {
  const body = JSON.stringify((await watcher.get('/api/transfer-wall')).body);
  for (const secret of [seller.email, buyer.email, seller.user.id, buyer.user.id, 'password', 'coins']) assert.ok(!body.includes(secret), 'ne doit pas contenir ' + secret);
  assert.deepEqual(Object.keys((await watcher.get('/api/transfer-wall')).body.items[0]).sort(), ['at', 'buyer', 'card', 'id', 'price', 'seller']);
});
