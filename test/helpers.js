'use strict';

// Harnais des tests d'intégration FOOTVAULT.
// Chaque fichier de test démarre son propre serveur sur une base PostgreSQL
// jetable (créée puis supprimée), et dialogue avec lui en HTTP comme le
// navigateur. Requiert TEST_DATABASE_URL : une connexion à un serveur
// PostgreSQL de test autorisé à créer des bases. Jamais la production.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');

function adminUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL manquante : voir test/README.md.');
  return url;
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = '/' + name;
  return u.toString();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer() {
  const dbName = 'fv_test_' + crypto.randomBytes(5).toString('hex');
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const databaseUrl = withDatabase(adminUrl(), dbName);
  const port = await freePort();
  let logs = '';
  const child = spawn(process.execPath, ['-r', './security-bootstrap.js', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), NODE_ENV: 'test', ADMIN_EMAILS: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('Le serveur s\'est arrêté au démarrage :\n' + logs);
    try {
      const r = await fetch(base + '/api/health');
      const body = await r.json();
      if (body.ready && body.storage === 'postgres') break;
    } catch {}
    if (Date.now() > deadline) throw new Error('Serveur non prêt après 60 s :\n' + logs);
    await new Promise(r => setTimeout(r, 250));
  }
  const db = new Pool({ connectionString: databaseUrl, max: 2 });
  let ipCounter = 0;
  return {
    base,
    db,
    logs: () => logs,
    // Chaque joueur a sa propre IP : le serveur limite à une inscription
    // par IP toutes les 72 h.
    newIp: () => `10.${(process.pid >> 8) & 255}.${process.pid & 255}.${++ipCounter}`,
    async stop() {
      await db.end();
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  };
}

// Client HTTP d'un joueur : garde son cookie de session et son IP.
function client(server, ip = server.newIp()) {
  let cookie = '';
  async function call(method, route, body) {
    const headers = { 'X-Forwarded-For': ip };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(server.base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = r.headers.get('set-cookie');
    const m = setCookie && /fv_session=([^;]*)/.exec(setCookie);
    if (m) cookie = m[1] ? 'fv_session=' + m[1] : '';
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, body: data };
  }
  return {
    ip,
    get: route => call('GET', route),
    post: (route, body = {}) => call('POST', route, body)
  };
}

// Crée un compte et renvoie son client connecté.
async function newPlayer(server, name = 'Joueur') {
  const c = client(server);
  const email = `${name.toLowerCase()}.${crypto.randomBytes(4).toString('hex')}@test.footvault`;
  const r = await c.post('/api/register', { name, email, password: 'MotDePasse123' });
  if (r.status !== 201 && r.status !== 200) throw new Error(`Inscription refusée (${r.status}) : ${JSON.stringify(r.body)}`);
  const me = await c.get('/api/me');
  c.user = me.body.user;
  c.email = email;
  return c;
}

async function setCoins(server, userId, coins) {
  await server.db.query('UPDATE users SET coins=$1 WHERE id=$2', [coins, userId]);
}

async function userRow(server, userId) {
  return (await server.db.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
}

module.exports = { startServer, client, newPlayer, setCoins, userRow };
