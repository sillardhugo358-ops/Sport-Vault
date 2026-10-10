'use strict';

// Tests navigateur (Playwright, Chromium) : chaque page s'affiche sans erreur JavaScript ni
// débordement horizontal, sur ordinateur, tablette et mobile. Lancer : npm run test:browser
// (TEST_DATABASE_URL comme pour npm test ; Chromium : CHROMIUM_PATH, sinon celui de Playwright).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer, ensureTestClubs, newPlayer } = require('../helpers');

const VIEWPORTS = [
  { name: 'ordinateur', width: 1280, height: 900 },
  { name: 'tablette', width: 900, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
];
const ROUTES = ['home', 'collection', 'album', 'packs', 'vault', 'profil', 'successes', 'market', 'trades', 'classement', 'amis', 'souhaits', 'statistiques', 'equipe', 'atelier', 'surmesure', 'collectif', 'admin'];

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
  assert.equal(await page.getAttribute('#menu', 'aria-expanded'), 'false');
  assert.equal(await page.getAttribute('#menu', 'aria-controls'), 'nav');
  await page.click('#menu');
  assert.equal(await page.isVisible('#nav a[data-route="packs"]'), true);
  assert.equal(await page.getAttribute('#menu', 'aria-expanded'), 'true', 'menu ouvert annoncé');
  // Habillage : fond bleu nuit opaque, lignes d'au moins 44 px, « Échanges » présent, page active repérée.
  const menu = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector('#nav')).backgroundColor, links: [...document.querySelectorAll('#nav a')].filter(a => a.getClientRects().length).map(a => ({ t: a.textContent.trim(), h: a.getBoundingClientRect().height })) }));
  assert.equal(menu.bg, 'rgb(7, 24, 46)');
  assert.ok(menu.links.some(l => l.t === 'Échanges'), 'lien Échanges dans le menu');
  assert.ok(menu.links.every(l => l.h >= 44), 'lignes du menu : ' + JSON.stringify(menu.links.filter(l => l.h < 44)));
  await page.click('#nav a[data-route="packs"]');
  await page.waitForFunction(() => location.hash === '#packs');
  assert.equal(await page.isVisible('#nav a[data-route="packs"]'), false);
  assert.equal(await page.getAttribute('#menu', 'aria-expanded'), 'false', 'menu refermé annoncé');
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

test('Mon Vault : « Mes dernières cartes » montre les 4 dernières obtenues, la plus récente d\'abord', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  const base = (await server.db.query('SELECT * FROM catalog_cards ORDER BY id LIMIT 1')).rows[0];
  for (let i = 1; i <= 6; i++) {
    await server.db.query(
      `INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,acquired_at,source,status)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,70,70,70,70,70,70,70,false,$9,'test','owned')`,
      [base.id, uid, base.season, 'Recent' + i, base.position, base.club, base.nation, base.rarity, new Date(Date.UTC(2099, 0, i)).toISOString()]);
  }
  await visit('vault');
  await page.waitForSelector('.vault-recent-cards .card-link');
  const names = await page.$$eval('.vault-recent-cards .card-link', els => els.map(e => e.innerText));
  assert.equal(names.length, 4);
  ['Recent6', 'Recent5', 'Recent4', 'Recent3'].forEach((n, i) => assert.match(names[i].toLowerCase(), new RegExp(n.toLowerCase()), 'position ' + i));
  assert.ok(!names.join(' ').toLowerCase().includes('recent1'));
  await server.db.query("DELETE FROM card_instances WHERE source='test' AND name LIKE 'Recent%'");
  assert.deepEqual(errors, []);
});

test('ouverture de pack : pack scellé, cartes distribuées sans retournement automatique, retournement par le joueur, tout révéler', async () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await visit('packs');
    await page.click('[data-pack="starter"]');
    await page.waitForSelector('.reveal-pack');
    assert.equal(await page.locator('.reveal-grid').isVisible(), false, vp.name + ' : cartes cachées avant ouverture');
    assert.equal(await page.locator('.reveal-controls').isVisible(), false, vp.name + ' : boutons masqués tant que le pack est scellé');
    await page.click('[data-open-pack]');
    await page.waitForSelector('.reveal-card', { state: 'visible' });
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.reveal-controls').isVisible(), true, vp.name + ' : boutons visibles une fois le pack ouvert');
    assert.equal(await page.locator('.reveal-card').count(), 5);
    assert.equal(await page.locator('.reveal-card.flipped').count(), 0, vp.name + ' : aucune carte retournée automatiquement');
    await page.locator('.reveal-card').first().click();
    assert.equal(await page.locator('.reveal-card.flipped').count(), 1);
    assert.equal(await page.locator('[data-reveal-again]').isVisible(), false, vp.name + ' : bouton caché tant que toutes les cartes ne sont pas révélées');
    assert.match(await page.textContent('.reveal-result'), /1 \/ 5/);
    // Cadre : toutes les cartes dans la grille, sans défilement ni rognage.
    const frame = await page.evaluate(() => { const g = document.querySelector('.reveal-grid'), r = g.getBoundingClientRect(); return { scroll: g.scrollHeight > g.clientHeight + 1, inside: [...g.querySelectorAll('.reveal-card')].every(c => { const q = c.getBoundingClientRect(); return q.top >= r.top - 1 && q.bottom <= r.bottom + 1 && q.left >= r.left - 1 && q.right <= r.right + 1; }), sized: !!g.style.getPropertyValue('--rv-w') }; });
    assert.deepEqual(frame, { scroll: false, inside: true, sized: true }, vp.name + ' : cadre de la révélation');
    await page.click('[data-skip-reveal]');
    await page.waitForFunction(() => document.querySelectorAll('.reveal-card.flipped').length === 5);
    await page.waitForTimeout(1500);
    // Retournement 3D intact (pas de carte vue à l'envers : aucun filtre ni animation sur l'élément qui tourne).
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.reveal-card.flipped .reveal-card-inner')].every(i => { const s = getComputedStyle(i); return s.transform.startsWith('matrix3d(-1') && s.filter === 'none' && s.animationName === 'none'; })), true, vp.name + ' : cartes retournées à l\'endroit (pas de filtre ni d\'animation sur l\'élément 3D)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, vp.name + ' : débordement');
    // « Ouvrir un autre pack » : caché tant que les cartes ne sont pas toutes révélées, puis relance le même pack.
    assert.equal(await page.locator('[data-reveal-again]').isVisible(), true, vp.name + ' : bouton « ouvrir un autre pack » une fois tout révélé');
    assert.match(await page.textContent('[data-reveal-again]'), /OUVRIR UN AUTRE PACK · \d+ FC/);
    if (vp === VIEWPORTS[0]) {
      await page.click('[data-reveal-again]');
      await page.waitForSelector('[data-open-pack]');
      assert.equal(await page.locator('[data-reveal-again]').isVisible(), false, 'caché sur le nouveau pack scellé');
    }
    await page.click('.pack-reveal-modal .modal-close');
  }
  assert.deepEqual(errors, []);
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

test('déconnecté : l\'administration refusée a un titre de page et un seul h1', async () => {
  const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await anon.goto(server.base + '/#admin');
  await anon.waitForSelector('#app .empty h1', { timeout: 15000 });
  assert.equal(await anon.evaluate(() => document.querySelectorAll('h1').length), 1);
  assert.equal(await anon.title(), 'Administration — FOOTVAULT');
  await anon.goto(server.base + '/#auth');
  await anon.waitForSelector('#switchAuth');
  assert.ok((await (await anon.$('#switchAuth')).boundingBox()).height >= 43.5, 'bouton « Créer un compte » assez haut');
  await anon.close();
});

test('marché : prix de marché sur la fiche carte, ventes récentes et alertes de prix', async () => {
  const card = (await server.db.query('SELECT id,name FROM catalog_cards ORDER BY id LIMIT 1')).rows[0];
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await visit('card?id=' + encodeURIComponent(card.id));
    await page.waitForSelector('#cardMarketPanel .card-market-figures');
    assert.match(await page.textContent('#cardMarketPanel'), /pas encore de vente/);
    assert.deepEqual(errors, [], vp.name + ' : erreur JavaScript');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, vp.name + ' : débordement');
  }
  await page.click('#cardMarketPanel [data-market-alert-edit]');
  await page.fill('#auctionDialogValue', '321');
  await page.click('#auctionDialogConfirm');
  await page.waitForFunction(() => /321 FC/.test(document.querySelector('#cardMarketPanel')?.innerText || ''));
  await visit('market');
  await page.click('[data-auction-tab="alerts"]');
  await page.waitForSelector('#auctionAlerts [data-alert-delete]');
  assert.match(await page.textContent('#auctionAlerts'), new RegExp(card.name.split(' ')[0]));
  await page.click('[data-auction-tab="sales"]');
  await page.waitForFunction(() => !/Chargement/.test(document.querySelector('#auctionSales').innerText));
  assert.deepEqual(errors, []);
});

