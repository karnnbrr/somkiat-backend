'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-saleService.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const saleService = require('../src/services/saleService');
const { AppError } = require('../src/errors');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');

const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'MGR1', request_id: 'r1' });
const staffCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'staff', user_id: 'STF1', request_id: 'r2' });

stockService.addTruck(managerCtx, { truck_id: 'TRK-001', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(managerCtx, { truck_id: 'TRK-002', price: 599000, down_payment: 19000, installment_amount: 14500, installment_count: 60 });
const customer = crmService.createCustomer(managerCtx, { name: 'คุณซื้อ', phone: '0899999999' });
const interest = crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: customer.customer_id });
const wrongInterest = crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-002', customer_id: customer.customer_id });

test('12. Sale ต้องผ่าน Service Layer — STAFF cannot call approveSale directly', () => {
  assert.throws(() => saleService.approveSale(staffCtx, {
    truck_id: 'TRK-001', sold_interest_id: interest.truck_interest_id, confirmed_sale: 'Yes', sale_price: 629000,
  }), AppError);
});

test('Safety Gate blocks: mismatched truck_id vs sold_interest.truck_id', () => {
  assert.throws(() => saleService.approveSale(managerCtx, {
    truck_id: 'TRK-001', sold_interest_id: wrongInterest.truck_interest_id, confirmed_sale: 'Yes', sale_price: 629000,
  }), AppError);
});

test('Safety Gate blocks: confirmed_sale != "Yes"', () => {
  assert.throws(() => saleService.approveSale(managerCtx, {
    truck_id: 'TRK-001', sold_interest_id: interest.truck_interest_id, confirmed_sale: 'No', sale_price: 629000,
  }), AppError);
});

test('MANAGER approves a valid sale -> atomic Stock update + Sale row + Audit', () => {
  const result = saleService.approveSale(managerCtx, {
    truck_id: 'TRK-001', sold_interest_id: interest.truck_interest_id, confirmed_sale: 'Yes', sale_price: 629000,
  });
  assert.ok(result.sale_id);
  assert.strictEqual(stockService.getTruck(managerCtx, 'TRK-001').stock_status, 'ขายแล้ว');

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action_type = 'SALE_APPROVED' AND entity_id = 'TRK-001'").get();
  assert.ok(auditRow, 'sale approval must be audited');
});

test('Double-sale of the same truck is blocked', () => {
  const c2 = crmService.createCustomer(managerCtx, { name: 'คุณซื้อสอง', phone: '0888888888' });
  const interest2 = crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: c2.customer_id });
  assert.throws(() => saleService.approveSale(managerCtx, {
    truck_id: 'TRK-001', sold_interest_id: interest2.truck_interest_id, confirmed_sale: 'Yes', sale_price: 629000,
  }), AppError);
});

test('Void requires an explicit revertTo status and a reason (never guessed)', () => {
  const c3 = crmService.createCustomer(managerCtx, { name: 'คุณซื้อสาม', phone: '0877777777' });
  const interest3 = crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-002', customer_id: c3.customer_id });
  const sale = saleService.approveSale(managerCtx, {
    truck_id: 'TRK-002', sold_interest_id: interest3.truck_interest_id, confirmed_sale: 'Yes', sale_price: 599000,
  });
  assert.throws(() => saleService.voidSale(managerCtx, sale.sale_id, 'ลูกค้ายกเลิก', null), AppError, 'must require revertTo');
  assert.throws(() => saleService.voidSale(managerCtx, sale.sale_id, null, 'พร้อมขาย'), AppError, 'must require reason');
  const voided = saleService.voidSale(managerCtx, sale.sale_id, 'ลูกค้ายกเลิก', 'พร้อมขาย');
  assert.strictEqual(voided.reverted_to, 'พร้อมขาย');
  assert.strictEqual(stockService.getTruck(managerCtx, 'TRK-002').stock_status, 'พร้อมขาย');
});
