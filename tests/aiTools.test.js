'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-aiTools.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const { makeAiTools, FORBIDDEN_TOOL_NAMES } = require('../src/ai/aiTools');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');

const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'U1', request_id: 'r1' });
const abcManagerCtx = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'U2', request_id: 'r2' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
stockService.addTruck(abcManagerCtx, { truck_id: 'TRK-001', brand: 'FUSO', price: 900000, down_payment: 50000, installment_amount: 20000, installment_count: 48 });

test('13. Forbidden AI Tool ไม่มีอยู่ — every name in FORBIDDEN_TOOL_NAMES is absent from the tools object', () => {
  const tools = makeAiTools(managerCtx);
  for (const name of FORBIDDEN_TOOL_NAMES) {
    assert.strictEqual(name in tools, false, `Forbidden tool "${name}" must not be exposed to AI`);
  }
});

test('14. AI Tool ไม่รับ dealer_id จาก AI — function arity proves no dealer_id parameter slot exists', () => {
  const tools = makeAiTools(managerCtx);
  // lookupStock(criteria) — 1 param, not (dealer_id, criteria)
  assert.strictEqual(tools.lookupStock.length <= 1, true);
  assert.strictEqual(tools.getTruck.length <= 1, true);
  assert.strictEqual(tools.getTruckPhotos.length <= 1, true);
});

test('AI tools are scoped to the dealer baked into the context at creation time — proven with colliding truck_id', () => {
  const somkiatTools = makeAiTools(managerCtx);
  const abcTools = makeAiTools(abcManagerCtx);
  const somkiatTruck = somkiatTools.getTruck({ truck_id: 'TRK-001' });
  const abcTruck = abcTools.getTruck({ truck_id: 'TRK-001' });
  assert.strictEqual(somkiatTruck.brand, 'ISUZU');
  assert.strictEqual(abcTruck.brand, 'FUSO');
});

test('makeAiTools rejects a context without dealer_id', () => {
  assert.throws(() => makeAiTools({}), /trusted dealer context/);
  assert.throws(() => makeAiTools(null), /trusted dealer context/);
});
