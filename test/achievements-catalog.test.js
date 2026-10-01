'use strict';

// Les 200 succès du document « Succès et missions » : migration unique et fusion avec les succès
// d'origine (aucune double récompense), succès « à venir » inactifs, succès secrets masqués,
// et une mesure de chaque grande famille vérifiée sur un joueur construit.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer } = require('./helpers');
const { ACHIEVEMENT_CATALOG } = require('../lib/achievements-catalog');

let server, creator;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const byCode = list => new Map(list.map(a => [a.code, a]));
const achievementsOf = async p => byCode((await p.get('/api/achievements')).body.achievements);

// Ajoute un exemplaire directement (cartes construites pour les mesures).
async function give(p, o = {}) {
  const c = { card_id: 'ach-test-' + crypto.randomBytes(4).toString('hex'), season: '2026-2027', name: 'Joueur Test', position: 'ST', club: 'FC Test', nation: 'France', rarity: 'common', ovr: 70, jersey_number: null, source: 'pack:test', stats: 70, ...o };
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,jersey_number,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11,$11,$11,$11,$12,$13)`,
  [crypto.randomUUID(), c.card_id, p.user.id, c.season, c.name, c.position, c.club, c.nation, c.rarity, c.ovr, c.stats, c.jersey_number, c.source]);
}

test.before(async () => {
  server = await startServer();
  creator = await newPlayer(server, 'Createur');
  await q("UPDATE users SET role='creator' WHERE id=$1", [creator.user.id]);
});
test.after(async () => { await server?.stop(); });

test('migration : 200 succès numérotés, fusion des 9 d’origine, « à venir » inactifs, une seule fois', async () => {
  const rows = await q('SELECT id,code,name,type,coins,active,hidden FROM achievements');
  const coded = rows.filter(r => r.code != null);
  assert.equal(new Set(coded.map(r => r.code)).size, 200);
  const pending = ACHIEVEMENT_CATALOG.filter(a => a.pending).map(a => a.code);
  assert.deepEqual(coded.filter(r => !r.active).map(r => r.code).sort((a, b) => a - b), pending);
  assert.ok(coded.filter(r => r.type === 'pending').every(r => !r.active));
  const legacy = rows.find(r => r.id === 'ach-first-card');
  assert.deepEqual([legacy.code, Number(legacy.coins)], [1, 50], 'récompense d’origine conservée');
  assert.equal(rows.find(r => r.id === 'ach-clubs-4').active, false);
  assert.equal((await q("SELECT count(*)::int AS n FROM achievement_migration_backup WHERE migration_id='succes-pdf-2026-10-01'"))[0].n, 9);
  assert.equal(coded.filter(r => r.hidden).length, 25);
  // Une modification faite dans la console n'est pas écrasée au redémarrage, rien n'est dupliqué.
  await q("UPDATE achievements SET name='Débutant (modifié)' WHERE code=2");
  await server.restart();
  const after = await q('SELECT name FROM achievements WHERE code=2');
  assert.equal(after[0].name, 'Débutant (modifié)');
  assert.equal((await q('SELECT count(*)::int AS n FROM achievements'))[0].n, rows.length);
});

test('fusion : un succès déjà récupéré avant la migration ne se récupère pas deux fois', async () => {
  const p = await newPlayer(server, 'Ancien');
  await q("INSERT INTO reward_claims(user_id,claim_id) VALUES($1,'achievement:ach-first-card')", [p.user.id]);
  const first = (await achievementsOf(p)).get(1);
  assert.deepEqual([first.id, first.completed, first.claimed], ['ach-first-card', true, true]);
  assert.equal((await p.post('/api/achievements/claim', { id: 'ach-first-card' })).status, 400);
  // « Bienvenue » (n° 146) : une seule récompense même en rafale, journalisée.
  const id = (await achievementsOf(p)).get(146).id;
  const results = await Promise.all(Array.from({ length: 5 }, () => p.post('/api/achievements/claim', { id })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.deepEqual((await q('SELECT amount FROM coin_ledger WHERE user_id=$1 AND ref=$2', [p.user.id, 'achievement:' + id])).map(r => r.amount), [50]);
  // Non terminé : refusé.
  assert.equal((await p.post('/api/achievements/claim', { id: (await achievementsOf(p)).get(10).id })).status, 400);
});

test('mesures : collection, raretés, postes, maillots, OVR, clubs', async () => {
  const p = await newPlayer(server, 'Mesures');
  const before = await achievementsOf(p);
  assert.equal(before.get(187).description.startsWith('Succès secret'), true, 'secret masqué');
  assert.equal(before.get(187).type, 'secret');
  for (const rarity of ['rare', 'rare', 'rare', 'epic', 'legendary', 'icon']) await give(p, { rarity, club: 'FC ' + rarity });
  for (let i = 0; i < 5; i++) await give(p, { position: 'GK', jersey_number: 1, club: 'Valenciennes FC' });
  for (let i = 0; i < 3; i++) await give(p, { ovr: 77, card_id: 'ach-test-same' });
  await give(p, { ovr: 99, stats: 96, position: 'CM' });
  const a = await achievementsOf(p);
  const done = code => a.get(code).completed;
  assert.ok(done(22), 'Trio bleu');                     // 3 Rare
  assert.ok(done(37), 'Arc-en-ciel');                   // une carte de chaque rareté (les cartes de bienvenue sont communes)
  assert.ok(done(61) && done(184) && done(181), 'gardiens n° 1, Valenciennes');
  assert.ok(done(12) && done(188), 'triplé, trois à 77');
  assert.ok(done(187) && done(186), '99 OVR, palindrome');
  assert.equal(a.get(187).description, 'Possède une carte à 99 OVR.', 'secret dévoilé une fois réussi');
  assert.ok(done(69) && done(75) && done(79), 'Vitesse 95+, complet 80+, OVR 95');
  assert.ok(done(182) && !done(13), 'jumeau, pas quintuplé');
  assert.ok(a.get(42).completed, '5 clubs différents');
});

test('mesures : marché (vente, achat, dernière seconde), série de bonus, pack de nuit', async () => {
  const seller = await newPlayer(server, 'Vendeur');
  const buyer = await newPlayer(server, 'Acheteur');
  await q('UPDATE users SET coins=100000 WHERE id=ANY($1)', [[seller.user.id, buyer.user.id]]);
  const card = (await seller.post('/api/packs/open', { packId: 'starter' })).body.cards[0];
  const auction = (await seller.post('/api/auctions/create', { cardInstanceId: card.instanceId, startingBid: 10, duration: 10 })).body.auction;
  await q("UPDATE auctions SET ends_at=now()+interval '5 seconds' WHERE id=$1", [auction.id]);
  assert.equal((await buyer.post('/api/auctions/bid', { auctionId: auction.id, amount: 10 })).status, 200);
  assert.ok((await q('SELECT remaining_ms FROM auction_bids WHERE auction_id=$1', [auction.id]))[0].remaining_ms <= 10000);
  await q("UPDATE auctions SET ends_at=now()-interval '1 second' WHERE id=$1", [auction.id]);
  await buyer.get('/api/auctions');
  const s = await achievementsOf(seller), b = await achievementsOf(buyer);
  assert.ok(s.get(101).completed && s.get(104).completed, 'mise en vente, vente');
  assert.ok(b.get(102).completed && b.get(103).completed && b.get(123).completed, 'offre, victoire, dernière seconde');
  assert.ok(b.get(121).completed, 'bonne affaire : 10 FC pour une carte de valeur ≥ 100');
  assert.ok(s.get(81).completed, 'premier pack');
  // Série de 3 bonus quotidiens consécutifs et pack ouvert à 3 h (heure de Paris).
  const p = await newPlayer(server, 'Fidele');
  for (const d of ['2026-03-10', '2026-03-11', '2026-03-12']) await q("INSERT INTO security_events(user_id,event,details,created_at) VALUES($1,'daily_reward_claim','{}',$2)", [p.user.id, d + 'T10:00:00Z']);
  await q("INSERT INTO security_events(user_id,event,details,created_at) VALUES($1,'pack_open','{\"packId\":\"starter\"}','2026-03-13T02:30:00Z')", [p.user.id]);
  const f = await achievementsOf(p);
  assert.deepEqual([f.get(151).completed, f.get(152).completed, f.get(158).progress], [true, false, 3]);
  assert.ok(f.get(176).completed, 'Noctambule (3 h 30 à Paris)');
  assert.ok(f.get(180).completed, 'vendredi 13 mars 2026');
});

test('admin : un succès « à venir » ne peut pas être activé ; « tous les autres succès » non atteint', async () => {
  const pendingId = (await q("SELECT id FROM achievements WHERE type='pending' LIMIT 1"))[0].id;
  assert.equal((await creator.post('/api/admin/achievements', { action: 'toggle', id: pendingId, active: true })).status, 400);
  const types = (await creator.get('/api/admin/achievements')).body.types;
  assert.ok(types.dailyStreak && types.vaultValue && types.pending);
  const p = await newPlayer(server, 'Curieux');
  const a = await achievementsOf(p);
  assert.equal(a.get(199).completed, false);
  assert.equal(a.size, 194);
});
