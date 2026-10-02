'use strict';

// Descriptions des compétitions (migration competition-descriptions-2026-10-02) : complétées une seule fois,
// un texte déjà saisi par un admin n'est jamais écrasé.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await server?.stop(); });

const descriptions = async () => Object.fromEntries((await server.db.query('SELECT id,description FROM competitions')).rows.map(r => [r.id, r.description]));

test('descriptions vides complétées ; texte d\'un admin conservé ; migration jouée une seule fois', async () => {
  const first = await descriptions();
  for (const id of ['premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-des-champions', 'coupe-du-monde', 'ligue-des-nations']) {
    assert.ok(first[id] && first[id].length > 10, id + ' : ' + first[id]);
  }
  // Un admin a modifié une description ; la migration rejouée (ligne retirée) ne l'écrase pas et complète les vides.
  await server.db.query("UPDATE competitions SET description='Mon texte' WHERE id='serie-a'");
  await server.db.query("UPDATE competitions SET description='' WHERE id='la-liga'");
  await server.db.query("DELETE FROM app_migrations WHERE id='competition-descriptions-2026-10-02'");
  await server.restart();
  const second = await descriptions();
  assert.equal(second['serie-a'], 'Mon texte');
  assert.match(second['la-liga'], /Espagne/);
  // Pas rejouée au redémarrage suivant : une description volontairement vidée reste vide.
  await server.db.query("UPDATE competitions SET description='' WHERE id='la-liga'");
  await server.restart();
  assert.equal((await descriptions())['la-liga'], '');
});
