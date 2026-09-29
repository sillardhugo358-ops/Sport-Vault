'use strict';

// Démarrage avec ADMIN_EMAILS et ADMIN_BOOTSTRAP_PASSWORD : création du
// premier compte (admin, cartes de bienvenue) pendant l'initialisation, puis
// promotion en créateur au redémarrage suivant (comportement existant).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

const email = 'boss@test.footvault';
let server;
test.before(async () => {
  server = await startServer({ env: { ADMIN_EMAILS: email, ADMIN_BOOTSTRAP_PASSWORD: 'MotDePasse123', ADMIN_BOOTSTRAP_NAME: 'Boss' } });
});
test.after(async () => { await server?.stop(); });

test('premier compte : créé au démarrage, rôle admin, 3 cartes de bienvenue', async () => {
  const user = (await server.db.query('SELECT id,name,role,coins FROM users WHERE email=$1', [email])).rows[0];
  assert.ok(user, 'compte non créé');
  assert.equal(user.name, 'Boss');
  assert.equal(user.role, 'admin');
  const cards = Number((await server.db.query('SELECT count(*) FROM card_instances WHERE owner_id=$1', [user.id])).rows[0].count);
  assert.equal(cards, 3);
});

test('premier compte : connexion possible ; au redémarrage, créateur et sans doublon', async () => {
  const c = client(server);
  assert.equal((await c.post('/api/login', { email, password: 'MotDePasse123' })).status, 200);
  await server.restart();
  const n = Number((await server.db.query('SELECT count(*) FROM users WHERE email=$1', [email])).rows[0].count);
  assert.equal(n, 1);
  const role = (await server.db.query('SELECT role FROM users WHERE email=$1', [email])).rows[0].role;
  assert.equal(role, 'creator');
});
