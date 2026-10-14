'use strict';

// Amis et profils publics : amitié par code d'échange et acceptation, limites, droits, visibilité (public / amis / privé), contenu du profil.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, newPlayer, client } = require('./helpers');

let server, a, b, c, d;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const codeOf = async p => (await p.get('/api/trades')).body.code;

test.before(async () => {
  server = await startServer();
  [a, b, c, d] = [await newPlayer(server, 'Alice'), await newPlayer(server, 'Bruno'), await newPlayer(server, 'Carla'), await newPlayer(server, 'Dylan')];
});
test.after(async () => { await server.stop?.(); });

test('demande d\'ami : connexion requise, code valide, pas soi-même, pas deux fois', async () => {
  const cb = await codeOf(b), ca = await codeOf(a);
  assert.equal((await client(server).post('/api/friends/request', { code: cb })).status, 401);
  assert.equal((await a.post('/api/friends/request', { code: 'court' })).status, 400);
  assert.equal((await a.post('/api/friends/request', { code: 'ZZZZZZZZ' })).status, 404);
  assert.equal((await a.post('/api/friends/request', { code: ca })).status, 400, 'soi-même');
  assert.equal((await a.post('/api/friends/request', { code: cb })).status, 200);
  assert.equal((await a.post('/api/friends/request', { code: cb })).status, 400, 'déjà envoyée');
  const sb = (await b.get('/api/friends')).body;
  assert.equal(sb.incoming.length, 1);
  assert.equal(sb.incoming[0].name, 'Alice');
  assert.equal(sb.friends.length, 0);
  const notif = await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind='friend_request'", [b.user.id]);
  assert.equal(notif.length, 1);
});

test('acceptation : seul le destinataire accepte ; l\'auteur peut annuler ; refus = rien', async () => {
  const sb = (await b.get('/api/friends')).body, id = sb.incoming[0].id;
  assert.equal((await a.post('/api/friends/accept', { id })).status, 403, 'l\'auteur ne peut pas accepter');
  assert.equal((await c.post('/api/friends/accept', { id })).status, 404, 'un tiers ne voit rien');
  assert.equal((await b.post('/api/friends/accept', { id })).status, 200);
  assert.equal((await a.get('/api/friends')).body.friends[0].name, 'Bruno');
  assert.equal((await b.get('/api/friends')).body.friends[0].name, 'Alice');
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(b) })).status, 400, 'déjà amis');
  assert.equal((await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind='friend_accepted'", [a.user.id])).length, 1);
  // annulation par l'auteur, refus par le destinataire
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  const idc = (await a.get('/api/friends')).body.outgoing[0].id;
  assert.equal((await c.post('/api/friends/cancel', { id: idc })).status, 403);
  assert.equal((await a.post('/api/friends/cancel', { id: idc })).status, 200);
  assert.equal((await a.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  assert.equal((await c.post('/api/friends/decline', { id: (await c.get('/api/friends')).body.incoming[0].id })).status, 200);
  assert.deepEqual((await c.get('/api/friends')).body.incoming, []);
});

test('demandes croisées : la deuxième confirme l\'amitié', async () => {
  assert.equal((await c.post('/api/friends/request', { code: await codeOf(d) })).status, 200);
  assert.equal((await d.post('/api/friends/request', { code: await codeOf(c) })).status, 200);
  assert.equal((await c.get('/api/friends')).body.friends.length, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM friendships WHERE status=\'pending\' AND (requester=$1 OR requester=$2)', [c.user.id, d.user.id]))[0].n, 0);
});

test('profil public : contenu, visibilité public / amis / privé, rien de sensible', async () => {
  await q("UPDATE users SET xp=1200 WHERE id=$1", [b.user.id]);
  const cb = await codeOf(b);
  let r = await d.get('/api/players/profile?code=' + cb);          // public par défaut : visible par un inconnu
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.player.name, 'Bruno');
  assert.ok(r.body.player.level >= 1);
  assert.equal(r.body.player.relation, 'none');
  const text = JSON.stringify(r.body);
  assert.ok(!/@|email|coins|password/i.test(text), 'aucune donnée sensible');
  assert.equal((await b.post('/api/profile/visibility', { visibility: 'nimporte' })).status, 400);
  assert.equal((await b.post('/api/profile/visibility', { visibility: 'friends' })).status, 200);
  assert.equal((await d.get('/api/players/profile?code=' + cb)).status, 403, 'amis seulement : un inconnu est refusé');
  assert.equal((await d.get('/api/players/profile?code=' + cb)).body.player.name, 'Bruno', 'mais le nom reste visible pour demander en ami');
  assert.equal((await a.get('/api/players/profile?code=' + cb)).status, 200, 'un ami voit');
  assert.equal((await a.get('/api/players/profile?code=' + cb)).body.player.relation, 'friend');
  await b.post('/api/profile/visibility', { visibility: 'private' });
  assert.equal((await a.get('/api/players/profile?code=' + cb)).status, 403, 'privé : même les amis sont refusés');
  assert.equal((await b.get('/api/players/profile?code=' + cb)).status, 200, 'mais le joueur voit toujours son propre profil');
});

