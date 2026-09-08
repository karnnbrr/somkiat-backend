'use strict';
// ============================================================
// Tests the two gaps found and fixed when connecting to a real
// Facebook App: (1) the real nested Facebook envelope format, and
// (2) the actual AI response loop (webhook -> Claude -> Facebook send).
//
// Claude and the Facebook Send API are both stood in with LOCAL HTTP
// servers (via the *_OVERRIDE_FOR_TESTS_ONLY env vars already built
// for this purpose in Step 32) — real HTTP round trips to localhost,
// never a claim that the real Anthropic or Facebook APIs were called.
// ============================================================
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-webhookAiWiring.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
db.prepare('INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)')
  .run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', year: 2016, price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

let claudeServer, claudeUrl, claudeScript, claudeCallCount;
before(() => {
  claudeServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const responseBody = claudeScript[claudeCallCount] || claudeScript[claudeScript.length - 1];
      claudeCallCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });
  return new Promise((resolve) => claudeServer.listen(0, () => { claudeUrl = 'http://127.0.0.1:' + claudeServer.address().port; resolve(); }));
});
after(() => new Promise((resolve) => claudeServer.close(resolve)));

let fbServer, fbUrl, fbReceivedRequests;
before(() => {
  fbServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      fbReceivedRequests.push({ url: req.url, body: JSON.parse(data || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message_id: 'fb-mid-test' }));
    });
  });
  return new Promise((resolve) => fbServer.listen(0, () => { fbUrl = 'http://127.0.0.1:' + fbServer.address().port; resolve(); }));
});
after(() => new Promise((resolve) => fbServer.close(resolve)));

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + server.address().port; resolve(); }));
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

test('Real Facebook envelope format (entry[].messaging[]) is correctly parsed, not rejected', async () => {
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [{ content: [{ type: 'text', text: 'สวัสดีครับ มีอะไรให้ช่วยไหมครับ' }] }];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const realFacebookEnvelope = {
      object: 'page',
      entry: [{
        id: 'PAGE_SOMKIAT',
        time: 1234567890,
        messaging: [{
          sender: { id: 'PSID-REAL-ENVELOPE-1' },
          recipient: { id: 'PAGE_SOMKIAT' },
          timestamp: 1234567890,
          message: { mid: 'real-mid-1', text: 'สวัสดีครับ' },
        }],
      }],
    };
    const res = await postWebhook(realFacebookEnvelope);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'PROCESSED');
    assert.strictEqual(res.body.dealer_id, 'DEALER_SOMKIAT');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('is_echo messages are ignored, not processed as new inbound', async () => {
  const envelopeWithEcho = {
    entry: [{
      id: 'PAGE_SOMKIAT',
      messaging: [{ sender: { id: 'PAGE_SOMKIAT' }, message: { mid: 'echo-mid-1', text: 'our own reply', is_echo: true } }],
    }],
  };
  const res = await postWebhook(envelopeWithEcho);
  assert.strictEqual(res.status, 400);
});

test('End-to-end: real webhook -> real AI orchestrator (stand-in Claude) -> real outbound dispatch (stand-in Facebook)', async () => {
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [{ content: [{ type: 'text', text: 'มีครับ NLR ราคา 629,000 บาท' }] }];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'e2e-mid-1', sender_psid: 'PSID-E2E-1', text: 'มี NLR ไหมครับ' });
    assert.strictEqual(res.body.status, 'PROCESSED');

    assert.strictEqual(fbReceivedRequests.length, 1);
    assert.strictEqual(fbReceivedRequests[0].body.recipient.id, 'PSID-E2E-1');
    assert.strictEqual(fbReceivedRequests[0].body.message.text, 'มีครับ NLR ราคา 629,000 บาท');

    const db2 = getDb();
    const outboundRow = db2.prepare("SELECT * FROM outbound_messages WHERE recipient_psid = 'PSID-E2E-1'").get();
    assert.strictEqual(outboundRow.status, 'SENT');
    assert.strictEqual(outboundRow.message_content, 'มีครับ NLR ราคา 629,000 บาท');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('If Claude is not configured, the webhook still succeeds and no outbound message is queued', async () => {
  delete process.env.CLAUDE_API_KEY;
  const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'no-ai-mid-1', sender_psid: 'PSID-NO-AI', text: 'hello' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'PROCESSED');
  const db2 = getDb();
  const outboundRow = db2.prepare("SELECT * FROM outbound_messages WHERE recipient_psid = 'PSID-NO-AI'").get();
  assert.strictEqual(outboundRow, undefined);
});

test('A duplicate real-envelope event (same mid) is caught by idempotency and never gets a second AI reply', async () => {
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [{ content: [{ type: 'text', text: 'reply once' }] }];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const envelope = { entry: [{ id: 'PAGE_SOMKIAT', messaging: [{ sender: { id: 'PSID-DUP-1' }, message: { mid: 'dup-mid-1', text: 'hi' } }] }] };
    const first = await postWebhook(envelope);
    const second = await postWebhook(envelope);
    assert.strictEqual(first.body.status, 'PROCESSED');
    assert.strictEqual(second.body.status, 'DUPLICATE');
    assert.strictEqual(fbReceivedRequests.length, 1);
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});
