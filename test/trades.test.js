'use strict';

// Échanges de cartes : code d'échange, validation (propriété, raretés, cartes de bienvenue), cartes engagées (une offre à la fois, pas
// d'enchère), acceptation atomique, refus et annulation, plafonds (offres ouvertes, échanges par jour), expiration, demandes simultanées.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client, awayFromParisMidnight } = require('./helpers');
const { TRADE } = require('../lib/game-config');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
// Donne à un joueur une nouvelle carte (instance) et renvoie son identifiant d'instance.
async function card(p, { rarity = 'common', source = 'pack:test', tradeable = true, name } = {}) {
  n++;
  const id = crypto.randomUUID(), cardId = 'trade-' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Echange','France',$3,70) ON CONFLICT DO NOTHING", [cardId, name || 'Joueur Echange ' + n, rarity]);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,tradeable,acquired_at)
    VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Echange','France',$5,$6,$7,'2026-01-01')`, [id, cardId, p.user.id, name || 'Joueur Echange ' + n, rarity, source, tradeable]);
  return id;
}
const owner = async id => (await q('SELECT owner_id FROM card_instances WHERE instance_id=$1', [id]))[0].owner_id;
const code = async p => (await p.get('/api/trades')).body.code;
const offer = async (from, to, give, ask) => from.post('/api/trades/offer', { toCode: await code(to), give, ask });

test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

test('code d\'échange : 8 caractères, stable, unique ; non connecté refusé', async () => {
  const a = await newPlayer(server, 'Alice'), b = await newPlayer(server, 'Bob');
  const ca = await code(a), cb = await code(b);
  assert.match(ca, /^[A-Z2-9]{8}$/);
  assert.notEqual(ca, cb);
  assert.equal(await code(a), ca);
  const info = (await a.get('/api/trades')).body;
  assert.equal(info.limits.dailyLimit, TRADE.dailyLimit); assert.equal(info.remainingToday, TRADE.dailyLimit);
  assert.equal((await client(server).get('/api/trades')).status, 401);
  assert.equal((await client(server).post('/api/trades/accept', { id: 'x' })).status, 401);
});

test('validation : codes, nombres, propriété, raretés, cartes de bienvenue et non échangeables', async () => {
  const a = await newPlayer(server, 'Valide'), b = await newPlayer(server, 'Cible');
  const mine = await card(a), theirs = await card(b), extra = await card(a);
  const cb = await code(b);
  const post = body => a.post('/api/trades/offer', body);
  assert.equal((await post({ toCode: 'court', give: [mine], ask: [theirs] })).status, 400);
  assert.equal((await post({ toCode: 'ABCDEFGH', give: [mine], ask: [theirs] })).status, 404);
  assert.equal((await post({ toCode: await code(a), give: [mine], ask: [theirs] })).status, 400, 'soi-même');
  assert.equal((await post({ toCode: cb, give: [], ask: [theirs] })).status, 400);
  assert.equal((await post({ toCode: cb, give: [mine], ask: [] })).status, 400);
  assert.equal((await post({ toCode: cb, give: ['pas-un-uuid'], ask: [theirs] })).status, 400);
  assert.equal((await post({ toCode: cb, give: [mine, extra, await card(a), await card(a)], ask: [theirs] })).status, 400, 'plus de 3 cartes');
  assert.equal((await post({ toCode: cb, give: [mine], ask: [mine] })).status, 400, 'même carte des deux côtés');
  assert.equal((await post({ toCode: cb, give: [theirs], ask: [mine] })).status, 400, 'cartes inversées');
  for (const rarity of ['legendary', 'icon']) {
    const r1 = await post({ toCode: cb, give: [await card(a, { rarity })], ask: [theirs] });
    assert.equal(r1.status, 400); assert.match(r1.body.error, /Legendary ou Icon/);
    const r2 = await post({ toCode: cb, give: [mine], ask: [await card(b, { rarity })] });
    assert.equal(r2.status, 400); assert.match(r2.body.error, /Legendary ou Icon/);
  }
  assert.equal((await post({ toCode: cb, give: [await card(a, { source: 'welcome' })], ask: [theirs] })).status, 400);
  assert.equal((await post({ toCode: cb, give: [await card(a, { tradeable: false })], ask: [theirs] })).status, 400);
  assert.equal((await post({ toCode: cb, give: [mine], ask: [theirs] })).status, 200);
});

