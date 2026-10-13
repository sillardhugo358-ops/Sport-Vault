'use strict';

// lib/rewards.js sans base de données (mode mémoire) : barèmes de progression, récompenses jamais
// attribuées deux fois, série quotidienne. Les chemins PostgreSQL sont couverts par rewards.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRewards } = require('../lib/rewards');
const { periodInfo, taskClaimId } = require('../lib/periods');

const DAY = 86400_000;

function setup({ missions = [], tasks = [], userCards = [], catalogCards = [] } = {}) {
  const memory = { users: new Map(), claims: new Map(), cards: new Map(), activity: [] };
  const user = { id: 'u1', coins: 1000, xp: 0, packs_opened: 0 };
  memory.users.set('u1', user);
  const state = { missions, tasks, userCards };
  const rewards = createRewards({
    getPool: () => null,
    memory,
    catalog: () => catalogCards,
    getUserById: async id => memory.users.get(id) || null,
    getUserCards: async () => state.userCards,
    publicCard: c => ({ ...c, rarity: c.rarity, club: c.club }),
    safeUser: u => ({ id: u.id, coins: u.coins, xp: u.xp }),
    securityEvent: async () => {},
    listMissions: async () => state.missions,
    listTasks: async () => state.tasks,
    periodMissions: async (u, kind) => ({ period: periodInfo(kind), tasks: state.tasks })
  });
  return { rewards, memory, user, state };
}

test('niveau : paliers de 150 XP, +40 XP par niveau, valeurs invalides ramenées au niveau 1', () => {
  const { levelProgressFromXp: lvl } = setup().rewards;
  assert.deepEqual(lvl(0), { level: 1, currentXp: 0, xpToNext: 150 });
  assert.deepEqual(lvl(149), { level: 1, currentXp: 149, xpToNext: 150 });
  assert.deepEqual(lvl(150), { level: 2, currentXp: 0, xpToNext: 190 });
  assert.deepEqual(lvl(150 + 190 + 5), { level: 3, currentXp: 5, xpToNext: 230 });
  for (const bad of [-50, NaN, undefined, null, 'abc']) assert.deepEqual(lvl(bad), { level: 1, currentXp: 0, xpToNext: 150 });
  assert.equal(lvl(12.9).currentXp, 12, 'les XP décimaux sont arrondis à l’entier inférieur');
});

test('progression de mission : un barème par type, type inconnu = 0', () => {
  const { missionProgress: prog } = setup().rewards;
  const cards = [{ rarity: 'common', club: 'A' }, { rarity: 'rare', club: 'A' }, { rarity: 'epic', club: 'B' }, { rarity: 'common' }];
  assert.equal(prog({ type: 'cards' }, cards, null), 4);
  assert.equal(prog({ type: 'packs' }, cards, { packs_opened: '7' }), 7);
  assert.equal(prog({ type: 'packs' }, cards, null), 0, 'joueur absent');
  assert.equal(prog({ type: 'rarePlus' }, cards, null), 1);
  assert.equal(prog({ type: 'epicPlus' }, cards, null), 1);
  assert.equal(prog({ type: 'legendaryPlus' }, cards, null), 0);
  assert.equal(prog({ type: 'iconPlus' }, cards, null), 0);
  assert.equal(prog({ type: 'iconPlus' }, [{ rarity: 'icon' }], null), 1);
  assert.equal(prog({ type: 'legendaryPlus' }, [{ rarity: 'legendary' }], null), 1);
  assert.equal(prog({ type: 'rarePlus' }, [{ rarity: 'common' }, { rarity: 'inconnue' }], null), 0, 'rareté inconnue ignorée');
  assert.equal(prog({ type: 'distinctClubs' }, cards, null), 2, 'clubs distincts, cartes sans club ignorées');
  assert.equal(prog({ type: 'nimporte' }, cards, null), 0);
});

