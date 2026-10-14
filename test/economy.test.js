'use strict';

// Atelier : vente rapide (doublons seulement, prix, exclusions, concurrence, journal des FOOTCOINS) et fusion (5 doublons -> 1 carte de
// la rareté supérieure, exclusions, limite quotidienne, rien consommé en cas d'échec).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client, userRow } = require('./helpers');

let server, p;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
async function card(rarity, name) {
  n++;
  const id = 'eco-' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Atelier','France',$3,70)", [id, name || 'Carte Atelier ' + n, rarity]);
  return id;
}
async function copies(owner, cardId, count, extra = {}) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID(); ids.push(id);
    const c = (await q('SELECT name,rarity FROM catalog_cards WHERE id=$1', [cardId]))[0];
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,is_limited,serial,max_supply,acquired_at)
      VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Atelier','France',$5,70,$6,$7,$8,$9,now() - ($10 || ' minutes')::interval)`,
      [id, cardId, owner.user.id, c.name, c.rarity, extra.source || 'pack:test', !!extra.limited, extra.limited ? 1 : null, extra.limited ? 5 : null, String(i)]);
  }
  return ids;
}
const count = async cardId => (await q("SELECT count(*)::int AS n FROM card_instances WHERE card_id=$1 AND owner_id=$2", [cardId, p.user.id]))[0].n;
const coins = async u => Number((await userRow(server, u.user.id)).coins);

test.before(async () => { server = await startServer(); p = await newPlayer(server, 'Brocanteur'); });
test.after(async () => { await server.stop?.(); });

test('liste : doublons vendables seulement, exclusions respectées', async () => {
  assert.equal((await client(server).get('/api/workshop')).status, 401);
  const a = await card('common', 'Commune Doublon'), single = await card('common', 'Commune Unique'), leg = await card('legendary', 'Legendary Doublon');
  const lim = await card('epic', 'Limitee Doublon'), welcome = await card('common', 'Bienvenue Doublon'), fav = await card('common', 'Favorite Doublon');
  await copies(p, a, 3); await copies(p, single, 1); await copies(p, leg, 3); await copies(p, lim, 3, { limited: true });
  await copies(p, welcome, 2, { source: 'welcome' });
  const favIds = await copies(p, fav, 2);
  await q('INSERT INTO favorite_cards(user_id,instance_id) VALUES($1,$2)', [p.user.id, favIds[0]]);
  const r = (await p.get('/api/workshop')).body;
  const byName = Object.fromEntries(r.cards.map(c => [c.name, c]));
  assert.equal(byName['Commune Doublon'].spare, 2, '3 exemplaires = 2 de trop');
  assert.equal(byName['Commune Doublon'].unitPrice, 20, 'prix fixe sans vente connue');
  assert.equal(byName['Commune Unique'], undefined, 'un seul exemplaire : rien à vendre');
  assert.equal(byName['Legendary Doublon'], undefined);
  assert.equal(byName['Limitee Doublon'], undefined);
  assert.equal(byName['Bienvenue Doublon'], undefined, 'cartes de bienvenue exclues');
  assert.equal(byName['Favorite Doublon'].spare, 1, 'l\'exemplaire en vitrine est gardé');
});

