'use strict';

// Accessibilité (règles maison, sans dépendance) : chaque page, sur ordinateur et mobile.
// Les défauts actuels sont comptés dans test/browser/a11y-baseline.json : le test échoue si un compte AUGMENTE
// (régression) et signale ceux qui ont baissé. La dette est résorbée page par page jusqu'à une base vide.
// Mise à jour de la base après correction : A11Y_UPDATE=1 npm run test:a11y

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { startServer } = require('../helpers');
const { collectViolations } = require('./a11y-rules');

const BASELINE_FILE = path.join(__dirname, 'a11y-baseline.json');
const UPDATE = process.env.A11Y_UPDATE === '1';
const VIEWPORTS = [{ name: 'ordinateur', width: 1280, height: 900, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }];
const ROUTES = ['home', 'collection', 'album', 'packs', 'vault', 'profil', 'successes', 'market', 'classement', 'admin'];

let server, browser, page;
const found = {};          // « ordinateur|home|img-sans-alt » -> nombre
const samples = {};

function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
}

test.before(async () => {
  server = await startServer();
  browser = await chromium.launch({ executablePath: executablePath() });
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  page = await context.newPage();
  await page.goto(server.base + '/#home');
  const reg = await page.evaluate(async () => {
    const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Accessible', email: 'a11y@test.fr', password: 'motdepasse1234' }) });
    return r.status;
  });
  assert.equal(reg, 201);
  await server.db.query("UPDATE users SET role='creator' WHERE email='a11y@test.fr'");
});
test.after(async () => { await browser?.close(); await server?.stop(); });
test.beforeEach(async () => { await page?.setExtraHTTPHeaders({ 'X-Forwarded-For': server.newIp() }); });

for (const vp of VIEWPORTS) {
  test(`accessibilité ${vp.name} (${vp.width} px) : toutes les pages mesurées`, async () => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      await page.goto(server.base + '/#' + route);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const result = await page.evaluate(collectViolations, { mobile: vp.mobile });
      for (const [rule, v] of Object.entries(result)) {
        found[`${vp.name}|${route}|${rule}`] = v.count;
        samples[`${vp.name}|${route}|${rule}`] = v.samples;
      }
    }
  });
}

test('accessibilité clavier : chaque élément atteint au Tab a un indicateur de focus visible', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const route of ROUTES) {
    await page.goto(server.base + '/#' + route);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    let bad = 0; const sample = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el), rect = el.getBoundingClientRect();
        const hasRing = st => (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) || (st.boxShadow && st.boxShadow !== 'none');
        // Le cadre peut être porté par le conteneur (champ de recherche dans un label : :focus-within).
        let ring = hasRing(s);
        for (let p = el.parentElement, n = 0; !ring && p && n < 2; p = p.parentElement, n++) ring = p.matches(':focus-within') && hasRing(getComputedStyle(p));
        const label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + el.classList[0] : '');
        return { ring, label, shown: rect.width > 0 && rect.height > 0 };
      });
      if (r && r.shown && !r.ring) { bad++; if (sample.length < 3) sample.push(r.label); }
    }
    if (bad) { found[`ordinateur|${route}|focus-invisible`] = bad; samples[`ordinateur|${route}|focus-invisible`] = sample; }
  }
});

test('accessibilité : aucune régression par rapport à la base connue', () => {
  if (UPDATE) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(Object.fromEntries(Object.entries(found).sort()), null, 1) + '\n');
    console.log('Base écrite :', BASELINE_FILE, Object.keys(found).length, 'entrées');
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const regressions = [], improved = [];
  for (const [key, n] of Object.entries(found)) {
    const base = baseline[key] || 0, margin = key.endsWith('|cible-tactile-44px') ? Math.max(3, Math.ceil(base * 0.1)) : 0;   // les cibles tactiles varient un peu avec le chargement
    if (n > base + margin) regressions.push(`${key} : ${n} (base ${base}) ex. ${(samples[key] || []).join(' ; ')}`);
  }
  for (const [key, n] of Object.entries(baseline)) if ((found[key] || 0) < n) improved.push(`${key} : ${found[key] || 0} (base ${n})`);
  // Synthèse par règle, pour suivre la dette.
  const total = {};
  for (const [key, n] of Object.entries(found)) { const rule = key.split('|')[2]; total[rule] = (total[rule] || 0) + n; }
  console.log('Défauts d\'accessibilité par règle (toutes pages et tailles) :', JSON.stringify(total));
  const remaining = Object.keys(found).filter(k => !k.endsWith('|cible-tactile-44px')).sort().map(k => `${k} : ${found[k]} ex. ${(samples[k] || []).join(' ; ')}`);
  if (remaining.length) console.log('Défauts restants (hors cibles tactiles) :\n  ' + remaining.join('\n  '));
  if (improved.length) console.log('En amélioration (relancer avec A11Y_UPDATE=1 pour resserrer la base) :\n  ' + improved.join('\n  '));
  assert.deepEqual(regressions, [], 'nouveaux défauts d\'accessibilité');
});