test('recherche d\'un joueur : cartes échangeables seulement', async () => {
  const a = await newPlayer(server, 'Cherche'), b = await newPlayer(server, 'Cherché');
  const ok = await card(b, { name: 'Carte Visible' });
  await card(b, { rarity: 'icon', name: 'Carte Icon' }); await card(b, { source: 'welcome', name: 'Carte Bienvenue' });
  const r = await a.get('/api/trades/player?code=' + await code(b));
  assert.equal(r.status, 200); assert.equal(r.body.player.name, 'Cherché');
  assert.deepEqual(r.body.cards.map(c => c.name), ['Carte Visible']);
  assert.equal(r.body.cards[0].instanceId, ok);
  assert.equal((await a.get('/api/trades/player?code=' + await code(a))).status, 400);
  assert.equal((await a.get('/api/trades/player?code=ZZZZZZZZ')).status, 404);
  assert.deepEqual((await b.get('/api/trades/mine/cards')).body.cards.map(c => c.name).sort(), ['Carte Visible']);
});

test('offre puis acceptation : cartes échangées, notifications, trace, date d\'obtention conservée', async () => {
  const a = await newPlayer(server, 'Donneur'), b = await newPlayer(server, 'Receveur');
  const give = [await card(a), await card(a)], ask = [await card(b)];
  const o = await offer(a, b, give, ask);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal((await b.get('/api/notifications')).body.notifications.filter(x => x.kind === 'trade_offer').length, 1);
  const list = (await b.get('/api/trades')).body;
  assert.equal(list.received.length, 1); assert.equal(list.received[0].give.length, 2); assert.equal(list.received[0].ask.length, 1);
  assert.equal((await a.get('/api/trades')).body.sent.length, 1);
  assert.equal((await a.post('/api/trades/accept', { id: o.body.offerId })).status, 404, 'l\'expéditeur ne peut pas accepter');
  const ok = await b.post('/api/trades/accept', { id: o.body.offerId });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  for (const c of give) assert.equal(await owner(c), b.user.id);
  assert.equal(await owner(ask[0]), a.user.id);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE instance_id=ANY($1::uuid[]) AND status='owned' AND acquired_at='2026-01-01'", [[...give, ...ask]]))[0].n, 3);
  assert.equal((await a.get('/api/notifications')).body.notifications.filter(x => x.kind === 'trade_accepted').length, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM security_events WHERE event IN ('trade_offer_create','trade_accept') AND user_id IN ($1,$2)", [a.user.id, b.user.id]))[0].n, 2);
  assert.equal((await b.post('/api/trades/accept', { id: o.body.offerId })).status, 409, 'une seule acceptation');
  assert.equal((await b.get('/api/trades')).body.tradesToday, 1);
  assert.equal((await a.get('/api/trades')).body.history[0].status, 'accepted');
});

test('cartes engagées : une seule offre à la fois, pas d\'enchère ; refus et annulation les libèrent', async () => {
  const a = await newPlayer(server, 'Engage'), b = await newPlayer(server, 'Autre'), c = await newPlayer(server, 'Tiers');
  const mine = await card(a), theirs = await card(b), theirs2 = await card(b);
  const o = await offer(a, b, [mine], [theirs]);
  assert.equal(o.status, 200);
  assert.equal((await offer(a, c, [mine], [await card(c)])).status, 409, 'déjà engagée');
  const auction = await a.post('/api/auctions/create', { cardInstanceId: mine, startingBid: 10, duration: 10 });
  assert.equal(auction.status, 409); assert.match(auction.body.error, /offre d’échange/);
  assert.equal((await b.post('/api/trades/cancel', { id: o.body.offerId })).status, 404, 'seul l\'expéditeur annule');
  assert.equal((await b.post('/api/trades/decline', { id: o.body.offerId })).status, 200);
  assert.equal((await a.get('/api/notifications')).body.notifications.filter(x => x.kind === 'trade_declined').length, 1);
  assert.equal((await b.post('/api/trades/decline', { id: o.body.offerId })).status, 409);
  const o2 = await offer(a, b, [mine], [theirs2]);
  assert.equal(o2.status, 200, 'carte libérée par le refus');
  assert.equal((await a.post('/api/trades/cancel', { id: o2.body.offerId })).status, 200);
  assert.equal((await b.get('/api/notifications')).body.notifications.filter(x => x.kind === 'trade_cancelled').length, 1);
  assert.equal((await a.post('/api/auctions/create', { cardInstanceId: mine, startingBid: 10, duration: 10 })).status, 201, 'carte libérée par l\'annulation');
  assert.equal((await offer(b, a, [theirs], [mine])).status, 400, 'carte aux enchères non échangeable');
});

test('plafonds : offres ouvertes par joueur et offres reçues', async () => {
  const a = await newPlayer(server, 'Bavard'), b = await newPlayer(server, 'Cible2');
  for (let i = 0; i < TRADE.maxOpenSent; i++) assert.equal((await offer(a, b, [await card(a)], [await card(b)])).status, 200);
  const sixth = await offer(a, b, [await card(a)], [await card(b)]);
  assert.equal(sixth.status, 409); assert.equal(sixth.body.code, 'open_limit');
  assert.equal((await a.get('/api/trades')).body.openSent, TRADE.maxOpenSent);
  const busy = await newPlayer(server, 'Occupé');
  const senders = [];
  for (let i = 0; i < TRADE.maxOpenReceived; i++) { const s = await newPlayer(server, 'Expediteur' + i); senders.push(s); assert.equal((await offer(s, busy, [await card(s)], [await card(busy)])).status, 200); }
  const extra = await newPlayer(server, 'Dernier');
  const r = await offer(extra, busy, [await card(extra)], [await card(busy)]);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'recipient_busy');
});

