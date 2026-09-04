'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-outboundAndQueue.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const outboundMessageService = require('../src/services/outboundMessageService');
const { createInProcessQueue } = require('../src/queue/queueInterface');
const { AppError } = require('../src/errors');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager', user_id: 'U1', request_id: 'r1' });
const abc = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'manager', user_id: 'U2', request_id: 'r2' });

test('Outbound message: queue -> SENT happy path, with correlation_id and audit', () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'ราคา 629,000 บาทครับ' });
  assert.strictEqual(msg.status, 'QUEUED');
  assert.strictEqual(msg.correlation_id, 'r1');

  const sent = outboundMessageService.markSent(somkiat, msg.message_id);
  assert.strictEqual(sent.status, 'SENT');

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action_type = 'OUTBOUND_MESSAGE_SENT' AND entity_id = ?").get(msg.message_id);
  assert.ok(auditRow);
});

test('Outbound message: FAILED path records a reason', () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  const failed = outboundMessageService.markFailed(somkiat, msg.message_id, 'Facebook API timeout');
  assert.strictEqual(failed.status, 'FAILED');
});

test('Outbound message requires recipient_psid and message_content', () => {
  assert.throws(() => outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1' }), AppError);
});

test('Outbound message dealer isolation: DEALER_ABC cannot mark a Somkiat message as sent', () => {
  const msg = outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-1', recipient_psid: 'PSID-1', message_content: 'test' });
  assert.throws(() => outboundMessageService.markSent(abc, msg.message_id), AppError);
});

test('listQueued only returns QUEUED messages, scoped by dealer', () => {
  const before = outboundMessageService.listQueued(somkiat).length;
  outboundMessageService.queueMessage(somkiat, { conversation_id: 'CONV-2', recipient_psid: 'PSID-2', message_content: 'test2' });
  const after = outboundMessageService.listQueued(somkiat).length;
  assert.strictEqual(after, before + 1);
  assert.ok(outboundMessageService.listQueued(abc).length === 0);
});

// ---- Queue Boundary ----
test('Queue boundary: enqueue before a processor is registered, then drains once one is attached', () => {
  const q = createInProcessQueue('test-queue');
  const seen = [];
  q.enqueue({ hello: 'world' });
  assert.strictEqual(q.size(), 1);
  q.onProcess((payload) => seen.push(payload));
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(seen[0], { hello: 'world' });
  assert.strictEqual(q.size(), 0); // processed jobs are no longer "queued"
});

test('Queue boundary: a job that throws in the processor is marked failed, not silently dropped', () => {
  const q = createInProcessQueue('test-queue-2');
  q.onProcess(() => { throw new Error('boom'); });
  q.enqueue({ x: 1 });
  const jobs = q.peekAll();
  assert.strictEqual(jobs[0].state, 'failed');
  assert.strictEqual(jobs[0].error, 'boom');
});

test('Queue boundary: jobs enqueue immediately after a processor is already attached', () => {
  const q = createInProcessQueue('test-queue-3');
  const seen = [];
  q.onProcess((p) => seen.push(p));
  q.enqueue({ n: 1 });
  q.enqueue({ n: 2 });
  assert.strictEqual(seen.length, 2);
});