test('progression des missions périodiques : un barème par type, type inconnu = 0', () => {
  const { taskProgress: prog } = setup().rewards;
  const activity = { packOpens: 3, cards: [{ rarity: 'common', club: 'A' }, { rarity: 'rare', club: 'B' }, { rarity: 'epic', club: 'B' }, { rarity: 'common' }] };
  assert.equal(prog({ type: 'packsOpened' }, activity), 3);
  assert.equal(prog({ type: 'cardsObtained' }, activity), 4);
  assert.equal(prog({ type: 'rarePlusObtained' }, activity), 2);
  assert.equal(prog({ type: 'distinctClubsObtained' }, activity), 2);
  assert.equal(prog({ type: 'autre' }, activity), 0);
});

test('applyReward et réclamations en mémoire', async () => {
  const { rewards, user } = setup();
  assert.equal((await rewards.applyReward('u1', { coins: 100, xp: 10 })).coins, 1100);
  assert.equal(user.xp, 10);
  await rewards.applyReward('u1', {});
  assert.equal(user.coins, 1100, 'récompense sans montant : rien ne change');
  assert.equal(await rewards.applyReward('absent', { coins: 5 }), null);
  assert.equal(await rewards.claimExists('u1', 'm1'), false);
  await rewards.addClaim('u1', 'm1');
  assert.equal(await rewards.claimExists('u1', 'm1'), true);
  assert.equal(await rewards.claimExists('u2', 'm1'), false, 'les récupérations sont propres à chaque joueur');
});

test('prérequis de mission : bloquée tant que la précédente n’est pas récupérée, libre si elle n’existe plus', async () => {
  const { rewards } = setup();
  const first = { id: 'a' }, second = { id: 'b', prerequisite: 'a' };
  assert.equal(await rewards.missionUnlocked('u1', first, [first, second]), true);
  assert.equal(await rewards.missionUnlocked('u1', second, [first, second]), false);
  assert.equal(await rewards.missionUnlocked('u1', { id: 'c', prerequisite: 'retiree' }, [first]), true, 'prérequis retiré des missions actives');
  await rewards.addClaim('u1', 'a');
  assert.equal(await rewards.missionUnlocked('u1', second, [first, second]), true);
});

test('activité de la période : seulement les cartes du joueur, hors cartes de bienvenue, dans la période', async () => {
  const { rewards, memory } = setup();
  const now = new Date();
  const inPeriod = new Date(now.getTime());
  const add = (id, extra) => memory.cards.set(id, { ownerId: 'u1', status: 'owned', source: 'pack', acquiredAt: inPeriod.toISOString(), rarity: 'common', club: 'A', ...extra });
  add('c1', {});
  add('c2', { source: 'welcome' });
  add('c3', { ownerId: 'u2' });
  add('c4', { status: 'sold' });
  add('c5', { acquiredAt: new Date(now.getTime() - 3 * DAY).toISOString() });
  memory.activity.push(
    { userId: 'u1', event: 'pack_open', at: inPeriod },
    { userId: 'u1', event: 'pool_draw', at: inPeriod },
    { userId: 'u1', event: 'login', at: inPeriod },
    { userId: 'u2', event: 'pack_open', at: inPeriod },
    { userId: 'u1', event: 'pack_open', at: new Date(now.getTime() - 3 * DAY) }
  );
  const activity = await rewards.periodActivity('u1', 'daily', now);
  assert.deepEqual(activity.cards.map(c => c.club), ['A'], 'une seule carte compte');
  assert.equal(activity.packOpens, 2, 'ouvertures de packs et tirages de pool de la période');
  assert.ok(activity.key && activity.start < activity.end);
});