test('marché (fv-market.js) : créer une enchère puis l\'annuler par les fenêtres de saisie', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await page.evaluate(() => Object.keys(window.FVC?.market || {}).sort());
  assert.deepEqual(api, ['auctionDialog', 'bidAuction', 'cancelAuction', 'createAuction', 'loadAuctionHistory', 'market', 'showBidHistory', 'siteConfirmDialog', 'startAuctionTimer', 'withdrawAuction']);
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  const base = (await server.db.query('SELECT * FROM catalog_cards ORDER BY id LIMIT 1')).rows[0];
  await server.db.query(
    `INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,acquired_at,source,status)
     VALUES(gen_random_uuid(),$1,$2,$3,'Vendeur',$4,$5,$6,$7,70,70,70,70,70,70,70,false,now(),'test','owned')`,
    [base.id, uid, base.season, base.position, base.club, base.nation, base.rarity]);
  await visit('market');
  await page.click('[data-auction-tab="sell"]');
  await page.waitForSelector('#auctionSell [data-sell-card]');
  await page.click('#auctionSell [data-sell-card]');
  await page.fill('#auctionDialogValue', '150');
  await page.click('#auctionDialogConfirm');
  await page.waitForSelector('#auctionDialogConfirm');
  await page.click('#auctionDialogConfirm');
  await page.waitForSelector('#auctionLive [data-cancel-auction]', { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.auction-card').length > 0), true);
  await page.click('#auctionLive [data-cancel-auction]');
  await page.waitForSelector('#auctionDialogConfirm');
  await page.click('#auctionDialogConfirm');
  await page.waitForFunction(() => !document.querySelector('#auctionLive [data-cancel-auction]'), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
});

test('sets thématiques : éditeur admin (recherche de cartes) puis récupération au Vault', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const cards = (await server.db.query('SELECT id,name FROM catalog_cards ORDER BY id LIMIT 3')).rows;
  await visit('admin');
  await page.click('[data-admin-tab="successes"]');
  await page.waitForSelector('#adminSetBody');
  await page.waitForFunction(() => /Aucun set/.test(document.querySelector('#adminSetBody').innerText));
  await page.click('[data-new-set]');
  await page.click('[data-set-save]');
  assert.match(await page.textContent('[data-error="name"]'), /Nom/);
  assert.match(await page.textContent('[data-error="cardIds"]'), /2 à 100/);
  await page.fill('input[name="name"]', 'Trio Test');
  await page.fill('textarea[name="description"]', 'Trois cartes de test.');
  for (const c of cards) {
    await page.fill('input[name="search"]', c.name);
    await page.waitForSelector('#setEditorResults [data-set-add]:not([disabled])', { timeout: 10000 });
    await page.click('#setEditorResults [data-set-add]:not([disabled])');
  }
  assert.match(await page.textContent('#setEditorCount'), /3 cartes.*500 FC/);
  await page.click('[data-set-save]');
  await page.waitForFunction(() => /Trio Test/.test(document.querySelector('#adminSetBody')?.innerText || ''), null, { timeout: 15000 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  for (const c of cards) {
    await server.db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,status)
      SELECT gen_random_uuid(),id,$2,season,name,position,club,nation,rarity,'test','owned' FROM catalog_cards WHERE id=$1`, [c.id, uid]);
  }
  await visit('vault');
  await page.waitForSelector('[data-set-claim]');
  assert.match(await page.textContent('.set-section'), /Trio Test/);
  assert.match(await page.textContent('.set-section'), /3\/3/);
  await page.click('[data-set-claim]');
  await page.waitForFunction(() => /RÉCUPÉRÉ/.test(document.querySelector('.set-section')?.innerText || ''), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
});

test('échanges : proposer une offre depuis la page, puis accepter une offre reçue', async () => {
  const other = await newPlayer(server, 'Partenaire');
  const me = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  const base = (await server.db.query('SELECT * FROM catalog_cards ORDER BY id LIMIT 1')).rows[0];
  const give = async (uid, name) => (await server.db.query(
    `INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,status)
     VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'common','pack:test','owned') RETURNING instance_id`, [base.id, uid, base.season, name, base.position, base.club, base.nation])).rows[0].instance_id;
  const myCard = await give(me, 'Carte Navigateur'), hisCard = await give(other.user.id, 'Carte Partenaire'), hisOther = await give(other.user.id, 'Autre Partenaire');
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const r = await visit('trades');
    assert.ok(r.overflow <= 1, vp.name + ' : débordement de ' + r.overflow + ' px');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('trades');
  const otherCode = (await other.get('/api/trades')).body.code;
  await page.fill('#tradeCode', otherCode);
  await page.click('[data-trade-search]');
  await page.waitForSelector('[data-trade-pick="ask"]');
  await page.check('[data-trade-pick="give"][value="' + myCard + '"]');
  await page.check('[data-trade-pick="ask"][value="' + hisCard + '"]');
  await page.click('[data-trade-send]');
  await page.waitForFunction(() => /EN COURS \(1\)/.test(document.querySelector('.trades-page')?.innerText || ''), null, { timeout: 15000 });
  assert.equal((await other.get('/api/trades')).body.received.length, 1);
  // Offre reçue : acceptation depuis la page.
  const mineCode = await page.textContent('#tradeMyCode');
  const sent = await other.post('/api/trades/offer', { toCode: mineCode, give: [hisOther], ask: [(await server.db.query("SELECT instance_id FROM card_instances WHERE owner_id=$1 AND name='Carte Navigateur'", [me])).rows[0].instance_id.toString()] });
  assert.equal(sent.status, 409, 'carte déjà engagée dans l\'offre précédente');
  const spare = await give(me, 'Carte De Rechange');
  const ok = await other.post('/api/trades/offer', { toCode: mineCode, give: [hisOther], ask: [spare] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await visit('trades');
  await page.waitForSelector('[data-trade-accept]');
  await page.click('[data-trade-accept]');
  await page.waitForFunction(() => /ACCEPTÉE/.test(document.querySelector('.trades-page')?.innerText || ''), null, { timeout: 15000 });
  assert.equal((await server.db.query('SELECT owner_id FROM card_instances WHERE instance_id=$1', [hisOther])).rows[0].owner_id, me);
  assert.deepEqual(errors, []);
});

test('mobile : filtres des packs repliés, dépliables ; onglets du marché exclusifs', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('packs');
  assert.equal(await page.isVisible('.shop-filter-group'), false);
  await page.click('[data-shop-toggle]');
  assert.equal(await page.isVisible('.shop-filter-group'), true);
  await visit('market');
  const visible = await page.evaluate(() => ['auctionLive', 'auctionSell', 'auctionHistory', 'auctionSales', 'auctionAlerts'].filter(id => { const el = document.getElementById(id); return el && el.getBoundingClientRect().height > 0; }));
  assert.deepEqual(visible, ['auctionLive']);
  assert.deepEqual(errors, []);
});

test('favorites : ajout depuis la fiche carte, vitrine du profil, étoile de la collection', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('collection');
  const id = await page.evaluate(async () => ((await (await fetch('/api/collection')).json()).cards || [])[0]?.instanceId);
  assert.ok(id, 'le joueur doit posséder une carte');
  await visit('card?id=' + encodeURIComponent(id));
  await page.click('[data-fav-toggle]');
  await page.waitForSelector('[data-fav-toggle][data-fav="1"]');
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const r = await visit('profil');
    assert.equal(await page.locator('.profile-fav-card').count(), 1, vp.name);
    assert.ok(r.overflow <= 1, vp.name + ' : débordement');
  }
  await visit('collection');
  assert.equal(await page.locator('.collection-fav').count(), 1);
  await visit('profil');
  await page.click('[data-fav-remove]');
  await page.waitForFunction(() => document.querySelectorAll('.profile-fav-card').length === 0);
  assert.deepEqual(errors, []);
});

test('éditeur de succès : filtres (numéro, secrets, tri), aperçu joueur multi-états, formulaire sans débordement', async () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await visit('admin');
    await page.click('[data-admin-tab="successes"]');
    await page.waitForSelector('[data-preview-achievement]');
    await page.click('[data-reset-achievement-filters]');
    assert.equal(await page.locator('.admin-achievement-row').count(), 40, vp.name + ' : 40 premiers affichés');
    await page.fill('#adminAchievementSearch', '187');
    await page.waitForFunction(() => document.querySelectorAll('.admin-achievement-row').length === 1);
    await page.fill('#adminAchievementSearch', '');
    await page.selectOption('#adminAchievementStatus', 'secret');
    assert.match(await page.textContent('#adminAchievementCount'), /^25 \//);
    // Aperçu en lecture seule : carte réelle de la page Succès, condition masquée tant que non réussi.
    await page.click('[data-preview-achievement]');
    await page.click('[data-preview-state="secret"]');
    assert.match(await page.textContent('[data-preview-root] .success-card'), /Succès secret/);
    await page.click('[data-preview-state="ready"]');
    assert.match(await page.textContent('[data-preview-root] .success-status'), /TERMINÉ/);
    assert.equal(await page.locator('[data-preview-root] [data-claim-achievement]').count(), 0, 'bouton de récupération inactif');
    await page.click('[data-preview-close]');
    // Éditeur : l'aperçu suit le formulaire, aucun champ ne dépasse.
    await page.click('[data-edit-achievement]');
    await page.fill('form input[name="name"]', 'Nom de test aperçu');
    await page.waitForFunction(() => document.querySelector('[data-achievement-preview] .success-card')?.textContent.includes('Nom de test aperçu'));
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.achievement-editor-form input:not([type=checkbox]),.achievement-editor-form select,.achievement-editor-form textarea')]
      .filter(el => el.getBoundingClientRect().right > el.closest('label').getBoundingClientRect().right + 1).length);
    assert.equal(overflow, 0, vp.name + ' : champ hors de sa colonne');
    await page.click('[data-achievement-cancel]');
    await page.click('#siteConfirmOk'); // modifications non enregistrées : abandon confirmé
  }
  assert.deepEqual(errors, []);
});

test('packs : logo de la compétition sur les packs de compétition, pas sur les packs standard', async () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const r = await visit('packs');
    assert.ok(r.overflow <= 1, vp.name + ' : débordement');
    await page.waitForSelector('[data-shop-pack]');
    const info = await page.evaluate(() => [...document.querySelectorAll('[data-shop-pack]')].map(card => ({
      title: card.querySelector('h3')?.textContent.trim(),
      logos: [...card.querySelectorAll('.pack-logos img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }))
    })));
    const ligue1 = info.find(p => /ligue 1/i.test(p.title));
    assert.deepEqual(ligue1.logos.map(l => l.src), ['competition-ligue-1.png'], vp.name);
    assert.ok(ligue1.logos.every(l => l.ok), vp.name + ' : image chargée');
    assert.equal(info.find(p => /^starter/i.test(p.title)).logos.length, 0, vp.name + ' : pas de logo sur un pack standard');
  }
  assert.deepEqual(errors, []);
});

test('tableau de bord : panneaux de progression, classement et export CSV, sans débordement', async () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const r = await visit('admin');
    assert.ok(r.overflow <= 1, vp.name + ' : débordement');
    await page.waitForSelector('.admin-stats-panel');
    const titles = await page.$$eval('.admin-stats-panel h4', els => els.map(e => e.textContent.trim()));
    for (const t of ['Récompenses récupérées par jour', 'Succès les plus récupérés', 'Missions les plus récupérées', 'Classement de la semaine : récompenses']) {
      assert.ok(titles.includes(t), vp.name + ' : panneau « ' + t + ' »');
    }
    const kpis = await page.$$eval('.admin-stats-kpi span', els => els.map(e => e.textContent.trim()));
    for (const k of ['Récompenses récupérées', 'Retour à 7 jours', 'FC en circulation']) assert.ok(kpis.includes(k), k);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-stats-csv]')]);
    assert.match(download.suggestedFilename(), /^footvault-statistiques-\d+j\.csv$/);
  }
  assert.deepEqual(errors, []);
});

test('accueil déconnecté : serveur qui démarre (503) → « — » et message, puis chiffres affichés sans recharger', async () => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  const anon = await ctx.newPage();
  const anonErrors = [];
  anon.on('pageerror', e => anonErrors.push(e.message));
  let summaryCalls = 0;
  await anon.route('**/api/catalog/summary', route => ++summaryCalls <= 2
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Base de données en cours de démarrage.' }) })
    : route.continue());
  await anon.goto(server.base + '/#home');
  await anon.waitForSelector('.fvh-metrics');
  assert.equal(await anon.$eval('.fvh-metrics li b', e => e.textContent.trim()), '—', 'pas de faux zéro');
  assert.match(await anon.$eval('.fvh-notice', e => e.textContent), /serveur démarre/);
  await anon.waitForFunction(() => /\d/.test(document.querySelector('.fvh-metrics li b')?.textContent || ''), null, { timeout: 20000 });
  assert.equal(await anon.$('.fvh-notice'), null, 'message retiré une fois les chiffres reçus');
  assert.ok(summaryCalls >= 3, 'nouvelles tentatives automatiques : ' + summaryCalls);
  assert.deepEqual(anonErrors, []);
  await ctx.close();
});

test('accueil : les 8 tuiles de compétitions mènent chacune à leur album', async () => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  const anon = await ctx.newPage();
  await anon.goto(server.base + '/#home');
  await anon.waitForSelector('.fvh-competitions a');
  const hrefs = await anon.$$eval('.fvh-competitions a', els => els.map(a => a.getAttribute('href')));
  assert.deepEqual(hrefs, ['ligue-1', 'premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-des-champions', 'coupe-du-monde', 'ligue-des-nations'].map(id => '#album?competition=' + id));
  await ctx.close();
});

test('packs : visiteur non connecté = un seul appel /api/packs ; serveur qui démarre (503) → réessai, packs affichés', async () => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  const anon = await ctx.newPage();
  const anonErrors = [];
  anon.on('pageerror', e => anonErrors.push(e.message));
  let calls = 0;
  await anon.route('**/api/packs', route => ++calls === 1
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Base de données en cours de démarrage.' }) })
    : route.continue());
  await anon.goto(server.base + '/#packs');
  await anon.waitForSelector('[data-shop-pack]', { timeout: 20000 });
  assert.equal(calls, 2, 'un 503 puis une seule nouvelle tentative réussie : ' + calls);
  assert.ok((await anon.$$('[data-shop-pack]')).length >= 5);
  assert.deepEqual(anonErrors, []);
  // Rechargement normal : exactement un appel (plus de doublon pour les visiteurs non connectés).
  calls = 100;
  await anon.reload();
  await anon.waitForSelector('[data-shop-pack]');
  assert.equal(calls, 101);
  await ctx.close();
});

test('cartes : logos indisponibles au démarrage (503) → page affichée, puis pastilles dès que le serveur répond', async () => {
  const collection = await page.evaluate(async () => (await (await fetch('/api/collection')).json()).cards || []);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(collection[0].club);
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  const a = await ctx.newPage();
  let calls = 0;
  await a.route('**/api/club-logos', r => ++calls === 1
    ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Base de données en cours de démarrage' }) })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logos: { [key]: 'competition-ligue-1.png' }, aliases: {} }) }));
  await a.goto(server.base + '/#home');
  await a.evaluate(async () => { await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'navigateur@test.fr', password: 'motdepasse123' }) }); });
  calls = 0;
  await a.goto(server.base + '/#collection');
  await a.reload();
  await a.waitForSelector('.tcg-card.v4');
  assert.equal((await a.$$('.v4-club-badge')).length, 0, 'pas de pastille tant que les logos ne sont pas arrivés');
  await a.waitForSelector('.v4-club-badge', { timeout: 8000 });
  assert.ok(calls >= 2);
  await ctx.close();
});

test('cartes : logo de la base qui ne charge pas → repli sur le fichier du dossier, sinon pastille retirée', async () => {
  const collection = await page.evaluate(async () => (await (await fetch('/api/collection')).json()).cards || []);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(collection[0].club);
  for (const [fallback, expected] of [['competition-ligue-1.png', 'competition-ligue-1.png'], ['encore-inexistant.png', null]]) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
    const a = await ctx.newPage();
    await a.route('**/api/club-logos', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logos: { [key]: 'logo-casse.png' }, fallback: { [key]: fallback }, aliases: {} }) }));
    await a.goto(server.base + '/#home');
    await a.evaluate(async () => { await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'navigateur@test.fr', password: 'motdepasse123' }) }); });
    await a.goto(server.base + '/#collection');
    await a.reload();
    await a.waitForSelector('.tcg-card.v4');
    // Les images sont chargées à la demande : selon la carte tirée, une pastille peut être hors écran et ne jamais se charger ;
    // on force le chargement pour que le test ne dépende pas de la position de la carte dans la page.
    await a.evaluate(() => document.querySelectorAll('.v4-club-badge').forEach(i => { i.loading = 'eager'; }));
    if (expected) {
      await a.waitForFunction(e => [...document.querySelectorAll('.v4-club-badge')].some(i => (i.getAttribute('src') || '') === e), expected);
    } else {
      await a.waitForFunction(() => document.querySelectorAll('.v4-club-badge').length === 0);
    }
    await ctx.close();
  }
});

test('cartes : bandeau compétition + saison en grand, drapeau rond du pays, ni numéro en filigrane ni texte de nationalité', async () => {
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  // Trois cartes de catalogue différentes : la collection regroupe les exemplaires d'une même carte.
  const bases = (await server.db.query('SELECT id FROM catalog_cards ORDER BY id LIMIT 3 OFFSET 5')).rows;
  await ensureTestClubs(server);
  const lg = (await server.db.query("SELECT c.name,cs.competition_id,cs.season FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id JOIN clubs c ON c.id=sc.club_id WHERE cs.competition_id NOT IN ('ligue-des-champions','coupe-du-monde','ligue-des-nations') ORDER BY c.name LIMIT 1")).rows[0];
  const labels = { 'ligue-1': 'LIGUE 1', 'premier-league': 'PREMIER LEAGUE', 'serie-a': 'SERIE A', bundesliga: 'BUNDESLIGA', 'la-liga': 'LA LIGA' };
  const rows = [
    ['Cartetest Championnat', '2015-2016', lg.name, 'Spain'],   // nom anglais → drapeau d'Espagne
    ['Cartetest LDC', 'LDC 2010-11', lg.name, ''],            // Ligue des Champions, nationalité inconnue → pas de drapeau
    ['Cartetest Mondial', '1998', 'France', 'France']         // Coupe du monde : drapeau seul
  ];
  for (const [k, [name, season, club, nation]] of rows.entries()) {
    await server.db.query(
      `INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,is_limited,acquired_at,source,status,jersey_number)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,'ST',$5,$6,'rare',80,70,70,70,70,70,70,false,$7,'test','owned',9)`,
      [bases[k].id, uid, season, name, club, nation, new Date(Date.UTC(2099, 0, 1)).toISOString()]);
  }
  try {
    for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await visit('collection');
      const card = name => page.locator('.card-link', { hasText: name.toUpperCase() }).first();
      for (const name of rows.map(r => r[0])) await card(name).waitFor();
      const read = async name => card(name).evaluate(el => ({
        comp: el.querySelector('.v4-comp')?.textContent || '', season: el.querySelector('.v4-season')?.textContent || '',
        flag: el.querySelector('.v4-flag-badge')?.getAttribute('src') || '', club: !!el.querySelector('.v4-club-badge'),
        nationText: !!el.querySelector('.v4-nation'), watermark: !!el.querySelector('.v4-wm') }));
      const a = await read('Cartetest Championnat'), b = await read('Cartetest LDC'), c = await read('Cartetest Mondial');
      assert.equal(a.comp, labels[lg.competition_id], vp.name + ' : compétition du championnat');
      assert.equal(a.season, '2015-2016', vp.name + ' : saison');
      assert.equal(a.flag, 'club-logos/selection-espagne.png', vp.name + ' : « Spain » → drapeau d\'Espagne');
      assert.equal(b.comp, 'LIGUE DES CHAMPIONS');
      assert.equal(b.season, '2010-2011', 'préfixe LDC retiré, saison en forme longue');
      assert.equal(b.flag, '', 'pas de drapeau sans nationalité');
      assert.equal(c.comp, 'COUPE DU MONDE');
      assert.equal(c.season, '1998');
      assert.equal(c.flag, 'club-logos/selection-france.png');
      assert.equal(c.club, false, 'sélection : le drapeau remplace la pastille du club');
      for (const x of [a, b, c]) { assert.equal(x.nationText, false); assert.equal(x.watermark, false); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, vp.name + ' : débordement');
    }
  } finally {
    await server.db.query("DELETE FROM card_instances WHERE source='test' AND name LIKE 'Cartetest%'");
  }
  assert.deepEqual(errors, []);
});

test('cartes : pastille du club quand il a un logo, rien sinon', async () => {
  const collection = await page.evaluate(async () => (await (await fetch('/api/collection')).json()).cards || []);
  assert.ok(collection.length > 0);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(collection[0].club);
  const withLogo = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() } });
  const a = await withLogo.newPage();
  await a.route('**/api/club-logos', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logos: { [key]: 'competition-ligue-1.png' }, aliases: {} }) }));
  await a.goto(server.base + '/#home');
  await a.evaluate(async () => { await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'navigateur@test.fr', password: 'motdepasse123' }) }); });
  await a.goto(server.base + '/#collection');
  await a.reload();
  await a.waitForSelector('.tcg-card.v4');
  await a.waitForSelector('.v4-club-badge');
  const expected = collection.filter(c => norm(c.club) === key).length;
  assert.ok((await a.$$('.v4-club-badge')).length >= 1 && (await a.$$('.v4-club-badge')).length <= Math.max(expected, 1) * 2, 'pastilles seulement sur les cartes du club');
  assert.equal(await a.$eval('.v4-club-badge', e => e.getAttribute('src')), 'competition-ligue-1.png');
  await withLogo.close();
  // Aucun logo connu : aucune pastille, cartes inchangées.
  await page.route('**/api/club-logos', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logos: {}, fallback: {}, aliases: {} }) }));
  await page.goto(server.base + '/#collection');
  await page.reload();
  await page.waitForSelector('.tcg-card.v4');
  assert.equal((await page.$$('.v4-club-badge')).length, 0);
  await page.unroute('**/api/club-logos');
});

test('état du site : page publique, serveur et base annoncés en ligne, mémoire affichée, serveur en panne signalé', async () => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': server.newIp() }, viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(server.base + '/etat.html');
  await p.waitForFunction(() => /Tout fonctionne/.test(document.getElementById('statusText').textContent), null, { timeout: 15000 });
  assert.equal(await p.$eval('#status', e => e.className.includes('ok')), true);
  const tiles = await p.$$eval('.tile', els => els.map(e => e.textContent));
  assert.equal(tiles.length, 6);
  assert.ok(tiles.some(t => /Base de données.*OK/.test(t)), tiles.join(' | '));
  assert.ok(tiles.some(t => /Mémoire du serveur\d+ Mo/.test(t)), tiles.join(' | '));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'pas de défilement horizontal sur mobile');
  assert.equal(await p.$('a[href="/"]') !== null, true);
  // Serveur injoignable : message clair, page toujours là.
  await p.route('**/api/health', route => route.abort());
  await p.evaluate(() => new Promise(r => setTimeout(r, 0)));
  await p.reload();
  await p.waitForFunction(() => /ne répond pas/.test(document.getElementById('statusText').textContent), null, { timeout: 15000 });
  assert.equal(await p.$eval('#status', e => e.className.includes('bad')), true);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('accueil : le pied de page renvoie vers la page « état du site »', async () => {
  await page.goto(server.base + '/#home');
  assert.equal(await page.$eval('.footer a[href="etat.html"]', e => e.textContent.trim()), 'ÉTAT DU SITE');
});

test('clavier : lien d\'évitement au premier Tab, titre par page, focus sur le contenu au changement de page', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('home');
  assert.match(await page.title(), /^Accueil — FOOTVAULT$/);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(); return { cls: a.className, text: a.textContent.trim(), top: Math.round(r.top) }; });
  assert.equal(skip.cls, 'skip-link');
  assert.equal(skip.text, 'Aller au contenu');
  assert.ok(skip.top >= 0, 'le lien d\'évitement est visible au focus : ' + skip.top);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'app', 'le focus passe au contenu');
  assert.ok(!/#app/.test(page.url()), 'la navigation ne change pas l\'adresse : ' + page.url());
  assert.equal(await page.$eval('#app', e => e.children.length > 0), true, 'la page reste affichée');
  // Changement de page : titre mis à jour et focus sur le contenu.
  await page.evaluate(() => { location.hash = '#market'; });
  await page.waitForFunction(() => document.title === 'Marché — FOOTVAULT', null, { timeout: 15000 });
  await page.waitForFunction(() => document.activeElement?.id === 'app', null, { timeout: 5000 });
  assert.deepEqual(errors, []);
});

test('fenêtres modales : rôle dialog nommé, focus piégé, Échap, fond inerte, focus rendu au déclencheur', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('admin');
  await page.click('[data-admin-tab="successes"]');
  await page.waitForSelector('[data-preview-achievement]');
  await page.evaluate(() => document.querySelector('[data-preview-achievement]').setAttribute('data-test-trigger', '1'));
  await page.focus('[data-test-trigger]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#modal.show');
  const open = await page.evaluate(() => {
    const m = document.querySelector('#modal'), title = document.getElementById(m.getAttribute('aria-labelledby') || '');
    return { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), title: title?.textContent.trim() || '', inside: m.contains(document.activeElement),
      appInert: document.querySelector('#app').inert, headerInert: document.querySelector('.header').inert };
  });
  assert.equal(open.role, 'dialog');
  assert.equal(open.modal, 'true');
  assert.ok(open.title.length > 2, 'titre : ' + open.title);
  assert.equal(open.inside, true, 'le focus est dans la fenêtre à l\'ouverture');
  assert.equal(open.appInert && open.headerInert, true, 'le fond est inerte');
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').contains(document.activeElement)), true, 'Tab n\'est pas sorti de la fenêtre (' + i + ')');
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').contains(document.activeElement)), true, 'Maj+Tab n\'est pas sorti de la fenêtre (' + i + ')');
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'));
  const closed = await page.evaluate(() => ({ role: document.querySelector('#modal').getAttribute('role'), appInert: document.querySelector('#app').inert,
    headerInert: document.querySelector('.header').inert, back: document.activeElement?.hasAttribute('data-test-trigger') }));
  assert.equal(closed.role, null);
  assert.equal(closed.appInert || closed.headerInert, false, 'le fond est de nouveau actif');
  assert.equal(closed.back, true, 'le focus revient au bouton qui a ouvert la fenêtre');
  assert.deepEqual(errors, []);
});

test('espace de noms FVC : une fonction par page, aides partagées, page remplaçable, lien inconnu = accueil', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(server.base + '/#home');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
  const ns = await page.evaluate(() => ({
    pages: Object.keys(window.FVC?.pages || {}).sort(),
    core: Object.keys(window.FVC?.core || {}).sort(),
    ui: Object.keys(window.FVC?.ui || {}).sort(),
    allFunctions: Object.values(window.FVC?.pages || {}).every(f => typeof f === 'function')
  }));
  assert.deepEqual(ns.pages, ['admin', 'album', 'amis', 'atelier', 'auth', 'card', 'classement', 'collectif', 'collection', 'equipe', 'home', 'joueur', 'market', 'packs', 'profil', 'souhaits', 'statistiques', 'successes', 'surmesure', 'trades', 'vault']);
  for (const k of ['$', 'api', 'apiRetry', 'app', 'bind', 'cardLink', 'cardMarkup', 'cardStatDefinitions', 'closeModal', 'esc', 'initials', 'money', 'rarityOrder', 'render', 'setModal', 'state', 'toast', 'viewHero']) assert.ok(ns.core.includes(k), 'FVC.core.' + k);
  for (const k of ['claimAlbum', 'claimChallengeUi', 'claimSetUi', 'daily', 'logout', 'mission', 'openPack', 'openPool', 'submitAuth', 'task', 'toggleFavorite']) assert.ok(ns.ui.includes(k), 'FVC.ui.' + k);
  assert.equal(ns.allFunctions, true);
  // Un lien inconnu affiche l'accueil (et non « [object Promise] »).
  await page.goto(server.base + '/#page-qui-nexiste-pas');
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
  assert.equal(await page.evaluate(() => document.querySelector('#app').textContent.includes('[object')), false);
  assert.ok(await page.evaluate(() => document.querySelector('#app .page, #app section')), 'l\'accueil est affiché');
  // Un module chargé après app.js peut remplacer une page.
  await page.evaluate(() => { window.FVC.pages.successes = async () => '<div class="page" id="page-remplacee"><h1>Page remplacée</h1></div>'; });
  await page.goto(server.base + '/#successes');
  await page.waitForSelector('#page-remplacee');
  assert.deepEqual(errors, []);
});

test('classement : onglet SAISON (saison à venir ou en cours), barème et pas de débordement', async () => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(server.base + '/#classement?periode=saison');
    await page.reload();
    await page.waitForSelector('.season-box');
    const r = await page.evaluate(() => ({
      tab: document.querySelector('.ranking-tabs a.active')?.textContent.trim(),
      rows: document.querySelectorAll('.season-box > ul li').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    assert.equal(r.tab, 'SAISON');
    assert.equal(r.rows, 5);
    assert.equal(r.overflow, false);
  }
  assert.deepEqual(errors, []);
});

test('menu : « Marché » regroupe Enchères et Échanges (liste déroulante au bureau, liste à plat sur mobile)', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(server.base + '/#home');
  await page.reload();
  await page.waitForSelector('#nav .nav-group-btn');
  assert.equal(await page.isVisible('#nav a[data-route="trades"]'), false);
  await page.click('.nav-group:has(a[data-route="trades"]) .nav-group-btn');
  assert.equal(await page.isVisible('#nav a[data-route="trades"]'), true);
  assert.equal(await page.getAttribute('.nav-group.open .nav-group-btn', 'aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#nav a[data-route="trades"]'), false);
  await page.click('.nav-group:has(a[data-route="trades"]) .nav-group-btn');
  await page.click('#nav a[data-route="trades"]');
  await page.waitForFunction(() => location.hash.startsWith('#trades'));
  await page.waitForFunction(() => document.querySelector('.nav-group:has(a[data-route="trades"]) .nav-group-btn')?.classList.contains('active'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#menu');
  assert.equal(await page.isVisible('#nav a[data-route="trades"]'), true);
  assert.deepEqual(errors, []);
});

test('roue des éditions limitées : fenêtre accessible, lancer sur action du joueur, résultat annoncé, puis révélation des cartes', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(server.base + '/#home');
  await page.reload();
  await page.waitForFunction(() => window.FVC?.ui?.openPool);
  const card = (id, name, extra = {}) => ({ instanceId: id, cardId: id, name, position: 'ST', club: 'FC Roue', nation: 'France', season: '2026-2027', rarity: 'epic', ovr: 88, ...extra });
  await page.route('**/api/pools/open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    user: { id: 'u', name: 'T', coins: 10, xp: 0 },
    cards: [card('s1', 'Spéciale', { rarity: 'icon' }), card('l1', 'Limitée', { isLimited: true, serial: 1, maxSupply: 5, serialLabel: '1/5', bonus: true })],
    wheels: [{ special: { id: 's1', name: 'Spéciale' }, segments: [{ label: '/5', tier: 5, chance: 0.5 }, { label: 'RIEN', tier: null }], index: 0, lostChance: 99.5, tier: 5, card: card('l1', 'Limitée', { serialLabel: '1/5' }) }],
    pack: { id: 'pool:x', name: 'Pool', cards: 1, pool: true }
  }) }));
  await page.evaluate(() => { window.FVC.ui.openPool('x'); });
  await page.waitForSelector('#wheelGo');
  assert.equal(await page.getAttribute('#modal', 'role'), 'dialog');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  assert.equal(await page.textContent('#wheelResult'), '', 'rien n\'est annoncé avant le lancer');
  await page.click('#wheelGo');
  await page.waitForFunction(() => document.getElementById('wheelGo')?.textContent === 'CONTINUER', null, { timeout: 8000 });
  assert.match(await page.textContent('#wheelResult'), /Limitée.*1\/5/);
  await page.click('#wheelGo');
  await page.waitForFunction(() => !document.getElementById('wheelGo'));
  await page.unroute('**/api/pools/open');
});

test('PWA : manifeste complet (icônes maskable), service worker enregistré, bloc Notifications du profil sans débordement', async () => {
  const man = await (await fetch(server.base + '/manifest.json')).json();
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512'));
  for (const i of man.icons) assert.equal((await fetch(server.base + '/' + i.src)).status, 200, i.src);
  const sw = await fetch(server.base + '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const r = await visit('profil');
    assert.ok(r.overflow <= 1, 'pas de débordement à ' + width);
    await page.waitForSelector('.push-panel');
    assert.match(await page.textContent('.push-panel'), /NOTIFICATIONS/);
  }
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => !!r));
  assert.deepEqual(errors, []);
});

test('collection : affichage de base par OVR décroissant, tri modifiable', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  for (const [i, ovr] of [60, 80, 70].entries()) {
    const cardId = 'tri-ovr-' + i, name = 'Tri OVR ' + ovr;
    await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Tri','France','common',$3)", [cardId, name, ovr]);
    await server.db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,acquired_at)
      VALUES(gen_random_uuid(),$1,$2,'2026-2027',$3,'ST','FC Tri','France','common',$4,'pack:test',now() + ($5 || ' seconds')::interval)`, [cardId, uid, name, ovr, String(i)]);
  }
  await visit('collection');
  assert.equal(await page.inputValue('#collectionSort'), 'ovr');
  const order = async () => page.evaluate(() => [...document.querySelectorAll('.collection-card-item')].map(e => e.textContent).filter(t => /Tri OVR/.test(t)).map(t => Number(/Tri OVR (\d+)/.exec(t)[1])));
  assert.deepEqual(await order(), [80, 70, 60]);
  await page.selectOption('#collectionSort', 'name');
  await page.waitForFunction(() => { const t = [...document.querySelectorAll('.collection-card-item')].map(e => e.textContent).find(x => /Tri OVR/.test(x)); return t && /Tri OVR 60/.test(t); });
  assert.deepEqual(await order(), [60, 70, 80]);
  assert.deepEqual(errors, []);
});

