'use strict';

// Tâches quotidiennes et hebdomadaires : stockées en base (table period_tasks, migration
// period-tasks-2026-09-30, reprise de DAILY_TASKS et WEEKLY_TASKS) et modifiables dans la console admin.
// L'identifiant d'une tâche entre dans celui de sa récompense (taskClaimId) : il ne change jamais,
// si bien qu'une tâche modifiée en cours de période ne peut pas être récupérée deux fois.
// Sans base (mode mémoire), les listes de lib/game-config.js servent de référence.

const { DAILY_TASKS, WEEKLY_TASKS } = require('./game-config');

const TASK_KINDS = { daily: 'Quotidienne', weekly: 'Hebdomadaire' };
const TASK_TYPES = {
  packsOpened: 'Packs ouverts',
  cardsObtained: 'Cartes obtenues',
  rarePlusObtained: 'Cartes Rare ou mieux obtenues',
  distinctClubsObtained: 'Clubs différents obtenus'
};
const LIMIT = 1000000;
const DEFAULTS = { daily: DAILY_TASKS, weekly: WEEKLY_TASKS };

const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tache';

const fromRow = r => ({
  id: r.id, kind: r.kind, order: Number(r.sort_order), title: r.title, description: r.description, type: r.type,
  target: Number(r.target), reward: { coins: Number(r.coins), xp: Number(r.xp) }, active: Boolean(r.active)
});

function createTasks({ getPool, adminLog }) {
  // Tâches d'une période, triées par ordre ; seules les actives par défaut.
  async function listTasks(kind, { includeInactive = false } = {}) {
    if (!TASK_KINDS[kind]) return [];
    if (!getPool()) return DEFAULTS[kind].map((t, i) => ({ ...t, kind, order: i, active: true }));
    const r = await getPool().query(`SELECT * FROM period_tasks WHERE kind=$1 ${includeInactive ? '' : 'AND active'} ORDER BY sort_order, id`, [kind]);
    return r.rows.map(fromRow);
  }

  async function adminTasks() {
    const tasks = (await getPool().query('SELECT * FROM period_tasks ORDER BY kind, sort_order, id')).rows.map(fromRow);
    // Récompenses récupérées, toutes périodes confondues (claim_id = <kind>:<période>:<id>, lib/periods.js).
    const claims = (await getPool().query("SELECT split_part(claim_id,':',1) AS kind, split_part(claim_id,':',3) AS id, count(*)::int AS n FROM reward_claims WHERE claim_id LIKE 'daily:%' OR claim_id LIKE 'weekly:%' GROUP BY 1,2")).rows;
    const byKey = new Map(claims.map(c => [c.kind + ':' + c.id, c.n]));
    return { tasks: tasks.map(t => ({ ...t, claims: byKey.get(t.kind + ':' + t.id) || 0 })), types: TASK_TYPES, kinds: TASK_KINDS };
  }

  // Création (identifiant généré depuis le titre) ou modification (identifiant et période conservés).
  async function adminSaveTask(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    const kind = String(body.kind || '');
    if (!TASK_KINDS[kind]) return { error: 'Période inconnue.', status: 400 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE period_tasks IN SHARE ROW EXCLUSIVE MODE');
      const all = (await client.query('SELECT * FROM period_tasks WHERE kind=$1', [kind])).rows.map(fromRow);
      const byId = new Map(all.map(t => [t.id, t]));

      if (action === 'toggle') {
        const t = byId.get(String(body.id || ''));
        if (!t) { await client.query('ROLLBACK'); return { error: 'Tâche introuvable.', status: 404 }; }
        const active = body.active === true;
        if (!active && all.filter(x => x.active && x.id !== t.id).length === 0) {
          await client.query('ROLLBACK');
          return { error: 'Au moins une tâche ' + (kind === 'daily' ? 'quotidienne' : 'hebdomadaire') + ' doit rester active.', status: 400 };
        }
        await client.query('UPDATE period_tasks SET active=$3, updated_at=now() WHERE kind=$1 AND id=$2', [kind, t.id, active]);
        await adminLog(adminId, null, active ? 'task_enable' : 'task_disable', { kind, taskId: t.id }, client);
        await client.query('COMMIT');
        return { ok: true, task: { ...t, active } };
      }

      const errors = {};
      const title = String(body.title || '').trim(), description = String(body.description || '').trim(), type = String(body.type || '');
      const num = (v, min) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= LIMIT ? n : null; };
      const target = num(body.target, 1), coins = num(body.coins, 0), xp = num(body.xp, 0), order = num(body.order, 0);
      if (title.length < 2 || title.length > 100) errors.title = 'Titre : 2 à 100 caractères.';
      if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
      if (!TASK_TYPES[type]) errors.type = 'Condition inconnue.';
      if (target === null) errors.target = 'Objectif : nombre entier d\'au moins 1.';
      if (coins === null) errors.coins = 'FC : nombre entier positif ou nul.';
      if (xp === null) errors.xp = 'XP : nombre entier positif ou nul.';
      if (coins === 0 && xp === 0) errors.coins = 'Une récompense (FC ou XP) est nécessaire.';
      if (order === null) errors.order = 'Ordre : nombre entier positif ou nul.';

      let id;
      if (action === 'update') {
        id = String(body.id || '');
        if (!byId.has(id)) { await client.query('ROLLBACK'); return { error: 'Tâche introuvable.', status: 404 }; }
      } else {
        const base = slugify(title);
        id = base;
        for (let i = 2; byId.has(id); i++) id = base + '-' + i;
      }
      if (title && all.some(t => t.id !== id && t.title.toLowerCase() === title.toLowerCase())) errors.title = 'Une tâche de cette période porte déjà ce titre.';
      if (Object.keys(errors).length) { await client.query('ROLLBACK'); return { error: 'Formulaire incomplet ou invalide.', errors, status: 400 }; }

      const values = [kind, id, title, description, type, target, coins, xp, order];
      if (action === 'create') {
        await client.query('INSERT INTO period_tasks(kind,id,title,description,type,target,coins,xp,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [...values, body.active !== false]);
      } else {
        await client.query('UPDATE period_tasks SET title=$3,description=$4,type=$5,target=$6,coins=$7,xp=$8,sort_order=$9,updated_at=now() WHERE kind=$1 AND id=$2', values);
      }
      await adminLog(adminId, null, action === 'create' ? 'task_create' : 'task_update', { kind, taskId: id, title }, client);
      await client.query('COMMIT');
      const saved = fromRow((await getPool().query('SELECT * FROM period_tasks WHERE kind=$1 AND id=$2', [kind, id])).rows[0]);
      return { ok: true, task: saved };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { listTasks, adminTasks, adminSaveTask };
}

module.exports = { createTasks, TASK_TYPES, TASK_KINDS };
