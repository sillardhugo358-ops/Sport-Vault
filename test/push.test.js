'use strict';

// Notifications push : abonnement (droits, service reconnu), chiffrement RFC 8291 lu par un « navigateur » de test, signature VAPID,
// seules les notifications retenues et postérieures à l'abonnement sont envoyées, abonnement expiré (410) supprimé, une seule fois.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { generateVapidKeys } = require('../lib/push');
const { startServer, newPlayer, client } = require('./helpers');

const vapid = generateVapidKeys();
let server, p, push, received = [], mode = 201;
const q = async (sql, params) => (await server.db.query(sql, params)).rows;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64u = b => Buffer.from(b).toString('base64url');

// Le « navigateur » : sa paire de clés et son secret, comme dans pushManager.subscribe().
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);

function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPublic), uaPublic = ua.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'délimiteur de remplissage');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}
function verifyVapid(header, endpointOrigin) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, 'en-tête VAPID');
  assert.equal(m[2], vapid.publicKey);
  const [h, b, s] = m[1].split('.');
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + b), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'signature ES256');
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.equal(claims.aud, endpointOrigin);
  assert.ok(claims.exp > Date.now() / 1000);
}

test.before(async () => {
  push = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = mode; res.end(); });
  });
  await new Promise(r => push.listen(0, '127.0.0.1', r));
  server = await startServer({ env: { NODE_ENV: 'test', VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_POLL_MS: '150' } });
  p = await newPlayer(server, 'Abonne');
});
test.after(async () => { push.close(); await server.stop?.(); });

const endpoint = () => 'http://127.0.0.1:' + push.address().port + '/send/abc';
const sub = () => ({ endpoint: endpoint(), keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(authSecret) } });
const notif = (kind, title, link = '#trades') => q('INSERT INTO notifications(user_id,kind,title,body,link) VALUES($1,$2,$3,$4,$5) RETURNING id', [p.user.id, kind, title, 'Corps', link]);

test('configuration publique : clé VAPID, jamais la clé privée', async () => {
  const r = await client(server).get('/api/push/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.publicKey, vapid.publicKey);
  assert.ok(!JSON.stringify(r.body).includes(vapid.privateKey));
});

test('abonnement : connexion requise, service reconnu, clés valides', async () => {
  assert.equal((await client(server).post('/api/push/subscribe', sub())).status, 401);
  assert.equal((await p.post('/api/push/subscribe', { ...sub(), endpoint: 'https://evil.example.com/x' })).status, 400, 'hôte inconnu');
  assert.equal((await p.post('/api/push/subscribe', { ...sub(), endpoint: 'http://169.254.169.254/latest' })).status, 400, 'adresse interne');
  assert.equal((await p.post('/api/push/subscribe', { ...sub(), keys: { p256dh: 'abc', auth: 'def' } })).status, 400, 'clés invalides');
  assert.equal((await q('SELECT count(*)::int AS n FROM push_subscriptions'))[0].n, 0);
});

test('envoi : message chiffré lisible par le navigateur, signature VAPID, une seule fois, seulement les types retenus', async () => {
  await notif('outbid', 'Avant abonnement');            // créée avant l'abonnement : jamais envoyée
  await sleep(50);
  assert.equal((await p.post('/api/push/subscribe', sub())).status, 200);
  await sleep(50);
  await notif('price_alert', 'Type non retenu');          // pas dans la liste du push
  await notif('outbid', 'Tu as été surenchéri', '#market');
  for (let i = 0; i < 40 && !received.length; i++) await sleep(100);
  await sleep(500);                                       // laisse passer d'autres tours de boucle : pas de doublon
  assert.equal(received.length, 1, JSON.stringify(received.map(r => r.url)));
  const r = received[0];
  assert.equal(r.headers['content-encoding'], 'aes128gcm');
  assert.equal(r.headers.ttl, '86400');
  verifyVapid(r.headers.authorization, 'http://127.0.0.1:' + push.address().port);
  const msg = decrypt(r.body);
  assert.equal(msg.title, 'Tu as été surenchéri');
  assert.equal(msg.url, '/#market');
  assert.match(msg.tag, /^outbid-\d+$/);
});

test('abonnement expiré (410) : supprimé ; désabonnement ; limite de 5 appareils', async () => {
  received = []; mode = 410;
  await notif('trade_offer', 'Offre d’échange');
  for (let i = 0; i < 40 && !received.length; i++) await sleep(100);
  await sleep(300);
  assert.equal((await q('SELECT count(*)::int AS n FROM push_subscriptions'))[0].n, 0, 'abonnement 410 retiré');
  mode = 201;
  for (let i = 0; i < 7; i++) assert.equal((await p.post('/api/push/subscribe', { ...sub(), endpoint: endpoint() + i })).status, 200);
  assert.equal((await q('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1', [p.user.id]))[0].n, 5);
  assert.equal((await p.post('/api/push/unsubscribe', { endpoint: endpoint() + '6' })).status, 200);
  assert.equal((await q('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1', [p.user.id]))[0].n, 4);
});
