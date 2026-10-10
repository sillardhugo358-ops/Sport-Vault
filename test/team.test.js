'use strict';

// Équipe type : formations, lignes par poste, propriété des cartes, doublons, note d'équipe, profil public.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer, client } = require('./helpers');
const { FORMATIONS } = require('../lib/team');

let server, p, other;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
let n = 0;
async function give(owner, position, ovr, name) {
  n++;
  const cardId = 'team-' + n, nm = name || 'Joueur ' + position + ' ' + n;
  await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,'2026-2027',$2,$3,'FC Equipe','France','common',$4)", [cardId, nm, position, ovr]);
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,ovr,source)
    VALUES($1,$2,$3,'2026-2027',$4,$5,'FC Equipe','France','common',$6,'pack:test')`, [crypto.randomUUID(), cardId, owner.user.id, nm, position, ovr]);
  return cardId;
}

test.before(async () => { server = await startServer(); p = await newPlayer(server, 'Entraineur'); other = await newPlayer(server, 'Rival'); });
test.after(async () => { await server.stop?.(); });

test('formations : chaque formation compte 11 postes avec 1 gardien', () => {
  for (const [name, lines] of Object.entries(FORMATIONS)) {
    assert.equal(lines.length, 11, name);
    assert.equal(lines.filter(l => l === 'GK').length, 1, name);
  }
});

test('lecture : droits, formations, cartes possédées par ligne', async () => {
  assert.equal((await client(server).get('/api/team')).status, 401);
  const gk = await give(p, 'GK', 80);
  const r = (await p.get('/api/team')).body;
  assert.deepEqual(r.formations, Object.keys(FORMATIONS));
  assert.equal(r.lineup.formation, '4-3-3');
  assert.equal(r.lineup.filled, 0);
  assert.equal(r.lineup.rating, 0);
  assert.ok(r.cards.some(c => c.cardId === gk && c.line === 'GK'));
});

test('enregistrement : lignes respectées, propriété, doublons, note d\'équipe', async () => {
  const gk = await give(p, 'GK', 80), d1 = await give(p, 'CB', 70), d2 = await give(p, 'LB', 60), m1 = await give(p, 'CM', 90), a1 = await give(p, 'ST', 100);
  const foreign = await give(other, 'CB', 99);
  const lines = FORMATIONS['4-3-3'];
  const pick = { GK: [gk], DEF: [d1, d2], MID: [m1], ATT: [a1] };
  const slots = lines.map(l => pick[l].shift() || null);
  const ok = await p.post('/api/team/save', { formation: '4-3-3', slots });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.lineup.filled, 5);
  assert.equal(ok.body.lineup.rating, Math.round(((80 + 70 + 60 + 90 + 100) / 11) * 10) / 10);
  assert.equal((await p.get('/api/team')).body.lineup.slots[0].cardId, gk);
  // refus
  const bad = async s => (await p.post('/api/team/save', { formation: '4-3-3', slots: s })).status;
  const blank = () => Array(11).fill(null);
  assert.equal(await bad(blank().slice(0, 10)), 400, '11 postes exigés');
  assert.equal((await p.post('/api/team/save', { formation: '9-9-9', slots: blank() })).status, 400, 'formation inconnue');
  let s = blank(); s[0] = d1; assert.equal(await bad(s), 400, 'un défenseur ne joue pas gardien');
  s = blank(); s[1] = foreign; assert.equal(await bad(s), 400, 'carte d\'un autre joueur');
  s = blank(); s[1] = d1; s[2] = d1; assert.equal(await bad(s), 400, 'même carte deux fois');
  s = blank(); s[1] = 'inconnue'; assert.equal(await bad(s), 400, 'carte inconnue');
});

test('une carte qui n\'est plus possédée libère son poste ; l\'équipe apparaît sur le profil public', async () => {
  const t = (await p.get('/api/team')).body.lineup;
  const gkId = t.slots[0].cardId;
  const code = (await p.get('/api/trades')).body.code;
  const pub = (await other.get('/api/players/profile?code=' + code)).body;
  assert.equal(pub.team.formation, '4-3-3');
  assert.equal(pub.team.filled, 5);
  assert.ok(pub.team.players.some(x => x && x.name.startsWith('Joueur GK')));
  assert.ok(!JSON.stringify(pub.team).includes(gkId), 'pas d\'identifiant interne');
  await q('DELETE FROM card_instances WHERE card_id=$1', [gkId]);
  const after = (await p.get('/api/team')).body.lineup;
  assert.equal(after.slots[0], null);
  assert.equal(after.filled, 4);
  const empty = await newPlayer(server, 'Solo');
  assert.equal((await other.get('/api/players/profile?code=' + (await empty.get('/api/trades')).body.code)).body.team, null);
});
