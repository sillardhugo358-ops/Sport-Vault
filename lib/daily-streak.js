'use strict';

// Série de connexion quotidienne : jours consécutifs (heure de Paris) où le bonus a été récupéré.
// Le barème est dans DAILY_STREAK (lib/game-config.js) ; le serveur seul calcule la récompense.

const { DAILY_STREAK } = require('./game-config');
const { parisDayKey, parisLocalMidnight } = require('./periods');

// Clé du jour précédent à Paris (sans « - 24 h » : les changements d'heure raccourcissent ou allongent le jour).
function previousDayKey(now = new Date()) {
  return parisDayKey(new Date(parisLocalMidnight(parisDayKey(now)).getTime() - 3600_000));
}

// Série en cours : conservée si le dernier bonus date d'aujourd'hui ou d'hier, sinon interrompue (0).
function currentStreak(lastClaimedAt, streak, now = new Date()) {
  if (!lastClaimedAt) return 0;
  const last = parisDayKey(lastClaimedAt);
  return last === parisDayKey(now) || last === previousDayKey(now) ? Math.max(0, Number(streak) || 0) : 0;
}

// Série après la récupération d'aujourd'hui.
function nextStreak(lastClaimedAt, streak, now = new Date()) {
  return currentStreak(lastClaimedAt, streak, now) + 1;
}

// Récompense du jour n de la série : base + 10 FC par jour (plafonné) + palier éventuel (7 et 30 jours).
function streakReward(day) {
  const n = Math.max(1, Math.floor(Number(day) || 1));
  const coins = DAILY_STREAK.baseCoins + Math.min((n - 1) * DAILY_STREAK.dailyIncrement, DAILY_STREAK.maxBonus);
  const milestone = DAILY_STREAK.milestones[n] || 0;
  return { coins: coins + milestone, xp: DAILY_STREAK.xp, milestone };
}

module.exports = { previousDayKey, currentStreak, nextStreak, streakReward };