test('retirer un ami et limites', async () => {
  const ida = (await a.get('/api/friends')).body.friends[0].id;
  assert.equal((await c.post('/api/friends/remove', { id: ida })).status, 404, 'un tiers ne retire rien');
  assert.equal((await a.post('/api/friends/remove', { id: ida })).status, 200);
  assert.deepEqual((await a.get('/api/friends')).body.friends, []);
  // limite de demandes envoyées en attente
  const targets = [];
  for (let i = 0; i < 21; i++) targets.push(await newPlayer(server, 'Cible' + i));
  let last;
  for (const t of targets) last = await a.post('/api/friends/request', { code: await codeOf(t) });
  assert.equal(last.status, 400, 'plus de 20 demandes en attente');
  assert.match(last.body.error, /demandes en attente/);
});

test('flux d\'activité : événements marquants des amis seulement, sans montants, vie privée respectée', async () => {
  const [x, y, z] = [await newPlayer(server, 'Xavier'), await newPlayer(server, 'Yasmine'), await newPlayer(server, 'Zoe')];
  const crypto = require('node:crypto');
  const card = async (owner, { rarity, source = 'pack:test', name, limited = false, ago = '1 hour' }) => {
    const cardId = 'act-' + crypto.randomBytes(4).toString('hex');
    await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,'ST','FC Flux','France',$3,80)", [cardId, name, rarity]);
    const id = crypto.randomUUID();
    await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source,acquired_at,is_limited,serial,max_supply)
      VALUES($1,$2,$3,'2026-2027',$4,'ST','FC Flux','France',$5,$6,now() - $7::interval,$8,$9,$10)`, [id, cardId, owner.user.id, name, rarity, source, ago, limited, limited ? 3 : null, limited ? 10 : null]);
    return id;
  };
  // x est ami de y (visible) et de z (profil privé)
  for (const other of [y, z]) {
    await x.post('/api/friends/request', { code: await codeOf(other) });
    await other.post('/api/friends/accept', { id: (await other.get('/api/friends')).body.incoming[0].id });
  }
  await card(y, { rarity: 'epic', name: 'Carte Epic Amie' });
  await card(y, { rarity: 'legendary', name: 'Carte Limitée Amie', limited: true });
  await card(y, { rarity: 'common', name: 'Carte Commune' });                       // trop commune
  await card(y, { rarity: 'epic', name: 'Carte Offerte', source: 'admin_grant' });   // offerte
  await card(y, { rarity: 'epic', name: 'Carte Ancienne', ago: '30 days' });          // trop ancienne
  await card(z, { rarity: 'icon', name: 'Carte Privée' });
  await q("UPDATE users SET profile_visibility='private' WHERE id=$1", [z.user.id]);
  await q("INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2)", [y.user.id, 'achievement:act-visible']);
  await q("INSERT INTO achievements(id,name,category,description,type,target,coins,xp,hidden) VALUES('act-visible','Succès Visible','test','d','cards',1,9999,9,false),('act-cache','Succès Caché','test','d','cards',1,0,0,true)");
  await q("INSERT INTO reward_claims(user_id,claim_id) VALUES($1,'achievement:act-cache')", [y.user.id]);
  const r = await x.get('/api/friends/activity');
  assert.equal(r.status, 200);
  const labels = r.body.events.map(e => e.label);
  assert.ok(labels.includes('Carte Epic Amie'));
  assert.ok(labels.includes('Carte Limitée Amie'));
  assert.ok(labels.includes('Succès Visible'));
  for (const bad of ['Carte Commune', 'Carte Offerte', 'Carte Ancienne', 'Carte Privée', 'Succès Caché']) assert.ok(!labels.includes(bad), bad + ' ne doit pas apparaître');
  assert.equal(r.body.events.find(e => e.label === 'Carte Limitée Amie').serial, '3/10');
  assert.ok(!/9999|coins|xp/i.test(JSON.stringify(r.body)), 'aucun montant');
  assert.ok(r.body.events.every(e => e.name === 'Yasmine'), 'seulement les amis visibles');
  // un joueur sans amis ne voit rien ; un inconnu ne voit pas l'activité d'un joueur dont il n'est pas ami
  assert.deepEqual((await (await newPlayer(server, 'Solo')).get('/api/friends/activity')).body.events, []);
  assert.equal((await client(server).get('/api/friends/activity')).status, 401);
});

test('rivalités d\'album : amis seulement, 3 au plus, comparaison de complétion, profil privé masqué, amitié retirée = rivalité retirée', async () => {
  const crypto = require('node:crypto');
  const [x, y, z, w, v, stranger] = [await newPlayer(server, 'Xavier'), await newPlayer(server, 'Yanis'), await newPlayer(server, 'Zoe'), await newPlayer(server, 'Willy'), await newPlayer(server, 'Vera'), await newPlayer(server, 'Inconnu')];
  const befriend = async other => {
    assert.equal((await x.post('/api/friends/request', { code: await codeOf(other) })).status, 200);
    await other.post('/api/friends/accept', { id: (await other.get('/api/friends')).body.incoming[0].id });
  };
  for (const o of [y, z, w, v]) await befriend(o);
  const [cx, cy, cs] = [await codeOf(y), await codeOf(z), await codeOf(stranger)];
  assert.equal((await client(server).post('/api/friends/rival', { code: cx })).status, 401);
  assert.equal((await x.post('/api/friends/rival', { code: 'court' })).status, 400);
  assert.equal((await x.post('/api/friends/rival', { code: await codeOf(x) })).status, 400, 'pas soi-même');
  assert.equal((await x.post('/api/friends/rival', { code: cs })).status, 403, 'un inconnu n\'est pas un rival');
  assert.equal((await x.post('/api/friends/rival', { code: cx })).status, 200);
  assert.equal((await x.post('/api/friends/rival', { code: cx })).status, 200, 'idempotent');
  assert.equal((await x.post('/api/friends/rival', { code: cy })).status, 200);
  assert.equal((await x.post('/api/friends/rival', { code: await codeOf(w) })).status, 200);
  const full = await x.post('/api/friends/rival', { code: await codeOf(v) });
  assert.equal(full.status, 400, '4e rival refusé');
  assert.match(full.body.error, /3 rivaux/);

  // Cartes : Xavier en possède 2, Yanis 1, Zoé 0 (cartes différentes du catalogue actif).
  const cards = await q('SELECT id,name,position,club,nation,rarity,ovr,season FROM catalog_cards WHERE is_active=true ORDER BY id LIMIT 3');
  const give = (owner, c) => q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pack:test')`,
    [crypto.randomUUID(), c.id, owner.user.id, c.season, c.name, c.position, c.club, c.nation, c.rarity, c.ovr]);
  await give(x, cards[0]); await give(x, cards[1]); await give(x, cards[1]); await give(y, cards[0]);
  const sum = (await x.get('/api/friends')).body;
  assert.equal(sum.rivals.length, 3);
  const ry = sum.rivals.find(r => r.name === 'Yanis'), rz = sum.rivals.find(r => r.name === 'Zoe');
  assert.equal(sum.rivals[0].name, 'Yanis', 'dans l\'ordre d\'ajout');
  // Chaque joueur reçoit des cartes de bienvenue : seul l'écart compte. Xavier a 2 cartes de plus que Zoé, 1 de plus que Yanis ; ses doublons ne comptent qu'une fois.
  assert.deepEqual([ry.you.cards - ry.cards, ry.gap], [1, 1]);
  assert.deepEqual([rz.you.cards - rz.cards, rz.gap], [2, 2]);
  assert.equal(ry.you.cards, rz.you.cards);
  assert.ok(ry.total >= 3 && ry.you.pct > ry.pct && ry.hidden === false);
  assert.deepEqual(sum.friends.filter(f => f.rival).map(f => f.name).sort(), ['Willy', 'Yanis', 'Zoe']);
  assert.ok(!JSON.stringify(sum).includes('@'), 'aucun e-mail dans la réponse');

  // Profil privé : le rival reste affiché mais sans aucun chiffre.
  assert.equal((await y.post('/api/profile/visibility', { visibility: 'private' })).status, 200);
  const hidden = (await x.get('/api/friends')).body.rivals.find(r => r.name === 'Yanis');
  assert.equal(hidden.hidden, true);
  for (const k of ['cards', 'pct', 'gap', 'level']) assert.equal(k in hidden, false, k + ' ne doit pas fuiter');

  // Retirer un rival, puis retirer une amitié supprime la rivalité.
  assert.equal((await x.post('/api/friends/rival', { code: cx, on: false })).status, 200);
  assert.equal((await x.get('/api/friends')).body.rivals.some(r => r.name === 'Yanis'), false);
  const idz = (await x.get('/api/friends')).body.friends.find(f => f.name === 'Zoe').id;
  assert.equal((await x.post('/api/friends/remove', { id: idz })).status, 200);
  assert.equal((await q('SELECT 1 FROM friend_rivals WHERE user_id=$1 AND rival_id=$2', [x.user.id, z.user.id])).length, 0);
  assert.equal((await x.post('/api/friends/rival', { code: cx })).status, 200, 'une place s\'est libérée');
});