test('amis : demande par code, acceptation, profil public, confidentialité', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const other = await newPlayer(server, 'AmiTest');
  const otherCode = (await other.get('/api/trades')).body.code;
  let r = await visit('amis');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.waitForSelector('[data-friend-add]');
  await page.fill('#friendCode', otherCode);
  await page.click('[data-friend-add] button[type=submit]');
  await page.waitForFunction(() => /DEMANDES ENVOYÉES/.test(document.querySelector('#app').innerText));
  const incoming = (await other.get('/api/friends')).body.incoming;
  assert.equal(incoming.length, 1);
  assert.equal((await other.post('/api/friends/accept', { id: incoming[0].id })).status, 200);
  r = await visit('amis');
  await page.waitForFunction(() => /AmiTest/.test(document.querySelector('.friend-list')?.innerText || ''));
  assert.match(await page.textContent('.friends-page'), /ACTIVITÉ DE MES AMIS/);
  await page.click('.friend-name');
  await page.waitForFunction(() => location.hash.startsWith('#joueur'));
  await page.waitForFunction(() => /AMITEST/.test(document.querySelector('#app h1')?.textContent || ''));
  assert.match(await page.textContent('.friend-relation'), /Vous êtes amis/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await other.post('/api/profile/visibility', { visibility: 'private' });
  await page.reload();
  await page.waitForFunction(() => /pas visible/.test(document.querySelector('#app').innerText));
  assert.deepEqual(errors, []);
});

