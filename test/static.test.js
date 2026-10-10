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

test('feuilles de style : styles.css à styles-6.css liées dans l\'ordre de la cascade, chacune en CSS valide (accolades équilibrées)', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const linked = [...html.matchAll(/<link rel="stylesheet" href="(styles(?:-\d)?\.css)\?v=[^"]+">/g)].map(m => m[1]);
  assert.deepEqual(linked, ['styles.css', 'styles-2.css', 'styles-3.css', 'styles-4.css', 'styles-5.css', 'styles-6.css']);
  assert.ok(html.indexOf('styles-6.css') < html.indexOf('cards-v4.css'), 'cards-v4.css reste après les styles');
  for (const f of linked) {
    const r = await fetch(server.base + '/' + f);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type') || '', /text\/css/, f);
    const css = (await r.text()).replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    let depth = 0;
    for (const c of css) { if (c === '{') depth++; else if (c === '}') depth--; assert.ok(depth >= 0, f + ' : accolade fermante en trop'); }
    assert.equal(depth, 0, f + ' : accolades déséquilibrées (coupure au milieu d\'une règle ?)');
  }
});

test('refusé : code serveur, bibliothèques, données, configuration, dépôt git', async () => {
  const hidden = ['/server.js', '/security-bootstrap.js', '/ligue1-launcher.js', '/package.json', '/render.yaml', '/CLAUDE.md', '/README.md',
    '/.gitignore', '/.git/config', '/lib/rewards.js', '/lib/stats.js', '/lib/ledger.js', '/lib/tasks.js', '/lib/notifications.js', '/lib/profile.js', '/lib/leaderboard.js', '/lib/ligue1-history.js', '/lib/challenges.js', '/lib/club-key.js', '/lib/routes/auth.js', '/data/README.md', '/data/europe-2010-2027.json.gz',
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

test('cache et compression : gzip, ETag et 304, cache long des fichiers versionnés', async () => {
  const raw = await fetch(server.base + '/app.js', { headers: { 'accept-encoding': 'identity' } });
  const size = Number(raw.headers.get('content-length'));
  assert.ok(size > 20000, 'app.js assez gros pour que la compression compte');
  // http.get : fetch décompresse et masque la taille réellement transférée.
  const gz = await new Promise((resolve, reject) => {
    const u = new URL(server.base);
    http.get({ host: u.hostname, port: u.port, path: '/app.js?v=test', headers: { 'accept-encoding': 'gzip' } }, res => {
      let n = 0; res.on('data', d => { n += d.length; }); res.on('end', () => resolve({ headers: res.headers, n }));
    }).on('error', reject);
  });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.ok(gz.n < size / 3, `gzip ${gz.n} octets pour ${size}`);
  assert.match(gz.headers['cache-control'], /immutable/);
  assert.equal(gz.headers.vary, 'Accept-Encoding');
  const etag = raw.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(server.base + '/app.js', { headers: { 'if-none-match': etag } })).status, 304);
  const html = await fetch(server.base + '/');
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  assert.match(await html.text(), /FOOTVAULT/);
  assert.equal((await fetch(server.base + '/server.js')).status, 404);
});

test('application Android : assetlinks.json public, empreinte valide, dossiers cachés toujours refusés', async () => {
  const r = await fetch(server.base + '/.well-known/assetlinks.json');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const body = await r.json();
  assert.equal(body[0].target.namespace, 'android_app');
  assert.equal(body[0].target.package_name, 'com.footvault.app');
  assert.match(body[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(await rawGet('/.well-known/autre.json'), 404, 'seul assetlinks.json est servi');
  assert.equal(await rawGet('/android/app/build.gradle'), 404, 'le code de l\'application n\'est pas servi');
});
