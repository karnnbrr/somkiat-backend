'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-miscHardening.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const photoService = require('../src/services/photoService');
const idempotencyService = require('../src/services/idempotencyService');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'M1', request_id: 'r1' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(managerCtx, { truck_id: 'TRK-002', price: 599000, down_payment: 19000, installment_amount: 14500, installment_count: 60 });

test('16. Wrong photo — a photo uploaded for TRK-001 never appears when listing TRK-002, even within the SAME dealer', () => {
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-001', file_name: 'a.jpg', content_hash: 'h1' });
  const trk1Photos = photoService.listActivePhotos(managerCtx, 'TRK-001');
  const trk2Photos = photoService.listActivePhotos(managerCtx, 'TRK-002');
  assert.strictEqual(trk1Photos.length, 1);
  assert.strictEqual(trk2Photos.length, 0);
});

test('19. Ambiguous customer — design proof: (dealer_id, phone) UNIQUE constraint makes true ambiguity structurally impossible', () => {
  const c1 = crmService.createCustomer(managerCtx, { name: 'คุณเอ', phone: '0812223333' });
  // Calling createCustomer again with the same phone in the same dealer must
  // return the SAME row, never create a second, ambiguous candidate.
  const c2 = crmService.createCustomer(managerCtx, { name: 'คุณเอ (พิมพ์ซ้ำ)', phone: '0812223333' });
  assert.strictEqual(c1.customer_id, c2.customer_id);
  const count = db.prepare('SELECT COUNT(*) as n FROM customers WHERE dealer_id = ? AND phone = ?').get('DEALER_SOMKIAT', '0812223333').n;
  assert.strictEqual(count, 1, 'UNIQUE(dealer_id, phone) guarantees at most one row — ambiguity cannot arise from phone alone');
});

test('21-23. Idempotency — repeated processing (3x) and a simulated restart all agree on DUPLICATE', () => {
  const first = idempotencyService.checkAndRecord({ page_id: 'PAGE_X', message_id: 'M-REPEAT', dealer_id: 'DEALER_SOMKIAT' });
  const second = idempotencyService.checkAndRecord({ page_id: 'PAGE_X', message_id: 'M-REPEAT', dealer_id: 'DEALER_SOMKIAT' });
  const third = idempotencyService.checkAndRecord({ page_id: 'PAGE_X', message_id: 'M-REPEAT', dealer_id: 'DEALER_SOMKIAT' });
  assert.strictEqual(first.isNew, true);
  assert.strictEqual(second.isNew, false);
  assert.strictEqual(third.isNew, false);

  // Simulated restart: close and reopen the DB handle, key must still be there.
  const { closeDb, getDb: reopen } = require('../src/db/connection');
  closeDb();
  const freshDb = reopen();
  const row = freshDb.prepare('SELECT * FROM idempotency_keys WHERE idempotency_key = ?').get('PAGE_X::M-REPEAT');
  assert.ok(row, 'idempotency key must survive a simulated process restart');
});
