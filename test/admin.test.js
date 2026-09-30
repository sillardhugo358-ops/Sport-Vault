'use strict';

// Console d'administration (lib/admin.js) : accès, lectures, actions sur les comptes et les packs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');

let server, creator;
test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

const READS = ['/api/admin/overview', '/api/admin/users', '/api/admin/logs', '/api/admin/competitions', '/api/admin/packs', '/api/admin/cards', '/api/admin/auctions', '/api/admin/collections'];

test('admin : routes refusées à un joueur', async () => {
  const p = await newPlayer(server, 'Curieux');
  for (const url of READS) assert.equal((await p.get(url)).status, 403, url);
  assert.equal((await p.post(`/api/admin/users/${creator.user.id}/resources`, { resource: 'coins', amount: 1000 })).status, 403);
});

test('admin : lectures de la console', async () => {
  for (const url of READS) assert.equal((await creator.get(url)).status, 200, url);
  const p = await newPlayer(server, 'Fiche');
  const detail = await creator.get('/api/admin/users/' + p.user.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.user.id, p.user.id);
  const cards = (await creator.get('/api/admin/cards')).body.cards;
  assert.ok(cards.length > 0 && cards[0].id && cards[0].rarityLabel && !('card_order' in cards[0]));
});

test('admin : FC ajoutés et carte donnée, tracés dans les journaux', async () => {
  const p = await newPlayer(server, 'Beneficiaire');
  const add = await creator.post(`/api/admin/users/${p.user.id}/resources`, { resource: 'coins', amount: 500, reason: 'test' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(Number((await userRow(server, p.user.id)).coins), 1500);
  const cardId = (await server.db.query('SELECT id FROM catalog_cards WHERE is_active ORDER BY id LIMIT 1')).rows[0].id;
  const grant = await creator.post('/api/admin/cards/grant', { userId: p.user.id, cardId });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  assert.equal((await p.get('/api/collection')).body.count, 4);
  const logs = (await server.db.query('SELECT action FROM admin_logs WHERE target_user_id=$1', [p.user.id])).rows.map(r => r.action);
  assert.equal(logs.length, 2, JSON.stringify(logs));
});

test('admin : bannissement coupe la session ; on ne se bannit pas soi-même', async () => {
  const p = await newPlayer(server, 'Banni');
  assert.equal((await creator.post(`/api/admin/users/${creator.user.id}/action`, { action: 'ban' })).status, 400);
  const ban = await creator.post(`/api/admin/users/${p.user.id}/action`, { action: 'ban' });
  assert.equal(ban.status, 200, JSON.stringify(ban.body));
  assert.equal((await p.get('/api/me')).status, 401);
  assert.equal((await userRow(server, p.user.id)).account_status, 'banned');
});

test('admin : modification d\'un pack enregistrée (conditions comprises)', async () => {
  const conditions = { competitions: ['ligue-1'], decades: [], rarities: [], standardOnly: true };
  // Inactif : dans la base de test, aucune carte n'est rattachée aux saisons de la Ligue 1
  // (un pack actif sans carte éligible est refusé, voir test/shop.test.js).
  const r = await creator.post('/api/admin/packs', { action: 'pack_update', id: 'pack-ligue-1', name: 'PACK LIGUE 1', price: 350, cards: 6, badge: 'FRANCE', description: 'test', guarantee: 'rare', guaranteeCount: 1, conditions, active: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (await server.db.query("SELECT price,conditions FROM pack_definitions WHERE id='pack-ligue-1'")).rows[0];
  assert.equal(Number(row.price), 350);
  assert.deepEqual(row.conditions.competitions, ['ligue-1']);
});