test('souhaits : recherche, ajout, retrait, sans débordement', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES('wish-ui','2026-2027','Joueur Souhaité UI','ST','FC Souhait','France','epic',88) ON CONFLICT DO NOTHING");
  const r = await visit('souhaits');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.fill('#wishQuery', 'Souhaité UI');
  await page.waitForSelector('[data-wish-add="wish-ui"]');
  await page.click('[data-wish-add="wish-ui"]');
  await page.waitForSelector('[data-wish-remove="wish-ui"]');
  assert.match(await page.textContent('.wish-page'), /Pas en vente/);
  await page.click('[data-wish-remove="wish-ui"]');
  await page.waitForFunction(() => !document.querySelector('[data-wish-remove="wish-ui"]'));
  assert.deepEqual(errors, []);
});

test('statistiques : compétitions, décennies, rareté, poste, valeur indicative, sans débordement', async () => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const r = await visit('statistiques');
    assert.ok(r.overflow <= 1, 'pas de débordement à ' + width);
    await page.waitForSelector('.stats-page .stat-bar');
    const text = await page.textContent('.stats-page');
    for (const t of ['PAR COMPÉTITION', 'PAR DÉCENNIE', 'PAR RARETÉ', 'PAR POSTE', 'VALEUR ESTIMÉE', 'Ce n’est pas un prix garanti']) assert.ok(text.includes(t), t);
  }
  assert.deepEqual(errors, []);
});

