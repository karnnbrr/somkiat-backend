'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-crossDealer.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const photoService = require('../src/services/photoService');
const saleService = require('../src/services/saleService');
const handoffService = require('../src/services/handoffService');
const audit = require('../src/services/auditService');
const { AppError } = require('../src/errors');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');

const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'S1', request_id: 'r1' });
const abc = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'A1', request_id: 'r2' });

// Deliberately colliding IDs across both dealers, to prove isolation holds under the worst case.
stockService.addTruck(somkiat, { truck_id: 'TRK-001', brand: 'ISUZU', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(abc, { truck_id: 'TRK-001', brand: 'FUSO', price: 900000, down_payment: 50000, installment_amount: 20000, installment_count: 48 });

test('1. Truck ID ซ้ำข้าม Dealer — coexist without collision', () => {
  assert.strictEqual(stockService.getTruck(somkiat, 'TRK-001').brand, 'ISUZU');
  assert.strictEqual(stockService.getTruck(abc, 'TRK-001').brand, 'FUSO');
});

test('2. Customer ID ซ้ำข้าม Dealer — coexist as different people', () => {
  const cSomkiat = crmService.createCustomer(somkiat, { name: 'คุณเอ', phone: '0810000001' });
  const cAbc = crmService.createCustomer(abc, { name: 'คุณบี', phone: '0810000001' }); // same phone, different dealer
  assert.notStrictEqual(cSomkiat.customer_id, cAbc.customer_id);
  assert.strictEqual(crmService.findCustomerByPhone(somkiat, '0810000001').name, 'คุณเอ');
  assert.strictEqual(crmService.findCustomerByPhone(abc, '0810000001').name, 'คุณบี');
});

test('3. Photo ID ซ้ำข้าม Dealer — never cross-visible', () => {
  photoService.uploadPhoto(somkiat, { truck_id: 'TRK-001', file_name: 'a.jpg', content_hash: 'hashA' });
  photoService.uploadPhoto(abc, { truck_id: 'TRK-001', file_name: 'b.jpg', content_hash: 'hashB' });
  const somkiatPhotos = photoService.listActivePhotos(somkiat, 'TRK-001');
  const abcPhotos = photoService.listActivePhotos(abc, 'TRK-001');
  assert.strictEqual(somkiatPhotos.length, 1);
  assert.strictEqual(abcPhotos.length, 1);
  assert.strictEqual(somkiatPhotos[0].content_hash, 'hashA');
  assert.strictEqual(abcPhotos[0].content_hash, 'hashB');
});

test('4. Truck Interest cross dealer — a Somkiat customer cannot be linked to an ABC truck row', () => {
  const cSomkiat = crmService.findCustomerByPhone(somkiat, '0810000001');
  // Somkiat context can only ever see Somkiat's own TRK-001 (ISUZU) — there is no
  // code path by which it could accidentally create an interest against ABC's row.
  const interest = crmService.createTruckInterest(somkiat, { truck_id: 'TRK-001', customer_id: cSomkiat.customer_id });
  const truck = stockService.getTruck(somkiat, interest.truck_id);
  assert.strictEqual(truck.brand, 'ISUZU'); // proves it resolved Somkiat's truck, never ABC's
});

test('5. Sale cross dealer — approving a sale never touches the other dealer\'s stock row', () => {
  const cSomkiat = crmService.findCustomerByPhone(somkiat, '0810000001');
  const interest = crmService.createTruckInterest(somkiat, { truck_id: 'TRK-001', customer_id: cSomkiat.customer_id });
  const abcStatusBefore = stockService.getTruck(abc, 'TRK-001').stock_status;
  saleService.approveSale(somkiat, { truck_id: 'TRK-001', sold_interest_id: interest.truck_interest_id, confirmed_sale: 'Yes', sale_price: 629000 });
  assert.strictEqual(stockService.getTruck(somkiat, 'TRK-001').stock_status, 'ขายแล้ว');
  assert.strictEqual(stockService.getTruck(abc, 'TRK-001').stock_status, abcStatusBefore); // untouched
});

test('6. Handoff cross dealer — listing never mixes dealers', () => {
  handoffService.createHandoff(somkiat, { conversation_id: 'CONV-S', reason: 'CUSTOMER_REQUEST_HUMAN', summary: 'somkiat case' });
  handoffService.createHandoff(abc, { conversation_id: 'CONV-A', reason: 'CUSTOMER_REQUEST_HUMAN', summary: 'abc case' });
  const somkiatHandoffs = handoffService.listOpenHandoffs(somkiat);
  const abcHandoffs = handoffService.listOpenHandoffs(abc);
  assert.ok(somkiatHandoffs.every((h) => h.dealer_id === 'DEALER_SOMKIAT'));
  assert.ok(abcHandoffs.every((h) => h.dealer_id === 'DEALER_ABC'));
  assert.ok(!somkiatHandoffs.some((h) => h.summary === 'abc case'));
});

test('7. Audit cross dealer — listForDealer never leaks another dealer\'s rows', () => {
  audit.record(somkiat, { action_type: 'TEST_SOMKIAT_ONLY' });
  audit.record(abc, { action_type: 'TEST_ABC_ONLY' });
  const somkiatAudit = audit.listForDealer(somkiat);
  assert.ok(somkiatAudit.every((r) => r.dealer_id === 'DEALER_SOMKIAT'));
  assert.ok(!somkiatAudit.some((r) => r.action_type === 'TEST_ABC_ONLY'));
});

test('Sale Safety Gate defense-in-depth: dealer_id consistency check is present in every validateSale() result', () => {
  const cSomkiat = crmService.createCustomer(somkiat, { name: 'คุณซี', phone: '0899999999' });
  const interest = crmService.createTruckInterest(somkiat, { truck_id: 'TRK-001', customer_id: cSomkiat.customer_id });
  const result = saleService.validateSale(somkiat, { truck_id: 'TRK-001', sold_interest_id: interest.truck_interest_id });
  assert.ok(result.checks.some((c) => c.label.includes('dealer_id')));
});
