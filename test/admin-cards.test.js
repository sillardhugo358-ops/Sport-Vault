'use strict';

// Catalogue admin paginé côté serveur (/api/admin/cards/page) et résumé (/api/admin/cards/summary).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server, admin;
test.before(async () => {
  server = await startServer();
  admin = await newPlayer(server, 'Admin');
  await server.db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
  // 120 cartes d'un club de test, pour des pages pleines et des filtres précis.
  const values = [], params = [];
  for (let i = 0; i < 120; i++) {
    const rarity = i < 5 ? 'epic' : 'common', ovr = i < 5 ? 85 : 70;
    params.push(`pg-test-${String(i).padStart(3, '0')}`, `Joueur Page ${i}`, i % 2 ? 'ST' : 'GK', rarity, ovr, 1000 + i);
    const b = i * 6;
    values.push(`($${b + 1},'2026-2027',$${b + 2},$${b + 3},'FC Pagination','France',$${b + 4},$${b + 5},$${b + 6})`);
  }
  await server.db.query(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,card_order) VALUES ${values.join(',')}`, params);
});
test.after(async () => { await server?.stop(); });

const page = (who, qs) => who.get('/api/admin/cards/page?' + new URLSearchParams(qs).toString());

test('droits : réservé aux admins', async () => {
  const p = await newPlayer(server, 'Joueur');
  assert.equal((await page(p, {})).status, 403);
  assert.equal((await p.get('/api/admin/cards/summary')).status, 403);
});

test('pages de 50 cartes, total exact, page bornée', async () => {
  const p1 = await page(admin, { club: 'FC Pagination' });
  assert.equal(p1.status, 200);
  assert.deepEqual([p1.body.total, p1.body.pages, p1.body.page, p1.body.cards.length], [120, 3, 1, 50]);
  assert.equal(p1.body.cards[0].id, 'pg-test-000');
  const p3 = await page(admin, { club: 'FC Pagination', page: 3 });
  assert.equal(p3.body.cards.length, 20);
  assert.equal(p3.body.cards[19].id, 'pg-test-119');
  const over = await page(admin, { club: 'FC Pagination', page: 99 });
  assert.equal(over.body.page, 3);
  const ids = new Set([...p1.body.cards, ...(await page(admin, { club: 'FC Pagination', page: 2 })).body.cards, ...p3.body.cards].map(c => c.id));
  assert.equal(ids.size, 120);
});

test('filtres combinés : recherche, rareté, poste ; caractères spéciaux sans erreur', async () => {
  const epic = await page(admin, { club: 'FC Pagination', rarity: 'epic' });
  assert.equal(epic.body.total, 5);
  const gk = await page(admin, { club: 'FC Pagination', position: 'GK', rarity: 'epic' });
  assert.deepEqual(gk.body.cards.map(c => c.id), ['pg-test-000', 'pg-test-002', 'pg-test-004']);
  const q = await page(admin, { q: 'joueur page 11' });
  assert.deepEqual(q.body.cards.map(c => c.id).sort(), ['pg-test-011', 'pg-test-110', 'pg-test-111', 'pg-test-112', 'pg-test-113', 'pg-test-114', 'pg-test-115', 'pg-test-116', 'pg-test-117', 'pg-test-118', 'pg-test-119']);
  await server.db.query("UPDATE catalog_cards SET name='Kylian Mbappé' WHERE id='pg-test-050'");
  assert.deepEqual((await page(admin, { q: 'MBAPPE', club: 'FC Pagination' })).body.cards.map(c => c.id), ['pg-test-050']);
  assert.deepEqual((await page(admin, { q: 'mbappé', club: 'FC Pagination' })).body.cards.map(c => c.id), ['pg-test-050']);
  for (const weird of ['%', '_', "'; DROP TABLE users; --", '\\']) {
    const r = await page(admin, { q: weird, club: 'FC Pagination' });
    assert.equal(r.status, 200, weird);
    assert.equal(r.body.total, 0, weird);
  }
});

test('exemplaires et détenteurs par carte ; résumé du catalogue', async () => {
  const before = (await admin.get('/api/admin/cards/summary')).body;
  const p = await newPlayer(server, 'Detenteur');
  for (let i = 0; i < 2; i++) assert.equal((await admin.post('/api/admin/cards/grant', { userId: p.user.id, cardId: 'pg-test-007' })).status, 200);
  const r = await page(admin, { q: 'pg-test-007' });
  assert.deepEqual([r.body.cards[0].totalInstances, r.body.cards[0].owners], [2, 1]);
  const s = (await admin.get('/api/admin/cards/summary')).body;
  assert.equal(s.cards, (await server.db.query('SELECT count(*)::int AS n FROM catalog_cards WHERE is_active')).rows[0].n);
  assert.ok(s.instances > before.instances);
  assert.ok(s.clubs.some(c => c.name === 'FC Pagination' && c.cards === 120));
  for (const k of ['rarities', 'positions', 'seasons', 'nations']) assert.ok(Array.isArray(s[k]) && s[k].length, k);
});

test('carte désactivée : absente des pages et du résumé', async () => {
  await server.db.query("UPDATE catalog_cards SET is_active=false WHERE id='pg-test-119'");
  const r = await page(admin, { club: 'FC Pagination' });
  assert.equal(r.body.total, 119);
  assert.ok((await admin.get('/api/admin/cards/summary')).body.clubs.some(c => c.name === 'FC Pagination' && c.cards === 119));
});
