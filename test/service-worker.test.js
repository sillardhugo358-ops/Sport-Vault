'use strict';

// sw.js sans navigateur : seule la page hors ligne est servie en cas d'échec réseau, sur une navigation.
// Les autres requêtes (API, scripts) et les réponses du serveur, même en erreur, ne sont jamais remplacées.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load({ fetchImpl, cached = new Map() }) {
  const handlers = {};
  const store = new Map();
  const self = { addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() }, location: { origin: 'http://x' } };
  const caches = {
    open: async () => ({ addAll: async urls => urls.forEach(u => store.set(u, new Response('cache:' + u))), keys: async () => [...store.keys()] }),
    match: async url => (cached.has(url) ? cached.get(url) : null),
    keys: async () => ['fv-offline-v0', 'fv-offline-v1', 'autre'],
    delete: async k => { store.set('deleted:' + k, true); return true; }
  };
  const ctx = vm.createContext({ self, caches, fetch: fetchImpl, Response, URL, Promise, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), ctx);
  return { handlers, store };
}
const run = async (handlers, request) => {
  let out;
  handlers.fetch({ request, respondWith: p => { out = Promise.resolve(p); } });
  return out;
};

test('navigation sans réseau : la page hors ligne en cache est servie', async () => {
  const offline = new Response('hors ligne');
  const { handlers } = load({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')), cached: new Map([['offline.html', offline]]) });
  const res = await run(handlers, { mode: 'navigate', url: 'http://x/' });
  assert.equal(await res.text(), 'hors ligne');
});

test('navigation sans réseau et sans cache : réponse 503 en texte, jamais d\'exception', async () => {
  const { handlers } = load({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
  const res = await run(handlers, { mode: 'navigate', url: 'http://x/' });
  assert.equal(res.status, 503);
});

test('navigation avec réseau : la réponse du serveur est servie telle quelle, même en erreur 503', async () => {
  const server503 = new Response('Base de données en cours de démarrage', { status: 503 });
  const { handlers } = load({ fetchImpl: () => Promise.resolve(server503) });
  const res = await run(handlers, { mode: 'navigate', url: 'http://x/' });
  assert.equal(res, server503);
});

test('requêtes qui ne sont pas des navigations (API, scripts) : jamais interceptées', async () => {
  const { handlers } = load({ fetchImpl: () => Promise.reject(new Error('ne doit pas être appelé')) });
  for (const mode of ['cors', 'no-cors', 'same-origin']) {
    let intercepted = false;
    handlers.fetch({ request: { mode, url: 'http://x/api/me' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, mode);
  }
});

test('installation : seules offline.html et l\'icône sont mises en cache ; les anciens caches fv-offline-* sont supprimés', async () => {
  const { handlers, store } = load({ fetchImpl: () => Promise.resolve(new Response('')) });
  let waited;
  handlers.install({ waitUntil: p => { waited = p; } });
  await waited;
  assert.deepEqual([...store.keys()].filter(k => !k.startsWith('deleted:')).sort(), ['footvault-icon.svg', 'offline.html']);
  handlers.activate({ waitUntil: p => { waited = p; } });
  await waited;
  assert.ok(store.has('deleted:fv-offline-v0'));
  assert.ok(!store.has('deleted:fv-offline-v1'), 'le cache courant est conservé');
  assert.ok(!store.has('deleted:autre'), 'les caches étrangers ne sont pas touchés');
});