test('limite quotidienne : acceptation refusée sans rien changer, possible le lendemain', async () => {
  await awayFromParisMidnight();
  const a = await newPlayer(server, 'Marathon'), b = await newPlayer(server, 'Rival');
  const mine = await card(a), theirs = await card(b);
  const o = await offer(a, b, [mine], [theirs]);
  for (let i = 0; i < TRADE.dailyLimit; i++) {
    const other = await newPlayer(server, 'Passant' + i);
    await q("INSERT INTO trade_offers(id,from_user,to_user,status,expires_at,resolved_at) VALUES(gen_random_uuid(),$1,$2,'accepted',now()+interval '1 day',now())", [other.user.id, b.user.id]);
  }
  assert.equal((await b.get('/api/trades')).body.remainingToday, 0);
  const blocked = await b.post('/api/trades/accept', { id: o.body.offerId });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'daily_limit');
  assert.equal(await owner(mine), a.user.id); assert.equal(await owner(theirs), b.user.id);
  assert.equal((await b.get('/api/trades')).body.received.length, 1, 'l\'offre reste ouverte');
  await q("UPDATE trade_offers SET resolved_at=resolved_at - interval '2 days' WHERE status='accepted' AND to_user=$1", [b.user.id]);
  assert.equal((await b.post('/api/trades/accept', { id: o.body.offerId })).status, 200);
  assert.equal(await owner(mine), b.user.id);
});

test('carte déplacée entre l\'offre et l\'acceptation : offre annulée, cartes libérées, rien d\'échangé', async () => {
  const a = await newPlayer(server, 'Vendeur'), b = await newPlayer(server, 'Acheteur'), c = await newPlayer(server, 'Troisieme');
  const mine = await card(a), theirs = await card(b);
  const o = await offer(a, b, [mine], [theirs]);
  await q('UPDATE card_instances SET owner_id=$2 WHERE instance_id=$1', [theirs, c.user.id]); // ex. retrait ou don de l'administration
  const r = await b.post('/api/trades/accept', { id: o.body.offerId });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'offer_invalid');
  assert.equal(await owner(mine), a.user.id); assert.equal(await owner(theirs), c.user.id);
  assert.equal((await a.get('/api/trades')).body.sent.length, 0);
  assert.equal((await a.post('/api/auctions/create', { cardInstanceId: mine, startingBid: 10, duration: 10 })).status, 201, 'carte libérée');
});

test('expiration : offre expirée invisible, cartes libérées, acceptation refusée', async () => {
  const a = await newPlayer(server, 'Patient'), b = await newPlayer(server, 'Lent');
  const mine = await card(a), theirs = await card(b);
  const o = await offer(a, b, [mine], [theirs]);
  await q("UPDATE trade_offers SET expires_at=now()-interval '1 minute' WHERE id=$1", [o.body.offerId]);
  assert.equal((await b.post('/api/trades/accept', { id: o.body.offerId })).status, 409);
  assert.equal((await a.get('/api/trades')).body.sent.length, 0);
  assert.equal((await q('SELECT status FROM trade_offers WHERE id=$1', [o.body.offerId]))[0].status, 'expired');
  assert.equal((await offer(a, b, [mine], [theirs])).status, 200, 'cartes libérées par l\'expiration');
});

test('demandes simultanées : une seule acceptation, une seule offre par carte', async () => {
  const a = await newPlayer(server, 'Rafale1'), b = await newPlayer(server, 'Rafale2'), c = await newPlayer(server, 'Rafale3');
  const mine = await card(a), theirs = await card(b);
  const o = await offer(a, b, [mine], [theirs]);
  const results = await Promise.all(Array.from({ length: 8 }, () => b.post('/api/trades/accept', { id: o.body.offerId })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.every(r => r.status === 200 || r.status === 409), JSON.stringify(results.map(r => r.status)));
  assert.equal(await owner(mine), b.user.id); assert.equal(await owner(theirs), a.user.id);
  const shared = await card(a), want1 = await card(b), want2 = await card(c);
  const both = await Promise.all([offer(a, b, [shared], [want1]), offer(a, c, [shared], [want2])]);
  assert.equal(both.filter(r => r.status === 200).length, 1);
  assert.ok(both.every(r => r.status === 200 || r.status === 409), JSON.stringify(both.map(r => r.status)));
});
