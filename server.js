const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SESSION_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

let pool = null;
const memory = { users: new Map(), sessions: new Map() };

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Payload too large');
  }
  return JSON.parse(body || '{}');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hex] = String(stored).split(':');
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    coins: user.coins,
    gems: user.gems,
    xp: user.xp,
    createdAt: user.createdAt
  };
}

function sessionCookie(token) {
  return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

function expiryDate() {
  return new Date(Date.now() + SESSION_DAYS * 86400_000);
}

async function initDb() {
  if (!process.env.DATABASE_URL) return { mode: 'memory' };
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 5000
    });
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      name varchar(30) NOT NULL,
      email varchar(320) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      coins integer NOT NULL DEFAULT 1000,
      gems integer NOT NULL DEFAULT 50,
      xp integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    )`);
    return { mode: 'postgres' };
  } catch (error) {
    console.error('SPORT VAULT database unavailable:', error.message);
    if (pool) await pool.end().catch(() => {});
    pool = null;
    return { mode: 'memory', error: error.message };
  }
}

async function findUserByEmail(email) {
  if (pool) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }
  for (const user of memory.users.values()) if (user.email === email) return user;
  return null;
}

async function getUserById(id) {
  if (pool) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
  return memory.users.get(id) || null;
}

async function createUser({ name, email, password }) {
  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  const now = new Date();
  const user = { id, name, email, password_hash: passwordHash, coins: 1000, gems: 50, xp: 0, createdAt: now.toISOString() };
  if (pool) {
    await pool.query(
      'INSERT INTO users (id,name,email,password_hash,coins,gems,xp,created_at) VALUES ($1,$2,$3,$4,1000,50,0,$5)',
      [id, name, email, passwordHash, now]
    );
    return getUserById(id);
  }
  memory.users.set(id, user);
  return user;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = expiryDate();
  if (pool) await pool.query('INSERT INTO sessions (token,user_id,expires_at) VALUES ($1,$2,$3)', [token, userId, expires]);
  else memory.sessions.set(token, { userId, expiresAt: expires.getTime() });
  return token;
}

async function currentUser(req) {
  const token = cookies(req).fv_session;
  if (!token) return null;
  if (pool) {
    const result = await pool.query(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now()`, [token]);
    return result.rows[0] || null;
  }
  const session = memory.sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) { memory.sessions.delete(token); return null; }
  return memory.users.get(session.userId) || null;
}

async function destroySession(req, res) {
  const token = cookies(req).fv_session;
  if (token) {
    if (pool) await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
    else memory.sessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'fv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function staticFile(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(file).pipe(res);
}

(async () => {
  const db = await initDb();
  console.log(`SPORT VAULT startup: storage=${db.mode}`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, storage: pool ? 'postgres' : 'memory' });
      }

      if (req.method === 'GET' && url.pathname === '/api/me') {
        const user = await currentUser(req);
        return json(res, user ? 200 : 401, user ? { user: safeUser(user) } : { error: 'Non connecté' });
      }

      if (req.method === 'POST' && url.pathname === '/api/register') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (name.length < 2 || name.length > 30 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
          return json(res, 400, { error: 'Nom, email valide et mot de passe de 8 caractères minimum requis.' });
        }
        if (await findUserByEmail(email)) return json(res, 409, { error: 'Cet email est déjà utilisé.' });
        const user = await createUser({ name, email, password });
        const token = await createSession(user.id);
        res.setHeader('Set-Cookie', sessionCookie(token));
        return json(res, 201, { user: safeUser(user) });
      }

      if (req.method === 'POST' && url.pathname === '/api/login') {
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const user = await findUserByEmail(email);
        if (!user || !verifyPassword(password, user.password_hash)) return json(res, 401, { error: 'Email ou mot de passe incorrect.' });
        const token = await createSession(user.id);
        res.setHeader('Set-Cookie', sessionCookie(token));
        return json(res, 200, { user: safeUser(user) });
      }

      if (req.method === 'POST' && url.pathname === '/api/logout') {
        await destroySession(req, res);
        return json(res, 200, { ok: true });
      }

      return staticFile(req, res);
    } catch (error) {
      console.error('SPORT VAULT request error:', error);
      return json(res, 500, { error: 'Erreur serveur.' });
    }
  });

  const shutdown = async () => {
    if (pool) await pool.end().catch(() => {});
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(PORT, '0.0.0.0', () => console.log(`SPORT VAULT running on ${PORT}`));
})();
