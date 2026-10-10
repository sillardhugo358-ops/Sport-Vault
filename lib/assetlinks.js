'use strict';

// Digital Asset Links : lie le site à l'application Android (Trusted Web Activity, dossier android/) pour qu'elle s'ouvre en plein
// écran, sans barre d'adresse. L'empreinte SHA-256 du certificat de signature est publique (ce n'est pas un secret) ; la clé privée,
// elle, ne doit jamais être dans le dépôt. ANDROID_CERT_SHA256 (séparées par des virgules) remplace l'empreinte par défaut,
// par exemple après un changement de clé de signature.

const PACKAGE = 'com.footvault.app';
const DEFAULT_FINGERPRINT = '9E:09:08:30:04:4D:C7:1A:D4:86:59:9E:48:79:AE:0B:7B:7C:8E:C0:29:C2:71:4F:88:99:4B:98:44:74:02:E6';

const valid = f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f);

function assetLinks(env = process.env) {
  const list = String(env.ANDROID_CERT_SHA256 || DEFAULT_FINGERPRINT).split(',').map(s => s.trim().toUpperCase()).filter(valid);
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: list } }];
}

module.exports = { assetLinks, PACKAGE, DEFAULT_FINGERPRINT };
