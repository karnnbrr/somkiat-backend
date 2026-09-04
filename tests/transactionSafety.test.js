'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-transactionSafety.db');
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
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'M1', request_id: 'r1' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

test('30/31. Service failure mid-transaction rolls back completely — no partial write (Create Truck Interest + Audit)', () => {
  const auditCountBefore = db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n;
  const interestCountBefore = db.prepare('SELECT COUNT(*) as n FROM truck_interests').get().n;

  // Force a real database-level failure: FK constraint violation because
  // 'CUST-DOES-NOT-EXIST' is not a real row in `customers`.
  assert.throws(() => {
    crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: 'CUST-DOES-NOT-EXIST' });
  }, AppError);

  const auditCountAfter = db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n;
  const interestCountAfter = db.prepare('SELECT COUNT(*) as n FROM truck_interests').get().n;

  assert.strictEqual(interestCountAfter, interestCountBefore, 'no truck_interest row must survive a rolled-back transaction');
  assert.strictEqual(auditCountAfter, auditCountBefore, 'no audit row must survive a rolled-back transaction either — Create Truck Interest + Audit is atomic');
});

test('15. Successful creation commits Truck Interest + Audit together (not split)', () => {
  const customer = crmService.createCustomer(managerCtx, { name: 'คุณทดสอบ', phone: '0810009999' });
  const before = db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n;
  const interest = crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: customer.customer_id });
  const after = db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n;
  assert.ok(interest.truck_interest_id);
  assert.strictEqual(after, before + 1, 'exactly one audit row must be created alongside the truck_interest');
});
