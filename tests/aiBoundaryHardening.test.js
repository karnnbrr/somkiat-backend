'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-aiBoundaryHardening.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const audit = require('../src/services/auditService');
const { makeAiTools, sanitizeCriteria } = require('../src/ai/aiTools');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');

const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai', request_id: 'r1' });
const abc = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'ai', request_id: 'r2' });
stockService.addTruck(Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' }),
  { truck_id: 'TRK-001', brand: 'ISUZU', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager' }),
  { truck_id: 'TRK-001', brand: 'FUSO', price: 900000, down_payment: 50000, installment_amount: 20000, installment_count: 48 });

test('24. AI cannot supply dealer_id — an injected dealer_id in criteria has ZERO effect on the query result', () => {
  const tools = makeAiTools(somkiat);
  // Attempt: AI-generated criteria trying to point at DEALER_ABC's data.
  const result = tools.lookupStock({ dealer_id: 'DEALER_ABC', model: undefined });
  // Must still only see Somkiat's own truck (ISUZU), never ABC's (FUSO).
  assert.ok(result.every((t) => t.brand === 'ISUZU'));
  assert.ok(!result.some((t) => t.brand === 'FUSO'));
});

test('24b. sanitizeCriteria strips dealer_id and audits the attempt as a security event', () => {
  const before = audit.listForDealer(somkiat).length;
  const cleaned = sanitizeCriteria(somkiat, { dealer_id: 'DEALER_ABC', model: 'NLR' });
  assert.strictEqual('dealer_id' in cleaned, false);
  assert.strictEqual(cleaned.model, 'NLR');
  const after = audit.listForDealer(somkiat);
  assert.strictEqual(after.length, before + 1);
  assert.strictEqual(after[0].action_type, 'AI_DEALER_OVERRIDE_ATTEMPT_BLOCKED');
});

test('24c. Legitimate criteria without dealer_id produces no security audit noise', () => {
  const before = audit.listForDealer(somkiat).length;
  sanitizeCriteria(somkiat, { model: 'NLR' });
  const after = audit.listForDealer(somkiat).length;
  assert.strictEqual(after, before); // no new audit row for a clean call
});

test('25/26. AI tool object is frozen — cannot be extended at runtime to add a forbidden method', () => {
  const tools = makeAiTools(somkiat);
  assert.ok(Object.isFrozen(tools));
  assert.throws(() => { tools.approveSale = () => {}; }, TypeError);
  assert.strictEqual('approveSale' in tools, false);
});

test('26b. Each dealer gets its OWN tools object bound at creation time — proven with colliding truck_id', () => {
  const somkiatTools = makeAiTools(somkiat);
  const abcTools = makeAiTools(abc);
  assert.strictEqual(somkiatTools.getTruck('TRK-001').brand, 'ISUZU');
  assert.strictEqual(abcTools.getTruck('TRK-001').brand, 'FUSO');
});
