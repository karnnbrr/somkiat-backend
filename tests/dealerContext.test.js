'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-dealerContext.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const { contextFromSession, contextFromFacebookPage, DealerContextError } = require('../src/context/dealerContext');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
db.prepare(
  'INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)'
).run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');

test('1. Dealer Context ถูกต้อง — resolves from a valid session row', () => {
  const ctx = contextFromSession({ dealer_id: 'DEALER_SOMKIAT', user_id: 'USER-1', role: 'staff' });
  assert.strictEqual(ctx.dealer_id, 'DEALER_SOMKIAT');
  assert.ok(Object.isFrozen(ctx), 'context must be frozen/immutable');
});

test('2. Dealer Context หาย -> BLOCK (DealerContextError)', () => {
  assert.throws(() => contextFromSession(null), DealerContextError);
  assert.throws(() => contextFromSession({ dealer_id: null }), DealerContextError);
});

test('3. Cross Dealer Access via unknown/unmapped page -> BLOCK', () => {
  assert.throws(() => contextFromFacebookPage('PAGE_UNKNOWN'), DealerContextError);
});

test('Facebook page correctly resolves to its OWN dealer only', () => {
  const ctx = contextFromFacebookPage('PAGE_SOMKIAT');
  assert.strictEqual(ctx.dealer_id, 'DEALER_SOMKIAT');
  assert.notStrictEqual(ctx.dealer_id, 'DEALER_ABC');
});
