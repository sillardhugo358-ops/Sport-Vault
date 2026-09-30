'use strict';

// Albums par championnat : récompenses de club, de saison (tous ses clubs) et de championnat entier
// (toutes ses saisons), une seule fois par joueur, journalisées ; clubs sans cartes ignorés.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, newPlayer } = require('./helpers');
const { ALBUM_REWARDS } = require('../lib/game-config');

let server, player;
const q = (sql, params) => server.db.query(sql, params);
const S1 = 'coupe-album-2024', S2 = 'coupe-album-2025';
const CLUBS = { [S1]: ['Club Alpha', 'Club Beta'], [S2]: ['Club Gamma'] };
const SEASON = { [S1]: '2024-2025', [S2]: '2025-2026' };

async function own(cardId) {
  const c = (await q('SELECT * FROM catalog_cards WHERE id=$1', [cardId])).rows[0];
  await q(`INSERT INTO card_instances(instance_id,card_id,owner_id,season,name,position,club,nation,rarity,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pack:test')`, [crypto.randomUUID(), c.id, player.user.id, c.season, c.name, c.position, c.club, c.nation, c.rarity]);
}
const cardsOf = (seasonId, club) => [0, 1].map(i => `alb-${seasonId.slice(-4)}-${club.split(' ')[1].toLowerCase()}-${i}`);
const claim = body => player.post('/api/album/claim', body);
const album = async () => (await player.get('/api/album')).body;
const comp = d => d.album.competitions.find(c => c.id === 'coupe-album');

test.before(async () => {
  server = await startServer();
  player = await newPlayer(server, 'Albumiste');
  await q("INSERT INTO competitions(id,name,tag,status,sort_order) VALUES('coupe-album','Coupe Album','CA','available',99)");
  for (const [sid, clubs] of Object.entries(CLUBS)) {
    await q("INSERT INTO competition_seasons(id,competition_id,season,label,status) VALUES($1,'coupe-album',$2,$2,'available')", [sid, SEASON[sid]]);
    for (const [i, name] of clubs.entries()) {
      const clubId = 'ca-' + name.split(' ')[1].toLowerCase();
      await q('INSERT INTO clubs(id,name,tag) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [clubId, name, name.slice(5, 8).toUpperCase()]);
      await q('INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,$2,$3)', [sid, clubId, i]);
      for (const id of cardsOf(sid, name)) {
        await q("INSERT INTO catalog_cards(id,season,name,position,club,nation,rarity,ovr) VALUES($1,$2,$3,'CM',$4,'France','common',70)", [id, SEASON[sid], 'Joueur ' + id, name]);
      }
    }
  }
  // Club rattaché mais sans aucune carte au catalogue : ne doit pas bloquer la saison.
  await q("INSERT INTO clubs(id,name,tag) VALUES('ca-vide','Club Vide','VID')");
  await q("INSERT INTO season_clubs(season_id,club_id,position) VALUES($1,'ca-vide',9)", [S2]);
});
test.after(async () => { await server?.stop(); });

test('progression : saisons et championnat incomplets au départ, montants affichés', async () => {
  const d = await album();
  assert.deepEqual(d.rewards.amounts, ALBUM_REWARDS);
  const c = comp(d);
  assert.deepEqual([c.completion.seasons, c.completion.completeSeasons, c.completion.complete], [2, 0, false]);
  const s2 = c.seasons.find(s => s.id === S2);
  assert.equal(s2.completion.clubs, 1, 'le club sans carte est ignoré');
  assert.equal((await claim({ level: 'season', seasonId: S1 })).status, 400);
  assert.equal((await claim({ level: 'competition', competitionId: 'coupe-album' })).status, 400);
  assert.equal((await claim({ level: 'season', seasonId: 'inconnue' })).status, 404);
});

test('saison complète : récompense une seule fois, même en rafale, et journalisée', async () => {
  for (const club of CLUBS[S1]) for (const id of cardsOf(S1, club)) await own(id);
  const c = comp(await album());
  assert.equal(c.seasons.find(s => s.id === S1).completion.complete, true);
  assert.equal(c.completion.complete, false, 'une saison sur deux ne suffit pas');
  const before = Number((await q('SELECT coins FROM users WHERE id=$1', [player.user.id])).rows[0].coins);
  const results = await Promise.all(Array.from({ length: 6 }, () => claim({ level: 'season', seasonId: S1 })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const after = Number((await q('SELECT coins FROM users WHERE id=$1', [player.user.id])).rows[0].coins);
  assert.equal(after - before, ALBUM_REWARDS.season.coins);
  const ledger = (await q("SELECT amount FROM coin_ledger WHERE user_id=$1 AND ref=$2", [player.user.id, 'album-season:' + S1])).rows;
  assert.deepEqual(ledger.map(r => r.amount), [ALBUM_REWARDS.season.coins]);
  assert.equal(comp(await album()).seasons.find(s => s.id === S1).completion.claimed, true);
  // Les récompenses de club restent indépendantes.
  assert.equal((await claim({ seasonId: S1, clubId: 'ca-alpha' })).status, 200);
});

test('championnat entier : toutes les saisons complètes, récompense unique, visible au profil', async () => {
  for (const id of cardsOf(S2, 'Club Gamma')) await own(id);
  const c = comp(await album());
  assert.deepEqual([c.completion.completeSeasons, c.completion.complete], [2, true]);
  const r = await claim({ level: 'competition', competitionId: 'coupe-album' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.reward, ALBUM_REWARDS.competition);
  assert.equal((await claim({ level: 'competition', competitionId: 'coupe-album' })).status, 400);
  const labels = (await player.get('/api/profile')).body.history.map(h => h.label);
  assert.ok(labels.includes('Album : championnat complété'));
  assert.ok(labels.includes('Album : saison complétée'));
  assert.ok(labels.includes('Album : club complété'));
});
