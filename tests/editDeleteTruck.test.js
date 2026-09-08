'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-editDeleteTruck.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });
authService.createUser('DEALER_SOMKIAT', { name: 'Manager', username: 'manager1', password: 'pw12345', role: 'manager' });
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });

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

test('PATCH /api/stock/:id — staff can edit safe fields (price, brand, etc.)', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-EDIT-1', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const token = await loginAs('staff1');
  const res = await request('PATCH', '/api/stock/TRK-EDIT-1', { price: 650000, brand: 'ISUZU (Updated)' }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.truck.price, 650000);
  assert.strictEqual(res.body.truck.brand, 'ISUZU (Updated)');
});

test('PATCH /api/stock/:id — stock_status can NEVER be changed through this route (must go through reserve/sale flows)', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-EDIT-2', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const token = await loginAs('staff1');
  const res = await request('PATCH', '/api/stock/TRK-EDIT-2', { stock_status: 'ขายแล้ว' }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.truck.stock_status, 'พร้อมขาย', 'stock_status must be silently ignored by this endpoint, never changed');
});

test('DELETE (via POST /delete) — staff CANNOT delete, only manager can', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DEL-1', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const staffToken = await loginAs('staff1');
  const res = await request('POST', '/api/stock/TRK-DEL-1/delete', null, staffToken);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'AUTHORIZATION_ERROR');
});

test('DELETE — manager CAN delete a truck with no history', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DEL-2', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const managerToken = await loginAs('manager1');
  const res = await request('POST', '/api/stock/TRK-DEL-2/delete', null, managerToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'DELETED');
  const check = await request('GET', '/api/stock/TRK-DEL-2', null, managerToken);
  assert.strictEqual(check.body.truck, null);
});

test('DELETE — SAFELY REFUSES to delete a truck that already has a customer interest tied to it', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DEL-3', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const customer = crmService.createCustomer(managerCtx, { name: 'ทดสอบ', phone: '0899990002' });
  crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-DEL-3', customer_id: customer.customer_id });
  const managerToken = await loginAs('manager1');
  const res = await request('POST', '/api/stock/TRK-DEL-3/delete', null, managerToken);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error.message, /ลบไม่ได้/);
  // Prove it genuinely wasn't deleted.
  const check = await request('GET', '/api/stock/TRK-DEL-3', null, managerToken);
  assert.ok(check.body.truck);
});

test('DELETE — SAFELY REFUSES to delete a truck that has a photo', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DEL-4', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const photoService = require('../src/services/photoService');
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-DEL-4', file_name: 'front.jpg' });
  const managerToken = await loginAs('manager1');
  const res = await request('POST', '/api/stock/TRK-DEL-4/delete', null, managerToken);
  assert.strictEqual(res.status, 400);
});

test('Deleting a non-existent truck returns 404, not a crash', async () => {
  const managerToken = await loginAs('manager1');
  const res = await request('POST', '/api/stock/TRK-DOES-NOT-EXIST/delete', null, managerToken);
  assert.strictEqual(res.status, 404);
});
