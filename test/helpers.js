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

// options.env : variables d'environnement supplémentaires du serveur.
async function startServer(options = {}) {
  const dbName = 'fv_test_' + crypto.randomBytes(5).toString('hex');
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const databaseUrl = withDatabase(adminUrl(), dbName);
  let child = null;
  const cleanup = async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  };
  // Plusieurs fichiers de test tournent en parallèle : si le port choisi
  // est pris entre-temps, le serveur s'arrête et on réessaie ailleurs.
  async function launchWithRetry() {
    for (let attempt = 1; ; attempt++) {
      const port = await freePort();
      const started = await launch(databaseUrl, port, options.env);
      child = started.child;
      if (started.ok) return { port, logs: started.logs };
      if (!started.portInUse || attempt >= 3) throw new Error(started.error);
    }
  }
  try {
    const first = await launchWithRetry();
    const db = new Pool({ connectionString: databaseUrl, max: 2 });
    let ipCounter = 0;
    const server = {
      base: `http://127.0.0.1:${first.port}`,
      db,
      databaseUrl,
      logs: first.logs,
      // Chaque joueur a sa propre IP : le serveur limite à une inscription
      // par IP toutes les 72 h.
      newIp: () => `10.${(process.pid >> 8) & 255}.${process.pid & 255}.${++ipCounter}`,
      // Redémarre le serveur sur la même base (migrations au démarrage).
      async restart() {
        child.kill('SIGTERM');
        await new Promise(r => child.once('exit', r));
        const next = await launchWithRetry();
        server.base = `http://127.0.0.1:${next.port}`;
        server.logs = next.logs;
      },
      async stop() {
        await db.end();
        await cleanup();
      }
    };
    return server;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

async function launch(databaseUrl, port, extraEnv = {}) {
  let logs = '';
  const child = spawn(process.execPath, ['-r', './security-bootstrap.js', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), NODE_ENV: 'test', ADMIN_EMAILS: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) return { ok: false, child, portInUse: /EADDRINUSE/.test(logs), error: 'Le serveur s\'est arrêté au démarrage :\n' + logs };
    // N'interroger le port qu'une fois que *notre* serveur l'écoute.
    if (logs.includes(`running on ${port}`)) {
      try {
        const r = await fetch(base + '/api/health');
        const body = await r.json();
        if (body.ready && body.storage === 'postgres') return { ok: true, child, logs: () => logs };
      } catch {}
    }
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
      return { ok: false, child, portInUse: false, error: 'Serveur non prêt après 60 s :\n' + logs };
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

// Les récompenses quotidiennes et hebdomadaires dépendent de l'heure réelle :
// si minuit (heure de Paris) approche, attendre qu'il soit passé pour qu'un
// test ne commence pas un jour et ne finisse pas le lendemain.
async function awayFromParisMidnight(marginMs = 120_000) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  const msToMidnight = ((24 - Number(parts.hour)) * 3600 - Number(parts.minute) * 60 - Number(parts.second)) * 1000;
  if (msToMidnight < marginMs) await new Promise(r => setTimeout(r, msToMidnight + 2000));
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

module.exports = { startServer, client, newPlayer, setCoins, userRow, awayFromParisMidnight };
