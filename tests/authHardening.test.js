'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-authHardening.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const { AppError } = require('../src/errors');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });

test('9. Invalid session token -> AUTH_ERROR', () => {
  assert.throws(() => authService.contextFromToken('this-token-does-not-exist'), AppError);
  try {
    authService.contextFromToken('garbage');
    assert.fail('should have thrown');
  } catch (e) {
    assert.strictEqual(e.code, 'AUTH_ERROR');
  }
});

test('10. Expired session -> AUTH_ERROR (not silently accepted)', () => {
  const { session_token } = authService.login('staff1', 'pw12345');
  // Force the session to already be expired.
  db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE session_token = ?").run(session_token);
  assert.throws(() => authService.contextFromToken(session_token), (e) => e.code === 'AUTH_ERROR');
});

test('A freshly issued session is valid and carries the correct role/dealer', () => {
  const { session_token, context } = authService.login('staff1', 'pw12345');
  const resolved = authService.contextFromToken(session_token);
  assert.strictEqual(resolved.dealer_id, 'DEALER_SOMKIAT');
  assert.strictEqual(resolved.role, 'staff');
  assert.strictEqual(resolved.dealer_id, context.dealer_id);
});
