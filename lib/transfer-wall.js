'use strict';

// Mur des transferts : ventes aux enchères terminées, affichées avec les pseudos SEULEMENT pour les joueurs qui l'ont activé (opt-in, désactivé par
// défaut). Réciprocité : un joueur qui n'a pas activé le mur ne le voit pas non plus. Une vente apparaît si le vendeur OU l'acheteur a activé le mur ;
// l'autre partie, si elle n'a pas activé, est « Un collectionneur ». Rien de privé n'est exposé : ni solde, ni e-mail, ni code d'échange, ni id de joueur.

const WALL = { days: 14, limit: 30 };
const fail = (error, status = 400) => ({ error, status });

function createTransferWall({ getPool }) {
  const db = () => getPool();

  async function mine(userId) {
    return !!(await db().query('SELECT wall_visible FROM users WHERE id=$1', [userId])).rows[0]?.wall_visible;
  }

  async function wall(userId) {
    if (!db()) return { optedIn: false, items: [], days: WALL.days };
    const optedIn = await mine(userId);
    if (!optedIn) return { optedIn: false, items: [], days: WALL.days };
    const rows = (await db().query(`SELECT a.id,a.current_bid,a.completed_at,c.name,c.rarity,c.ovr,c.club,c.season,c.position,c.is_limited,c.serial,c.max_supply,
        s.name AS seller_name,s.wall_visible AS seller_on,b.name AS buyer_name,b.wall_visible AS buyer_on
      FROM auctions a JOIN card_instances c ON c.instance_id=a.card_instance_id
      JOIN users s ON s.id=a.seller_id JOIN users b ON b.id=a.current_bidder_id
      WHERE a.status='completed' AND a.current_bidder_id IS NOT NULL AND a.completed_at > now() - ($1 || ' days')::interval
        AND (s.wall_visible OR b.wall_visible) AND s.account_status <> 'banned' AND b.account_status <> 'banned'
      ORDER BY a.completed_at DESC LIMIT $2`, [String(WALL.days), WALL.limit])).rows;
    return {
      optedIn, days: WALL.days,
      items: rows.map(r => ({ id: r.id, price: Number(r.current_bid), at: r.completed_at, card: { name: r.name, rarity: r.rarity, ovr: Number(r.ovr || 0), club: r.club, season: r.season, position: r.position, limited: !!r.is_limited, serial: r.serial, maxSupply: r.max_supply },
        seller: r.seller_on ? r.seller_name : null, buyer: r.buyer_on ? r.buyer_name : null }))
    };
  }

  async function setOptIn(userId, on) {
    if (typeof on !== 'boolean') return fail('Choix invalide.');
    if (!db()) return fail('Indisponible.', 503);
    await db().query('UPDATE users SET wall_visible=$2 WHERE id=$1', [userId, on]);
    return { optedIn: on };
  }

  return { wall, setOptIn };
}

module.exports = { createTransferWall, WALL };
