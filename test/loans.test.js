'use strict';

// Prêts de cartes : ami accepté, Common et Rare seulement, carte « loaned » chez le prêteur (exclue des ventes et primes), utilisable dans l'équipe type de
// l'emprunteur, limites 3 / 3, retour anticipé (prêteur ou emprunteur), retour automatique (échéance, fin d'amitié, réparation), simultanéité.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client } = require('./helpers');

let server;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const codeOf = async p => (await p.get('/api/trades')).body.code;
let n = 0;
async function give(p, { rarity = 'common', position = 'ST', source = 'pack:test', limited = false, tradeable = true, status = 'owned' } = {}) {
  n++;
  const cardId = 'loan-' + n, inst = crypto.randomUUID();
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr,is_limited) VALUES($1,'2026-2027',$2,$3,'FC Pret','France',$4,78,$5)", [cardId, 'Pret ' + n, position, rarity, limited]);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source,status,tradeable,is_limited)
    VALUES($1,$2,$3,'2026-2027',$4,$5,'FC Pret','France',$6,78,$7,$8,$9,$10)`, [inst, cardId, p.user.id, 'Pret ' + n, position, rarity, source, status, tradeable, limited]);
  return { inst, cardId };
}
const status = async inst => (await q('SELECT status FROM card_instances WHERE instance_id=$1', [inst]))[0].status;
async function player(name) {
  const p = await newPlayer(server, name);
  await q("UPDATE card_instances SET status='archived' WHERE owner_id=$1", [p.user.id]); // cartes de bienvenue aléatoires : partir de zéro
  return p;
}
async function befriend(x, y) {
  const [lo, hi] = x.user.id < y.user.id ? [x.user.id, y.user.id] : [y.user.id, x.user.id];
  await q("INSERT INTO friendships(user_low,user_high,requester,status) VALUES($1,$2,$3,'accepted')", [lo, hi, x.user.id]);
}
const lend = async (from, to, inst) => from.post('/api/loans/lend', { instanceId: inst, code: await codeOf(to) });

test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop?.(); });

test('droits, ami obligatoire et cartes prêtables (Common et Rare, libres)', async () => {
  const a = await player('Preteur'), b = await player('Ami'), s = await player('Etranger');
  await befriend(a, b);
  const c = await give(a);
  assert.equal((await client(server).get('/api/loans')).status, 401);
  assert.equal((await client(server).post('/api/loans/lend', { instanceId: c.inst, code: await codeOf(b) })).status, 401);
  assert.equal((await a.post('/api/loans/lend', { instanceId: c.inst, code: 'court' })).status, 400);
  assert.equal((await a.post('/api/loans/lend', { instanceId: c.inst, code: 'ZZZZZZZZ' })).status, 404);
  assert.equal((await lend(a, a, c.inst)).status, 400, 'à soi-même');
  assert.equal((await lend(a, s, c.inst)).status, 403, 'pas un ami');
  assert.equal((await a.post('/api/loans/lend', { instanceId: 'pas-un-uuid', code: await codeOf(b) })).body.code, 'not_lendable');
  assert.equal((await lend(b, a, c.inst)).body.code, 'not_lendable', 'pas sa carte');
  const refused = {
    epic: await give(a, { rarity: 'epic' }), legendary: await give(a, { rarity: 'legendary' }), icon: await give(a, { rarity: 'icon' }),
    welcome: await give(a, { source: 'welcome' }), limited: await give(a, { rarity: 'rare', limited: true }), locked: await give(a, { tradeable: false }), auction: await give(a, { status: 'auction' })
  };
  for (const [why, x] of Object.entries(refused)) assert.equal((await lend(a, b, x.inst)).body.code, 'not_lendable', why);
  const engaged = await give(a, { rarity: 'rare' });
  const offer = crypto.randomUUID();
  await q("INSERT INTO trade_offers(id,from_user,to_user,status,expires_at) VALUES($1,$2,$3,'open',now()+interval '1 day')", [offer, a.user.id, b.user.id]);
  await q("INSERT INTO trade_offer_cards(offer_id,instance_id,side,open) VALUES($1,$2,'give',true)", [offer, engaged.inst]);
  assert.equal((await lend(a, b, engaged.inst)).body.code, 'not_lendable', 'engagée dans une offre d’échange');
  const ok = await lend(a, b, c.inst);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await status(c.inst), 'loaned');
  assert.equal((await lend(a, b, c.inst)).body.code, 'not_lendable', 'déjà prêtée');
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='loan'", [b.user.id]))[0].n, 1, 'l’emprunteur est prévenu');
  const mine = (await a.get('/api/loans')).body, theirs = (await b.get('/api/loans')).body;
  assert.equal(mine.lent.length, 1);
  assert.equal(mine.lent[0].other, 'Ami');
  assert.equal(theirs.borrowed.length, 1);
  assert.equal(theirs.borrowed[0].other, 'Preteur');
  assert.deepEqual((await s.get('/api/loans')).body.lent, [], 'les prêts sont privés');
});

test('recherche de cartes prêtables : seulement les cartes libres Common ou Rare', async () => {
  const a = await player('Chercheur');
  const lendable = await give(a, { rarity: 'rare' });
  await give(a, { rarity: 'epic' });
  const r = (await a.get('/api/loans/cards?q=Pret')).body.cards;
  assert.deepEqual(r.map(x => x.instanceId), [lendable.inst]);
  assert.deepEqual((await a.get('/api/loans/cards?q=P')).body.cards, [], '2 caractères au moins');
  assert.deepEqual((await a.get('/api/loans/cards?q=%25')).body.cards, [], 'le joker % est neutralisé');
});

test('limites 3 prêtées / 3 empruntées ; la carte prêtée ne peut pas être donnée en prime', async () => {
  const a = await player('Genereux'), b = await player('Emprunteur'), x1 = await player('Preteur1');
  for (const f of [b, x1]) await befriend(a, f);
  await befriend(b, x1);
  const cards = [];
  for (let i = 0; i < 4; i++) cards.push(await give(a));
  for (let i = 0; i < 3; i++) assert.equal((await lend(a, b, cards[i].inst)).status, 200);
  assert.equal((await lend(a, b, cards[3].inst)).body.code, 'too_many_lent', '3 prêtées au plus');
  const fromX = await give(x1);
  assert.equal((await lend(x1, b, fromX.inst)).body.code, 'too_many_borrowed', '3 empruntées au plus');
  // La carte prêtée n'est plus « possédée » : une prime ne peut pas être remplie avec elle.
  const poster = await player('Demandeur');
  await q('UPDATE users SET coins=5000 WHERE id=$1', [poster.user.id]);
  assert.equal((await poster.post('/api/bounties/create', { cardId: cards[0].cardId, reward: 500 })).status, 200);
  const bid = (await poster.get('/api/bounties')).body.mine[0].id;
  assert.equal((await a.post('/api/bounties/fulfil', { id: bid })).body.code, 'no_card');
});

test('équipe type de l’emprunteur : la carte prêtée est utilisable puis quitte l’équipe au retour', async () => {
  const a = await player('Gardien'), b = await player('Coach');
  await befriend(a, b);
  const gk = await give(a, { position: 'GK' });
  const before = (await b.get('/api/team')).body.cards.map(c => c.cardId);
  assert.ok(!before.includes(gk.cardId));
  await lend(a, b, gk.inst);
  assert.ok((await b.get('/api/team')).body.cards.map(c => c.cardId).includes(gk.cardId), 'carte empruntée proposée');
  assert.ok(!(await a.get('/api/team')).body.cards.map(c => c.cardId).includes(gk.cardId), 'le prêteur ne la propose plus');
  const slots = Array(11).fill(null); slots[0] = gk.cardId;
  assert.equal((await b.post('/api/team/save', { formation: '4-3-3', slots })).status, 200);
  assert.equal((await b.get('/api/team')).body.lineup.slots[0].cardId, gk.cardId);
  const id = (await b.get('/api/loans')).body.borrowed[0].id;
  assert.equal((await b.post('/api/loans/return', { id })).status, 200);
  assert.equal((await b.get('/api/team')).body.lineup.slots[0], null, 'le poste est libéré au retour');
  assert.equal(await status(gk.inst), 'owned');
  assert.equal((await q("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='loan'", [a.user.id]))[0].n, 1, 'le prêteur est prévenu du retour');
});

test('retour anticipé (prêteur ou emprunteur), droits, retour automatique (échéance, fin d’amitié, réparation)', async () => {
  const a = await player('Pa'), b = await player('Pb'), s = await player('Pc');
  await befriend(a, b);
  const c1 = await give(a), c2 = await give(a), c3 = await give(a);
  for (const c of [c1, c2, c3]) await lend(a, b, c.inst);
  const loans = (await a.get('/api/loans')).body.lent;
  const idOf = c => loans.find(l => l.card.instanceId === c.inst).id;
  assert.equal((await s.post('/api/loans/return', { id: idOf(c1) })).status, 404, 'un tiers ne peut rien');
  assert.equal((await a.post('/api/loans/return', { id: idOf(c1) })).status, 200, 'le prêteur reprend sa carte');
  assert.equal(await status(c1.inst), 'owned');
  assert.equal((await a.post('/api/loans/return', { id: idOf(c1) })).status, 409, 'déjà terminé');
  // Échéance dépassée : retour automatique à la prochaine lecture.
  await q("UPDATE card_loans SET expires_at=now()-interval '1 minute' WHERE instance_id=$1 AND status='active'", [c2.inst]);
  await s.get('/api/loans'); // le balayage est global
  assert.equal(await status(c2.inst), 'owned');
  assert.equal((await q('SELECT returned_by FROM card_loans WHERE instance_id=$1', [c2.inst]))[0].returned_by, 'auto');
  assert.equal(await status(c3.inst), 'loaned', 'le prêt en cours n’est pas touché');
  // Fin d'amitié : la carte revient.
  await q('DELETE FROM friendships WHERE user_low=LEAST($1::uuid,$2::uuid) AND user_high=GREATEST($1::uuid,$2::uuid)', [a.user.id, b.user.id]);
  await a.get('/api/loans');
  assert.equal(await status(c3.inst), 'owned');
  assert.equal((await q('SELECT returned_by FROM card_loans WHERE instance_id=$1', [c3.inst]))[0].returned_by, 'friendship');
  // Réparation : une carte restée « loaned » sans prêt actif est rendue.
  const orphan = await give(a, { status: 'loaned' });
  await a.get('/api/loans');
  assert.equal(await status(orphan.inst), 'owned');
});

test('simultanéité : une carte prêtée à deux amis en même temps n’est prêtée qu’une fois', async () => {
  const a = await player('Course'), b = await player('Ami1'), c = await player('Ami2');
  await befriend(a, b); await befriend(a, c);
  const card = await give(a);
  const [cb, cc] = [await codeOf(b), await codeOf(c)];
  const res = await Promise.all([a.post('/api/loans/lend', { instanceId: card.inst, code: cb }), a.post('/api/loans/lend', { instanceId: card.inst, code: cc })]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409]);
  assert.equal((await q("SELECT count(*)::int AS n FROM card_loans WHERE instance_id=$1 AND status='active'", [card.inst]))[0].n, 1);
});
