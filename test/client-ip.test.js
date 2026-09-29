'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clientIp } = require('../lib/client-ip');

const req = (headers = {}, remoteAddress = '10.0.0.9') => ({ headers, socket: { remoteAddress } });
// Client qui envoie un faux en-tête ; le proxy ajoute la vraie IP à droite.
const spoofed = req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'true-client-ip': '203.0.113.7' });

test('sans réglage : première valeur de X-Forwarded-For (ancien comportement)', () => {
  assert.equal(clientIp(spoofed, {}), '6.6.6.6');
  assert.equal(clientIp(req({ 'x-real-ip': '198.51.100.2' }), {}), '198.51.100.2');
  assert.equal(clientIp(req(), {}), '10.0.0.9');
});

test('TRUSTED_PROXY_HOPS=1 : la valeur ajoutée par le proxy, pas celle du client', () => {
  assert.equal(clientIp(spoofed, { TRUSTED_PROXY_HOPS: '1' }), '203.0.113.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }), { TRUSTED_PROXY_HOPS: '1' }), '203.0.113.7');
});

test('TRUSTED_PROXY_HOPS=2 : deux proxys (ex. CDN puis répartiteur)', () => {
  const r = req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.64.0.1' });
  assert.equal(clientIp(r, { TRUSTED_PROXY_HOPS: '2' }), '203.0.113.7');
  // Chaîne plus courte que prévu : entrée la plus à gauche disponible.
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }), { TRUSTED_PROXY_HOPS: '2' }), '203.0.113.7');
});

test('CLIENT_IP_HEADER : en-tête du proxy prioritaire', () => {
  assert.equal(clientIp(spoofed, { CLIENT_IP_HEADER: 'True-Client-IP', TRUSTED_PROXY_HOPS: '1' }), '203.0.113.7');
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), { CLIENT_IP_HEADER: 'true-client-ip' }), '10.0.0.9');
});

test('réglage invalide ignoré', () => {
  assert.equal(clientIp(spoofed, { TRUSTED_PROXY_HOPS: 'abc' }), '6.6.6.6');
  assert.equal(clientIp(spoofed, { TRUSTED_PROXY_HOPS: '0' }), '6.6.6.6');
});
