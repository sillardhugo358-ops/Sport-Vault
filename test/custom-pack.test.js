'use strict';

// Pack sur mesure : validation, prix calculé par le serveur, aperçu, tirage (filtres, rareté minimale, cartes distinctes),
// refus avant débit (sélection trop étroite, pas assez de cartes rares, FC insuffisants), journal des FOOTCOINS.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client, userRow } = require('./helpers');

let server, p;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const coins = async () => Number((await userRow(server, p.user.id)).coins);
const mix = { common: 25, rare: 6, epic: 6, legendary: 2, icon: 4 };

test.before(async () => {
  server = await startServer();
  p = await newPlayer(server, 'Mesureur');
  for (const [rarity, n] of Object.entries(mix)) for (let i = 0; i < n; i++)
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,$3,'FC Mesure','France',$4,70)",
      ['cp-' + rarity + i, 'Mesure ' + rarity + i, i % 2 ? 'ST' : 'CB', rarity]);
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES('cp-solo','2026-2027','Mesure Solo','GK','FC Solitaire','France','common',70)");
  await q('UPDATE users SET coins=100000 WHERE id=$1', [p.user.id]);
});
test.after(async () => { await server.stop?.(); });

const spec = (o = {}) => ({ cards: 5, minRarity: 'common', filters: { clubs: ['FC Mesure'] }, ...o });

test('options, aperçu et refus : prix serveur, validation, connexion obligatoire', async () => {
  assert.equal((await client(server).get('/api/custom-pack/options')).status, 401);
  assert.equal((await client(server).post('/api/custom-pack/open', spec())).status, 401);
  const o = (await p.get('/api/custom-pack/options')).body;
  assert.ok(o.clubs.includes('FC Mesure') && o.positions.includes('GK') && o.perCard.icon === 6000 && o.perCard.common === 150 && o.perCard.rare === 500 && o.perCard.epic === 1000 && o.perCard.legendary === 2000);
  const qt = (await p.post('/api/custom-pack/quote', spec())).body;
  assert.equal(qt.ok, true);
  assert.equal(qt.price, 825, '5 cartes × 150 FC + 10 % (1 catégorie de filtre)');
  assert.equal(qt.poolSize, 43);
  assert.equal((await p.post('/api/custom-pack/quote', spec({ minRarity: 'icon' }))).body.price, 33000, '5 × 6 000 FC + 10 %');
  assert.equal((await p.post('/api/custom-pack/quote', spec({ filters: { clubs: ['FC Mesure'], positions: ['ST'] } }))).body.price, 900, 'deux catégories : +20 %');
  for (const bad of [spec({ cards: 2 }), spec({ cards: 11 }), spec({ cards: 5.5 }), spec({ minRarity: 'mythic' }), spec({ filters: { positions: ['XX'] } }), spec({ filters: { clubs: 'FC Mesure' } })])
    assert.equal((await p.post('/api/custom-pack/quote', bad)).status, 400);
  const narrow = (await p.post('/api/custom-pack/quote', spec({ filters: { clubs: ['FC Solitaire'] } }))).body;
  assert.equal(narrow.ok, false, 'moins de 20 cartes : refusé');
});

test('achat : prix débité, cartes distinctes du filtre, rareté minimale tenue, journal des FC', async () => {
  const before = await coins();
  const r = await p.post('/api/custom-pack/open', spec({ minRarity: 'rare' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.cards.length, 5);
  assert.equal(new Set(r.body.cards.map(c => c.cardId)).size, 5, 'cartes distinctes');
  for (const c of r.body.cards) { assert.equal(c.club, 'FC Mesure'); assert.ok(['rare', 'epic', 'legendary', 'icon'].includes(c.rarity), c.rarity); }
  assert.equal(before - await coins(), 2750, '5 × 500 FC + 10 %');
  const led = await q("SELECT amount,reason,ref FROM coin_ledger WHERE user_id=$1 ORDER BY id DESC LIMIT 1", [p.user.id]);
  assert.deepEqual([Number(led[0].amount), led[0].reason, led[0].ref], [-2750, 'pack', 'custom']);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND source='pack:custom'", [p.user.id]))[0].n, 5);
});

test('refus avant débit : sélection trop étroite, pas assez de cartes de la rareté, FC insuffisants, spéciales exclues', async () => {
  const before = await coins();
  assert.equal((await p.post('/api/custom-pack/open', spec({ filters: { clubs: ['FC Solitaire'] } }))).status, 409);
  const icons = await p.post('/api/custom-pack/open', spec({ cards: 5, minRarity: 'icon' }));
  assert.equal(icons.status, 409, 'seulement 4 Icon dans la sélection pour 5 cartes');
  assert.equal(await coins(), before, 'rien débité en cas de refus');
  await q("UPDATE catalog_cards SET rarity_locked=true,updated_at=now() WHERE id LIKE 'cp-icon%'");
  assert.equal((await p.post('/api/custom-pack/quote', spec({ minRarity: 'icon' }))).body.eligible, 0, 'cartes spéciales à rareté verrouillée exclues');
  await q("UPDATE catalog_cards SET rarity_locked=false,updated_at=now() WHERE id LIKE 'cp-icon%'");
  const poor = await newPlayer(server, 'Fauchee');
  await q('UPDATE users SET coins=100 WHERE id=$1', [poor.user.id]);
  const refused = await poor.post('/api/custom-pack/open', spec());
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'FOOTCOINS insuffisants : il te faut 825 FC, tu en as 100.', 'aucune enchère en cours : pas de mention d\'enchère');
  await q('UPDATE users SET reserved_coins=60 WHERE id=$1', [poor.user.id]);
  const reserved = await poor.post('/api/custom-pack/open', spec());
  assert.match(reserved.body.error, /60 FC sont réservés par une enchère \(disponible : 40 FC, il en faut 825\)/);
  await q('UPDATE users SET reserved_coins=0 WHERE id=$1', [poor.user.id]);
  assert.equal(Number((await userRow(server, poor.user.id)).coins), 100);
});

test('rareté minimale Icon : toutes les cartes sont des Icon, prix ≈ 6 000 FC la carte', async () => {
  await q('UPDATE users SET coins=100000 WHERE id=$1', [p.user.id]);
  const before = await coins();
  const r = await p.post('/api/custom-pack/open', spec({ cards: 3, minRarity: 'icon' }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cards.map(c => c.rarity), ['icon', 'icon', 'icon']);
  assert.equal(before - await coins(), 19800, '3 × 6 000 FC + 10 %');
});
