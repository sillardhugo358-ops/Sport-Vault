'use strict';

// Import de la Coupe du monde et de la Ligue des Nations (scripts/import-international.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins } = require('./helpers');
const { loadCards, importInternational, EXPECTED_CARDS } = require('../scripts/import-international');
const { rarityFromOvr } = require('../lib/rarity');

const POSITIONS = ['GK', 'CB', 'DM', 'CM', 'AM', 'ST'];
const quiet = () => {};

test('fichier : 12 586 cartes valides, raretés du barème, notes du classeur conservées, doublon conservé', () => {
  const cards = loadCards();
  assert.equal(cards.length, EXPECTED_CARDS);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  const wc = cards.filter(c => c.competitionId === 'coupe-du-monde'), nl = cards.filter(c => c.competitionId === 'ligue-des-nations');
  assert.deepEqual([wc.length, nl.length], [12210, 376]);
  assert.ok(wc.every(c => c.id.startsWith('fv-w-')) && nl.every(c => c.id.startsWith('fv-n-')));
  for (const c of cards) {
    assert.ok(POSITIONS.includes(c.position), c.position);
    assert.equal(c.rarity, rarityFromOvr(c.ovr));
    assert.ok(c.ovr <= 99, c.name + ' ' + c.ovr);
    assert.ok(c.nation && c.nation === c.club);
  }
  assert.deepEqual([...new Set(nl.map(c => c.season))].sort(), ['2018-2019', '2020-2021', '2022-2023', '2024-2025']);
  assert.ok(!cards.some(c => /Germany|Ivory Coast|Soviet|Yugoslavia/.test(c.nation)), 'noms de sélections en français');
  assert.equal(Math.max(...cards.map(c => c.ovr)), 98, 'aucune note plafonnée');
  const stevens = cards.filter(c => c.name === 'Gary Stevens' && c.season === '1986');
  assert.equal(stevens.length, 2, 'deux joueurs homonymes, deux cartes');
});

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('import : cartes, compétitions, éditions ; relance sans doublon ; carte désactivée respectée', async () => {
  const first = await importInternational(server.db, { log: quiet });
  assert.equal(first.skipped, false);
  const count = async (where = '') => Number((await server.db.query(`SELECT count(*) FROM catalog_cards WHERE id ~ '^fv-[wn]-' AND is_active ${where}`)).rows[0].count);
  assert.equal(await count(), EXPECTED_CARDS);
  const comps = (await server.db.query("SELECT id FROM competitions WHERE status='available'")).rows.map(r => r.id);
  assert.ok(comps.includes('coupe-du-monde') && comps.includes('ligue-des-nations'));
  const editions = async id => Number((await server.db.query("SELECT count(*) FROM competition_seasons WHERE competition_id=$1 AND status='available'", [id])).rows[0].count);
  assert.equal(await editions('ligue-des-nations'), 4);
  assert.equal(await editions('coupe-du-monde'), 23);
  assert.equal((await importInternational(server.db, { log: quiet })).skipped, true);
  await server.db.query("UPDATE catalog_cards SET is_active=false WHERE id=(SELECT min(id) FROM catalog_cards WHERE id LIKE 'fv-w-%')");
  await importInternational(server.db, { force: true, log: quiet });
  assert.equal(await count(), EXPECTED_CARDS - 1);
  assert.equal(Number((await server.db.query("SELECT count(*) FROM catalog_cards WHERE id ~ '^fv-[wn]-'")).rows[0].count), EXPECTED_CARDS);
  const clubs = Number((await server.db.query("SELECT count(*) FROM clubs WHERE lower(name)=lower('France')")).rows[0].count);
  assert.equal(clubs, 1, 'une seule équipe « France »');
});

test('anti-dilution : packs génériques et cadeau de bienvenue sans cartes internationales ; pack dédié oui', async () => {
  const p = await newPlayer(server, 'Mondial');
  await setCoins(server, p.user.id, 100000);
  assert.ok((await p.get('/api/collection')).body.cards.every(c => !/^fv-[wn]-/.test(c.cardId)), 'cadeau de bienvenue');
  for (let i = 0; i < 15; i++) {
    const r = await p.post('/api/packs/open', { packId: 'starter' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.cards.every(c => !/^fv-[wn]-/.test(c.cardId)), 'pack starter');
  }
  await server.db.query(`INSERT INTO pack_definitions(id,name,price,currency,cards,guarantee,guarantee_count,conditions,active)
    VALUES('pack-cdm-test','PACK CDM TEST',10,'coins',5,'common',0,$1,true)`, [JSON.stringify({ competitions: ['coupe-du-monde'] })]);
  const r = await p.post('/api/packs/open', { packId: 'pack-cdm-test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cards.length, 5);
  assert.ok(r.body.cards.every(c => /^fv-w-/.test(c.cardId)), 'pack Coupe du monde : seulement des cartes Coupe du monde');
});
