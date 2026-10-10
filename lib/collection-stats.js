'use strict';

// Statistiques de collection (page « Statistiques ») : % complété par compétition et par décennie (selon l'album), répartition par
// rareté et par poste, valeur estimée. La valeur est INDICATIVE : médiane des 20 dernières ventes aux enchères de chaque carte
// (même référence que le marché) ; une carte jamais vendue n'a pas de prix et n'entre pas dans le total.

const { referenceSql } = require('./market');

const RARITIES = ['icon', 'legendary', 'epic', 'rare', 'common'];
const POSITIONS = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'];
const pct = (owned, total) => (total > 0 ? Math.round((owned / total) * 1000) / 10 : 0);
const startYear = s => { const m = /(\d{4})/.exec(String(s || '')); return m ? Number(m[1]) : null; };

function createCollectionStats({ getPool, albumData }) {
  async function stats(userId) {
    const db = getPool();
    if (!db) return { competitions: [], decades: [], rarities: [], positions: [], value: { estimated: 0, priced: 0, unpriced: 0, top: [] }, totals: { cards: 0, unique: 0 } };
    const album = (await albumData(userId)).album;
    const competitions = [], decades = new Map();
    for (const c of album.competitions) {
      let owned = 0, total = 0;
      for (const s of c.seasons) {
        const so = (s.clubs || []).reduce((n, cl) => n + cl.owned, 0), st = (s.clubs || []).reduce((n, cl) => n + cl.total, 0);
        owned += so; total += st;
        const y = startYear(s.season);
        if (y !== null && st > 0) { const d = y - (y % 10), cur = decades.get(d) || { owned: 0, total: 0 }; cur.owned += so; cur.total += st; decades.set(d, cur); }
      }
      if (total > 0) competitions.push({ id: c.id, name: c.name, owned, total, pct: pct(owned, total) });
    }
    const [rar, pos, tot, priced] = await Promise.all([
      db.query("SELECT rarity,count(DISTINCT card_id)::int AS unique_cards,count(*)::int AS copies FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') GROUP BY rarity", [userId]),
      db.query("SELECT upper(position) AS position,count(DISTINCT card_id)::int AS unique_cards FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') GROUP BY upper(position)", [userId]),
      db.query("SELECT count(*)::int AS cards,count(DISTINCT card_id)::int AS uniq FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction')", [userId]),
      db.query(`SELECT x.card_id,x.name,x.rarity,x.copies,${referenceSql('x.card_id')} AS median FROM (
          SELECT card_id,max(name) AS name,max(rarity) AS rarity,count(*)::int AS copies FROM card_instances WHERE owner_id=$1 AND status IN ('owned','auction') GROUP BY card_id) x`, [userId])
    ]);
    const byRar = new Map(rar.rows.map(r => [r.rarity, r])), byPos = new Map(pos.rows.map(r => [r.position, r.unique_cards]));
    const rows = priced.rows.map(r => ({ cardId: r.card_id, name: r.name, rarity: r.rarity, copies: r.copies, price: r.median == null ? null : Math.round(Number(r.median)) }));
    const withPrice = rows.filter(r => r.price !== null);
    return {
      totals: { cards: tot.rows[0].cards, unique: tot.rows[0].uniq },
      competitions: competitions.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'fr')),
      decades: [...decades.entries()].sort((a, b) => b[0] - a[0]).map(([d, v]) => ({ decade: d, owned: v.owned, total: v.total, pct: pct(v.owned, v.total) })),
      rarities: RARITIES.map(r => ({ rarity: r, unique: byRar.get(r)?.unique_cards || 0, copies: byRar.get(r)?.copies || 0 })),
      positions: [...POSITIONS, ...[...byPos.keys()].filter(p => !POSITIONS.includes(p))].map(p => ({ position: p, unique: byPos.get(p) || 0 })).filter(p => POSITIONS.includes(p.position) || p.unique > 0),
      value: {
        estimated: withPrice.reduce((n, r) => n + r.price * r.copies, 0),
        priced: withPrice.length, unpriced: rows.length - withPrice.length,
        top: withPrice.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name, 'fr')).slice(0, 5)
      }
    };
  }
  return { stats };
}

module.exports = { createCollectionStats };
