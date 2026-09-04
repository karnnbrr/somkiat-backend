'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildApiUrl, getStatusBadge, formatCurrency, computeFunnelStages, parseApiError, isLiveConnectionError,
} = require('../frontend-logic-reference/frontendLogic');

test('buildApiUrl joins base+path correctly regardless of trailing/leading slashes', () => {
  assert.strictEqual(buildApiUrl('http://localhost:3001', '/api/stock'), 'http://localhost:3001/api/stock');
  assert.strictEqual(buildApiUrl('http://localhost:3001/', '/api/stock'), 'http://localhost:3001/api/stock');
  assert.strictEqual(buildApiUrl('http://localhost:3001', 'api/stock'), 'http://localhost:3001/api/stock');
});

test('getStatusBadge: 1. Login / stock status display mapping matches the spec exactly (green/orange/black)', () => {
  assert.strictEqual(getStatusBadge('พร้อมขาย').emoji, '🟢');
  assert.strictEqual(getStatusBadge('จองแล้ว').emoji, '🟠');
  assert.strictEqual(getStatusBadge('ขายแล้ว').emoji, '⚫');
  assert.strictEqual(getStatusBadge('unknown-status').emoji, '⚪'); // never crashes on unexpected input
});

test('formatCurrency: real numbers only, non-numbers fall back to a dash (never fake data)', () => {
  assert.strictEqual(formatCurrency(629000), '฿629,000');
  assert.strictEqual(formatCurrency(NaN), '-');
  assert.strictEqual(formatCurrency(undefined), '-');
  assert.strictEqual(formatCurrency('629000'), '-'); // must be a real number, not a coerced string
});

test('computeFunnelStages: every number comes straight from the real dashboard summary, none invented', () => {
  const summary = { crm: { customers: 5, truck_interests: 8, open_follow_ups: 2, open_handoffs: 1, sales_this_month: 3 } };
  const stages = computeFunnelStages(summary);
  assert.strictEqual(stages.length, 5);
  assert.strictEqual(stages[0].value, 5);
  assert.strictEqual(stages[4].value, 3);
});

test('computeFunnelStages: missing summary -> empty array, never fabricated numbers', () => {
  assert.deepStrictEqual(computeFunnelStages(null), []);
  assert.deepStrictEqual(computeFunnelStages(undefined), []);
});

test('parseApiError: maps known HTTP statuses to safe Thai messages, never leaks internals', () => {
  assert.strictEqual(parseApiError(401, {}), 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  assert.strictEqual(parseApiError(403, {}), 'คุณไม่มีสิทธิ์ทำรายการนี้');
  assert.strictEqual(parseApiError(400, { error: { code: 'VALIDATION_ERROR', message: 'price must be non-negative', details: { secret: 'xxx' } } }), 'price must be non-negative');
  const result = parseApiError(500, { error: { code: 'DATABASE_ERROR', message: 'internal error' } });
  assert.strictEqual(result, 'internal error');
});

test('isLiveConnectionError: recognizes a fetch() network failure (used to show the honest "cannot connect" state)', () => {
  assert.strictEqual(isLiveConnectionError(new TypeError('Failed to fetch')), true);
  assert.strictEqual(isLiveConnectionError(new Error('some other app error')), false);
});
