'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-errorHandling.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });
process.env.PORT = '0'; // ephemeral port

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });

let server, baseUrl;

before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* leave null */ }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('6. Invalid Request -> BLOCK (missing Authorization header)', async () => {
  const res = await request('GET', '/api/stock');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'AUTH_ERROR');
});

test('6b. Invalid Request -> BLOCK (bad credentials on login)', async () => {
  const res = await request('POST', '/api/auth/login', { body: { username: 'staff1', password: 'wrong-password' } });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'AUTH_ERROR');
});

test('Valid login succeeds and returns a usable session token', async () => {
  const res = await request('POST', '/api/auth/login', { body: { username: 'staff1', password: 'pw12345' } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.session_token);
  assert.strictEqual(res.body.role, 'staff');
});

test('6c. Invalid Request -> BLOCK (invalid truck data rejected with VALIDATION_ERROR, not a crash)', async () => {
  const login = await request('POST', '/api/auth/login', { body: { username: 'staff1', password: 'pw12345' } });
  const res = await request('POST', '/api/stock', {
    token: login.body.session_token,
    body: { truck_id: 'TRK-BAD', price: -1, down_payment: 0, installment_amount: 0, installment_count: 12 },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('15. Error responses never leak internal `details` or secret-shaped fields to the client', async () => {
  const login = await request('POST', '/api/auth/login', { body: { username: 'staff1', password: 'pw12345' } });
  const res = await request('POST', '/api/stock', {
    token: login.body.session_token,
    body: { truck_id: 'TRK-BAD', price: -1, down_payment: 0, installment_amount: 0, installment_count: 12 },
  });
  assert.strictEqual('details' in res.body.error, false, 'client-facing error must not include internal details');
  assert.strictEqual(res.raw.includes('password_hash'), false);
  assert.strictEqual(res.raw.toLowerCase().includes('secret'), false);
});

test('15b. Login response never returns the password hash or salt', async () => {
  const res = await request('POST', '/api/auth/login', { body: { username: 'staff1', password: 'pw12345' } });
  assert.strictEqual('password_hash' in res.body, false);
  assert.strictEqual('password_salt' in res.body, false);
  assert.strictEqual(res.raw.includes('password_hash'), false);
});
