'use strict';

// Connexion TLS à PostgreSQL (lib/db-ssl.js) : comportement historique par défaut, vérification complète avec le certificat de l'autorité.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { poolConfig, caCertificate, withoutSslParams, tlsMode, tlsDiagnostic } = require('../lib/db-ssl');

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
  // Un PEM invalide ne doit jamais empêcher le démarrage : retour au comportement historique (annoncé « invalid » par /api/health).
  const quiet = console.error; console.error = () => {};
  try {
    const c = poolConfig({ max: 2 }, { DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: 'xxx', NODE_ENV: 'production' });
    assert.deepEqual(c, { connectionString: URL_NO_VERIFY, ssl: { rejectUnauthorized: false }, max: 2 });
  } finally { console.error = quiet; }
});

test('adresse : seuls les paramètres TLS sont retirés', () => {
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?sslmode=require'), 'postgresql://u:p@h:1/d');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?sslmode=require&application_name=fv'), 'postgresql://u:p@h:1/d?application_name=fv');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?application_name=fv&sslmode=no-verify'), 'postgresql://u:p@h:1/d?application_name=fv');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d?uselibpqcompat=true&sslmode=require&connect_timeout=5'), 'postgresql://u:p@h:1/d?connect_timeout=5');
  assert.equal(withoutSslParams('postgresql://u:p@h:1/d'), 'postgresql://u:p@h:1/d');
});

test('mode TLS annoncé : verified avec le certificat, unverified en production sans certificat, off ailleurs', () => {
  assert.equal(tlsMode({ DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: PEM, NODE_ENV: 'production' }), 'verified');
  assert.equal(tlsMode({ DATABASE_URL: URL_NO_VERIFY, NODE_ENV: 'production' }), 'unverified');
  assert.equal(tlsMode({ DATABASE_URL: 'postgresql://localhost/x' }), 'off');
  assert.equal(tlsMode({ DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERT: 'pas un certificat', NODE_ENV: 'production' }), 'invalid', 'valeur fournie mais inexploitable : jamais d\'exception');
});

test('diagnostic TLS : longueur et noms seulement, jamais de valeur', () => {
  const d = tlsDiagnostic({ DATABASE_URL: URL_NO_VERIFY, DATABASE_CA_CERTIFICATE: PEM, DATABASE_CA_CERT: '', OTHER: 'x', RENDER_CERT_X: 'y' });
  assert.equal(d.caCertChars, 0);
  assert.equal(d.caFileSet, false);
  assert.deepEqual(d.nearbyNames, ['DATABASE_CA_CERT', 'DATABASE_CA_CERTIFICATE', 'DATABASE_URL', 'RENDER_CERT_X']);
  assert.ok(!JSON.stringify(d).includes('postgresql://') && !JSON.stringify(d).includes('BEGIN CERTIFICATE'));
  assert.equal(tlsDiagnostic({ DATABASE_CA_CERT: PEM }).caCertChars, PEM.length);
});

test('diagnostic d\'un PEM refusé : forme de la valeur (comptes et booléens), jamais son contenu', () => {
  const secret = 'MIIBsecretsecretsecret';
  const cases = {
    corpsSeul: secret,
    entouréDeGuillemets: '"' + PEM + '"',
    enTeteSeule: '-----BEGIN CERTIFICATE-----\n' + secret,
    unBlocComplet: PEM
  };
  const shapes = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, tlsDiagnostic({ DATABASE_CA_CERT: v }).caCertShape]));
  assert.equal(shapes.corpsSeul.certificateBlocks, 0); assert.equal(shapes.corpsSeul.startsWithDashes, false);
  assert.equal(shapes.entouréDeGuillemets.quoted, true); assert.equal(shapes.entouréDeGuillemets.certificateBlocks, 1);
  assert.equal(shapes.enTeteSeule.beginLines, 1); assert.equal(shapes.enTeteSeule.endLines, 0); assert.equal(shapes.enTeteSeule.certificateBlocks, 0);
  assert.equal(shapes.unBlocComplet.certificateBlocks, 1); assert.equal(shapes.unBlocComplet.realNewlines, 3);
  assert.equal(tlsDiagnostic({ DATABASE_CA_CERT: PEM.replace(/\n/g, '\\n') }).caCertShape.literalBackslashN, true);
  assert.equal(tlsDiagnostic({}).caCertShape, undefined);
  for (const v of Object.values(cases)) assert.ok(!JSON.stringify(tlsDiagnostic({ DATABASE_CA_CERT: v })).includes(secret), 'aucun contenu exposé');
});
