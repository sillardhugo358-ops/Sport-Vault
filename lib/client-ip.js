'use strict';

// Adresse IP du client, utilisée pour les limites (inscription, connexion,
// débit). Les en-têtes de proxy se falsifient facilement : un client peut
// envoyer son propre X-Forwarded-For, que les proxys complètent par la droite.
//
// Réglages (variables d'environnement) :
// - CLIENT_IP_HEADER : en-tête posé par le proxy de l'hébergeur et que le
//   client ne peut pas imposer (ex. true-client-ip). Prioritaire.
// - TRUSTED_PROXY_HOPS : nombre de proxys de confiance devant l'application.
//   L'IP retenue est alors la N-ième en partant de la droite de
//   X-Forwarded-For, partie que le client ne contrôle pas.
// Sans réglage : première valeur de X-Forwarded-For (ancien comportement,
// falsifiable). Voir /api/admin/ip-debug pour choisir le bon réglage.

function headerValue(req, name) {
  const v = req.headers[name.toLowerCase()];
  return String(Array.isArray(v) ? v[0] : v || '').trim();
}

function forwardedChain(req) {
  return headerValue(req, 'x-forwarded-for').split(',').map(x => x.trim()).filter(Boolean);
}

function clientIp(req, env = process.env) {
  const socket = req.socket?.remoteAddress || 'unknown';
  const header = String(env.CLIENT_IP_HEADER || '').trim();
  if (header) return headerValue(req, header) || socket;
  const chain = forwardedChain(req);
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS, 10);
  if (Number.isInteger(hops) && hops > 0) {
    // Moins d'entrées que de proxys attendus : requête qui n'est pas passée
    // par toute la chaîne ; on garde l'entrée la plus à gauche disponible.
    return chain[Math.max(0, chain.length - hops)] || socket;
  }
  return chain[0] || headerValue(req, 'x-real-ip') || socket;
}

// Ce que voit le serveur, pour choisir le réglage (route admin de diagnostic).
function ipDiagnostics(req, env = process.env) {
  const names = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'forwarded', 'x-forwarded-proto'];
  return {
    resolvedIp: clientIp(req, env),
    config: { CLIENT_IP_HEADER: env.CLIENT_IP_HEADER || null, TRUSTED_PROXY_HOPS: env.TRUSTED_PROXY_HOPS || null },
    socketAddress: req.socket?.remoteAddress || null,
    forwardedChain: forwardedChain(req),
    headers: Object.fromEntries(names.map(n => [n, req.headers[n] ?? null]))
  };
}

module.exports = { clientIp, ipDiagnostics };
