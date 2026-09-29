'use strict';

// Missions de progression : stockées en base (table missions, migration
// missions-table-2026-09-30, reprise de MISSIONS) et modifiables dans la console admin.
// Sans base (mode mémoire), la liste de lib/game-config.js sert de référence.

const { MISSIONS } = require('./game-config');

const MISSION_TYPES = {
  cards: 'Cartes possédées',
  packs: 'Packs ouverts',
  rarePlus: 'Rare ou mieux',
  epicPlus: 'Epic ou mieux',
  legendaryPlus: 'Legendary ou mieux',
  iconPlus: 'Icon',
  distinctClubs: 'Clubs différents'
};
const LIMIT = 1000000;

const slugify = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mission';

const fromRow = r => ({
  id: r.id, order: Number(r.sort_order), title: r.title, description: r.description, type: r.type,
  target: Number(r.target), prerequisite: r.prerequisite || null,
  reward: { coins: Number(r.coins), xp: Number(r.xp) }, active: Boolean(r.active)
});

function createMissions({ getPool, adminLog }) {
  // Missions triées par ordre ; seules les actives par défaut.
  async function listMissions({ includeInactive = false } = {}) {
    if (!getPool()) return MISSIONS.map(m => ({ ...m, prerequisite: m.prerequisite || null, active: true }));
    const r = await getPool().query(`SELECT * FROM missions ${includeInactive ? '' : 'WHERE active'} ORDER BY sort_order, id`);
    return r.rows.map(fromRow);
  }

  // Une mission est débloquée sans prérequis, si son prérequis est validé,
  // ou si son prérequis n'est plus une mission active (chaîne jamais bloquée).
  function isUnlocked(mission, activeIds, claimedIds) {
    return !mission.prerequisite || !activeIds.has(mission.prerequisite) || claimedIds.has(mission.prerequisite);
  }

  async function adminMissions() {
    const missions = await listMissions({ includeInactive: true });
    const claims = (await getPool().query('SELECT claim_id, count(*)::int AS n FROM reward_claims WHERE claim_id = ANY($1::varchar[]) GROUP BY claim_id', [missions.map(m => m.id)])).rows;
    const byId = new Map(claims.map(c => [c.claim_id, c.n]));
    return { missions: missions.map(m => ({ ...m, claims: byId.get(m.id) || 0 })), types: MISSION_TYPES };
  }

  // Création (identifiant généré depuis le titre) ou modification (identifiant conservé).
  async function adminSaveMission(adminId, body) {
    const action = String(body.action || '');
    if (!['create', 'update', 'toggle'].includes(action)) return { error: 'Action inconnue.', status: 400 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // Verrou : deux enregistrements simultanés ne calculent pas le même identifiant.
      await client.query('LOCK TABLE missions IN SHARE ROW EXCLUSIVE MODE');
      const all = (await client.query('SELECT * FROM missions ORDER BY sort_order, id')).rows.map(fromRow);
      const byId = new Map(all.map(m => [m.id, m]));

      if (action === 'toggle') {
        const m = byId.get(String(body.id || ''));
        if (!m) { await client.query('ROLLBACK'); return { error: 'Mission introuvable.', status: 404 }; }
        const active = body.active === true;
        if (!active) {
          const dependent = all.find(x => x.active && x.prerequisite === m.id);
          if (dependent) { await client.query('ROLLBACK'); return { error: `Mission requise par « ${dependent.title} » : change d'abord son prérequis.`, status: 400 }; }
        }
        await client.query('UPDATE missions SET active=$2, updated_at=now() WHERE id=$1', [m.id, active]);
        await adminLog(adminId, null, active ? 'mission_enable' : 'mission_disable', { missionId: m.id }, client);
        await client.query('COMMIT');
        return { ok: true, mission: { ...m, active } };
      }

      const errors = {};
      const title = String(body.title || '').trim(), description = String(body.description || '').trim();
      const type = String(body.type || ''), prerequisite = String(body.prerequisite || '').trim() || null;
      const num = (v, min) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= LIMIT ? n : null; };
      const target = num(body.target, 1), coins = num(body.coins, 0), xp = num(body.xp, 0), order = num(body.order, 0);
      if (title.length < 2 || title.length > 100) errors.title = 'Titre : 2 à 100 caractères.';
      if (!description || description.length > 300) errors.description = 'Description : 1 à 300 caractères.';
      if (!MISSION_TYPES[type]) errors.type = 'Condition inconnue.';
      if (target === null) errors.target = 'Objectif : nombre entier d\'au moins 1.';
      if (coins === null) errors.coins = 'FC : nombre entier positif ou nul.';
      if (xp === null) errors.xp = 'XP : nombre entier positif ou nul.';
      if (coins === 0 && xp === 0) errors.coins = 'Une récompense (FC ou XP) est nécessaire.';
      if (order === null) errors.order = 'Ordre : nombre entier positif ou nul.';

      let id;
      if (action === 'update') {
        id = String(body.id || '');
        if (!byId.has(id)) { await client.query('ROLLBACK'); return { error: 'Mission introuvable.', status: 404 }; }
      } else {
        const base = slugify(title);
        id = base;
        for (let i = 2; byId.has(id); i++) id = base + '-' + i;
      }
      if (prerequisite) {
        if (prerequisite === id) errors.prerequisite = 'Une mission ne peut pas se précéder elle-même.';
        else if (!byId.has(prerequisite)) errors.prerequisite = 'Prérequis introuvable.';
        else {
          // Pas de boucle : en remontant les prérequis, on ne doit pas retomber sur cette mission.
          const seen = new Set([id]);
          for (let cur = prerequisite; cur; cur = byId.get(cur)?.prerequisite) {
            if (seen.has(cur)) { errors.prerequisite = 'Ce prérequis créerait une boucle.'; break; }
            seen.add(cur);
          }
        }
      }
      if (Object.keys(errors).length) { await client.query('ROLLBACK'); return { error: 'Formulaire incomplet ou invalide.', errors, status: 400 }; }

      const values = [id, title, description, type, target, prerequisite, coins, xp, order];
      if (action === 'create') {
        await client.query('INSERT INTO missions(id,title,description,type,target,prerequisite,coins,xp,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [...values, body.active !== false]);
      } else {
        await client.query('UPDATE missions SET title=$2,description=$3,type=$4,target=$5,prerequisite=$6,coins=$7,xp=$8,sort_order=$9,updated_at=now() WHERE id=$1', values);
      }
      await adminLog(adminId, null, action === 'create' ? 'mission_create' : 'mission_update', { missionId: id, title }, client);
      await client.query('COMMIT');
      const saved = fromRow((await getPool().query('SELECT * FROM missions WHERE id=$1', [id])).rows[0]);
      return { ok: true, mission: saved };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }

  return { listMissions, isUnlocked, adminMissions, adminSaveMission };
}

module.exports = { createMissions, MISSION_TYPES };
