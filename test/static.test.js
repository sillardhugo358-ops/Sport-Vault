'use strict';

// Fichiers statiques : l'interface est servie, le code serveur et les données ne le sont jamais.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

// Requête brute : fetch normaliserait les « .. » avant l'envoi.
const rawGet = p => new Promise((resolve, reject) => {
  const u = new URL(server.base);
  http.get({ host: u.hostname, port: u.port, path: p }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('interface : page d\'accueil et tout ce qu\'elle charge', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
  assert.ok(local.length >= 5, local.join(', '));
  for (const u of ['/', ...local.map(x => '/' + x)]) assert.equal((await fetch(server.base + u)).status, 200, u);
  for (const page of ['album.html', 'auth.html', 'card.html', 'collection.html', 'market.html', 'packs.html', 'vault.html']) {
    assert.equal((await fetch(server.base + '/' + page)).status, 200, page);
  }
});

test('refusé : code serveur, bibliothèques, données, configuration, dépôt git', async () => {
  const hidden = ['/server.js', '/security-bootstrap.js', '/ligue1-launcher.js', '/package.json', '/render.yaml', '/CLAUDE.md', '/README.md',
    '/.gitignore', '/.git/config', '/lib/rewards.js', '/lib/stats.js', '/lib/ledger.js', '/lib/tasks.js', '/lib/notifications.js', '/lib/profile.js', '/lib/routes/auth.js', '/data/README.md', '/data/europe-2010-2027.json.gz',
    '/scripts/import-europe.js', '/test/helpers.js', '/docs/SAUVEGARDE.md', '/node_modules/pg/package.json', '/.github/workflows/check.yml'];
  for (const p of hidden) assert.equal(await rawGet(p), 404, p);
  for (const p of ['/..%2fserver.js', '/lib/../server.js', '/%2e%2e/etc/passwd', '/../../etc/passwd']) assert.equal(await rawGet(p), 404, p);
  assert.equal(await rawGet('/%E0%A4%A'), 400);
});

test("polices : fonts/*.woff2 servies (cache long), rien d'autre dans fonts/", async () => {
  const r = await fetch(server.base + '/fonts/inter-latin-400-normal.woff2');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'font/woff2');
  assert.match(r.headers.get('cache-control') || '', /immutable/);
  assert.equal(await rawGet('/fonts/LICENCES.md'), 404);
  assert.equal(await rawGet('/fonts/../server.js'), 404);
  const css = await (await fetch(server.base + '/fonts.css')).text();
  const files = [...css.matchAll(/url\(fonts\/([^)]+)\)/g)].map(m => m[1]);
  assert.ok(files.length >= 26);
  for (const f of new Set(files)) assert.equal((await fetch(server.base + '/fonts/' + f)).status, 200, f);
});
