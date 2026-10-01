'use strict';

// Succès : administration (liste, création, modification, activation, suppression).
// Mêmes règles que les missions (lib/missions.js) : identifiant généré par le serveur
// depuis le nom et conservé à la modification, validation champ par champ, actions tracées.

const { ACHIEVEMENT_TYPES } = require('./achievement-stats');

const LIMIT = 1000000;
const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'succes';

function createAchievements({ getPool, adminLog }) {
  async function adminAchievements() {
    const rows = (await getPool().query('SELECT * FROM achievements ORDER BY sort_order, code NULLS LAST, created_at, id')).rows;
    const claims = (await getPool().query("SELECT substring(claim_id from 13) AS id, count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'achievement:%' GROUP BY claim_id")).rows;
    const byId = new Map(claims.map(c => [c.id, c.n]));
    return { achievements: rows.map(r => ({ ...r, claims: byId.get(r.id) || 0 })), types: ACHIEVEMENT_TYPES };
  }

  async function adminSaveAchievement(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle', 'delete'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // Verrou : deux créations simultanées ne calculent pas le même identifiant.
      await client.query('LOCK TABLE achievements IN SHARE ROW EXCLUSIVE MODE');
      const existing = new Map((await client.query('SELECT * FROM achievements')).rows.map(r => [r.id, r]));
      const done = async (logAction, details, result) => {
        await adminLog(adminId, null, logAction, details, client);
        await client.query('COMMIT');
        return result;
      };
      const fail = async (error, status, errors) => { await client.query('ROLLBACK'); return { error, status, ...(errors ? { errors } : {}) }; };

      if (action === 'toggle' || action === 'delete') {
        const a = existing.get(String(body.id || ''));
        if (!a) return fail('Succès introuvable.', 404);
        if (action === 'delete') {
          // Les récompenses déjà récupérées restent acquises (reward_claims).
          await client.query('DELETE FROM achievements WHERE id=$1', [a.id]);
          return done('achievement_delete', { achievementId: a.id, name: a.name }, { ok: true });
        }
        const active = body.active === true;
        if (active && a.type === 'pending') return fail('Ce succès n’est pas encore mesurable : choisis d’abord une condition disponible (bouton Modifier).', 400);
        await client.query('UPDATE achievements SET active=$2, updated_at=now() WHERE id=$1', [a.id, active]);
        return done(active ? 'achievement_enable' : 'achievement_disable', { achievementId: a.id }, { ok: true });
      }

      const errors = {};
      const name = String(body.name || '').trim(), category = String(body.category || '').trim();
      const description = String(body.description || '').trim(), icon = String(body.icon || '').trim() || '✦';
      const type = String(body.type || '');
      const num = (v, min) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= LIMIT ? n : null; };
      const target = num(body.target, 1), coins = num(body.coins, 0), xp = num(body.xp, 0);
      if (name.length < 2 || name.length > 100) errors.name = 'Nom : 2 à 100 caractères.';
      if (!category || category.length > 50) errors.category = 'Catégorie : 1 à 50 caractères.';
      if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
      if ([...icon].length > 8 || icon.length > 20) errors.icon = 'Icône : un symbole ou un emoji.';
      if (!ACHIEVEMENT_TYPES[type]) errors.type = 'Condition inconnue.';
      if (target === null) errors.target = 'Objectif : nombre entier d\'au moins 1.';
      if (coins === null) errors.coins = 'FC : nombre entier positif ou nul.';
      if (xp === null) errors.xp = 'XP : nombre entier positif ou nul.';
      if (coins === 0 && xp === 0) errors.coins = 'Une récompense (FC ou XP) est nécessaire.';

      let id;
      if (action === 'update') {
        id = String(body.id || '');
        if (!existing.has(id)) return fail('Succès introuvable.', 404);
      } else {
        const base = 'ach-' + slugify(name);
        id = base;
        for (let i = 2; existing.has(id); i++) id = base + '-' + i;
      }
      const duplicate = [...existing.values()].find(a => a.id !== id && a.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) errors.name = `Un succès porte déjà ce nom (${duplicate.id}).`;
      if (Object.keys(errors).length) return fail('Formulaire incomplet ou invalide.', 400, errors);

      const values = [id, name, category, description, type, target, coins, xp, icon, body.hidden === true];
      if (action === 'create') {
        const order = Number((await client.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM achievements')).rows[0].n);
        await client.query('INSERT INTO achievements(id,name,category,description,type,target,coins,xp,icon,hidden,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [...values, body.active !== false, order]);
      } else {
        await client.query('UPDATE achievements SET name=$2,category=$3,description=$4,type=$5,target=$6,coins=$7,xp=$8,icon=$9,hidden=$10,updated_at=now() WHERE id=$1', values);
      }
      const result = { ok: true, achievement: (await client.query('SELECT * FROM achievements WHERE id=$1', [id])).rows[0] };
      return done(action === 'create' ? 'achievement_create' : 'achievement_update', { achievementId: id, name }, result);
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { adminAchievements, adminSaveAchievement };
}

module.exports = { createAchievements };
