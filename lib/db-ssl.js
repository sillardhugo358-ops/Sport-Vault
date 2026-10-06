'use strict';

// Connexion TLS à PostgreSQL (Aiven en production).
//
// Sans réglage : comportement historique, connexion chiffrée en production sans vérifier le certificat
// du serveur (`rejectUnauthorized:false`, équivalent de `?sslmode=no-verify`).
//
// Avec le certificat de l'autorité d'Aiven (« CA certificate » du service, public) : vérification
// complète du certificat et du nom du serveur. Réglage, au choix :
//   - DATABASE_CA_CERT : contenu PEM du certificat (les « \n » littéraux sont acceptés) ;
//   - DATABASE_CA_FILE : chemin d'un fichier PEM.
// Le paramètre `sslmode` de l'adresse est alors retiré : node-postgres le lit après les options du code et
// écraserait le certificat fourni. Retour arrière : supprimer DATABASE_CA_CERT / DATABASE_CA_FILE.

const fs = require('node:fs');

function caCertificate(env = process.env) {
  const inline = String(env.DATABASE_CA_CERT || '').trim();
  const file = String(env.DATABASE_CA_FILE || '').trim();
  const pem = inline ? inline.replace(/\\n/g, '\n') : file ? fs.readFileSync(file, 'utf8') : '';
  if (!pem) return null;
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem)) {
    throw new Error('DATABASE_CA_CERT / DATABASE_CA_FILE : certificat PEM invalide (attendu : -----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----).');
  }
  return pem;
}

// Retire de l'adresse les paramètres TLS (sslmode, sslrootcert, uselibpqcompat…) qui primeraient sur nos options.
function withoutSslParams(url) {
  const text = String(url || ''), q = text.indexOf('?');
  if (q < 0) return text;
  const kept = text.slice(q + 1).split('&').filter(p => p && !/^(ssl[a-z]*|uselibpqcompat)(=|$)/i.test(p));
  return text.slice(0, q) + (kept.length ? '?' + kept.join('&') : '');
}

// Options de new Pool({...}) : adresse, TLS et réglages propres à chaque usage (max, délais…).
function poolConfig(extra = {}, env = process.env) {
  const ca = caCertificate(env);
  if (ca) return { connectionString: withoutSslParams(env.DATABASE_URL), ssl: { ca, rejectUnauthorized: true }, ...extra };
  return { connectionString: env.DATABASE_URL, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, ...extra };
}

// Mode TLS annoncé par /api/health (aucun secret) : « verified » (certificat de l'autorité fourni, identité du serveur vérifiée),
// « unverified » (chiffré sans vérification, comportement historique en production) ou « off » (pas de TLS : développement, tests).
function tlsMode(env = process.env) {
  if (caCertificate(env)) return 'verified';
  return env.NODE_ENV === 'production' ? 'unverified' : 'off';
}

// Diagnostic sans secret quand le certificat n'est pas pris en compte : longueur de la variable lue (0 = absente ou vide),
// présence d'un fichier, et NOMS (jamais les valeurs) des variables d'environnement proches (faute de frappe, mauvais nom).
function tlsDiagnostic(env = process.env) {
  const names = Object.keys(env).filter(k => /^DATABASE/i.test(k) || /CERT/i.test(k)).sort();
  return {
    caCertChars: String(env.DATABASE_CA_CERT || '').length,
    caFileSet: !!String(env.DATABASE_CA_FILE || '').trim(),
    nearbyNames: names
  };
}

module.exports = { poolConfig, caCertificate, withoutSslParams, tlsMode, tlsDiagnostic };
