'use strict';
// ============================================================
// Tests the RETRY POLICY / IDEMPOTENCY state machine in
// src/services/outboundDispatchService.js using a labeled Test Double
// sender — NOT the real src/integrations/facebookSender.js. Real
// Facebook delivery is BLOCKED in this environment (no
// FACEBOOK_PAGE_ACCESS_TOKEN, no network to graph.facebook.com — see
// the Step 31 final report).
// ============================================================
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-outboundDispatch.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const outboundMessageService = require('../src/services/outboundMessageService');
const { dispatchOne, MAX_RETRIES } = require('../src/services/outboundDispatchService');
const { isConfigured } = require('../src/integrations/facebookSender');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'U1', request_id: 'r1' });

test('Real Facebook Send API is correctly reported as NOT configured in this environment', () => {
  assert.strictEqual(isConfigured(), false);
});

test('Outbound retry: success on first attempt -> SENT, sender called exactly once', async () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  let calls = 0;
  const testDoubleSender = { sendMessage: async () => { calls++; return { message_id: 'fb-123' }; } };
  const result = await dispatchOne(somkiat, msg.message_id, testDoubleSender);
  assert.strictEqual(result.status, 'SENT');
  assert.strictEqual(calls, 1);
});

test('Outbound retry: failure increments retry_count and stays QUEUED under MAX_RETRIES', async () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  const failingSender = { sendMessage: async () => { throw new Error('simulated network failure'); } };
  const result = await dispatchOne(somkiat, msg.message_id, failingSender);
  assert.strictEqual(result.status, 'QUEUED');
  assert.strictEqual(result.retry_count, 1);
  const row = db.prepare('SELECT * FROM outbound_messages WHERE message_id = ?').get(msg.message_id);
  assert.strictEqual(row.last_error, 'simulated network failure');
});

test('Outbound retry: after MAX_RETRIES consecutive failures, message becomes terminally FAILED', async () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  const failingSender = { sendMessage: async () => { throw new Error('down'); } };
  let last;
  for (let i = 0; i < MAX_RETRIES; i++) {
    last = await dispatchOne(somkiat, msg.message_id, failingSender);
  }
  assert.strictEqual(last.status, 'FAILED');
  assert.strictEqual(last.terminal, true);
});

test('Outbound idempotency: dispatching an already-SENT message never calls the sender again', async () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  let calls = 0;
  const testDoubleSender = { sendMessage: async () => { calls++; return {}; } };
  await dispatchOne(somkiat, msg.message_id, testDoubleSender);
  const second = await dispatchOne(somkiat, msg.message_id, testDoubleSender);
  assert.strictEqual(second.alreadyHandled, true);
  assert.strictEqual(calls, 1, 'sender must be called exactly once even if dispatch is invoked twice — this is what prevents a duplicate send if the inbound Facebook event that triggered the AI response is retried');
});

test('Dealer isolation: dispatching a message for one dealer with another dealer\'s context fails', async () => {
  db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
  const abc = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'U2', request_id: 'r2' });
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  await assert.rejects(() => dispatchOne(abc, msg.message_id, { sendMessage: async () => ({}) }));
});
