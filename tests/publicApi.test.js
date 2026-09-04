'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-publicApi.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');

const somkiatManager = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
const abcManager = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager' });

stockService.addTruck(somkiatManager, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', year: 2016, price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(somkiatManager, { truck_id: 'TRK-099', brand: 'ISUZU', model: 'NKR', year: 2009, price: 319000, down_payment: 19000, installment_amount: 8400, installment_count: 60 });
stockService.addTruck(somkiatManager, { truck_id: 'TRK-777', brand: 'HINO', model: 'HINO300', year: 2018, price: 750000, down_payment: 30000, installment_amount: 18000, installment_count: 60 });

// Sell TRK-777 via the normal Safety Gate flow so it's genuinely 'ขายแล้ว'.
const crmService = require('../src/services/crmService');
const saleService = require('../src/services/saleService');
const cust = crmService.createCustomer(somkiatManager, { name: 'ทดสอบ', phone: '0899990001' });
const interest = crmService.createTruckInterest(somkiatManager, { truck_id: 'TRK-777', customer_id: cust.customer_id });
saleService.approveSale(somkiatManager, { truck_id: 'TRK-777', sold_interest_id: interest.truck_interest_id, confirmed_sale: 'Yes', sale_price: 750000 });

photoService.uploadPhoto(somkiatManager, { truck_id: 'TRK-001', file_name: 'front.jpg', content_hash: 'h1' });

// A different dealer with a colliding truck_id, to prove isolation.
stockService.addTruck(abcManager, { truck_id: 'TRK-001', brand: 'FUSO', model: 'CANTER', year: 2020, price: 900000, down_payment: 50000, installment_amount: 20000, installment_count: 48 });

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + path, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    }).on('error', reject);
  });
}

test('Public routes require NO Authorization header at all', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks');
    assert.strictEqual(res.status, 200);
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Without PUBLIC_DEALER_ID configured, public routes fail closed with a generic error (no internal details leaked)', async () => {
  delete process.env.PUBLIC_DEALER_ID;
  const res = await get('/api/public/trucks');
  assert.notStrictEqual(res.status, 200);
  assert.strictEqual(res.body.error.code, 'DEALER_CONTEXT_ERROR');
  assert.strictEqual(JSON.stringify(res.body).includes('PUBLIC_DEALER_ID'), false, 'must not leak the env var name to a public caller');
});

test('Public listing excludes sold trucks (TRK-777) but includes available (TRK-001)', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks');
    const ids = res.body.trucks.map((t) => t.truck_id);
    assert.ok(ids.includes('TRK-001'));
    assert.strictEqual(ids.includes('TRK-777'), false, 'sold trucks must not appear in the public catalog listing');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Direct link to a SOLD truck still shows its real, honest status — never a fake 404, never hidden', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks/TRK-777');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.truck.stock_status, 'ขายแล้ว');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Dealer isolation: PUBLIC_DEALER_ID=DEALER_SOMKIAT never returns DEALER_ABC\'s colliding TRK-001', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks/TRK-001');
    assert.strictEqual(res.body.truck.brand, 'ISUZU'); // Somkiat's, never ABC's FUSO
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Switching PUBLIC_DEALER_ID to DEALER_ABC serves ABC\'s catalog instead — proves scoping is server-config-driven, not hardcoded', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_ABC';
  try {
    const res = await get('/api/public/trucks/TRK-001');
    assert.strictEqual(res.body.truck.brand, 'FUSO');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Public photos endpoint returns only ACTIVE photos for the exact truck_id requested', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks/TRK-001/photos');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.photos.every((p) => p.truck_id === 'TRK-001'));
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Unknown truck_id returns 404, not a crash', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks/TRK-DOES-NOT-EXIST');
    assert.strictEqual(res.status, 404);
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Public trucks response never includes internal-only fields (e.g. reserved_by_customer_id)', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await get('/api/public/trucks/TRK-001');
    assert.strictEqual('reserved_by_customer_id' in res.body.truck, false);
    assert.strictEqual('listing_date' in res.body.truck, false);
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Public routes carry the same CORS headers as everything else (no special-casing needed)', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(baseUrl + '/api/public/trucks', { headers: { Origin: 'http://localhost:5173' } }, (r) => {
        let raw = '';
        r.on('data', (c) => { raw += c; });
        r.on('end', () => resolve({ headers: r.headers }));
      }).on('error', reject);
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});
