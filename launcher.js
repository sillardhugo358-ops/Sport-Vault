const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.join(__dirname, 'server.js');
const dataFile = path.join(__dirname, 'data.json');
const source = fs.readFileSync(filename, 'utf8');

async function start() {
  let state = null;
  let persistQueue = Promise.resolve();
  let pool = null;

  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 5
    });

    await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
      id integer PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (result.rows[0]?.data) {
      state = result.rows[0].data;
    } else if (fs.existsSync(dataFile)) {
      try {
        state = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      } catch {
        state = null;
      }
    }
    state ??= { users: {}, market: [], trades: [], counters: {} };

    const persist = () => {
      persistQueue = persistQueue.then(() =>
        pool.query(
          `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [JSON.stringify(state)]
        )
      ).catch(err => console.error('Postgres persistence error:', err.message));
      return persistQueue;
    };

    const originalExistsSync = fs.existsSync;
    const originalReadFileSync = fs.readFileSync;
    const originalWriteFileSync = fs.writeFileSync;
    const isDataFile = value => path.resolve(String(value)) === path.resolve(dataFile);

    fs.existsSync = function(value) {
      if (isDataFile(value)) return true;
      return originalExistsSync.apply(this, arguments);
    };
    fs.readFileSync = function(value, options) {
      if (isDataFile(value)) {
        const encoding = typeof options === 'string' ? options : options?.encoding;
        const text = JSON.stringify(state, null, 2);
        return encoding ? text : Buffer.from(text);
      }
      return originalReadFileSync.apply(this, arguments);
    };
    fs.writeFileSync = function(value, data, options) {
      if (isDataFile(value)) {
        try {
          state = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
          persist();
        } catch (err) {
          console.error('Invalid data.json write:', err.message);
        }
        return;
      }
      return originalWriteFileSync.apply(this, arguments);
    };

    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(state)]
    );

    const shutdown = async () => {
      try { await persistQueue; } finally { await pool.end(); process.exit(0); }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }

  // Keep the prototype's auth-validation compatibility patch.
  const fixedSource = source.replace(
    '!/^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$/.test(email)',
    '!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)'
  );

  const app = new Module(filename, module);
  app.filename = filename;
  app.paths = Module._nodeModulePaths(__dirname);
  app._compile(fixedSource, filename);
}

start().catch(err => {
  console.error('SPORT VAULT startup error:', err);
  process.exit(1);
});
