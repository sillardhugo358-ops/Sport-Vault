'use strict';

// Tests navigateur (Playwright, Chromium) : chaque page s'affiche sans erreur JavaScript ni
// débordement horizontal, sur ordinateur, tablette et mobile. Lancer : npm run test:browser
// (TEST_DATABASE_URL comme pour npm test ; Chromium : CHROMIUM_PATH, sinon celui de Playwright).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer } = require('../helpers');

const VIEWPORTS = [
  { name: 'ordinateur', width: 1280, height: 900 },
  { name: 'tablette', width: 900, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
];
const ROUTES = ['home', 'collection', 'album', 'packs', 'vault', 'profil', 'successes', 'market', 'classement', 'admin'];

let server, browser, context, page;
const errors = [];

function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined; // navigateur installé par « npx playwright-core install chromium »
}

test.before(async () => {
  server = await startServer();
  browser = await chromium.launch({ executablePath: executablePath() });
  context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.base + '/#home');
  const reg = await page.evaluate(async () => {
    const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Navigateur', email: 'navigateur@test.fr', password: 'motdepasse123' }) });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  await server.db.query("UPDATE users SET role='creator' WHERE email='navigateur@test.fr'");
});
test.after(async () => { await browser?.close(); await server?.stop(); });

// Le serveur limite les appels à l'API par IP (180 par minute) : chaque test part d'une nouvelle IP.
test.beforeEach(async () => { await page?.setExtraHTTPHeaders({ 'X-Forwarded-For': server.newIp() }); });

async function visit(route) {
  errors.length = 0;
  await page.goto(server.base + '/#' + route);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.querySelector('#app').innerText.slice(0, 200),
    login: !!document.querySelector('#app form input[type=password]')
  }));
}

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.width} px) : toutes les pages sans erreur ni débordement`, async () => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      const r = await visit(route);
      assert.deepEqual(errors, [], `${route} : erreur JavaScript`);
      assert.ok(r.overflow <= 1, `${route} : débordement horizontal de ${r.overflow} px`);
      assert.ok(!r.login, `${route} : page de connexion affichée alors que le joueur est connecté`);
      assert.ok(r.text.trim().length > 0, `${route} : page vide`);
    }
  });
}

test('mobile : le menu s\'ouvre et mène aux pages', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('home');
  assert.equal(await page.isVisible('#nav a[data-route="packs"]'), false);
  await page.click('#menu');
  assert.equal(await page.isVisible('#nav a[data-route="packs"]'), true);
  await page.click('#nav a[data-route="packs"]');
  await page.waitForFunction(() => location.hash === '#packs');
  assert.equal(await page.isVisible('#nav a[data-route="packs"]'), false);
});

test('cloche : visible sur mobile et ordinateur, panneau ouvert puis fermé', async () => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await visit('vault');
    assert.equal(await page.isVisible('#notifBell'), true, `cloche à ${width} px`);
    await page.click('#notifBell');
    await page.waitForSelector('#notifPanel:not([hidden])');
    assert.match(await page.textContent('#notifPanel'), /NOTIFICATIONS/);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#notifPanel', e => e.hidden), true);
  }
});

test('boutique : ouverture d\'un pack depuis l\'API, cartes visibles dans la collection', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const r = await page.evaluate(async () => {
    const x = await fetch('/api/packs/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packId: 'starter' }) });
    return { status: x.status, cards: (await x.json()).cards?.length };
  });
  assert.deepEqual(r, { status: 200, cards: 5 });
  await visit('collection');
  assert.ok(await page.$$eval('.tcg-card', c => c.length) >= 5);
});

test('déconnecté : les pages privées renvoient vers la connexion', async () => {
  const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  anon.on('pageerror', e => errs.push(e.message));
  for (const route of ['vault', 'profil']) {
    await anon.goto(server.base + '/#' + route);
    await anon.waitForSelector('#app input[type=password]', { timeout: 15000 });
  }
  assert.equal(await anon.$('#notifBell'), null);
  assert.deepEqual(errs, []);
  await anon.close();
});
