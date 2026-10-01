'use strict';

// Fusion des clubs en double : un même club présent sous plusieurs noms (« LOSC Lille » et
// « Lille OSC », « Angers SCO » et « SCO Angers »…, même clé lib/club-key.js) n'en fait plus qu'un.
//  - Table clubs : un seul club gardé par clé (rattaché à la saison la plus récente, puis avec logo,
//    puis le plus rattaché) ; les rattachements aux compétitions et saisons des doublons lui sont
//    transférés, puis les doublons sont supprimés.
//  - Cartes du catalogue, exemplaires des joueurs, packs et pools : le nom du club gardé partout.
// Rien n'est perdu : chaque club supprimé (avec ses rattachements) et chaque renommage sont
// enregistrés dans club_merge_backup (annulation possible à la main).

const { clubKey } = require('./club-key');

async function mergeDuplicateClubs(client, migrationId) {
  await client.query('CREATE TABLE IF NOT EXISTS club_merge_backup(id bigserial PRIMARY KEY,migration_id varchar(120) NOT NULL,kind varchar(20) NOT NULL,data jsonb NOT NULL,saved_at timestamptz NOT NULL DEFAULT now())');
  const save = (kind, data) => client.query('INSERT INTO club_merge_backup(migration_id,kind,data) VALUES($1,$2,$3)', [migrationId, kind, JSON.stringify(data)]);

  const clubs = (await client.query(`SELECT c.*,
      (SELECT max(cs.season) FROM season_clubs sc JOIN competition_seasons cs ON cs.id=sc.season_id WHERE sc.club_id=c.id) AS last_season,
      (SELECT count(*)::int FROM season_clubs sc WHERE sc.club_id=c.id) AS links
    FROM clubs c`)).rows;
  const groups = new Map();
  for (const c of clubs) {
    const k = clubKey(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const keep = new Map(); // clé -> nom gardé
  let removed = 0;
  for (const [k, list] of groups) {
    list.sort((a, b) => String(b.last_season || '').localeCompare(String(a.last_season || ''))
      || Number(!!b.logo_url) - Number(!!a.logo_url) || b.links - a.links || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    const [main, ...dups] = list;
    keep.set(k, main.name);
    for (const d of dups) {
      const comps = (await client.query('SELECT * FROM competition_clubs WHERE club_id=$1', [d.id])).rows;
      const seasons = (await client.query('SELECT * FROM season_clubs WHERE club_id=$1', [d.id])).rows;
      const { last_season, links, ...row } = d;
      await save('club', { club: row, mergedInto: main.id, competitionClubs: comps, seasonClubs: seasons });
      await client.query('INSERT INTO competition_clubs(competition_id,club_id,position) SELECT competition_id,$2,position FROM competition_clubs WHERE club_id=$1 ON CONFLICT DO NOTHING', [d.id, main.id]);
      await client.query('INSERT INTO season_clubs(season_id,club_id,position) SELECT season_id,$2,position FROM season_clubs WHERE club_id=$1 ON CONFLICT DO NOTHING', [d.id, main.id]);
      if (!main.logo_url && d.logo_url) await client.query('UPDATE clubs SET logo_url=$2,updated_at=now() WHERE id=$1', [main.id, d.logo_url]);
      await client.query('DELETE FROM clubs WHERE id=$1', [d.id]); // rattachements supprimés en cascade
      removed++;
    }
  }

  // Noms de club des cartes : celui du club gardé ; sans club en table, le nom le plus porté.
  const names = (await client.query('SELECT club, count(*)::int AS n FROM catalog_cards WHERE club<>\'\' GROUP BY club')).rows;
  const byKey = new Map();
  for (const r of names) {
    const k = clubKey(r.club);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const renames = new Map();
  for (const [k, list] of byKey) {
    const target = keep.get(k) || list.slice().sort((a, b) => b.n - a.n || a.club.localeCompare(b.club))[0].club;
    for (const r of list) if (r.club !== target) renames.set(r.club, target);
  }
  let cards = 0, instances = 0;
  for (const [from, to] of renames) {
    const a = await client.query('UPDATE catalog_cards SET club=$2,updated_at=now() WHERE club=$1', [from, to]);
    const b = await client.query('UPDATE card_instances SET club=$2 WHERE club=$1', [from, to]);
    await save('rename', { from, to, catalogCards: a.rowCount, cardInstances: b.rowCount });
    cards += a.rowCount; instances += b.rowCount;
  }

  // Packs (conditions.clubs) et pools (config.club) qui citent un ancien nom.
  const rename = n => renames.get(n) || n;
  for (const p of (await client.query("SELECT id,conditions FROM pack_definitions WHERE conditions ? 'clubs'")).rows) {
    const list = Array.isArray(p.conditions.clubs) ? p.conditions.clubs : [];
    const next = [...new Set(list.map(rename))];
    if (JSON.stringify(next) === JSON.stringify(list)) continue;
    await save('pack', { id: p.id, conditions: p.conditions });
    await client.query('UPDATE pack_definitions SET conditions=$2 WHERE id=$1', [p.id, JSON.stringify({ ...p.conditions, clubs: next })]);
  }
  for (const p of (await client.query("SELECT id,config FROM pack_pools WHERE config ? 'club'")).rows) {
    if (rename(p.config.club) === p.config.club) continue;
    await save('pool', { id: p.id, config: p.config });
    await client.query('UPDATE pack_pools SET config=$2 WHERE id=$1', [p.id, JSON.stringify({ ...p.config, club: rename(p.config.club) })]);
  }
  return { removed, renamed: renames.size, cards, instances, renames };
}

module.exports = { mergeDuplicateClubs };
