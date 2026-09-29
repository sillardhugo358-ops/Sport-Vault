'use strict';

/*
 * FOOTVAULT security bootstrap.
 * Loaded before server.js so the existing business logic keeps working while
 * every HTTP request receives a common security layer.
 */

const http = require('node:http');

const originalCreateServer = http.createServer;
const buckets = new Map();

const WINDOW_MS = 60_000;
const MAX_API_PER_MINUTE = 180;
const MAX_AUTH_PER_WINDOW = 20;
const MAX_PACK_OPENS_PER_WINDOW = 30;
const MAX_AUCTION_WRITES_PER_WINDOW = 60;

const { clientIp } = require('./lib/client-ip');

function consume(key, limit, windowMs = WINDOW_MS) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.started >= windowMs) bucket = { started: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= limit;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const protocol = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const requestOrigin = `${protocol}://${req.headers.host}`;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function isMutation(req) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '');
}

function applySecurityHeaders(req, res) {
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' || !!req.socket.encrypted;
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'set-cookie') {
      const values = Array.isArray(value) ? value : [value];
      value = values.map(cookie => {
        let out = String(cookie);
        if (/^fv_session=/i.test(out) && secure && !/;\s*Secure/i.test(out)) out += '; Secure';
        if (/^fv_session=/i.test(out) && !/;\s*HttpOnly/i.test(out)) out += '; HttpOnly';
        if (/^fv_session=/i.test(out) && !/;\s*SameSite=/i.test(out)) out += '; SameSite=Lax';
        return out;
      });
      if (!Array.isArray(value)) value = value[0];
    }
    return originalSetHeader(name, value);
  };

  originalSetHeader('X-Content-Type-Options', 'nosniff');
  originalSetHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';");
  originalSetHeader('Cross-Origin-Resource-Policy', 'same-origin');
  originalSetHeader('Origin-Agent-Cluster', '?1');
  originalSetHeader('X-Permitted-Cross-Domain-Policies', 'none');
  originalSetHeader('X-Frame-Options', 'DENY');
  originalSetHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  originalSetHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  originalSetHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (secure) originalSetHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  originalSetHeader('Server', 'FOOTVAULT');
}

function originalApiHeaders(res) {
  try { res.setHeader('Cache-Control', 'no-store'); } catch {}
}

function reject(res, status, message, retryAfter) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  res.writeHead(status, headers);
  res.end(JSON.stringify({ error: message }));
}

http.createServer = function patchedCreateServer(requestListener) {
  return originalCreateServer.call(http, async (req, res) => {
    applySecurityHeaders(req, res);

    const path = new URL(req.url || '/', 'http://local').pathname;
    const ip = clientIp(req);

    if (['TRACE', 'TRACK', 'CONNECT'].includes(req.method)) {
      return reject(res, 405, 'Méthode HTTP non autorisée.');
    }

    if (path.startsWith('/api/')) {
      originalApiHeaders(res);
      if (!consume(`api:${ip}`, MAX_API_PER_MINUTE)) {
        return reject(res, 429, 'Trop de requêtes. Réessaie dans un instant.', 60);
      }

      if (isMutation(req) && !sameOrigin(req)) {
        return reject(res, 403, 'Origine de requête refusée.');
      }

      if (path === '/api/login' || path === '/api/register') {
        if (!consume(`auth:${ip}`, MAX_AUTH_PER_WINDOW, 15 * 60_000)) {
          return reject(res, 429, 'Trop de tentatives. Réessaie plus tard.', 900);
        }
      }

      if (path === '/api/packs/open') {
        if (!consume(`packs:${ip}`, MAX_PACK_OPENS_PER_WINDOW)) {
          return reject(res, 429, 'Trop d’ouvertures de packs en peu de temps.', 60);
        }
      }

      if (path === '/api/auctions/create' || path === '/api/auctions/bid' || path === '/api/auctions/cancel') {
        if (!consume(`auction:${ip}`, MAX_AUCTION_WRITES_PER_WINDOW)) {
          return reject(res, 429, 'Trop d’actions d’enchères en peu de temps.', 60);
        }
      }
    }

    return requestListener(req, res);
  });
};

setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [key, bucket] of buckets) {
    if (bucket.started < cutoff) buckets.delete(key);
  }
}, 5 * 60_000).unref();
