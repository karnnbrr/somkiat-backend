'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-stockService.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const { AppError } = require('../src/errors');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');

const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'U1', request_id: 'r1' });
const abcManagerCtx = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'U2', request_id: 'r2' });

test('10. Stock Status Enum validation — invalid status is rejected', () => {
  assert.throws(() => stockService.addTruck(managerCtx, {
    truck_id: 'TRK-BAD', price: 100000, down_payment: 10000, installment_amount: 5000, installment_count: 12,
    stock_status: 'กำลังจะขาย', // not one of the 3 allowed values
  }), AppError);
});

test('10b. Non-negative number / positive integer validations', () => {
  assert.throws(() => stockService.addTruck(managerCtx, {
    truck_id: 'TRK-BAD2', price: -100, down_payment: 10000, installment_amount: 5000, installment_count: 12,
  }), AppError);
  assert.throws(() => stockService.addTruck(managerCtx, {
    truck_id: 'TRK-BAD3', price: 100000, down_payment: 10000, installment_amount: 5000, installment_count: 0,
  }), AppError);
});

test('Valid truck can be added, and duplicate truck_id within the same dealer is blocked', () => {
  const truck = stockService.addTruck(managerCtx, {
    truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', year: 2016,
    price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60,
  });
  assert.strictEqual(truck.stock_status, 'พร้อมขาย');
  assert.throws(() => stockService.addTruck(managerCtx, {
    truck_id: 'TRK-001', price: 500000, down_payment: 10000, installment_amount: 5000, installment_count: 12,
  }), AppError);
});

test('Same truck_id is allowed for a DIFFERENT dealer (dealer-scoped uniqueness)', () => {
  assert.doesNotThrow(() => stockService.addTruck(abcManagerCtx, {
    truck_id: 'TRK-001', brand: 'FUSO', price: 900000, down_payment: 50000, installment_amount: 20000, installment_count: 48,
  }));
  const somkiatTruck = stockService.getTruck(managerCtx, 'TRK-001');
  const abcTruck = stockService.getTruck(abcManagerCtx, 'TRK-001');
  assert.strictEqual(somkiatTruck.brand, 'ISUZU');
  assert.strictEqual(abcTruck.brand, 'FUSO');
});

test('11. Truck Interest ไม่เปลี่ยน Stock Status — creating interest never touches stock_status', () => {
  const customer = crmService.createCustomer(managerCtx, { name: 'คุณทดสอบ', phone: '0810000001' });
  const before = stockService.getTruck(managerCtx, 'TRK-001').stock_status;

  crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: customer.customer_id });

  const after = stockService.getTruck(managerCtx, 'TRK-001').stock_status;
  assert.strictEqual(before, after, 'stock_status must be unchanged by a Truck Interest');
  assert.strictEqual(after, 'พร้อมขาย');
});

test('Reserve requires stock.reserve permission (staff/manager), and blocks double-reservation by another customer', () => {
  const c1 = crmService.createCustomer(managerCtx, { name: 'ลูกค้า A', phone: '0820000002' });
  const c2 = crmService.createCustomer(managerCtx, { name: 'ลูกค้า B', phone: '0830000003' });
  stockService.reserveTruck(managerCtx, 'TRK-001', c1.customer_id);
  assert.strictEqual(stockService.getTruck(managerCtx, 'TRK-001').stock_status, 'จองแล้ว');
  assert.throws(() => stockService.reserveTruck(managerCtx, 'TRK-001', c2.customer_id), AppError);
  stockService.cancelReservation(managerCtx, 'TRK-001');
  assert.strictEqual(stockService.getTruck(managerCtx, 'TRK-001').stock_status, 'พร้อมขาย');
});