test('équipe type : formation, meilleur 11, choix d\'un joueur, enregistrement, sans débordement', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  for (const [pos, ovr] of [['GK', 77], ['CB', 76], ['ST', 79]]) {
    const cardId = 'team-ui-' + pos;
    await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,$3,'FC Equipe','France','common',$4) ON CONFLICT DO NOTHING", [cardId, 'Titulaire ' + pos, pos, ovr]);
    await server.db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
      SELECT gen_random_uuid(),$1::varchar,$2::uuid,'2026-2027',$3::varchar,$4::varchar,'FC Equipe','France','common',$5::int,'pack:test' WHERE NOT EXISTS(SELECT 1 FROM card_instances WHERE card_id=$1::varchar AND owner_id=$2::uuid)`, [cardId, uid, 'Titulaire ' + pos, pos, ovr]);
  }
  const r = await visit('equipe');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.waitForSelector('.team-pitch');
  assert.equal(await page.locator('.team-slot').count(), 11);
  await page.selectOption('#teamFormation', '4-4-2');
  await page.waitForFunction(() => document.querySelectorAll('.team-row').length === 4 && document.querySelector('#teamFormation').value === '4-4-2');
  await page.click('[data-team-auto]');
  await page.waitForFunction(() => document.querySelectorAll('.team-slot.is-filled').length >= 3);
  await page.click('[data-team-slot="0"]');
  await page.waitForSelector('.team-picker');
  assert.equal(await page.getAttribute('#modal', 'role'), 'dialog');
  await page.click('[data-team-remove]');
  await page.waitForFunction(() => !document.querySelector('.team-picker'));
  await page.click('[data-team-save]');
  await page.waitForFunction(() => /Équipe enregistrée|0 \/ 11|\/ 11 postes/.test(document.body.innerText) && !document.querySelector('[data-team-save]:not([disabled])'));
  const saved = (await server.db.query('SELECT formation FROM team_lineups WHERE user_id=$1', [uid])).rows[0];
  assert.equal(saved.formation, '4-4-2');
  assert.deepEqual(errors, []);
});

test('atelier : vente rapide d\'un doublon, fusion refusée sans assez de doublons, sans débordement', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES('wk-ui','2026-2027','Doublon Atelier UI','ST','FC Atelier','France','common',70) ON CONFLICT DO NOTHING");
  for (let i = 0; i < 2; i++) await server.db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
    VALUES(gen_random_uuid(),'wk-ui',$1,'2026-2027','Doublon Atelier UI','ST','FC Atelier','France','common',70,'pack:test')`, [uid]);
  const r = await visit('atelier');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.waitForSelector('[data-wk-sell="wk-ui"]');
  assert.equal(await page.locator('[data-wk-fuse="common"]').isDisabled(), true, 'pas assez de doublons pour fusionner');
  const before = Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins);
  await page.click('[data-wk-sell="wk-ui"]');
  await page.waitForFunction(() => !document.querySelector('[data-wk-sell="wk-ui"]'));
  assert.equal(Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins), before + 20);
  assert.deepEqual(errors, []);
});

