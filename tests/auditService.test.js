'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-auditService.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const audit = require('../src/services/auditService');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
const ctx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'U1', request_id: 'r1' });

test('8. Audit ถูกสร้าง — record() inserts a row with all required fields', () => {
  const id = audit.record(ctx, { action_type: 'TEST_ACTION', entity: 'truck', entity_id: 'TRK-001', new_value: 'พร้อมขาย' });
  const row = db.prepare('SELECT * FROM audit_log WHERE audit_id = ?').get(id);
  assert.ok(row);
  assert.strictEqual(row.dealer_id, 'DEALER_SOMKIAT');
  assert.strictEqual(row.action_type, 'TEST_ACTION');
  assert.strictEqual(row.correlation_id, 'r1');
});

test('record() throws if dealer_id is missing — cannot write an unscoped audit row', () => {
  assert.throws(() => audit.record({ role: 'manager' }, { action_type: 'X' }), /AUDIT_WITHOUT_DEALER_ID_FORBIDDEN/);
  assert.throws(() => audit.record(null, { action_type: 'X' }), /AUDIT_WITHOUT_DEALER_ID_FORBIDDEN/);
});

test('9. Audit ไม่สามารถแก้ไขย้อนหลังแบบปกติ — module exposes no update/delete function', () => {
  assert.strictEqual(typeof audit.update, 'undefined');
  assert.strictEqual(typeof audit.delete, 'undefined');
  assert.strictEqual(typeof audit.remove, 'undefined');
  // Only record() (insert) and listForDealer() (read) are exported.
  assert.deepStrictEqual(Object.keys(audit).sort(), ['listForDealer', 'record']);
});

test('listForDealer is scoped — never returns another dealer\'s audit rows', () => {
  db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
  const abcCtx = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'U2', request_id: 'r2' });
  audit.record(abcCtx, { action_type: 'ABC_ONLY_ACTION' });

  const somkiatRows = audit.listForDealer(ctx);
  assert.ok(somkiatRows.every((r) => r.dealer_id === 'DEALER_SOMKIAT'));
  assert.ok(!somkiatRows.some((r) => r.action_type === 'ABC_ONLY_ACTION'));
});
