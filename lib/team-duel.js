'use strict';

// Duel quotidien d'équipe type : un joueur défie un AMI ACCEPTÉ (code d'échange). Les deux équipes doivent compter 11 titulaires ; le score est la
// somme des OVR des titulaires (comparaison exacte, pas la moyenne arrondie). Le vainqueur gagne TEAM_DUEL.coins FC + TEAM_DUEL.xp XP, une seule
// fois (reward_claims « duel:<id> ») ; égalité : pas de récompense, le duel compte quand même. Un seul duel par joueur et par jour de Paris, défieur
// ou défié (team_duel_days). Tout est calculé ici : le client n'envoie que le code de l'ami. Les FC de duel ne comptent pas dans le plafond des sets.

const crypto = require('crypto');
const { TEAM_DUEL } = require('./game-config');
const { parisDayKey } = require('./periods');
const { notify } = require('./notifications');

const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });
const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const score = lineup => lineup.slots.reduce((n, c) => n + (c ? c.ovr : 0), 0);

function createTeamDuel({ getPool, team, applyReward, securityEvent, now = () => new Date() }) {
  const db = () => getPool();

  const row = (r, me) => ({
    id: r.id, day: r.day, createdAt: r.created_at,
    me: { score: me === r.challenger_id ? r.challenger_score : r.opponent_score },
    opponent: { name: me === r.challenger_id ? r.opponent_name : r.challenger_name, score: me === r.challenger_id ? r.opponent_score : r.challenger_score },
    result: !r.winner_id ? 'draw' : r.winner_id === me ? 'win' : 'loss', challenger: me === r.challenger_id
  });
  const SELECT = `SELECT d.*,uc.name AS challenger_name,uo.name AS opponent_name FROM team_duels d JOIN users uc ON uc.id=d.challenger_id JOIN users uo ON uo.id=d.opponent_id`;

  async function status(userId) {
    if (!db()) return { usedToday: false, today: null, history: [], reward: { coins: TEAM_DUEL.coins, xp: TEAM_DUEL.xp } };
    const day = parisDayKey(now());
    const rows = (await db().query(SELECT + ' WHERE d.challenger_id=$1 OR d.opponent_id=$1 ORDER BY d.created_at DESC LIMIT $2', [userId, TEAM_DUEL.history])).rows.map(r => row(r, userId));
    const today = rows.find(r => r.day === day) || null;
    return { usedToday: !!today, today, history: rows, reward: { coins: TEAM_DUEL.coins, xp: TEAM_DUEL.xp }, day };
  }

  async function challenge(userId, codeRaw) {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return fail('Code invalide (8 caractères).');
    if (!db()) return fail('Indisponible.', 503);
    const other = (await db().query("SELECT id,name,profile_visibility FROM users WHERE trade_code=$1 AND account_status <> 'banned'", [code])).rows[0];
    if (!other) return fail('Joueur introuvable.', 404);
    if (other.id === userId) return fail('Tu ne peux pas te défier toi-même.');
    const [lo, hi] = pair(userId, other.id);
    const friend = (await db().query("SELECT 1 FROM friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted'", [lo, hi])).rowCount;
    if (!friend) return fail('Tu ne peux défier qu’un ami accepté.', 403);
    if (other.profile_visibility === 'private') return fail('Ce joueur garde son profil privé : pas de duel.', 403);
    const mine = await team.get(userId), theirs = await team.get(other.id);
    if (!mine.lineup || mine.lineup.filled < 11) return fail('Compose une équipe type de 11 titulaires pour pouvoir défier.', 409, { code: 'team_incomplete' });
    if (!theirs.lineup || theirs.lineup.filled < 11) return fail(other.name + ' n’a pas encore une équipe type complète.', 409, { code: 'opponent_team_incomplete' });
    const a = score(mine.lineup), b = score(theirs.lineup);
    const day = parisDayKey(now());
    const winner = a > b ? userId : b > a ? other.id : null;
    const id = crypto.randomUUID();
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Verrous dans un ordre fixe : deux défis croisés ne peuvent pas se bloquer entre eux.
      await client.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[userId, other.id]]);
      await client.query('INSERT INTO team_duels(id,challenger_id,opponent_id,day,challenger_score,opponent_score,winner_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, userId, other.id, day, a, b, winner]);
      const mineDay = await client.query('INSERT INTO team_duel_days(user_id,day,duel_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [userId, day, id]);
      if (!mineDay.rowCount) { await client.query('ROLLBACK'); return fail('Tu as déjà fait ton duel aujourd’hui : reviens demain.', 409, { code: 'daily_limit' }); }
      const theirDay = await client.query('INSERT INTO team_duel_days(user_id,day,duel_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [other.id, day, id]);
      if (!theirDay.rowCount) { await client.query('ROLLBACK'); return fail(other.name + ' a déjà fait son duel aujourd’hui.', 409, { code: 'opponent_busy' }); }
      let user = null;
      if (winner) {
        const claim = 'duel:' + id;
        const ins = await client.query('INSERT INTO reward_claims(user_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING claim_id', [winner, claim]);
        if (ins.rowCount) user = await applyReward(winner, { coins: TEAM_DUEL.coins, xp: TEAM_DUEL.xp }, client, claim);
      }
      await securityEvent(userId, null, 'team_duel', { duel: id, opponent: other.id, scores: [a, b], winner }, client);
      const me = (await client.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
      await notify(client, other.id, 'team_duel', me.name + ' t’a défié : ' + (winner === other.id ? 'tu gagnes ' + a + ' à ' + b + ' !' : winner ? 'tu perds ' + a + ' à ' + b + '.' : 'égalité.'), 'Équipes type comparées, un duel par jour.', '#amis');
      await client.query('COMMIT');
      return { duel: { id, day, me: { score: a }, opponent: { name: other.name, score: b }, result: !winner ? 'draw' : winner === userId ? 'win' : 'loss' }, reward: winner === userId ? { coins: TEAM_DUEL.coins, xp: TEAM_DUEL.xp } : null, user: winner === userId ? user : null };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { status, challenge };
}

module.exports = { createTeamDuel };