test('pack sur mesure : prix calculé par le serveur, aperçu qui suit les choix, achat et révélation, sans débordement', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  for (let i = 0; i < 25; i++) await server.db.query("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Sur Mesure','France','common',70) ON CONFLICT DO NOTHING", ['cpui' + i, 'Sur Mesure UI ' + i]);
  await server.db.query('UPDATE users SET coins=5000 WHERE id=$1', [uid]);
  const r = await visit('surmesure');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.waitForSelector('[data-cp-open]');
  await page.fill('#cpClub', 'FC Sur Mesure');
  await page.click('[data-cp-club-add]');
  await page.waitForFunction(() => /5 cartes/.test(document.querySelector('#cpQuote .cp-price small')?.textContent || '') && /220/.test(document.querySelector('#cpQuote .cp-price strong')?.textContent.replace(/\s/g, '') || ''));
  const before = Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins);
  await page.click('[data-cp-open]');
  await page.waitForSelector('[data-reveal-card]', { state: 'attached' });
  assert.equal(await page.locator('[data-reveal-card]').count(), 5);
  assert.equal(Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins), before - 220);
  assert.deepEqual(errors, []);
});

test('défis collectifs : jauge commune, palier atteint réclamé une seule fois, sans débordement', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const uid = (await server.db.query("SELECT id FROM users WHERE email='navigateur@test.fr'")).rows[0].id;
  await server.db.query("INSERT INTO collective_challenges(id,title,description,metrics,tiers,starts_at,ends_at) VALUES('cl-ui','Défi UI','Ouvre des packs',ARRAY['packs'],$1::jsonb,now()-interval '1 hour',now()+interval '1 day')", [JSON.stringify([{ at: 1, coins: 77, xp: 5 }, { at: 1000, coins: 500, xp: 50 }])]);
  await server.db.query("INSERT INTO security_events(user_id,event,details) VALUES($1,'pack_open','{\"cards\":5}'::jsonb)", [uid]);
  const r = await visit('collectif');
  assert.ok(r.overflow <= 1, 'pas de débordement');
  await page.waitForSelector('[data-cl-claim="cl-ui"][data-tier="0"]');
  assert.equal(await page.locator('[data-cl-claim="cl-ui"][data-tier="1"]').count(), 0, 'palier lointain non réclamable');
  const before = Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins);
  await page.click('[data-cl-claim="cl-ui"][data-tier="0"]');
  await page.waitForFunction(() => !document.querySelector('[data-cl-claim="cl-ui"][data-tier="0"]'));
  assert.equal(Number((await server.db.query('SELECT coins FROM users WHERE id=$1', [uid])).rows[0].coins), before + 77);
  assert.deepEqual(errors, []);
});

test('administration (fv-admin.js) : onglets et éditeurs de cartes, packs, pools, compétitions et clubs s\'ouvrent', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit('admin');
  assert.ok(await page.evaluate(() => typeof window.FVC.admin?.showPackEditor === 'function' && typeof window.FVC.pages.admin === 'function'));
  const editors = [['cards', '[data-new-catalog-card]'], ['packs', '[data-new-pack]'], ['packs', '[data-new-pool]'], ['competitions', '[data-new-competition]'], ['competitions', '[data-new-club]']];
  for (const [tab, selector] of editors) {
    await page.click(`[data-admin-tab="${tab}"]`);
    await page.waitForSelector(selector, { state: 'visible' });
    await page.click(selector);
    await page.waitForFunction(() => document.querySelector('#modal')?.classList.contains('show'));
    assert.ok((await page.textContent('#modal h2, #modal h3, #modal h1'))?.trim().length > 2, selector + ' : fenêtre titrée');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'));
  }
  assert.deepEqual(errors, []);
});
