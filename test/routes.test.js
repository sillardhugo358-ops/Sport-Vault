'use strict';

// Tour de toutes les routes de l'API (lib/routes/) : chacune répond, sans erreur serveur.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer } = require('./helpers');

let server, player, creator;
test.before(async () => {
  server = await startServer();
  player = await newPlayer(server, 'Visiteur');
  creator = await newPlayer(server, 'Createur');
  await server.db.query("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

test('routes joueur : lectures', async () => {
  const cardId = (await server.db.query('SELECT id FROM catalog_cards WHERE is_active ORDER BY id LIMIT 1')).rows[0].id;
  const expected = {
    '/api/me': 200, '/api/catalog/summary': 200, '/api/cards': 200, ['/api/cards/' + cardId]: 200, '/api/cards/inexistante': 404,
    '/api/packs': 200, '/api/collection': 200, '/api/achievements': 200, '/api/progression': 200, '/api/album': 200,
    '/api/auctions': 200, '/api/auctions/history': 200
  };
  for (const [url, status] of Object.entries(expected)) assert.equal((await player.get(url)).status, status, url);
  const ach = (await player.get('/api/achievements')).body;
  assert.ok(Array.isArray(ach.achievements) && ach.achievements.length > 0);
});

test('routes : non connecté refusé, succès inconnu refusé, import interne protégé', async () => {
  for (const url of ['/api/collection', '/api/progression', '/api/album', '/api/achievements']) {
    assert.equal((await fetch(server.base + url)).status, 401, url);
  }
  assert.equal((await player.post('/api/achievements/claim', { id: 'inexistant' })).status >= 400, true);
  const r = await fetch(server.base + '/api/internal/historical-import', { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
});

test('routes admin : succès et diagnostic IP', async () => {
  assert.equal((await creator.get('/api/admin/achievements')).status, 200);
  assert.equal((await creator.get('/api/admin/ip-debug')).status, 200);
  assert.equal((await player.get('/api/admin/achievements')).status, 403);
});

test('routes : chemin inconnu servi comme fichier statique, pas comme erreur serveur', async () => {
  const r = await fetch(server.base + '/api/inexistant');
  assert.notEqual(r.status, 500);
  assert.equal((await fetch(server.base + '/')).status, 200);
});
