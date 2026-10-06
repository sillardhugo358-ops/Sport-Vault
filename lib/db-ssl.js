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
  let ca = null;
  try { ca = caCertificate(env); }
  catch (e) { console.error('SPORT VAULT TLS : ' + e.message + ' Retour au comportement historique (chiffré sans vérification) ; /api/health annonce databaseTls="invalid".'); }
  if (ca) return { connectionString: withoutSslParams(env.DATABASE_URL), ssl: { ca, rejectUnauthorized: true }, ...extra };
  return { connectionString: env.DATABASE_URL, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, ...extra };
}

// Mode TLS annoncé par /api/health (aucun secret) : « verified » (certificat de l'autorité fourni, identité du serveur vérifiée),
// « unverified » (chiffré sans vérification, comportement historique en production) ou « off » (pas de TLS : développement, tests).
// « invalid » : une valeur est fournie mais n'est pas un PEM exploitable (le service tourne alors en mode historique). Ne lève jamais d'exception.
function tlsMode(env = process.env) {
  try { if (caCertificate(env)) return 'verified'; }
  catch { return 'invalid'; }
  return env.NODE_ENV === 'production' ? 'unverified' : 'off';
}

// Diagnostic sans secret quand le certificat n'est pas pris en compte : longueur de la variable lue (0 = absente ou vide),
// présence d'un fichier, et NOMS (jamais les valeurs) des variables d'environnement proches (faute de frappe, mauvais nom).
function tlsDiagnostic(env = process.env) {
  const names = Object.keys(env).filter(k => /^DATABASE/i.test(k) || /CERT/i.test(k)).sort();
  const raw = String(env.DATABASE_CA_CERT || '');
  return {
    caCertChars: raw.length,
    caFileSet: !!String(env.DATABASE_CA_FILE || '').trim(),
    nearbyNames: names,
    // Forme de la valeur (booléens et comptes seulement, jamais de contenu) : de quoi comprendre un PEM refusé.
    caCertShape: raw ? {
      beginLines: (raw.match(/-----BEGIN [A-Z ]+-----/g) || []).length,
      endLines: (raw.match(/-----END [A-Z ]+-----/g) || []).length,
      certificateBlocks: (raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []).length,
      startsWithDashes: raw.trimStart().startsWith('-----'),
      quoted: /^\s*["']/.test(raw) || /["']\s*$/.test(raw),
      literalBackslashN: raw.includes('\\n'),
      realNewlines: (raw.match(/\n/g) || []).length,
      carriageReturns: raw.includes('\r')
    } : undefined
  };
}

module.exports = { poolConfig, caCertificate, withoutSslParams, tlsMode, tlsDiagnostic };