test('vente : prix, doublons seulement, jamais le dernier exemplaire, journal, concurrence', async () => {
  const a = await card('common', 'Vendable'), b = await card('rare', 'Vendue Au Marche');
  await copies(p, a, 3); await copies(p, b, 3);
  // une vente aux enchères terminée de b à 100 FC : prix de référence 100 -> 70 FC l'unité
  const buyer = await newPlayer(server, 'Acheteur');
  const sold = (await copies(buyer, b, 1))[0];
  await q(`INSERT INTO auctions(id,card_instance_id,seller_id,starting_bid,current_bid,current_bidder_id,status,starts_at,ends_at,completed_at)
    VALUES($1,$2,$3,100,100,$4,'completed',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour')`, [crypto.randomUUID(), sold, p.user.id, buyer.user.id]);
  const before = await coins(p);
  const r = await p.post('/api/workshop/sell', { cardId: b, count: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.unit, 70);
  assert.equal(r.body.total, 140);
  assert.equal(await coins(p), before + 140);
  assert.equal(await count(b), 1, 'un exemplaire est gardé');
  assert.equal((await q("SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=$1 AND reason='quick_sell' AND amount=140", [p.user.id]))[0].n, 1);
  // refus : plus de doublon, quantité invalide, carte inexistante, rareté exclue, non connecté
  assert.equal((await p.post('/api/workshop/sell', { cardId: b, count: 1 })).status, 400);
  assert.equal((await p.post('/api/workshop/sell', { cardId: a, count: 0 })).status, 400);
  assert.equal((await p.post('/api/workshop/sell', { cardId: a, count: 3 })).status, 400, 'pas plus que les doublons');
  assert.equal((await p.post('/api/workshop/sell', { cardId: 'inconnue', count: 1 })).status, 400);
  assert.equal((await client(server).post('/api/workshop/sell', { cardId: a, count: 1 })).status, 401);
  // concurrence : 5 ventes simultanées d'1 exemplaire alors qu'il en reste 2 de trop -> exactement 2 réussissent
  const rs = await Promise.all(Array.from({ length: 5 }, () => p.post('/api/workshop/sell', { cardId: a, count: 1 })));
  assert.equal(rs.filter(x => x.status === 200).length, 2);
  assert.equal(await count(a), 1);
});

test('fusion : 5 doublons -> 1 carte de la rareté supérieure ; refus sans rien consommer', async () => {
  await card('rare', 'Cible Rare');                                // au moins une carte Rare fusionnable au catalogue
  const c = await card('common', 'Commune Fusion');
  await copies(p, c, 6);                                           // 5 de trop
  const before = (await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1", [p.user.id]))[0].n;
  assert.equal((await p.post('/api/workshop/fuse', { rarity: 'epic' })).status, 400, 'Epic ne se fusionne pas');
  assert.equal((await p.post('/api/workshop/fuse', { rarity: 'legendary' })).status, 400);
  const r = await p.post('/api/workshop/fuse', { rarity: 'common' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.card.rarity, 'rare');
  assert.equal(r.body.consumed, 5);
  const after = (await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1", [p.user.id]))[0].n;
  assert.equal(after, before - 5 + 1);
  assert.equal((await q("SELECT source FROM card_instances WHERE instance_id=$1", [r.body.card.instanceId]))[0].source, 'fusion');
  // plus assez de doublons : refus et rien de consommé
  const stock = (await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND rarity='common'", [p.user.id]))[0].n;
  const no = await p.post('/api/workshop/fuse', { rarity: 'common' });
  assert.equal(no.status, 400);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND rarity='common'", [p.user.id]))[0].n, stock);
});

test('fusion : le joueur choisit les doublons consommés ; choix invalides refusés sans rien consommer', async () => {
  await card('rare', 'Cible Rare Choix');
  const a = await card('common', 'Choix A'), b = await card('common', 'Choix B'), r2 = await card('rare', 'Rare Choix');
  await copies(p, a, 4); await copies(p, b, 4); await copies(p, r2, 3);
  const fuse = picks => p.post('/api/workshop/fuse', { rarity: 'common', picks });
  const before = [await count(a), await count(b)];
  for (const bad of [{ [a]: 2 }, { [a]: 3, [b]: 3 }, { [a]: 4, [b]: 1 }, { [a]: 3, [r2]: 2 }, { [a]: 3, inconnue: 2 }, { [a]: -1, [b]: 6 }, { [a]: 1.5, [b]: 3.5 }, [a, b], null])
    assert.equal((await fuse(bad)).status, 400, JSON.stringify(bad));
  assert.deepEqual([await count(a), await count(b)], before, 'rien consommé');
  const ok = await fuse({ [a]: 3, [b]: 2 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.card.rarity, 'rare');
  assert.deepEqual([await count(a), await count(b)], [before[0] - 3, before[1] - 2]);
});

test('fusion : la carte obtenue est toujours une carte que le joueur ne possède pas encore', async () => {
  const f = await newPlayer(server, 'Collectionneur');
  const fcount = async cardId => (await q('SELECT count(*)::int AS n FROM card_instances WHERE card_id=$1 AND owner_id=$2', [cardId, f.user.id]))[0].n;
  const fuseOnce = async () => {
    const c = await card('common', 'Doublon Neuf ' + (++n));
    await copies(f, c, 6);
    return { c, r: await f.post('/api/workshop/fuse', { rarity: 'common', picks: { [c]: 5 } }) };
  };
  // Le joueur possède déjà toutes les cartes Rare du catalogue sauf une : c'est celle-là qu'il reçoit, jamais un doublon.
  const target = await card('rare', 'Seule Rare Manquante');
  for (const row of await q("SELECT id FROM catalog_cards WHERE rarity='rare' AND id<>$1", [target])) await copies(f, row.id, 1);
  const first = await fuseOnce();
  assert.equal(first.r.status, 200, JSON.stringify(first.r.body));
  assert.equal(first.r.body.card.cardId, target);
  assert.equal(await fcount(target), 1);
  // Plus aucune carte nouvelle à gagner : refus, et rien n'est consommé.
  const second = await fuseOnce();
  assert.equal(second.r.status, 409);
  assert.match(second.r.body.error, /déjà toutes les cartes/);
  assert.equal(await fcount(second.c), 6, 'doublons intacts');
  assert.equal((await f.get('/api/workshop')).body.fusion.rules.common.fresh, 0);
});

test('fusion : 10 par jour, puis refus sans rien consommer', async () => {
  const c = await card('common', 'Commune Limite');
  await copies(p, c, 6);
  const used = (await q("SELECT count(*)::int AS n FROM security_events WHERE user_id=$1 AND event='card_fusion'", [p.user.id]))[0].n;
  for (let i = used; i < 10; i++) await q("INSERT INTO security_events(user_id,event,details) VALUES($1,'card_fusion','{}'::jsonb)", [p.user.id]);
  const before = await count(c);
  const r = await p.post('/api/workshop/fuse', { rarity: 'common' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /10 fusions par jour/);
  assert.equal(await count(c), before, 'rien consommé');
  assert.equal((await p.get('/api/workshop')).body.fusion.left, 0);
});

test('fusion : la liste des cartes possibles n\'est donnée que s\'il en reste 49 ou moins, triée par note', async () => {
  const v = await newPlayer(server, 'Apercu');
  const low = await card('rare', 'Rare Basse'), high = await card('rare', 'Rare Haute'), mid = await card('rare', 'Rare Moyenne');
  for (const [id, ovr] of [[low, 78], [high, 83], [mid, 80]]) await q('UPDATE catalog_cards SET ovr=$2 WHERE id=$1', [id, ovr]);
  const mine = new Set([low, high, mid]);
  for (const row of await q("SELECT id FROM catalog_cards WHERE rarity='rare' AND is_active=true")) if (!mine.has(row.id)) await copies(v, row.id, 1);
  const rule = async () => (await v.get('/api/workshop')).body.fusion.rules.common;
  const few = await rule();
  assert.equal(few.fresh, 3);
  assert.deepEqual(few.preview.map(c => c.name), ['Rare Haute', 'Rare Moyenne', 'Rare Basse']);
  assert.deepEqual(Object.keys(few.preview[0]).sort(), ['cardId', 'club', 'name', 'ovr', 'position', 'season'], 'seulement des champs publics du catalogue');
  // Au-delà de 49 cartes possibles, le serveur n'envoie que le nombre.
  for (let i = 0; i < 47; i++) await card('rare', 'Rare Surplus ' + i);
  const many = await rule();
  assert.equal(many.fresh, 50);
  assert.equal(many.preview, null);
});
