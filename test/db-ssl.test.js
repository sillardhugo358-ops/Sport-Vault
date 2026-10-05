'use strict';

// Connexion TLS à PostgreSQL (lib/db-ssl.js) : comportement historique par défaut, vérification complète avec le certificat de l'autorité.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { poolConfig, caCertificate, withoutSslParams } = require('../lib/db-ssl');

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUTESTTESTTESTTESTTESTTEST\n-----END CERTIFICATE-----\n';
const URL_NO_VERIFY = 'postgresql://u:p%40ss@db.example.com:12345/app?sslmode=no-verify';

test('sans certificat : comportement inchangé (production = chiffré sans vérification, sinon rien)', () => {
  const prod = poolConfig({ max: 5 }, { DATABASE_URL: URL_NO_VERIFY, NODE_ENV: 'production' });
  assert.deepEqual(prod, { connectionString: URL_NO_VERIFY, ssl: { rejectUnauthorized: false }, max: 5 });
  const dev = poolConfig({}, { DATABASE_URL: 'postgresql://localhost/x' });
  assert.equal(dev.ssl, undefined);
  assert.equal(dev.connectionString, 'postgresql://localhost/x');
});

test('avec DATABASE_CA_CERT : vérification complète, sslmode retiré de l\'adresse, options conservées', () => {
  const c = poolConfig({ max: 1, connectionTimeoutMillis: 2000 }, { DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: PEM, NODE_ENV: 'production' });
  assert.deepEqual(c.ssl, { ca: PEM.trim(), rejectUnauthorized: true });
  assert.equal(c.connectionString, 'postgresql://u:p%40ss@db.example.com:12345/app');
  assert.equal(c.max, 1);
  assert.equal(c.connectionTimeoutMillis, 2000);
  // Aussi hors production : le certificat fourni est toujours vérifié.
  assert.equal(poolConfig({}, { DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: PEM }).ssl.rejectUnauthorized, true);
});

test('certificat : « \\n » littéraux acceptés, fichier PEM, valeur invalide refusée avec un message clair', () => {
  assert.equal(caCertificate({ DATABASE_CA_CERT: PEM.trim().replace(/\n/g, '\\n') }), PEM.trim());
  const file = path.join(os.tmpdir(), 'fv-ca-' + process.pid + '.pem');
  fs.writeFileSync(file, PEM);
  try { assert.equal(caCertificate({ DATABASE_CA_FILE: file }), PEM); } finally { fs.unlinkSync(file); }
  assert.equal(caCertificate({}), null);
  assert.throws(() => caCertificate({ DATABASE_CA_CERT: 'pas un certificat' }), /certificat PEM invalide/);
  assert.throws(() => poolConfig({}, { DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: 'xxx' }), /certificat PEM invalide/);
});

test('adresse : seuls les paramètres TLS sont retirés', () => {
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?sslmode=require'), 'postgresql://u:p@h:1/d');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?sslmode=require&application_name=fv'), 'postgresql://u:p@h:1/d?application_name=fv');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?application_name=fv&sslmode=no-verify'), 'postgresql://u:p@h:1/d?application_name=fv');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?uselibpqcompat=true&sslmode=require&connect_timeout=5'), 'postgresql://u:p@h:1/d?connect_timeout=5');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d'), 'postgresql://u:p@h:1/d');
});
