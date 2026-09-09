'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-stockEnhancements.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const { makeAiTools } = require('../src/ai/aiTools');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
db.prepare('INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)')
  .run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });

stockService.addTruck(managerCtx, { truck_id: 'TRK-BODY-1', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60, body_type: 'กระบะเหล็ก' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-BODY-2', brand: 'ISUZU', model: 'NLR', price: 650000, down_payment: 20000, installment_amount: 15000, installment_count: 60, body_type: 'ตู้แห้ง' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-BODY-3', brand: 'ISUZU', model: 'NKR', price: 400000, down_payment: 15000, installment_amount: 9000, installment_count: 48, body_type: 'กระบะคอก' });

test('searchTrucks: bodyType filter finds an exact match', () => {
  const results = stockService.searchTrucks(managerCtx, { bodyType: 'ตู้แห้ง' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].truck_id, 'TRK-BODY-2');
});

test('searchTrucks: bodyType filter partially matches', () => {
  const results = stockService.searchTrucks(managerCtx, { bodyType: 'กระบะ' });
  const ids = results.map((t) => t.truck_id).sort();
  assert.deepStrictEqual(ids, ['TRK-BODY-1', 'TRK-BODY-3']);
});

test('The AI lookupStock tool actually supports bodyType end-to-end', () => {
  const aiTools = makeAiTools(managerCtx);
  const results = aiTools.lookupStock({ bodyType: 'ตู้แห้ง' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].truck_id, 'TRK-BODY-2');
});

test('addTruck accepts and stores cargo_dimensions', () => {
  const truck = stockService.addTruck(managerCtx, {
    truck_id: 'TRK-DIM-1', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000,
    installment_amount: 14000, installment_count: 60, cargo_dimensions: '2.5 x 5.0 x 2.0 ม.',
  });
  assert.strictEqual(truck.cargo_dimensions, '2.5 x 5.0 x 2.0 ม.');
});

test('editTruckDetails can update cargo_dimensions', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DIM-2', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const updated = stockService.editTruckDetails(managerCtx, 'TRK-DIM-2', { cargo_dimensions: '2.0 x 4.5 x 1.9 ม.' });
  assert.strictEqual(updated.cargo_dimensions, '2.0 x 4.5 x 1.9 ม.');
});

test('The AI can see cargo_dimensions through getTruck and lookupStock', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-DIM-3', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60, cargo_dimensions: '2.2 x 4.8 x 2.0 ม.' });
  const aiTools = makeAiTools(managerCtx);
  assert.strictEqual(aiTools.getTruck({ truck_id: 'TRK-DIM-3' }).cargo_dimensions, '2.2 x 4.8 x 2.0 ม.');
  const found = aiTools.lookupStock({ model: 'NLR' }).find((t) => t.truck_id === 'TRK-DIM-3');
  assert.strictEqual(found.cargo_dimensions, '2.2 x 4.8 x 2.0 ม.');
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

test('When a truck has THREE real-URL photos, ALL THREE get sent as real images (was only the first before)', async () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-MULTI', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-MULTI', file_name: '1.jpg', storage_reference: 'https://example.com/1.jpg', content_hash: 'm1' });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-MULTI', file_name: '2.jpg', storage_reference: 'https://example.com/2.jpg', content_hash: 'm2' });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-MULTI', file_name: '3.jpg', storage_reference: 'https://example.com/3.jpg', content_hash: 'm3' });

  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = fbUrl;
  claudeScript = [
    { content: [{ type: 'tool_use', id: 'tu_1', name: 'getTruckPhotos', input: { truck_id: 'TRK-MULTI' } }] },
    { content: [{ type: 'text', text: 'ส่งรูปให้ครบแล้วครับ' }] },
  ];
  claudeCallCount = 0;
  fbReceivedRequests = [];
  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'multi-mid-1', sender_psid: 'PSID-MULTI-1', text: 'ขอรูปหน่อยครับ' });
    assert.strictEqual(res.body.status, 'PROCESSED');

    assert.strictEqual(fbReceivedRequests.length, 4);
    const imageUrls = fbReceivedRequests.filter((r) => r.message.attachment).map((r) => r.message.attachment.payload.url).sort();
    assert.deepStrictEqual(imageUrls, ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg']);
    const textMsg = fbReceivedRequests.find((r) => r.message.text);
    assert.strictEqual(textMsg.message.text, 'ส่งรูปให้ครบแล้วครับ');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});
