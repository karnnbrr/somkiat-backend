'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { requirePermission } = require('../src/middleware/permission');
const { AppError } = require('../src/errors');

const staffCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'staff' });
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
const aiCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai' });

test('4. STAFF Permission — can do staff-level actions, cannot approve sale', () => {
  assert.doesNotThrow(() => requirePermission(staffCtx, 'stock.reserve'));
  assert.doesNotThrow(() => requirePermission(staffCtx, 'photo.upload'));
  assert.throws(() => requirePermission(staffCtx, 'sale.approve'), AppError);
  assert.throws(() => requirePermission(staffCtx, 'photo.restore'), AppError);
});

test('5. MANAGER Permission — can do everything staff can, plus manager-only actions', () => {
  assert.doesNotThrow(() => requirePermission(managerCtx, 'stock.reserve'));
  assert.doesNotThrow(() => requirePermission(managerCtx, 'sale.approve'));
  assert.doesNotThrow(() => requirePermission(managerCtx, 'sale.void'));
  assert.doesNotThrow(() => requirePermission(managerCtx, 'photo.restore'));
});

test('AI pseudo-role has NO permissions in this table at all (must use ai/aiTools.js instead)', () => {
  assert.throws(() => requirePermission(aiCtx, 'stock.reserve'), AppError);
  assert.throws(() => requirePermission(aiCtx, 'sale.approve'), AppError);
});
