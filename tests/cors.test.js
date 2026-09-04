'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAllowedOrigin, applyCorsHeaders, ALLOWED_METHODS, ALLOWED_HEADERS } = require('../src/middleware/cors');

function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
  };
}

test('CORS: production with ALLOWED_ORIGIN set — matching origin is allowed, exact string, never a wildcard', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = 'https://skautotruck.com';
  try {
    const allowed = resolveAllowedOrigin('https://skautotruck.com');
    assert.strictEqual(allowed, 'https://skautotruck.com');
    assert.notStrictEqual(allowed, '*');
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('CORS: production — a DIFFERENT origin than the configured one is rejected', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = 'https://skautotruck.com';
  try {
    const allowed = resolveAllowedOrigin('https://evil-attacker.example');
    assert.strictEqual(allowed, null);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('CORS: production with NO ALLOWED_ORIGIN configured — fails closed (nobody allowed), never falls back to "*"', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOWED_ORIGIN;
  try {
    const allowed = resolveAllowedOrigin('https://skautotruck.com');
    assert.strictEqual(allowed, null);
  } finally {
    delete process.env.NODE_ENV;
  }
});

test('CORS: development with no ALLOWED_ORIGIN — reflects the requesting origin back (never a literal "*")', () => {
  delete process.env.NODE_ENV;
  delete process.env.ALLOWED_ORIGIN;
  const allowed = resolveAllowedOrigin('http://localhost:5173');
  assert.strictEqual(allowed, 'http://localhost:5173');
});

test('CORS: development WITH ALLOWED_ORIGIN explicitly set — honors it exactly, same as production policy', () => {
  process.env.ALLOWED_ORIGIN = 'https://skautotruck.com';
  try {
    assert.strictEqual(resolveAllowedOrigin('https://skautotruck.com'), 'https://skautotruck.com');
    assert.strictEqual(resolveAllowedOrigin('https://someone-else.example'), null);
  } finally {
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('CORS: no Origin header present at all -> no CORS header set (same-origin/non-browser requests unaffected)', () => {
  delete process.env.NODE_ENV;
  delete process.env.ALLOWED_ORIGIN;
  assert.strictEqual(resolveAllowedOrigin(undefined), null);
});

test('applyCorsHeaders: sets Allow-Methods/Allow-Headers always, Allow-Origin + Vary only when an origin is allowed', () => {
  delete process.env.NODE_ENV;
  delete process.env.ALLOWED_ORIGIN;
  const res = fakeRes();
  const allowed = applyCorsHeaders({ headers: { origin: 'http://localhost:3000' } }, res);
  assert.strictEqual(allowed, 'http://localhost:3000');
  assert.strictEqual(res.getHeader('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.strictEqual(res.getHeader('Vary'), 'Origin');
  assert.strictEqual(res.getHeader('Access-Control-Allow-Methods'), ALLOWED_METHODS);
  assert.strictEqual(res.getHeader('Access-Control-Allow-Headers'), ALLOWED_HEADERS);
});

test('applyCorsHeaders: Access-Control-Allow-Credentials is NEVER set (frontend uses Bearer tokens, not cookies)', () => {
  const res = fakeRes();
  applyCorsHeaders({ headers: { origin: 'http://localhost:3000' } }, res);
  assert.strictEqual(res.getHeader('Access-Control-Allow-Credentials'), undefined);
});

test('Allow-Methods includes exactly what the router supports (GET, POST, PATCH) plus OPTIONS, nothing extra', () => {
  assert.strictEqual(ALLOWED_METHODS, 'GET, POST, PATCH, OPTIONS');
});

test('Allow-Headers includes exactly what the frontend actually sends (Content-Type, Authorization)', () => {
  assert.strictEqual(ALLOWED_HEADERS, 'Content-Type, Authorization');
});
