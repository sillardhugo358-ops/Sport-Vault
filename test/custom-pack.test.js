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

test('nouvelles cartes uniquement : +30 %, cartes possédées exclues, refus sans débit si presque tout est possédé', async () => {
  const n = await newPlayer(server, 'Neuf');
  await q('UPDATE users SET coins=100000 WHERE id=$1', [n.user.id]);
  await q("UPDATE card_instances SET status='archived' WHERE owner_id=$1", [n.user.id]); // cartes de bienvenue aléatoires : partir de zéro
  const give = async (ids, status = 'owned') => q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,status)
    SELECT gen_random_uuid(),c.id,$1,c.season,c.name,c.position,c.club,c.nation,c.rarity,'pack:test',$3 FROM catalog_cards c WHERE c.id = ANY($2::text[])`, [n.user.id, ids, status]);
  const commons = Array.from({ length: 25 }, (_, i) => 'cp-common' + i);
  const bal = async () => Number((await userRow(server, n.user.id)).coins);

  assert.equal((await n.post('/api/custom-pack/quote', spec({ newOnly: 'oui' }))).status, 400, 'option strictement booléenne');
  assert.equal((await n.post('/api/custom-pack/quote', spec())).body.price, 825, 'sans option : prix inchangé');
  const quote = (await n.post('/api/custom-pack/quote', spec({ newOnly: true }))).body;
  assert.equal(quote.price, 1050, '5 × 150 FC + 10 % (filtre) + 30 % (nouvelles cartes)');
  assert.equal(quote.alreadyOwned, 0);

  // Possède 5 communes (plus une carte archivée, qui ne compte pas) : le pack n'en contient aucune.
  await give(commons.slice(0, 5));
  await give(['cp-common20'], 'archived');
  const owned = new Set(commons.slice(0, 5));
  const before = await bal();
  const r = await n.post('/api/custom-pack/open', spec({ newOnly: true }));
  assert.equal(r.status, 200);
  assert.equal(r.body.cards.length, 5);
  assert.ok(r.body.cards.every(c => !owned.has(c.cardId || c.card_id || c.id)), 'aucune carte déjà possédée');
  assert.equal(before - await bal(), 1050);
  assert.equal(new Set(r.body.cards.map(c => c.cardId || c.card_id || c.id)).size, 5, 'cartes distinctes');

  // Presque tout possédé : 25 communes + les 5 reçues ci-dessus → il reste moins de 20 cartes nouvelles → refus, rien débité.
  await give(commons.slice(5));
  const stuck = await bal();
  const refused = await n.post('/api/custom-pack/open', spec({ newOnly: true }));
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /déjà presque toutes les cartes/);
  assert.equal(await bal(), stuck, 'rien débité');
  const qt = (await n.post('/api/custom-pack/quote', spec({ newOnly: true }))).body;
  assert.equal(qt.ok, false);
  assert.ok(qt.alreadyOwned >= 25);
  // Sans l'option, le même pack reste possible.
  assert.equal((await n.post('/api/custom-pack/open', spec())).status, 200);
});

test('révélation : chaque carte dit si elle est nouvelle ou un doublon (collection avant le tirage, statuts comptés, archivée ignorée)', async () => {
  const n = await newPlayer(server, 'Doublons');
  await q('UPDATE users SET coins=100000 WHERE id=$1', [n.user.id]);
  await q("UPDATE card_instances SET status='archived' WHERE owner_id=$1", [n.user.id]); // cartes de bienvenue aléatoires : partir de zéro
  const ids = Array.from({ length: 22 }, (_, i) => 'cpn-' + i);
  for (const id of ids) await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Nouveau','France','common',70)", [id, 'Nouveau ' + id]);
  // Possède 20 des 22 cartes : 17 en main, 1 en vente, 1 prêtée, 1 archivée (ne compte pas) ; cpn-20 et cpn-21 ne sont pas possédées.
  const statusOf = i => (i === 17 ? 'auction' : i === 18 ? 'loaned' : i === 19 ? 'archived' : 'owned');
  for (let i = 0; i < 20; i++) await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,status)
    SELECT gen_random_uuid(),c.id,$1,c.season,c.name,c.position,c.club,c.nation,c.rarity,c.ovr,'pack:test',$3 FROM catalog_cards c WHERE c.id=$2`, [n.user.id, ids[i], statusOf(i)]);
  const had = new Set(ids.slice(0, 19));        // possédées avant le premier tirage (cpn-19 archivée : non)
  const open = () => n.post('/api/custom-pack/open', { cards: 10, minRarity: 'common', filters: { clubs: ['FC Nouveau'] } });
  const first = await open();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  for (const c of first.body.cards) assert.equal(c.isNew, !had.has(c.cardId), c.cardId + ' : nouvelle seulement si absente de la collection avant le tirage');
  assert.ok(first.body.cards.some(c => c.isNew === false), 'au moins un doublon (20 cartes sur 22 déjà possédées)');
  const after = new Set([...had, ...first.body.cards.map(c => c.cardId)]);
  const second = await open();
  assert.equal(second.status, 200);
  for (const c of second.body.cards) assert.equal(c.isNew, !after.has(c.cardId), 'les cartes du premier tirage sont désormais des doublons');
  assert.ok(second.body.cards.every(c => typeof c.isNew === 'boolean'));
});
