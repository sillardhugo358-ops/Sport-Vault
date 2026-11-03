'use strict';

// Primes : FC bloqués à la création, remboursés à l'expiration ou à l'annulation, règlement unique (carte au demandeur, prime moins 5 % au preneur),
// cartes exclues (Legendary, Icon, limitées, bienvenue, engagées), limites, validations, simultanéité, journal des FC.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client, userRow } = require('./helpers');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
async function card(rarity = 'rare', extra = {}) {
  n++;
  const id = 'bty-' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,is_limited) VALUES($1,'2026-2027',$2,'ST','FC Prime','France',$3,80,$4)", [id, 'Prime ' + n, rarity, !!extra.limited]);
  return id;
}
async function give(p, cardId, { source = 'pack:test', status = 'owned', tradeable = true } = {}) {
  const inst = crypto.randomUUID();
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,status,tradeable)
    SELECT $1,c.id,$2,c.season,c.name,c.position,c.club,c.nation,c.rarity,c.ovr,$3,$4,$5 FROM catalog_cards c WHERE c.id=$6`, [inst, p.user.id, source, status, tradeable, cardId]);
  return inst;
}
const bal = async p => { const u = await userRow(server, p.user.id); return { coins: Number(u.coins), reserved: Number(u.reserved_coins || 0) }; };
async function player(name, coins = 10000) {
  const p = await newPlayer(server, name);
  await q("UPDATE card_instances SET status='archived' WHERE owner_id=$1", [p.user.id]); // cartes de bienvenue aléatoires : partir de zéro
  await q('UPDATE users SET coins=$2,reserved_coins=0 WHERE id=$1', [p.user.id, coins]);
  return p;
}

test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop?.(); });

test('création : FC bloqués, validations, exclusions, doublons, limite, droits', async () => {
  const a = await player('Poster');
  const c = await card('rare');
  assert.equal((await client(server).get('/api/bounties')).status, 401);
  assert.equal((await client(server).post('/api/bounties/create', { cardId: c, reward: 500 })).status, 401);
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: 50 })).status, 400, 'sous le minimum');
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: '500' })).status, 400, 'entier strict');
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: 500.5 })).status, 400);
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: 999999 })).status, 400, 'au-dessus du maximum');
  assert.equal((await a.post('/api/bounties/create', { cardId: 'inconnue', reward: 500 })).status, 404);
  assert.equal((await a.post('/api/bounties/create', { cardId: await card('legendary'), reward: 500 })).status, 400, 'Legendary exclue');
  assert.equal((await a.post('/api/bounties/create', { cardId: await card('icon'), reward: 500 })).status, 400, 'Icon exclue');
  assert.equal((await a.post('/api/bounties/create', { cardId: await card('epic', { limited: true }), reward: 500 })).status, 400, 'limitée exclue');
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: 20000 })).status, 400, 'plus de FC que le solde');
  const own = await card('common'); await give(a, own);
  assert.equal((await a.post('/api/bounties/create', { cardId: own, reward: 500 })).body.code, 'already_owned');
  const ok = await a.post('/api/bounties/create', { cardId: c, reward: 500 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 500 }, 'FC bloqués, pas débités');
  assert.equal((await a.post('/api/bounties/create', { cardId: c, reward: 600 })).body.code, 'duplicate');
  for (let i = 0; i < 4; i++) assert.equal((await a.post('/api/bounties/create', { cardId: await card('common'), reward: 100 })).status, 200);
  assert.equal((await a.post('/api/bounties/create', { cardId: await card('common'), reward: 100 })).body.code, 'too_many', '5 primes ouvertes au plus');
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 900 });
});

test('règlement : carte au demandeur, prime moins 5 % au preneur, une seule fois, journal des FC', async () => {
  const a = await player('Demandeur'), b = await player('Preneur'), c2 = await player('Autre');
  const cardId = await card('epic');
  const inst = await give(b, cardId);
  assert.equal((await a.post('/api/bounties/create', { cardId, reward: 1000 })).status, 200);
  const id = (await a.get('/api/bounties')).body.mine[0].id;
  const seen = (await b.get('/api/bounties')).body.open.find(x => x.id === id);
  assert.equal(seen.canFulfil, true);
  assert.equal(seen.net, 950);
  assert.equal((await c2.get('/api/bounties')).body.open.find(x => x.id === id).canFulfil, false, 'sans la carte : pas de bouton');
  assert.equal((await a.post('/api/bounties/fulfil', { id })).status, 400, 'pas sa propre prime');
  assert.equal((await c2.post('/api/bounties/fulfil', { id })).body.code, 'no_card');
  const r = await b.post('/api/bounties/fulfil', { id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.reward, r.body.fee], [950, 50]);
  assert.deepEqual(await bal(a), { coins: 9000, reserved: 0 });
  assert.deepEqual(await bal(b), { coins: 10950, reserved: 0 });
  assert.equal((await q('SELECT owner_id FROM card_instances WHERE instance_id=$1', [inst]))[0].owner_id, a.user.id, 'la carte change de main');
  assert.equal((await q("SELECT sum(amount)::int AS s FROM coin_ledger WHERE reason='bounty' AND ref=$1", [id]))[0].s, -50, 'seule la commission disparaît du total');
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='bounty'", [a.user.id]))[0].n, 1);
  assert.equal((await b.post('/api/bounties/fulfil', { id })).body.code, 'closed', 'pas de second règlement');
  assert.deepEqual(await bal(b), { coins: 10950, reserved: 0 });
});

test('cartes non donnables : bienvenue, non échangeable, en vente, engagée dans une offre', async () => {
  const a = await player('Chasseur'), b = await player('Detenteur');
  const cardId = await card('rare');
  await a.post('/api/bounties/create', { cardId, reward: 300 });
  const id = (await a.get('/api/bounties')).body.mine[0].id;
  const refuse = async () => (await b.post('/api/bounties/fulfil', { id })).body.code;
  const w = await give(b, cardId, { source: 'welcome' });
  assert.equal(await refuse(), 'no_card', 'bienvenue');
  await q('DELETE FROM card_instances WHERE instance_id=$1', [w]);
  const nt = await give(b, cardId, { tradeable: false });
  assert.equal(await refuse(), 'no_card', 'non échangeable');
  await q('DELETE FROM card_instances WHERE instance_id=$1', [nt]);
  const au = await give(b, cardId, { status: 'auction' });
  assert.equal(await refuse(), 'no_card', 'en vente');
  await q('DELETE FROM card_instances WHERE instance_id=$1', [au]);
  const ok = await give(b, cardId);
  const offerId = crypto.randomUUID();
  await q("INSERT INTO trade_offers(id,from_user,to_user,status,expires_at) VALUES($1,$2,$3,'open',now()+interval '1 day')", [offerId, b.user.id, a.user.id]);
  await q("INSERT INTO trade_offer_cards(offer_id,instance_id,side,open) VALUES($1,$2,'give',true)", [offerId, ok]);
  assert.equal(await refuse(), 'no_card', 'engagée dans une offre d’échange');
  await q('DELETE FROM trade_offer_cards WHERE offer_id=$1', [offerId]);
  assert.equal((await b.post('/api/bounties/fulfil', { id })).status, 200, 'libre : possible');
});

test('annulation et expiration : FC libérés, une seule fois', async () => {
  const a = await player('Annuleur'), b = await player('Voisin');
  const c1 = await card('common'), c2 = await card('common'), c3 = await card('common');
  for (const c of [c1, c2, c3]) await a.post('/api/bounties/create', { cardId: c, reward: 400 });
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 1200 });
  const mine = (await a.get('/api/bounties')).body.mine;
  assert.equal((await b.post('/api/bounties/cancel', { id: mine[0].id })).status, 404, 'pas la prime d’un autre');
  assert.equal((await a.post('/api/bounties/cancel', { id: mine[0].id })).status, 200);
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 800 });
  assert.equal((await a.post('/api/bounties/cancel', { id: mine[0].id })).status, 409, 'déjà annulée : rien de plus libéré');
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 800 });
  await q("UPDATE bounties SET expires_at=now()-interval '1 minute' WHERE poster_id=$1 AND status='open' AND card_id=$2", [a.user.id, c2]);
  await b.get('/api/bounties'); // le balayage est global : n'importe qui le déclenche
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 400 }, 'expirée : FC libérés');
  assert.equal((await q("SELECT status FROM bounties WHERE poster_id=$1 AND card_id=$2", [a.user.id, c2]))[0].status, 'expired');
  const exp = await a.post('/api/bounties/fulfil', { id: (await q("SELECT id FROM bounties WHERE card_id=$1", [c2]))[0].id });
  assert.equal(exp.status, 400);
  await a.get('/api/bounties');
  assert.deepEqual(await bal(a), { coins: 10000, reserved: 400 }, 'un second balayage ne libère rien de plus');
});

test('simultanéité : deux preneurs, une seule prime payée ; solde du demandeur insuffisant à la clôture', async () => {
  const a = await player('Course'), b = await player('Rapide1'), c = await player('Rapide2');
  const cardId = await card('rare');
  await give(b, cardId); await give(c, cardId);
  await a.post('/api/bounties/create', { cardId, reward: 2000 });
  const id = (await a.get('/api/bounties')).body.mine[0].id;
  const res = await Promise.all([b.post('/api/bounties/fulfil', { id }), c.post('/api/bounties/fulfil', { id })]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await bal(a), { coins: 8000, reserved: 0 }, 'payée une seule fois');
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND card_id=$2 AND status='owned'", [a.user.id, cardId]))[0].n, 1);
  const x = await player('Fauche'), y = await player('Donneur');
  const c4 = await card('rare'); await give(y, c4);
  await x.post('/api/bounties/create', { cardId: c4, reward: 1000 });
  await q('UPDATE users SET coins=100 WHERE id=$1', [x.user.id]); // retrait par un administrateur, par exemple
  const bid = (await x.get('/api/bounties')).body.mine[0].id;
  const r = await y.post('/api/bounties/fulfil', { id: bid });
  assert.equal(r.body.code, 'poster_broke');
  assert.deepEqual(await bal(x), { coins: 100, reserved: 0 }, 'prime annulée, réserve libérée');
  assert.equal((await q("SELECT count(*)::int AS n FROM card_instances WHERE owner_id=$1 AND card_id=$2 AND status='owned'", [y.user.id, c4]))[0].n, 1, 'le donneur garde sa carte');
});