test('mission : inconnue, verrouillée, incomplète, puis récupérée une seule fois', async () => {
  const missions = [
    { id: 'm1', type: 'cards', target: 3, reward: { coins: 200, xp: 20 } },
    { id: 'm2', type: 'cards', target: 1, prerequisite: 'm1', reward: { coins: 50, xp: 5 } }
  ];
  const { rewards, user, state } = setup({ missions, userCards: [{ rarity: 'common' }] });
  assert.equal((await rewards.claimMission('u1', 'zzz')).status, 404);
  assert.equal((await rewards.claimMission('u1', 'm2')).status, 403);
  const early = await rewards.claimMission('u1', 'm1');
  assert.equal(early.status, 400);
  assert.deepEqual([early.progress, early.target], [1, 3]);
  assert.equal(user.coins, 1000, 'mission incomplète : rien n’est versé');

  state.userCards = [{}, {}, {}, {}, {}];
  const ok = await rewards.claimMission('u1', 'm1');
  assert.equal(ok.reward.coins, 200);
  assert.equal(ok.user.coins, 1200);
  const again = await rewards.claimMission('u1', 'm1');
  assert.equal(again.status, 400);
  assert.match(again.error, /déjà récupérée/);
  assert.equal(user.coins, 1200, 'jamais de seconde récompense');
  assert.equal((await rewards.claimMission('u1', 'm2')).mission?.id, 'm2', 'la mission suivante se débloque');
});

test('mission périodique : joueur ou mission inconnus, non terminée, puis une seule récupération par période', async () => {
  const done = { id: 't1', completed: true, progress: 5, target: 5, reward: { coins: 80, xp: 8 } };
  const open = { id: 't2', completed: false, progress: 1, target: 4, reward: { coins: 10, xp: 1 } };
  const { rewards, user, memory } = setup({ tasks: [done, open] });
  assert.equal((await rewards.claimTask('absent', 'daily', 't1')).status, 404);
  assert.equal((await rewards.claimTask('u1', 'daily', 'zzz')).status, 404);
  const notDone = await rewards.claimTask('u1', 'daily', 't2');
  assert.deepEqual([notDone.status, notDone.progress, notDone.target], [400, 1, 4]);

  const ok = await rewards.claimTask('u1', 'daily', 't1');
  assert.equal(ok.user.coins, 1080);
  assert.equal(ok.period, periodInfo('daily').key);
  assert.ok(memory.claims.has(`u1:${taskClaimId('daily', ok.period, 't1')}`));
  const again = await rewards.claimTask('u1', 'daily', 't1');
  assert.equal(again.status, 400);
  assert.equal(user.coins, 1080);
  assert.equal((await rewards.claimTask('u1', 'weekly', 't1')).task?.id, 't1', 'la période hebdomadaire est distincte');
});

test('bonus quotidien : joueur inconnu, une fois par jour, série qui monte puis repart à 1 avec record conservé', async () => {
  const { rewards, user } = setup();
  assert.equal((await rewards.claimDaily('absent')).status, 404);

  const first = await rewards.claimDaily('u1');
  assert.equal(first.streak, 1);
  assert.equal(first.reward.coins, 150);
  assert.equal(user.coins, 1150);
  const same = await rewards.claimDaily('u1');
  assert.equal(same.status, 400);
  assert.equal(same.user.coins, 1150);
  assert.equal(user.coins, 1150, 'pas de second bonus le même jour');

  user.dailyClaimedAt = new Date(Date.now() - DAY).toISOString();
  const next = await rewards.claimDaily('u1');
  assert.equal(next.streak, 2);
  assert.equal(next.reward.coins, 160);

  user.dailyClaimedAt = new Date(Date.now() - 4 * DAY).toISOString();
  const reset = await rewards.claimDaily('u1');
  assert.equal(reset.streak, 1, 'un jour manqué remet la série à 1');
  assert.equal(reset.bestStreak, 2, 'le record est conservé');
});

test('album sans base : un championnat sans club n’est jamais complet', async () => {
  const { rewards } = setup();
  const data = await rewards.albumData('u1');
  const [league] = data.album.competitions;
  assert.equal(league.id, 'ligue-1');
  assert.equal(league.seasons[0].completion.complete, false);
  assert.equal(league.completion.complete, false);
  assert.deepEqual([data.album.overallOwned, data.album.overallTotal], [0, 0]);
  assert.deepEqual(data.rewards.clubs, []);
});
