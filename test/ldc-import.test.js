'use strict';

// Import de la Ligue des Champions (scripts/import-ldc.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins } = require('./helpers');
const { loadData, importLdc, EXPECTED_CARDS } = require('../scripts/import-ldc');
const { rarityFromOvr } = require('../lib/rarity');

const quiet = () => {};

test('fichier : 21 446 cartes valides, raretés du barème, notes du classeur conservées', () => {
  const { cards, clubs, seasons } = loadData();
  assert.equal(cards.length, EXPECTED_CARDS);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  assert.equal(seasons.length, 35);
  assert.ok(cards.every(c => c.id.startsWith('fv-c-') && /^LDC \d{4}-\d{2}$/.test(c.season) && c.season.length <= 12));
  for (const c of cards) assert.equal(c.rarity, rarityFromOvr(c.ovr));
  assert.equal(Math.max(...cards.map(c => c.ovr)), 97, 'notes du classeur conservées');
  const messi = cards.find(c => c.name === 'Lionel Messi' && c.seasonKey === '2010-2011');
  assert.equal(messi.ovr, 97);
  assert.equal(messi.club, 'FC Barcelona');
  // Un même club écrit de plusieurs façons dans le classeur n'est plus qu'un seul club.
  assert.ok(!clubs.includes('Club Brugge KV') && !clubs.includes('FC Bayern Munich') && clubs.includes('Bayern Munich'));
  // Gardien : colonnes PLO, ARR, JAP, RÉF, VIT, PLA -> shooting, passing, dribbling, defending, pace, physical.
  const gk = cards.find(c => c.name === 'Ihor Kutyepov' && c.seasonKey === '1991-1992');
  assert.deepEqual([gk.position, gk.shooting, gk.passing, gk.dribbling, gk.defending, gk.pace, gk.physical], ['GK', 69, 68, 58, 71, 35, 65]);
});

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('import : cartes, clubs, saisons ; relance sans doublon ; album sans mélange avec les championnats', async () => {
  const first = await importLdc(server.db, { log: quiet });
  assert.equal(first.skipped, false);
  const count = async () => Number((await server.db.query("SELECT count(*) FROM catalog_cards WHERE id LIKE 'fv-c-%' AND is_active")).rows[0].count);
  assert.equal(await count(), EXPECTED_CARDS);
  const comp = (await server.db.query("SELECT status FROM competitions WHERE id='ligue-des-champions'")).rows[0];
  assert.equal(comp.status, 'available');
  const seasons = Number((await server.db.query("SELECT count(*) FROM competition_seasons WHERE competition_id='ligue-des-champions' AND status='available'")).rows[0].count);
  assert.equal(seasons, 35);
  // Aucune carte de Ligue des Champions ne partage (saison, club) avec une carte de championnat.
  const shared = await server.db.query("SELECT count(*)::int AS n FROM (SELECT season,club FROM catalog_cards WHERE id LIKE 'fv-c-%' INTERSECT SELECT season,club FROM catalog_cards WHERE id NOT LIKE 'fv-c-%') x");
  assert.equal(shared.rows[0].n, 0);
  assert.equal((await importLdc(server.db, { log: quiet })).skipped, true);
  await server.db.query("UPDATE catalog_cards SET is_active=false WHERE id=(SELECT min(id) FROM catalog_cards WHERE id LIKE 'fv-c-%')");
  await importLdc(server.db, { force: true, log: quiet });
  assert.equal(await count(), EXPECTED_CARDS - 1, 'une carte désactivée par un admin reste désactivée');
  assert.equal(Number((await server.db.query("SELECT count(*) FROM catalog_cards WHERE id LIKE 'fv-c-%'")).rows[0].count), EXPECTED_CARDS);
});

test('anti-dilution : packs génériques sans cartes LDC ; pack dédié = cartes LDC ; accueil sans LDC', async () => {
  const pack = (await server.db.query("SELECT price,cards,guarantee FROM pack_definitions WHERE id='pack-ligue-des-champions'")).rows[0];
  assert.deepEqual([Number(pack.price), Number(pack.cards), pack.guarantee], [300, 6, 'rare']);
  const p = await newPlayer(server, 'Europeen');
  await setCoins(server, p.user.id, 10000);
  assert.ok((await p.get('/api/collection')).body.cards.every(c => !c.cardId.startsWith('fv-c-')), 'cadeau de bienvenue');
  for (let i = 0; i < 8; i++) {
    const r = await p.post('/api/packs/open', { packId: 'starter' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.cards.every(c => !c.cardId.startsWith('fv-c-')), 'pack starter');
  }
  for (let i = 0; i < 5; i++) {
    const r = await p.post('/api/packs/open', { packId: 'pack-ligue-des-champions' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cards.length, 6);
    assert.ok(r.body.cards.every(c => c.cardId.startsWith('fv-c-')), 'pack Ligue des Champions');
    assert.ok(r.body.cards.some(c => c.rarity !== 'common'), 'Rare garanti');
  }
  const res = await fetch(server.base + '/api/catalog/summary');
  const summary = await res.json();
  assert.equal(res.status, 200, JSON.stringify(summary));
  assert.ok(summary.featured.every(c => !c.id.startsWith('fv-c-')));
});
