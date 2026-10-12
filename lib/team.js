'use strict';

// Équipe type : un 11 composé de cartes possédées, dans une formation. Chaque poste de la formation demande un POSTE EXACT (gardien, latéral
// gauche, défenseur central, latéral droit, milieu défensif / central / offensif, ailier gauche / droit, attaquant) : une carte ne convient
// que si son poste est celui du poste à pourvoir (un latéral gauche ne joue pas à droite). Note d'équipe = moyenne des OVR des 11 titulaires
// (un poste vide compte 0). Aucune récompense : c'est une vitrine. Enregistrée par carte (card_id) : un joueur qui perd un exemplaire en garde
// un autre ; à la lecture, une carte qui n'est plus possédée ou qui ne convient plus au poste libère son poste.

const POSITION_LABELS = {
  GK: 'Gardien', LB: 'Latéral gauche', CB: 'Défenseur central', RB: 'Latéral droit', DM: 'Milieu défensif', CM: 'Milieu central',
  AM: 'Milieu offensif', LW: 'Ailier gauche', RW: 'Ailier droit', ST: 'Attaquant'
};
// Rangées de chaque formation, de l'arrière vers l'avant, de gauche à droite : l'ordre des postes (et des 11 cartes enregistrées) est
// celui de ces rangées mises bout à bout.
const FORMATION_ROWS = {
  '4-3-3': [['GK'], ['LB', 'CB', 'CB', 'RB'], ['CM', 'DM', 'CM'], ['LW', 'ST', 'RW']],
  '4-4-2': [['GK'], ['LB', 'CB', 'CB', 'RB'], ['LW', 'CM', 'CM', 'RW'], ['ST', 'ST']],
  '3-5-2': [['GK'], ['CB', 'CB', 'CB'], ['LB', 'CM', 'DM', 'CM', 'RB'], ['ST', 'ST']],
  '4-2-3-1': [['GK'], ['LB', 'CB', 'CB', 'RB'], ['DM', 'DM'], ['LW', 'AM', 'RW'], ['ST']],
  '5-3-2': [['GK'], ['LB', 'CB', 'CB', 'CB', 'RB'], ['CM', 'DM', 'CM'], ['ST', 'ST']]
};
const FORMATIONS = Object.fromEntries(Object.entries(FORMATION_ROWS).map(([name, rows]) => [name, rows.flat()]));
const DEFAULT_FORMATION = '4-3-3';
const fail = (error, status = 400) => ({ error, status });

function createTeam({ getPool }) {
  const db = () => getPool();

  const view = r => ({ cardId: r.card_id, name: r.name, club: r.club, season: r.season, rarity: r.rarity, ovr: Number(r.ovr || 0), position: String(r.position || '').toUpperCase() });

  // Meilleure carte (OVR) possédée pour chaque card_id : le nom, la rareté et la note viennent de l'exemplaire le mieux noté.
  async function ownedCards(userId) {
    const rows = (await db().query(`SELECT DISTINCT ON (card_id) card_id,name,club,season,rarity,ovr,position FROM card_instances
      WHERE owner_id=$1 AND status IN ('owned','auction') ORDER BY card_id, ovr DESC`, [userId])).rows;
    return rows.map(view).sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name, 'fr'));
  }

  const rating = slots => Math.round((slots.reduce((n, c) => n + (c ? c.ovr : 0), 0) / 11) * 10) / 10;

  async function lineupFor(userId, owned) {
    const row = (await db().query('SELECT formation,slots FROM team_lineups WHERE user_id=$1', [userId])).rows[0];
    const formation = row && FORMATIONS[row.formation] ? row.formation : DEFAULT_FORMATION;
    const ids = Array.isArray(row?.slots) ? row.slots : [];
    const byId = new Map(owned.map(c => [c.cardId, c]));
    const used = new Set();
    const slots = FORMATIONS[formation].map((position, i) => {
      const c = byId.get(ids[i]);
      if (!c || c.position !== position || used.has(c.cardId)) return null;
      used.add(c.cardId); return c;
    });
    return { formation, positions: FORMATIONS[formation], rows: FORMATION_ROWS[formation], slots, rating: rating(slots), filled: slots.filter(Boolean).length };
  }

  async function get(userId) {
    if (!db()) return { formations: Object.keys(FORMATIONS), formationRows: FORMATION_ROWS, positionLabels: POSITION_LABELS, lineup: null, cards: [] };
    const owned = await ownedCards(userId);
    return { formations: Object.keys(FORMATIONS), formationRows: FORMATION_ROWS, positionLabels: POSITION_LABELS, lineup: await lineupFor(userId, owned), cards: owned };
  }

  async function save(userId, body) {
    const formation = String(body?.formation || '');
    if (!FORMATIONS[formation]) return fail('Formation inconnue.');
    const slots = Array.isArray(body?.slots) ? body.slots : null;
    if (!slots || slots.length !== 11) return fail('Une équipe compte 11 postes.');
    const owned = await ownedCards(userId), byId = new Map(owned.map(c => [c.cardId, c])), seen = new Set(), clean = [];
    for (let i = 0; i < 11; i++) {
      const id = slots[i];
      if (id === null || id === undefined || id === '') { clean.push(null); continue; }
      const c = byId.get(String(id));
      if (!c) return fail('Tu ne possèdes pas une des cartes choisies.');
      if (c.position !== FORMATIONS[formation][i]) return fail(c.name + ' (' + (POSITION_LABELS[c.position] || c.position) + ') ne peut pas jouer au poste « ' + POSITION_LABELS[FORMATIONS[formation][i]] + ' ».');
      if (seen.has(c.cardId)) return fail(c.name + ' est déjà dans l\'équipe.');
      seen.add(c.cardId); clean.push(c.cardId);
    }
    await db().query(`INSERT INTO team_lineups(user_id,formation,slots) VALUES($1,$2,$3::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET formation=$2,slots=$3::jsonb,updated_at=now()`, [userId, formation, JSON.stringify(clean)]);
    return { ok: true, lineup: await lineupFor(userId, owned) };
  }

  // Équipe visible sur le profil public (null si aucun titulaire).
  async function publicTeam(userId) {
    if (!db()) return null;
    const l = await lineupFor(userId, await ownedCards(userId));
    if (!l.filled) return null;
    return { formation: l.formation, positions: l.positions, rows: l.rows, rating: l.rating, filled: l.filled, players: l.slots.map(c => (c ? { name: c.name, rarity: c.rarity, ovr: c.ovr, position: c.position } : null)) };
  }

  return { get, save, publicTeam };
}

module.exports = { createTeam, FORMATIONS, FORMATION_ROWS, POSITION_LABELS };
