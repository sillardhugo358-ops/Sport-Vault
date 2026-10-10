'use strict';

// Amis et profils publics : amitié par code d'échange et acceptation, limites, droits, visibilité (public / amis / privé), contenu du profil.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');

let server, a, b, c, d;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const codeOf = async p => (await p.get('/api/trades')).body.code;

test.before(async () => {
  server = await startServer();
  [a, b, c, d] = [await newPlayer(server, 'Alice'), await newPlayer(server, 'Bruno'), await newPlayer(server, 'Carla'), await newPlayer(server, 'Dylan')];
});
test.after(async () => { await server.stop?.(); });

test('demande d\'ami : connexion requise, code valide, pas soi-même, pas deux fois', async () => {
  const cb = await codeOf(b), ca = await codeOf(a);
  assert.equal((await client(server).post('/api/friends/request', { code: cb })).status, 401);
  assert.equal((await a.post('/api/friends/request', { code: 'court' })).status, 400);
  assert.equal((await a.post('/api/friends/request', { code: 'ZZZZZZZZ' })).status, 404);
  assert.equal((await a.post('/api/friends/request', { code: ca })).status, 400, 'soi-même');
  assert.equal((await a.post('/api/friends/request', { code: cb })).status, 200);
  assert.equal((await a.post('/api/friends/request', { code: cb })).status, 400, 'déjà envoyée');
  const sb = (await b.get('/api/friends')).body;
  assert.equal(sb.incoming.length, 1);
  assert.equal(sb.incoming[0].name, 'Alice');
  assert.equal(sb.friends.length, 0);
  const notif = await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind='friend_request'", [b.user.id]);
  assert.equal(notif.length, 1);
});

test('acceptation : seul le destinataire accepte ; l\'auteur peut annuler ; refus = rien', async () => {
  const sb = (await b.get('/api/friends')).body, id = sb.incoming[0].id;
  assert.equal((await a.post('/api/friends/accept', { id })).status, 403, 'l\'auteur ne peut pas accepter');
  assert.equal((await c.post('/api/friends/accept', { id })).status, 404, 'un tiers ne voit rien');
  assert.equal((await b.post('/api/friends/accept', { id })).status, 200);
  assert.equal((await a.get('/api/friends')).body.friends[0].name, 'Bruno');
  assert.equal((await b.get('/api/friends')).body.friends[0].name, 'Alice');
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(b) })).status, 400, 'déjà amis');
  assert.equal((await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind='friend_accepted'", [a.user.id])).length, 1);
  // annulation par l'auteur, refus par le destinataire
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  const idc = (await a.get('/api/friends')).body.outgoing[0].id;
  assert.equal((await c.post('/api/friends/cancel', { id: idc })).status, 403);
  assert.equal((await a.post('/api/friends/cancel', { id: idc })).status, 200);
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  assert.equal((await c.post('/api/friends/decline', { id: (await c.get('/api/friends')).body.incoming[0].id })).status, 200);
  assert.deepEqual((await c.get('/api/friends')).body.incoming, []);
});

test('demandes croisées : la deuxième confirme l\'amitié', async () => {
  assert.equal((await c.post('/api/friends/request', { code: await codeOf(d) })).status, 200);
  assert.equal((await d.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  assert.equal((await c.get('/api/friends')).body.friends.length, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM friendships WHERE status=\'pending\' AND (requester=$1 OR requester=$2)', [c.user.id, d.user.id]))[0].n, 0);
});

test('profil public : contenu, visibilité public / amis / privé, rien de sensible', async () => {
  await q("UPDATE users SET xp=1200 WHERE id=$1", [b.user.id]);
  const cb = await codeOf(b);
  let r = await d.get('/api/players/profile?code=' + cb);          // public par défaut : visible par un inconnu
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.player.name, 'Bruno');
  assert.ok(r.body.player.level >= 1);
  assert.equal(r.body.player.relation, 'none');
  const text = JSON.stringify(r.body);
  assert.ok(!/@|email|coins|password/i.test(text), 'aucune donnée sensible');
  assert.equal((await b.post('/api/profile/visibility', { visibility: 'nimporte' })).status, 400);
  assert.equal((await b.post('/api/profile/visibility', { visibility: 'friends' })).status, 200);
  assert.equal((await d.get('/api/players/profile?code=' + cb)).status, 403, 'amis seulement : un inconnu est refusé');
  assert.equal((await d.get('/api/players/profile?code=' + cb)).body.player.name, 'Bruno', 'mais le nom reste visible pour demander en ami');
  assert.equal((await a.get('/api/players/profile?code=' + cb)).status, 200, 'un ami voit');
  assert.equal((await a.get('/api/players/profile?code=' + cb)).body.player.relation, 'friend');
  await b.post('/api/profile/visibility', { visibility: 'private' });
  assert.equal((await a.get('/api/players/profile?code=' + cb)).status, 403, 'privé : même les amis sont refusés');
  assert.equal((await b.get('/api/players/profile?code=' + cb)).status, 200, 'mais le joueur voit toujours son propre profil');
});

test('retirer un ami et limites', async () => {
  const ida = (await a.get('/api/friends')).body.friends[0].id;
  assert.equal((await c.post('/api/friends/remove', { id: ida })).status, 404, 'un tiers ne retire rien');
  assert.equal((await a.post('/api/friends/remove', { id: ida })).status, 200);
  assert.deepEqual((await a.get('/api/friends')).body.friends, []);
  // limite de demandes envoyées en attente
  const targets = [];
  for (let i = 0; i < 21; i++) targets.push(await newPlayer(server, 'Cible' + i));
  let last;
  for (const t of targets) last = await a.post('/api/friends/request', { code: await codeOf(t) });
  assert.equal(last.status, 400, 'plus de 20 demandes en attente');
  assert.match(last.body.error, /demandes en attente/);
});
