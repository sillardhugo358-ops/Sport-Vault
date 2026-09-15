const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SESSION_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

let pool = null;
const memory = { users: new Map(), sessions: new Map(), cards: new Map() };

const RARITIES = {
  common: { label: 'COMMON', supply: 1000, order: 1 },
  rare: { label: 'RARE', supply: 500, order: 2 },
  epic: { label: 'EPIC', supply: 250, order: 3 },
  legendary: { label: 'LEGENDARY', supply: 100, order: 4 },
  icon: { label: 'ICON', supply: 25, order: 5 }
};

const FOOTVAULT_CARDS = [
  ['Nolan Vasseur', 'GK', 'Aster FC', 'France', 'common'],
  ['Maël Dervin', 'GK', 'Racing Nord', 'France', 'common'],
  ['Ilyan Mercier', 'RB', 'Union Atlantique', 'France', 'common'],
  ['Sacha Perrin', 'LB', 'Stade Horizon', 'France', 'common'],
  ['Noé Caron', 'CB', 'Aster FC', 'Belgium', 'common'],
  ['Tiago Valente', 'CM', 'Racing Nord', 'Portugal', 'common'],
  ['Yanis Roux', 'CM', 'Union Atlantique', 'France', 'common'],
  ['Eden Marceau', 'RW', 'Stade Horizon', 'France', 'common'],
  ['Kylian Mercier', 'ST', 'Aster FC', 'France', 'common'],
  ['Liam Sorel', 'LW', 'Racing Nord', 'France', 'common'],
  ['Hugo Delmas', 'CB', 'Union Atlantique', 'France', 'rare'],
  ['Amine Bensaïd', 'DM', 'Stade Horizon', 'Morocco', 'rare'],
  ['Rayan Giraud', 'AM', 'Aster FC', 'France', 'rare'],
  ['Matteo Rinaldi', 'ST', 'Racing Nord', 'Italy', 'rare'],
  ['Elias Novak', 'GK', 'Union Atlantique', 'Croatia', 'rare'],
  ['Iker Solano', 'LW', 'Stade Horizon', 'Spain', 'rare'],
  ['Jules Ferrand', 'CB', 'Aster FC', 'France', 'epic'],
  ['Nassim Belkacem', 'CM', 'Union Atlantique', 'Algeria', 'epic'],
  ['Oscar Lund', 'RW', 'Racing Nord', 'Sweden', 'epic'],
  ['Milo Varga', 'ST', 'Stade Horizon', 'Hungary', 'epic'],
  ['Adrien Montfort', 'GK', 'Aster FC', 'France', 'legendary'],
  ['Sami Kader', 'AM', 'Union Atlantique', 'France', 'legendary'],
  ['Diego Aranda', 'ST', 'Racing Nord', 'Argentina', 'legendary'],
  ['Victor Saint-Clair', 'ST', 'Stade Horizon', 'France', 'icon']
];

function catalogRows() {
  return FOOTVAULT_CARDS.map(([name, position, club, nation, rarity], index) => ({
    id: `fv-${String(index + 1).padStart(3, '0')}`,
    season: '2026',
    name, position, club, nation, rarity,
    rarityLabel: RARITIES[rarity].label,
    maxSupply: RARITIES[rarity].supply,
    order: index + 1
  }));
}

const CARD_CATALOG = catalogRows();

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
    coins: Number(user.coins),
    gems: Number(user.gems),
    xp: Number(user.xp),
    createdAt: user.createdAt || user.created_at
  };
}

