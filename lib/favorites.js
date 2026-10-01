'use strict';

// Cartes favorites (vitrine du Profil) : jusqu'à MAX_FAVORITES exemplaires choisis par le joueur.
// Un favori désigne un exemplaire (card_instances.instance_id). Une carte qui n'est plus au joueur
// (vendue, transférée) n'est plus affichée ; les cartes en vente aux enchères restent visibles.

const MAX_FAVORITES = 5;

function createFavorites({ getPool, publicCard }) {
  async function listFavorites(userId) {
    if (!getPool()) return [];
    const r = await getPool().query(`SELECT ci.* FROM favorite_cards f
      JOIN card_instances ci ON ci.instance_id=f.instance_id
      WHERE f.user_id=$1 AND ci.owner_id=$1 AND ci.status IN ('owned','auction')
      ORDER BY f.created_at, f.instance_id LIMIT $2`, [userId, MAX_FAVORITES]);
    return r.rows.map(publicCard);
  }

  async function setFavorite(userId, instanceId, favorite) {
    if (!getPool()) return { error: 'Favoris indisponibles.', status: 503 };
    instanceId = String(instanceId || '');
    if (!/^[0-9a-f-]{36}$/i.test(instanceId)) return { error: 'Carte introuvable.', status: 404 };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // Verrou par joueur : la limite tient même avec des requêtes simultanées.
      await client.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId]);
      // Les exemplaires qui ne sont plus au joueur ne comptent plus (et sont retirés).
      await client.query(`DELETE FROM favorite_cards f USING card_instances ci
        WHERE f.user_id=$1 AND ci.instance_id=f.instance_id AND (ci.owner_id<>$1 OR ci.status NOT IN ('owned','auction'))`, [userId]);
      if (!favorite) {
        await client.query('DELETE FROM favorite_cards WHERE user_id=$1 AND instance_id=$2', [userId, instanceId]);
      } else {
        const card = (await client.query("SELECT 1 FROM card_instances WHERE instance_id=$1 AND owner_id=$2 AND status IN ('owned','auction')", [instanceId, userId])).rowCount;
        if (!card) { await client.query('ROLLBACK'); return { error: 'Carte introuvable dans ta collection.', status: 404 }; }
        const exists = (await client.query('SELECT 1 FROM favorite_cards WHERE user_id=$1 AND instance_id=$2', [userId, instanceId])).rowCount;
        if (!exists) {
          const n = Number((await client.query('SELECT count(*)::int AS n FROM favorite_cards WHERE user_id=$1', [userId])).rows[0].n);
          if (n >= MAX_FAVORITES) { await client.query('ROLLBACK'); return { error: `Tu as déjà ${MAX_FAVORITES} cartes favorites : retires-en une pour en ajouter une autre.`, status: 400 }; }
          await client.query('INSERT INTO favorite_cards(user_id,instance_id) VALUES($1,$2)', [userId, instanceId]);
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    return { ok: true, favorites: await listFavorites(userId) };
  }

  return { listFavorites, setFavorite };
}

module.exports = { createFavorites, MAX_FAVORITES };
