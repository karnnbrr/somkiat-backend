'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-dealerInfo.db');
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
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });
authService.createUser('DEALER_SOMKIAT', { name: 'Manager', username: 'manager1', password: 'pw12345', role: 'manager' });

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
async function loginAs(username) {
  const res = await request('POST', '/api/auth/login', { username, password: 'pw12345' });
  return res.body.session_token;
}

test('GET /api/dealer-info requires authentication', async () => {
  const res = await request('GET', '/api/dealer-info');
  assert.strictEqual(res.status, 401);
});

test('GET /api/dealer-info returns real fields, starts empty (no fake defaults)', async () => {
  const token = await loginAs('staff1');
  const res = await request('GET', '/api/dealer-info', null, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.dealer.dealer_id, 'DEALER_SOMKIAT');
  assert.strictEqual(res.body.dealer.phone, null);
  assert.strictEqual(res.body.dealer.address, null);
});

test('PATCH /api/dealer-info: staff CANNOT edit — manager only', async () => {
  const token = await loginAs('staff1');
  const res = await request('PATCH', '/api/dealer-info', { phone: '081-234-5678' }, token);
  assert.strictEqual(res.status, 403);
});

test('PATCH /api/dealer-info: manager CAN edit, values persist', async () => {
  const token = await loginAs('manager1');
  const res = await request('PATCH', '/api/dealer-info', {
    phone: '081-234-5678', address: '123 ถ.สุวินทวงศ์ กทม.', business_hours: 'จันทร์-เสาร์ 8:00-18:00',
  }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.dealer.phone, '081-234-5678');
  assert.strictEqual(res.body.dealer.address, '123 ถ.สุวินทวงศ์ กทม.');

  const check = await request('GET', '/api/dealer-info', null, token);
  assert.strictEqual(check.body.dealer.business_hours, 'จันทร์-เสาร์ 8:00-18:00');
});

test('GET /api/public/dealer-info requires NO auth and returns the real saved values', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await request('GET', '/api/public/dealer-info');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.dealer.phone, '081-234-5678');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Dealer isolation: DEALER_ABC never sees DEALER_SOMKIAT contact info', async () => {
  authService.createUser('DEALER_ABC', { name: 'ABC Staff', username: 'abcstaff', password: 'pw12345', role: 'staff' });
  const token = await loginAs('abcstaff');
  const res = await request('GET', '/api/dealer-info', null, token);
  assert.strictEqual(res.body.dealer.dealer_id, 'DEALER_ABC');
  assert.strictEqual(res.body.dealer.phone, null);
});

test('Empty string clears a field back to null (not stored as a literal empty string)', async () => {
  const token = await loginAs('manager1');
  await request('PATCH', '/api/dealer-info', { line_id: '@somkiat' }, token);
  const cleared = await request('PATCH', '/api/dealer-info', { line_id: '' }, token);
  assert.strictEqual(cleared.body.dealer.line_id, null);
});