function sessionCookie(token) {
  return `fv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

function expiryDate() {
  return new Date(Date.now() + SESSION_DAYS * 86400_000);
}

function publicCard(card) {
  return {
    instanceId: card.instance_id || card.instanceId,
    cardId: card.card_id || card.cardId,
    season: card.season,
    name: card.name,
    position: card.position,
    club: card.club,
    nation: card.nation,
    rarity: card.rarity,
    rarityLabel: RARITIES[card.rarity]?.label || card.rarity,
    serial: Number(card.serial),
    maxSupply: Number(card.max_supply || card.maxSupply),
    serialLabel: `${Number(card.serial)}/${Number(card.max_supply || card.maxSupply)}`,
    acquiredAt: card.acquired_at || card.acquiredAt,
    source: card.source
  };
}

function buildInstance(card, ownerId, source = 'welcome') {
  const rarity = RARITIES[card.rarity];
  const key = crypto.randomUUID();
  const serial = Math.floor(Math.random() * rarity.supply) + 1;
  return {
    instanceId: key,
    cardId: card.id,
    ownerId,
    season: card.season,
    name: card.name,
    position: card.position,
    club: card.club,
    nation: card.nation,
    rarity: card.rarity,
    serial,
    maxSupply: rarity.supply,
    acquiredAt: new Date().toISOString(),
    source,
    status: 'owned'
  };
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
    await pool.query(`CREATE TABLE IF NOT EXISTS card_instances (
      instance_id uuid PRIMARY KEY,
      card_id varchar(32) NOT NULL,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season varchar(12) NOT NULL,
      name varchar(80) NOT NULL,
      position varchar(8) NOT NULL,
      club varchar(80) NOT NULL,
      nation varchar(80) NOT NULL,
      rarity varchar(20) NOT NULL,
      serial integer NOT NULL,
      max_supply integer NOT NULL,
      acquired_at timestamptz NOT NULL DEFAULT now(),
      source varchar(40) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'owned'
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS card_instances_owner_idx ON card_instances(owner_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS card_instances_card_idx ON card_instances(card_id)');
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

async function createCardInstance(instance) {
  if (pool) {
    await pool.query(`INSERT INTO card_instances
      (instance_id,card_id,owner_id,season,name,position,club,nation,rarity,serial,max_supply,acquired_at,source,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
      instance.instanceId, instance.cardId, instance.ownerId, instance.season, instance.name,
      instance.position, instance.club, instance.nation, instance.rarity, instance.serial,
      instance.maxSupply, instance.acquiredAt, instance.source, instance.status
    ]);
    return;
  }
  memory.cards.set(instance.instanceId, instance);
}

async function getUserCards(ownerId) {
  if (pool) {
    const result = await pool.query('SELECT * FROM card_instances WHERE owner_id=$1 AND status=\'owned\' ORDER BY acquired_at DESC', [ownerId]);
    return result.rows.map(publicCard);
  }
  return [...memory.cards.values()].filter(card => card.ownerId === ownerId && card.status === 'owned').sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt)).map(publicCard);
}

async function grantWelcomeCards(userId) {
  const existing = await getUserCards(userId);
  if (existing.length) return existing;
  const starterSet = CARD_CATALOG.filter(card => card.rarity === 'common').slice(0, 3);
  const created = [];
  for (const card of starterSet) {
    const instance = buildInstance(card, userId, 'welcome');
    await createCardInstance(instance);
    created.push(publicCard(instance));
  }
  return created;
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
        return json(res, 200, { ok: true, storage: pool ? 'postgres' : 'memory', universe: 'FOOTVAULT', cards: CARD_CATALOG.length });
      }

      if (req.method === 'GET' && url.pathname === '/api/me') {
        const user = await currentUser(req);
        return json(res, user ? 200 : 401, user ? { user: safeUser(user) } : { error: 'Non connecté' });
      }

      if (req.method === 'GET' && url.pathname === '/api/cards') {
        return json(res, 200, { universe: 'FOOTVAULT', season: '2026', cards: CARD_CATALOG });
      }

      if (req.method === 'GET' && url.pathname === '/api/collection') {
        const user = await currentUser(req);
        if (!user) return json(res, 401, { error: 'Non connecté' });
        const cards = await getUserCards(user.id);
        return json(res, 200, { user: safeUser(user), cards, count: cards.length });
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
        const cards = await grantWelcomeCards(user.id);
        const token = await createSession(user.id);
        res.setHeader('Set-Cookie', sessionCookie(token));
        return json(res, 201, { user: safeUser(user), welcomeCards: cards });
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
