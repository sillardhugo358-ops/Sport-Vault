'use strict';

// Notifications push (Web Push, RFC 8030 / 8291 / 8292) : aucune dépendance, tout vient de node:crypto.
// Seules quelques notifications de la cloche sont envoyées (PUSH_KINDS). Pas d'e-mail, jamais.
// Les clés VAPID viennent de l'environnement (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) : sans elles, le push est désactivé.
// Envoi : une boucle lit les notifications non encore poussées (colonne pushed_at) APRÈS leur validation en base, les réserve
// (UPDATE ... RETURNING, sûr avec plusieurs instances) puis les envoie ; une notification n'est donc jamais envoyée deux fois.

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const PUSH_KINDS = ['outbid', 'auction_won', 'trade_offer', 'leaderboard_reward', 'friend_request', 'wishlist_auction'];
const MAX_SUBSCRIPTIONS = 5;
const FRESH_MINUTES = 10;
const MAX_FAILURES = 5;
// Services de push des navigateurs : un point d'entrée hors liste est refusé (sinon le serveur pourrait être poussé vers n'importe quelle adresse).
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s || ''), 'base64url');

function vapidConfig(env = process.env) {
  const pub = String(env.VAPID_PUBLIC_KEY || '').trim(), priv = String(env.VAPID_PRIVATE_KEY || '').trim();
  const raw = fromB64u(pub), d = fromB64u(priv);
  if (raw.length !== 65 || raw[0] !== 4 || d.length !== 32) return null;
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  return { publicKey: pub, key, subject: String(env.VAPID_SUBJECT || 'mailto:contact@footvault.invalid') };
}

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return { publicKey: b64u(pub), privateKey: jwk.d };
}

function vapidHeader(cfg, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: cfg.subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + cfg.publicKey;
}

// Chiffrement du message (RFC 8291, aes128gcm) pour la clé publique du navigateur (p256dh) et son secret d'authentification.
function encryptPayload(payload, p256dh, auth) {
  const uaPublic = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Abonnement push invalide.');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

function allowedEndpoint(endpoint, env = process.env) {
  let u; try { u = new URL(String(endpoint)); } catch { return false; }
  if (String(endpoint).length > 600) return false;
  if (env.NODE_ENV === 'test' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(re => re.test(u.hostname));
}

function post(endpoint, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint), lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': body.length }, timeout: 10000 }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end(body);
  });
}

function createPush({ getPool }) {
  const cfg = vapidConfig();
  const enabled = () => !!cfg;

  async function subscribe(userId, body) {
    if (!cfg) return { error: 'Notifications push indisponibles.', status: 503 };
    const endpoint = String(body?.endpoint || ''), p256dh = String(body?.keys?.p256dh || ''), auth = String(body?.keys?.auth || '');
    if (!allowedEndpoint(endpoint)) return { error: 'Service de notification non reconnu.', status: 400 };
    if (fromB64u(p256dh).length !== 65 || fromB64u(auth).length < 16) return { error: 'Abonnement invalide.', status: 400 };
    const db = getPool();
    const mine = (await db.query('SELECT endpoint FROM push_subscriptions WHERE user_id=$1 AND endpoint<>$2 ORDER BY created_at', [userId, endpoint])).rows;
    // Au-delà de 5 appareils, le plus ancien est remplacé.
    for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_SUBSCRIPTIONS - 1)))) await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [old.endpoint]);
    await db.query(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth) VALUES($1,$2,$3,$4)
      ON CONFLICT (endpoint) DO UPDATE SET user_id=$2,p256dh=$3,auth=$4,failures=0,created_at=now()`, [endpoint, userId, p256dh, auth]);
    return { ok: true };
  }
  async function unsubscribe(userId, endpoint) {
    await getPool().query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [String(endpoint || ''), userId]);
    return { ok: true };
  }

  async function sendOne(sub, payload) {
    try {
      const status = await post(sub.endpoint, {
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: vapidHeader(cfg, sub.endpoint)
      }, encryptPayload(payload, sub.p256dh, sub.auth));
      if (status === 404 || status === 410) { await getPool().query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]); return 'gone'; }
      if (status >= 200 && status < 300) return 'ok';
      throw new Error('HTTP ' + status);
    } catch (e) {
      await getPool().query('UPDATE push_subscriptions SET failures=failures+1 WHERE endpoint=$1', [sub.endpoint]);
      await getPool().query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND failures>=$2', [sub.endpoint, MAX_FAILURES]);
      return 'error';
    }
  }

  // Une passe : réserve les notifications récentes des joueurs abonnés (créées après l'abonnement), puis les envoie.
  async function dispatch() {
    if (!cfg || !getPool()) return 0;
    const rows = (await getPool().query(`UPDATE notifications n SET pushed_at=now()
      WHERE n.id IN (SELECT n2.id FROM notifications n2 WHERE n2.pushed_at IS NULL AND n2.kind=ANY($1::text[]) AND n2.created_at > now() - make_interval(mins => $2)
        AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=n2.user_id AND s.created_at <= n2.created_at) ORDER BY n2.id LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING n.id,n.user_id,n.kind,n.title,n.body,n.link`, [PUSH_KINDS, FRESH_MINUTES])).rows;
    let sent = 0;
    for (const n of rows) {
      const subs = (await getPool().query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1', [n.user_id])).rows;
      const payload = { title: n.title, body: n.body, url: n.link ? '/' + (String(n.link).startsWith('#') ? n.link : '#' + n.link) : '/', tag: n.kind + '-' + n.id };
      for (const s of subs) if (await sendOne(s, payload) === 'ok') sent++;
    }
    return sent;
  }
  function start(everyMs = Number(process.env.PUSH_POLL_MS) || 15000) {
    if (!cfg) return null;
    const t = setInterval(() => dispatch().catch(e => console.error('FOOTVAULT push :', e.message)), everyMs);
    t.unref?.();
    return t;
  }
  return { enabled, publicKey: () => cfg?.publicKey || null, subscribe, unsubscribe, dispatch, start };
}

module.exports = { createPush, PUSH_KINDS, generateVapidKeys, encryptPayload, vapidConfig, allowedEndpoint };
