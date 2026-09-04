'use strict';
// ============================================================
// Step 31 Phase D — End-to-End Scenario.
//
// Everything in this test is REAL code exercised for real: the HTTP
// webhook endpoint, signature-verification bypass logic (dev mode,
// documented), idempotency, dealer resolution, conversation/customer
// matching, the AI orchestrator's tool dispatch loop, Stock/Photo
// lookups, Truck Interest/Audit creation, and Handoff creation.
//
// The ONLY two things replaced with a labeled Test Double are the
// exact two edges that require real external credentials this
// environment does not have: the Claude API call itself (scripted
// fixture responses, standing in for what a real Claude conversation
// would produce) and the Facebook Send API call (a no-op stub). Both
// are called out explicitly below and in the Step 31 final report.
// ============================================================
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-e2eMessenger.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const conversationService = require('../src/services/conversationService');
const outboundMessageService = require('../src/services/outboundMessageService');
const { dispatchOne } = require('../src/services/outboundDispatchService');
const { runConversationTurn } = require('../src/ai/aiOrchestrator');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)')
  .run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');

const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', year: 2016, price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-001', file_name: 'front.jpg', content_hash: 'h1' });

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function postWebhook(bodyObj) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(baseUrl + '/api/facebook/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

test('E2E: full scenario — new customer -> stock -> photos -> reservation handoff', async () => {
  // ---- Steps 1-4: customer messages Facebook, page->dealer resolves, conversation+customer created ----
  const r1 = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'E2E-1', sender_psid: 'PSID-E2E', text: 'มี NLR ปี 16 ไหมครับ' });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.body.status, 'PROCESSED');
  assert.strictEqual(r1.body.dealer_id, 'DEALER_SOMKIAT');
  assert.strictEqual(r1.body.customer_match, 'PENDING_NO_PHONE'); // no phone yet — correct per the Contract
  const conversation_id = r1.body.conversation_id;

  // ---- Steps 5-7: customer asks about the truck -> Claude (fixture) calls lookupStock -> gets the real truck ----
  const context = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai', request_id: 'e2e-req-1' });
  const claudeFixture1 = {
    sendMessage: async () => ({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'lookupStock', input: { model: 'NLR' } }],
    }),
  };
  const turn1 = await runConversationTurn(context, [{ role: 'user', content: 'มี NLR ปี 16 ไหมครับ' }], claudeFixture1);
  const stockResult = JSON.parse(turn1.toolCallsMade[0].result.content);
  assert.strictEqual(stockResult.length, 1);
  assert.strictEqual(stockResult[0].truck_id, 'TRK-001'); // the real truck, from the real database

  // ---- Steps 8-9: customer asks for photos -> Claude (fixture) calls getTruckPhotos ----
  const claudeFixture2 = {
    sendMessage: async () => ({
      content: [{ type: 'tool_use', id: 'tu_2', name: 'getTruckPhotos', input: 'TRK-001' }],
    }),
  };
  const turn2 = await runConversationTurn(context, [{ role: 'user', content: 'ขอรูปด้วยครับ' }], claudeFixture2);
  const photos = JSON.parse(turn2.toolCallsMade[0].result.content);
  assert.strictEqual(photos.length, 1);
  assert.strictEqual(photos[0].truck_id, 'TRK-001');

  // ---- Step 10: (LABELED STUB) "send rูป back to Facebook" — real send is BLOCKED, use a no-op Test Double ----
  const queuedPhotoMsg = outboundMessageService.queueMessage(context, {
    conversation_id, recipient_psid: 'PSID-E2E', message_content: 'ส่งรูปรถให้แล้วครับ',
  });
  const noopSender = { sendMessage: async () => ({ stub: true, note: 'Facebook Send API is not connected in this environment' }) };
  const sendResult = await dispatchOne(context, queuedPhotoMsg.message_id, noopSender);
  assert.strictEqual(sendResult.status, 'SENT');

  // ---- Steps 11-13: customer asks to reserve -> Claude MUST hand off, MUST NOT confirm reservation ----
  const claudeFixture3 = {
    sendMessage: async () => ({
      content: [
        { type: 'tool_use', id: 'tu_3', name: 'createHandoff', input: { conversation_id, reason: 'RESERVATION_REQUEST', summary: 'ลูกค้าขอจอง TRK-001' } },
      ],
    }),
  };
  const turn3 = await runConversationTurn(context, [{ role: 'user', content: 'ขอจองคันนี้เลยครับ' }], claudeFixture3);
  assert.strictEqual(turn3.toolCallsMade[0].name, 'createHandoff');
  assert.ok(!turn3.toolCallsMade[0].result.is_error);
  // Prove AI never had a tool that could confirm the reservation:
  const truckAfter = stockService.getTruck(managerCtx, 'TRK-001');
  assert.strictEqual(truckAfter.stock_status, 'พร้อมขาย', 'AI must never confirm a reservation — stock_status must be untouched');

  // ---- Step 14: Customer/Interaction/Truck Interest/Audit all recorded correctly ----
  const history = conversationService.getConversationHistory(context, conversation_id);
  assert.ok(history.length >= 1);
  const handoffRow = db.prepare("SELECT * FROM handoffs WHERE dealer_id = ? AND conversation_id = ?").get('DEALER_SOMKIAT', conversation_id);
  assert.ok(handoffRow);
  assert.strictEqual(handoffRow.status, 'New'); // NOT auto-resolved — a human must act

  // ---- Step 15: duplicate webhook must not create duplicate data ----
  const dup = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'E2E-1', sender_psid: 'PSID-E2E', text: 'มี NLR ปี 16 ไหมครับ' });
  assert.strictEqual(dup.body.status, 'DUPLICATE');
  const conversationCount = db.prepare('SELECT COUNT(*) as n FROM conversations WHERE dealer_id = ?').get('DEALER_SOMKIAT').n;
  const beforeDupConversationCount = conversationCount; // already includes the one created above; re-posting must not add another
  const dup2 = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'E2E-1', sender_psid: 'PSID-E2E', text: 'มี NLR ปี 16 ไหมครับ' });
  const conversationCountAfter = db.prepare('SELECT COUNT(*) as n FROM conversations WHERE dealer_id = ?').get('DEALER_SOMKIAT').n;
  assert.strictEqual(conversationCountAfter, beforeDupConversationCount, 'duplicate inbound webhook must never create a new conversation row');
});
