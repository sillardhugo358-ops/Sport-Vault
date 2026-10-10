'use strict';

// Journal des FOOTCOINS : une ligne par mouvement de solde (gain ou dépense), écrite dans la
// même transaction que le mouvement. Sert au tableau de bord économique et aux audits.
// Les soldes antérieurs à sa création (30/09/2026) n'y figurent pas.

const REASONS = ['signup', 'reward', 'pack', 'pool', 'auction_buy', 'auction_sale', 'admin', 'quick_sell'];

async function recordCoins(db, userId, amount, reason, ref = null) {
  const n = Math.trunc(Number(amount) || 0);
  if (!db || !n) return;
  if (!REASONS.includes(reason)) throw new Error('Motif de journal inconnu : ' + reason);
  await db.query('INSERT INTO coin_ledger(user_id,amount,reason,ref) VALUES($1,$2,$3,$4)', [userId, n, reason, ref == null ? null : String(ref).slice(0, 120)]);
}

module.exports = { recordCoins, LEDGER_REASONS: REASONS };
