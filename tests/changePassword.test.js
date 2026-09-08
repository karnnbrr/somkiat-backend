'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-changePassword.db');
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
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'oldpass123', role: 'staff' });

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, body, token) {
  return new Promise((resolvePromise, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolvePromise({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('Change password: wrong current password is rejected, nothing changes', async () => {
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'oldpass123' });
  const token = login.body.session_token;
  const res = await request('POST', '/api/auth/change-password', { currentPassword: 'WRONG', newPassword: 'newpass123' }, token);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'AUTH_ERROR');
  // Old password must still work.
  const stillWorks = await request('POST', '/api/auth/login', { username: 'staff1', password: 'oldpass123' });
  assert.strictEqual(stillWorks.status, 200);
});

test('Change password: too-short new password is rejected', async () => {
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'oldpass123' });
  const token = login.body.session_token;
  const res = await request('POST', '/api/auth/change-password', { currentPassword: 'oldpass123', newPassword: 'short' }, token);
  assert.strictEqual(res.status, 400);
});

test('Change password: correct flow works, old password stops working, new one works', async () => {
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'oldpass123' });
  const token = login.body.session_token;
  const res = await request('POST', '/api/auth/change-password', { currentPassword: 'oldpass123', newPassword: 'brandnewpass456' }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'PASSWORD_CHANGED');

  const oldFails = await request('POST', '/api/auth/login', { username: 'staff1', password: 'oldpass123' });
  assert.strictEqual(oldFails.status, 401);

  const newWorks = await request('POST', '/api/auth/login', { username: 'staff1', password: 'brandnewpass456' });
  assert.strictEqual(newWorks.status, 200);
});

test('Change password: invalidates the OLD session token used to make the change itself', async () => {
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'brandnewpass456' });
  const oldToken = login.body.session_token;
  await request('POST', '/api/auth/change-password', { currentPassword: 'brandnewpass456', newPassword: 'anotherpass789' }, oldToken);
  const res = await request('GET', '/api/stock', null, oldToken);
  assert.strictEqual(res.status, 401, 'the session token used to change the password must be invalidated, not left usable forever');
});

test('Change password requires authentication — no token, no dice', async () => {
  const res = await request('POST', '/api/auth/change-password', { currentPassword: 'x', newPassword: 'y'.repeat(10) });
  assert.strictEqual(res.status, 401);
});
