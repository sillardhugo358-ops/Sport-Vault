'use strict';

// Import de la Ligue des Champions (scripts/import-ldc.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, setCoins } = require('./helpers');
const { loadData, importLdc, EXPECTED_CARDS, LEGACY_CLUB_NAMES } = require('../scripts/import-ldc');
const { rarityFromOvr } = require('../lib/rarity');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const quiet = () => {};

test('fichier : 21 446 cartes valides, raretés du barème, notes du classeur conservées', () => {
  const { cards, clubs, seasons } = loadData();
  assert.equal(cards.length, EXPECTED_CARDS);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  assert.equal(seasons.length, 35);
  assert.ok(cards.every(c => c.id.startsWith('fv-c-') && /^LDC \d{4}-\d{2}$/.test(c.season) && c.season.length <= 12));
  for (const c of cards) assert.equal(c.rarity, rarityFromOvr(c.ovr));
  assert.equal(Math.max(...cards.map(c => c.ovr)), 97, 'les notes >= 92 ne bougent pas');
  const messi = cards.find(c => c.name === 'Lionel Messi' && c.seasonKey === '2010-2011');
  assert.equal(messi.ovr, 97);
  assert.equal(messi.club, 'FC Barcelona');
  // Un même club écrit de plusieurs façons dans le classeur n'est plus qu'un seul club.
  assert.ok(!clubs.includes('Club Brugge KV') && !clubs.includes('FC Bayern Munich') && clubs.includes('Bayern Munich'));
  // Gardien : colonnes PLO, ARR, JAP, RÉF, VIT, PLA -> shooting, passing, dribbling, defending, pace, physical.
  const gk = cards.find(c => c.name === 'Ihor Kutyepov' && c.seasonKey === '1991-1992');
  assert.deepEqual([gk.position, gk.shooting, gk.passing, gk.dribbling, gk.defending, gk.pace, gk.physical], ['GK', 73, 72, 61, 75, 37, 69]);
});

test('relèvement léger des notes (scripts/lift-ldc-ratings.py) : courbe croissante, ordre conservé, notes >= 92 intactes, médiane ~76', () => {
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'data', 'ldc-1991-2026.json.gz'))).toString('utf8'));
  assert.equal(doc.lift.name, 'legere-2026-10-04');
  const curve = doc.lift.curve, io = doc.columns.indexOf('ovr'), oo = doc.columns.indexOf('ovrOrig');
  const lift = o => { if (o >= curve[curve.length - 1][0]) return o; if (o <= curve[0][0]) return o + curve[0][1] - curve[0][0];
    for (let i = 0; i < curve.length - 1; i++) { const [x0, y0] = curve[i], [x1, y1] = curve[i + 1]; if (o >= x0 && o <= x1) return Math.round(y0 + (y1 - y0) * (o - x0) / (x1 - x0)); } return o; };
  assert.ok(curve.every(([x, y], i) => i === 0 || (x > curve[i - 1][0] && y > curve[i - 1][1])), 'courbe strictement croissante');
  for (const r of doc.rows) {
    assert.equal(r[io], lift(r[oo]), 'note = courbe(note d\'origine)');
    assert.ok(r[io] >= r[oo], 'aucune baisse');
    if (r[oo] >= 92) assert.equal(r[io], r[oo], 'notes >= 92 intactes');
  }
  // Ordre conservé : une note d'origine plus haute n'est jamais passée sous une note d'origine plus basse.
  const byOrig = new Map();
  for (const r of doc.rows) byOrig.set(r[oo], r[io]);
  const origs = [...byOrig.keys()].sort((a, b) => a - b);
  for (let i = 1; i < origs.length; i++) assert.ok(byOrig.get(origs[i]) >= byOrig.get(origs[i - 1]));
  const ovr = doc.rows.map(r => r[io]).sort((a, b) => a - b);
  assert.ok(ovr[ovr.length >> 1] >= 75 && ovr[ovr.length >> 1] <= 77, 'médiane ~76 : ' + ovr[ovr.length >> 1]);
  const common = ovr.filter(o => o < 78).length / ovr.length;
  assert.ok(common > 0.5 && common < 0.6, 'Common ~55 % : ' + common);
  for (const r of doc.rows) for (const c of ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical']) assert.ok(r[doc.columns.indexOf(c)] >= 1 && r[doc.columns.indexOf(c)] <= 99);
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

test('club corrigé (« FC Kosicee » → « FC Košice ») : renommé sur place, identifiants des cartes et exemplaires intacts, pas de doublon', async () => {
  assert.deepEqual(LEGACY_CLUB_NAMES, { 'FC Košice': 'FC Kosicee' });
  const db = server.db, q = async (sql, params) => (await db.query(sql, params)).rows;
  const koscards = loadData().cards.filter(c => c.club === 'FC Košice');
  assert.equal(koscards.length, 17);
  // État d'avant la correction : l'ancien nom partout, un logo posé sur le club, un exemplaire possédé.
  await q("UPDATE clubs SET name='FC Kosicee',logo_url='club-logos/ldc-fc-kosicee.png' WHERE name='FC Košice'");
  await q("UPDATE catalog_cards SET club='FC Kosicee' WHERE club='FC Košice'");
  const owner = await newPlayer(server, 'Proprio');
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
    SELECT gen_random_uuid(),id,$1,season,name,position,club,nation,rarity,'test' FROM catalog_cards WHERE id=$2`, [owner.user.id, koscards[0].id]);
  const clubsBefore = Number((await q('SELECT count(*) AS n FROM clubs'))[0].n);
  const idBefore = (await q("SELECT id FROM clubs WHERE name='FC Kosicee'"))[0].id;
  await importLdc(db, { force: true, log: quiet });
  const clubs = await q("SELECT id,name,logo_url FROM clubs WHERE name ILIKE 'FC Ko%ice%'");
  assert.deepEqual(clubs.map(c => [c.id, c.name, c.logo_url]), [[idBefore, 'FC Košice', 'club-logos/ldc-fc-kosicee.png']], 'même ligne, même logo');
  assert.equal(Number((await q('SELECT count(*) AS n FROM clubs'))[0].n), clubsBefore, 'aucun club créé');
  assert.equal(Number((await q("SELECT count(*) AS n FROM catalog_cards WHERE club='FC Kosicee'"))[0].n), 0);
  assert.equal(Number((await q("SELECT count(*) AS n FROM catalog_cards WHERE club='FC Košice' AND is_active"))[0].n), 17, 'mêmes 17 cartes (identifiants stables)');
  assert.equal((await q('SELECT club FROM card_instances WHERE owner_id=$1 AND card_id=$2', [owner.user.id, koscards[0].id]))[0].club, 'FC Košice', 'exemplaire resynchronisé');
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
