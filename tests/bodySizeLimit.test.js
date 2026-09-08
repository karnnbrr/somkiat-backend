'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-bodySizeLimit.db');
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
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

let server, baseUrl, token;
before(async () => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  await new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'pw12345' });
  token = login.body.session_token;
});
after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, bodyObj) {
  return new Promise((resolvePromise, reject) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolvePromise({ status: res.statusCode, body: JSON.parse(raw) }); } catch (e) { resolvePromise({ status: res.statusCode, body: null }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('A ~3MB photo-sized base64 payload (typical after client-side compression) is accepted, not rejected', async () => {
  const fakeBase64Photo = 'data:image/jpeg;base64,' + 'A'.repeat(3 * 1024 * 1024);
  const res = await request('POST', '/api/photos', { truck_id: 'TRK-001', storage_reference: fakeBase64Photo });
  assert.strictEqual(res.status, 201);
});

test('A payload larger than the 8MB limit is still rejected (connection reset by the server), not silently accepted', async () => {
  const tooLarge = 'data:image/jpeg;base64,' + 'A'.repeat(9 * 1024 * 1024);
  const result = await new Promise((resolve) => {
    const data = JSON.stringify({ truck_id: 'TRK-001', storage_reference: tooLarge });
    const req = http.request(baseUrl + '/api/photos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ rejected: true, status: res.statusCode }));
    });
    // The server enforces the size limit by destroying the connection
    // outright (see router.js readJsonBody) rather than a graceful 400 —
    // a connection reset here is itself proof the limit is enforced.
    req.on('error', () => resolve({ rejected: true, viaReset: true }));
    req.write(data);
    req.end();
  });
  assert.strictEqual(result.rejected, true, 'an oversized payload must never be silently accepted');
  if (!result.viaReset) assert.notStrictEqual(result.status, 201);
});
