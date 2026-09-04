'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-conversationService.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const conversationService = require('../src/services/conversationService');
const { decideMatchOutcome, matchCustomerForConversation, startOrGetConversation, recordMessage, getConversationHistory } = conversationService;

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai', request_id: 'r1' });
const abc = Object.freeze({ dealer_id: 'DEALER_ABC', role: 'ai', request_id: 'r2' });

// ---- Pure decision function (unit-level — proves the AMBIGUOUS branch logic
// even though the live schema's UNIQUE constraint prevents constructing it
// end-to-end; see the file header comment in conversationService.js) ----
test('decideMatchOutcome: NONE / ONE / AMBIGUOUS branch logic', () => {
  assert.strictEqual(decideMatchOutcome([]), 'NONE');
  assert.strictEqual(decideMatchOutcome([{ customer_id: 'A' }]), 'ONE');
  assert.strictEqual(decideMatchOutcome([{ customer_id: 'A' }, { customer_id: 'B' }]), 'AMBIGUOUS');
  assert.strictEqual(decideMatchOutcome(null), 'NONE');
});

test('New PSID, no phone -> PENDING_NO_PHONE (Interaction/Conversation created, no Customer yet)', () => {
  const result = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-NEW-1' });
  assert.strictEqual(result.status, 'PENDING_NO_PHONE');
  assert.strictEqual(result.customer, null);
  assert.ok(result.conversation.conversation_id);
});

test('Existing PSID (already linked) -> MATCHED without asking again', () => {
  const first = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-RET-1', phone: '0811112222', name: 'คุณเอ' });
  assert.strictEqual(first.status, 'MATCHED');
  const second = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-RET-1' }); // no phone this time
  assert.strictEqual(second.status, 'MATCHED');
  assert.strictEqual(second.customer.customer_id, first.customer.customer_id);
  assert.strictEqual(second.matchedBy, 'psid');
});

test('New PSID + phone that matches an existing customer -> MATCHED (linked, not duplicated)', () => {
  const c1 = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-A', phone: '0822223333', name: 'คุณบี' });
  const c2 = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-B-DIFFERENT-DEVICE', phone: '0822223333' });
  assert.strictEqual(c1.customer.customer_id, c2.customer.customer_id);
  assert.strictEqual(c2.matchedBy, 'phone');
});

test('New PSID + brand new phone -> CREATED as a new customer', () => {
  const result = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-C', phone: '0833334444', name: 'คุณซี' });
  assert.strictEqual(result.status, 'MATCHED');
  assert.strictEqual(result.matchedBy, 'created');
  assert.strictEqual(result.customer.name, 'คุณซี');
});

test('Dealer isolation: same phone on two different dealers resolves to two different customers', () => {
  const s = matchCustomerForConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-CROSS-1', phone: '0899990000', name: 'Somkiat side' });
  const a = matchCustomerForConversation(abc, { page_id: 'PAGE_ABC', sender_psid: 'PSID-CROSS-2', phone: '0899990000', name: 'ABC side' });
  assert.notStrictEqual(s.customer.customer_id, a.customer.customer_id);
});

test('recordMessage + getConversationHistory round-trip, and correlation_id is captured', () => {
  const conv = startOrGetConversation(somkiat, { page_id: 'PAGE_SOMKIAT', sender_psid: 'PSID-HIST-1' });
  recordMessage(somkiat, { conversation_id: conv.conversation_id, direction: 'INBOUND', sender_type: 'CUSTOMER', text: 'สวัสดีครับ' });
  recordMessage(somkiat, { conversation_id: conv.conversation_id, direction: 'OUTBOUND', sender_type: 'AI', text: 'สวัสดีครับ ยินดีต้อนรับ' });
  const history = getConversationHistory(somkiat, conv.conversation_id);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].direction, 'INBOUND');
  assert.strictEqual(history[0].correlation_id, 'r1');
});
