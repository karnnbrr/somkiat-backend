'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-idempotency.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const idempotencyService = require('../src/services/idempotencyService');

runMigrations();

test('7. Duplicate Idempotency Key -> ไม่สร้างซ้ำ', () => {
  const first = idempotencyService.checkAndRecord({ page_id: 'PAGE_SOMKIAT', message_id: 'MSG-1', dealer_id: 'DEALER_SOMKIAT' });
  assert.strictEqual(first.isNew, true);

  const second = idempotencyService.checkAndRecord({ page_id: 'PAGE_SOMKIAT', message_id: 'MSG-1', dealer_id: 'DEALER_SOMKIAT' });
  assert.strictEqual(second.isNew, false);

  // Different message_id on the same page must be treated as genuinely new.
  const different = idempotencyService.checkAndRecord({ page_id: 'PAGE_SOMKIAT', message_id: 'MSG-2', dealer_id: 'DEALER_SOMKIAT' });
  assert.strictEqual(different.isNew, true);

  // Same message_id on a DIFFERENT page must also be treated as new (key includes page_id).
  const otherPage = idempotencyService.checkAndRecord({ page_id: 'PAGE_ABC', message_id: 'MSG-1', dealer_id: 'DEALER_ABC' });
  assert.strictEqual(otherPage.isNew, true);
});

test('Idempotency is persisted (survives a fresh DB handle, not just in-memory)', () => {
  const { closeDb, getDb } = require('../src/db/connection');
  closeDb();
  const db = getDb(); // reopen same file
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE idempotency_key = ?').get('PAGE_SOMKIAT::MSG-1');
  assert.ok(row, 'idempotency key must survive reconnecting to the database file');
});
