'use strict';

// Retrait des 4 clubs fictifs d'origine (migration remove-fictional-clubs-2026-10-04) : clubs, cartes, exemplaires possédés,
// enchères (réservations libérées), favoris, alertes et collections supprimés, archivés dans removed_data_archive,
// jouée une seule fois ; les vrais clubs et cartes ne sont pas touchés.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, userRow } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

const count = async (sql, params = []) => Number((await server.db.query(sql, params)).rows[0].n);
const NAMES = ['Aster FC', 'Racing Nord', 'Stade Horizon', 'Union Atlantique'];

test('au démarrage à blanc, aucun club fictif n\'est recréé', async () => {
  assert.equal(await count('SELECT count(*) AS n FROM clubs WHERE name=ANY($1::text[])', [NAMES]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM card_collections WHERE id IN ('aster-fc','racing-nord','stade-horizon','union-atlantique')"), 0);
});

test('migration : suppression complète, archive, libération des FOOTCOINS réservés, jouée une seule fois', async () => {
  const db = server.db;
  const real = await count('SELECT count(*) AS n FROM clubs');
  const realCards = await count('SELECT count(*) AS n FROM catalog_cards');
  const owner = await newPlayer(server, 'Proprio'), bidder = await newPlayer(server, 'Encherisseur');
  const ownerId = owner.id || owner.user?.id, bidderId = bidder.id || bidder.user?.id;
  assert.ok(ownerId && bidderId);
  // Données fictives telles qu'elles existaient avant la migration.
  await db.query("INSERT INTO clubs(id,name,tag,country) VALUES('aster-fc','Aster FC','AST','France'),('union-atlantique','Union Atlantique','UA','France')");
  await db.query("INSERT INTO season_clubs(season_id,club_id,position) VALUES('ligue-1-2026','aster-fc',0),('ligue-1-2026','union-atlantique',1) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO card_collections(id,name,tag) VALUES('aster-fc','Aster FC','AST')");
  await db.query(`INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,pace,shooting,passing,dribbling,defending,physical,distribution_type,is_limited,card_order)
    VALUES('fv-901','2026','Joueur Fictif','GK','Aster FC','France','common',72,72,72,72,72,72,72,'STANDARD',false,9001)`);
  await db.query("INSERT INTO card_collection_cards(collection_id,card_id,position) VALUES('aster-fc','fv-901',0)");
  const inst = '11111111-1111-4111-8111-111111111111';
  await db.query(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
    VALUES($1,'fv-901',$2,'2026','Joueur Fictif','GK','Aster FC','France','common','test')`, [inst, ownerId]);
  await db.query('INSERT INTO favorite_cards(user_id,instance_id) VALUES($1,$2)', [ownerId, inst]);
  await db.query("INSERT INTO price_alerts(user_id,card_id,max_price) VALUES($1,'fv-901',50)", [ownerId]);
  const auction = '22222222-2222-4222-8222-222222222222';
  await db.query("INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,current_bidder_id,ends_at,status) VALUES($1,$2,$3,100,120,$4,now()+interval '1 hour','active')", [auction, inst, ownerId, bidderId]);
  await db.query('INSERT INTO auction_bids(auction_id,bidder_id,amount) VALUES($1,$2,120)', [auction, bidderId]);
  await db.query('UPDATE users SET reserved_coins=120 WHERE id=$1', [bidderId]);
  // Une carte et un club réels, à ne pas toucher.
  const realInstance = (await db.query('SELECT instance_id FROM card_instances WHERE owner_id=$1 LIMIT 1', [ownerId])).rows[0].instance_id;

  await db.query("DELETE FROM app_migrations WHERE id='remove-fictional-clubs-2026-10-04'");
  await server.restart();

  for (const [sql, label] of [
    ["SELECT count(*) AS n FROM clubs WHERE name=ANY($1::text[])", 'clubs'],
    ["SELECT count(*) AS n FROM catalog_cards WHERE club=ANY($1::text[])", 'cartes'],
    ["SELECT count(*) AS n FROM card_instances WHERE club=ANY($1::text[])", 'exemplaires'],
    ["SELECT count(*) AS n FROM card_collections WHERE name=ANY($1::text[])", 'collections']]) {
    assert.equal(await count(sql, [NAMES]), 0, label);
  }
  assert.equal(await count('SELECT count(*) AS n FROM auctions WHERE id=$1', [auction]), 0);
  assert.equal(await count('SELECT count(*) AS n FROM auction_bids WHERE auction_id=$1', [auction]), 0);
  assert.equal(await count('SELECT count(*) AS n FROM favorite_cards WHERE instance_id=$1', [inst]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM price_alerts WHERE card_id='fv-901'"), 0);
  assert.equal(await count("SELECT count(*) AS n FROM season_clubs WHERE club_id IN ('aster-fc','union-atlantique')"), 0);
  // FOOTCOINS réservés libérés ; le reste du compte est intact.
  assert.equal(Number((await userRow(server, bidderId)).reserved_coins), 0);
  // Archive complète (restauration possible).
  const archived = Object.fromEntries((await db.query("SELECT table_name,count(*)::int AS n FROM removed_data_archive WHERE migration='remove-fictional-clubs-2026-10-04' GROUP BY 1")).rows.map(r => [r.table_name, r.n]));
  assert.deepEqual(archived, { auctions: 1, auction_bids: 1, favorite_cards: 1, card_instances: 1, price_alerts: 1, card_collection_cards: 1, card_collections: 1, catalog_cards: 1, season_clubs: 2, clubs: 2 });
  const restored = (await db.query("SELECT row_data->>'name' AS name FROM removed_data_archive WHERE table_name='card_instances'")).rows[0];
  assert.equal(restored.name, 'Joueur Fictif');
  // Les vrais clubs et cartes sont intacts ; l'exemplaire réel du joueur aussi.
  assert.equal(await count('SELECT count(*) AS n FROM clubs'), real);
  assert.equal(await count('SELECT count(*) AS n FROM catalog_cards'), realCards);
  assert.equal(await count('SELECT count(*) AS n FROM card_instances WHERE instance_id=$1', [realInstance]), 1);

  // Jouée une seule fois : des données recréées à la main ne sont pas supprimées au redémarrage suivant.
  await db.query("INSERT INTO clubs(id,name,tag,country) VALUES('aster-fc','Aster FC','AST','France')");
  await server.restart();
  assert.equal(await count("SELECT count(*) AS n FROM clubs WHERE id='aster-fc'"), 1);
  await db.query("DELETE FROM clubs WHERE id='aster-fc'");
});
