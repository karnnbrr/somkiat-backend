'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-corsIntegration.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function rawRequest(method, path, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl + path, { method, headers: headers || {} }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('OPTIONS preflight to a real route receives a correct CORS response (204, no body, proper headers)', async () => {
  const res = await rawRequest('OPTIONS', '/api/stock', { headers: { Origin: 'http://localhost:5173' } });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.raw, '');
  assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.strictEqual(res.headers['access-control-allow-methods'], 'GET, POST, PATCH, OPTIONS');
  assert.strictEqual(res.headers['access-control-allow-headers'], 'Content-Type, Authorization');
});

test('Preflight never reaches route handlers/auth — no Authorization header needed for OPTIONS to succeed', async () => {
  // /api/stock normally requires auth; an OPTIONS preflight must succeed anyway.
  const res = await rawRequest('OPTIONS', '/api/stock', { headers: { Origin: 'http://localhost:5173' } });
  assert.strictEqual(res.status, 204);
});

test('Unauthorized origin in production receives no Access-Control-Allow-Origin header (browser will block it)', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = 'https://skautotruck.com';
  try {
    const res = await rawRequest('GET', '/health', { headers: { Origin: 'https://evil-attacker.example' } });
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Configured production origin DOES receive the header, as an exact string, never "*"', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGIN = 'https://skautotruck.com';
  try {
    const res = await rawRequest('GET', '/health', { headers: { Origin: 'https://skautotruck.com' } });
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://skautotruck.com');
    assert.notStrictEqual(res.headers['access-control-allow-origin'], '*');
  } finally {
    delete process.env.NODE_ENV;
    delete process.env.ALLOWED_ORIGIN;
  }
});

test('Existing API behavior is unchanged: login still works exactly as before, same response shape', async () => {
  const res = await rawRequest('POST', '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff1', password: 'pw12345' }),
  });
  const body = JSON.parse(res.raw);
  assert.strictEqual(res.status, 200);
  assert.ok(body.session_token);
  assert.strictEqual(body.role, 'staff');
});

test('Existing API behavior is unchanged: missing auth still returns 401 AUTH_ERROR exactly as before', async () => {
  const res = await rawRequest('GET', '/api/stock');
  assert.strictEqual(res.status, 401);
  const body = JSON.parse(res.raw);
  assert.strictEqual(body.error.code, 'AUTH_ERROR');
});

test('Existing API behavior is unchanged: unknown route still returns 404 exactly as before', async () => {
  const res = await rawRequest('GET', '/api/this-does-not-exist');
  assert.strictEqual(res.status, 404);
});

test('Non-OPTIONS requests without an Origin header (e.g. server-to-server, curl) are unaffected — no CORS header, request still processes normally', async () => {
  const res = await rawRequest('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  assert.strictEqual(JSON.parse(res.raw).status, 'ok');
});
