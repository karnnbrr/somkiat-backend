'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAllowedOrigin } = require('../src/middleware/cors');

const ADMIN_ORIGIN = 'https://skautotrucks.karnnnbrr.workers.dev';
const PUBLIC_ORIGIN = 'https://www.skautotruck.com';

test('Multi-origin: both real deployed frontends are allowed in production when comma-separated', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = `${ADMIN_ORIGIN},${PUBLIC_ORIGIN}`;
  try {
    assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), ADMIN_ORIGIN);
    assert.strictEqual(resolveAllowedOrigin(PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Multi-origin: a third, unlisted origin is still rejected — the list is exact-match, not permissive', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = `${ADMIN_ORIGIN},${PUBLIC_ORIGIN}`;
  try {
    assert.strictEqual(resolveAllowedOrigin('https://evil-attacker.example'), null);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Trailing slash in configured ALLOWED_ORIGIN is stripped — a common real-world paste mistake must not silently break CORS', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = `${ADMIN_ORIGIN}/,${PUBLIC_ORIGIN}/`; // pasted exactly as the user gave them, with trailing slashes
  try {
    assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), ADMIN_ORIGIN);
    assert.strictEqual(resolveAllowedOrigin(PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Whitespace around comma-separated entries is tolerated ("origin1, origin2")', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = ` ${ADMIN_ORIGIN} , ${PUBLIC_ORIGIN} `;
  try {
    assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), ADMIN_ORIGIN);
    assert.strictEqual(resolveAllowedOrigin(PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Single-origin configuration (backward compatible, no comma) still works exactly as before', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = ADMIN_ORIGIN;
  try {
    assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), ADMIN_ORIGIN);
    assert.strictEqual(resolveAllowedOrigin(PUBLIC_ORIGIN), null); // not in the (single-item) list
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Multi-origin also applies in non-production when ALLOWED_ORIGIN is explicitly set (rehearsing prod policy locally)', () => {
  process.env.ALLOWED_ORIGIN = `${ADMIN_ORIGIN},${PUBLIC_ORIGIN}`;
  try {
    assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), ADMIN_ORIGIN);
    assert.strictEqual(resolveAllowedOrigin('https://not-in-the-list.example'), null);
  } finally {
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('No ALLOWED_ORIGIN configured at all in production -> fails closed for every origin, never a wildcard', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOWED_ORIGIN;
  assert.strictEqual(resolveAllowedOrigin(ADMIN_ORIGIN), null);
  assert.strictEqual(resolveAllowedOrigin(PUBLIC_ORIGIN), null);
  delete process.env.NODE_ENV;
});
