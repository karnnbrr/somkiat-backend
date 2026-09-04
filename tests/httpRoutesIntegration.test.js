'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-httpRoutes.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const stockService = require('../src/services/stockService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });
stockService.addTruck(Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' }),
  { truck_id: 'TRK-001', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

let server, baseUrl, token;
before(async () => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  await new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'pw12345' });
  token = login.body.session_token;
});
after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('HTTP: POST /api/customers creates a customer', async () => {
  const res = await request('POST', '/api/customers', { name: 'คุณทดสอบ', phone: '0811110000' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.customer.phone, '0811110000');
});

test('HTTP: GET /api/customers/lookup finds by phone', async () => {
  const res = await request('GET', '/api/customers/lookup?phone=0811110000');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.customer.phone, '0811110000');
});

test('HTTP: POST /api/photos then GET /api/photos/:truck_id round-trips', async () => {
  const upload = await request('POST', '/api/photos', { truck_id: 'TRK-001', file_name: 'x.jpg', content_hash: 'h-http-1' });
  assert.strictEqual(upload.status, 201);
  const list = await request('GET', '/api/photos/TRK-001');
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.photos.some((p) => p.photo_id === upload.body.photo.photo_id));
});

test('HTTP: POST /api/follow-ups then complete it', async () => {
  const customer = await request('POST', '/api/customers', { name: 'คุณติดตาม', phone: '0822220000' });
  const created = await request('POST', '/api/follow-ups', { customer_id: customer.body.customer.customer_id, reason: 'ติดตามผลไฟแนนซ์' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.follow_up.status, 'Upcoming');
  const completed = await request('POST', `/api/follow-ups/${created.body.follow_up.follow_up_id}/complete`, { result: 'โทรแล้ว' });
  assert.strictEqual(completed.body.follow_up.status, 'Completed');
});

test('HTTP: POST /api/handoffs creates a handoff, GET /api/handoffs lists it', async () => {
  const created = await request('POST', '/api/handoffs', { conversation_id: 'CONV-HTTP-1', reason: 'CUSTOMER_REQUEST_HUMAN', summary: 'ทดสอบผ่าน HTTP' });
  assert.strictEqual(created.status, 201);
  const list = await request('GET', '/api/handoffs');
  assert.ok(list.body.handoffs.some((h) => h.handoff_id === created.body.handoff.handoff_id));
});

test('HTTP: unauthenticated requests to all new routes are rejected with 401', async () => {
  const savedToken = token;
  token = null;
  try {
    const r1 = await request('POST', '/api/customers', { name: 'x' });
    const r2 = await request('GET', '/api/photos/TRK-001');
    const r3 = await request('POST', '/api/follow-ups', {});
    assert.strictEqual(r1.status, 401);
    assert.strictEqual(r2.status, 401);
    assert.strictEqual(r3.status, 401);
  } finally {
    token = savedToken;
  }
});
