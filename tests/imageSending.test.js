'use strict';
// ============================================================
// Tests the newly wired image-sending capability, using local
// stand-in servers for Claude and the Facebook Send API (same
// pattern as tests/webhookAiWiring.test.js — never the real APIs).
// ============================================================
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-imageSending.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const facebookSender = require('../src/integrations/facebookSender');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
db.prepare('INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)')
  .run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', year: 2016, price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

test('sendImage: rejects a base64 data URL immediately — Facebook can never fetch it', async () => {
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  try {
    let caught = null;
    try {
      await facebookSender.sendImage({ recipientPsid: 'PSID-1', imageUrl: 'data:image/jpeg;base64,AAAA' });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'sendImage must throw/reject for a base64 data URL');
    assert.match(caught.message, /real http\(s\) URL/);
  } finally {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  }
});

test('sendImage: not configured without a real token, same as sendMessage', () => {
  assert.throws(() => facebookSender.sendImage({ recipientPsid: 'x', imageUrl: 'https://example.com/a.jpg' }), /NEEDS CREDENTIALS/);
});

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
      fbReceivedRequests.push(JSON.parse(data || '{}'));
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
  return new Promise((resolvePromise, reject) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(baseUrl + '/api/facebook/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolvePromise({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

test('End-to-end: customer asks for photos with a REAL URL photo -> an actual image message gets sent to Facebook', async () => {
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-001', file_name: 'front.jpg', storage_reference: 'https://example.com/real-photo.jpg' });
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [
    { content: [{ type: 'tool_use', id: 'tu_1', name: 'getTruckPhotos', input: { truck_id: 'TRK-001' } }] },
    { content: [{ type: 'text', text: 'ส่งรูปให้แล้วครับ' }] },
  ];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'photo-mid-1', sender_psid: 'PSID-PHOTO-1', text: 'ขอรูปหน่อยครับ' });
    assert.strictEqual(res.body.status, 'PROCESSED');

    assert.strictEqual(fbReceivedRequests.length, 2);
    assert.strictEqual(fbReceivedRequests[0].message.attachment.type, 'image');
    assert.strictEqual(fbReceivedRequests[0].message.attachment.payload.url, 'https://example.com/real-photo.jpg');
    assert.strictEqual(fbReceivedRequests[1].message.text, 'ส่งรูปให้แล้วครับ');

    const outboundImageRow = getDb().prepare("SELECT * FROM outbound_messages WHERE message_type = 'IMAGE' AND recipient_psid = 'PSID-PHOTO-1'").get();
    assert.strictEqual(outboundImageRow.status, 'SENT');
    assert.strictEqual(outboundImageRow.message_content, 'https://example.com/real-photo.jpg');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('A truck with ONLY a base64-uploaded photo: no image is sent, text reply still works, no crash', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-BASE64-ONLY', brand: 'ISUZU', model: 'NKR', price: 400000, down_payment: 20000, installment_amount: 10000, installment_count: 48 });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-BASE64-ONLY', file_name: 'phone.jpg', storage_reference: 'data:image/jpeg;base64,AAAABBBB' });
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [
    { content: [{ type: 'tool_use', id: 'tu_1', name: 'getTruckPhotos', input: { truck_id: 'TRK-BASE64-ONLY' } }] },
    { content: [{ type: 'text', text: 'ตอบกลับข้อความปกติ' }] },
  ];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'photo-mid-3', sender_psid: 'PSID-PHOTO-3', text: 'ขอรูป NKR' });
    assert.strictEqual(res.body.status, 'PROCESSED');
    assert.strictEqual(fbReceivedRequests.length, 1, 'only the text reply should be sent — no image attempt for a base64-only photo set');
    assert.strictEqual(fbReceivedRequests[0].message.text, 'ตอบกลับข้อความปกติ');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});
