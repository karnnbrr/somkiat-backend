'use strict';
// ============================================================
// Proves the real diagnostic gap found today is actually fixed: a
// failed Claude call must log its real response body detail, not
// just "responded 400" with no explanation.
// ============================================================
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-aiErrorLogging.db');
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
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

// Stand-in Claude server that always responds like a real 400 with a real Anthropic-shaped error body.
let claudeServer, claudeUrl;
before(() => {
  claudeServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }));
    });
  });
  return new Promise((resolve) => claudeServer.listen(0, () => { claudeUrl = 'http://127.0.0.1:' + claudeServer.address().port; resolve(); }));
});
after(() => new Promise((resolve) => claudeServer.close(resolve)));

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

test('A failed Claude call logs the REAL response body detail, not just the bare status code', async () => {
  process.env.CLAUDE_API_KEY = 'test-key';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = claudeUrl;

  const originalConsoleError = console.error;
  const loggedLines = [];
  console.error = (...args) => { loggedLines.push(args.join(' ')); };

  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'err-mid-1', sender_psid: 'PSID-ERR-1', text: 'hi' });
    assert.strictEqual(res.body.status, 'PROCESSED'); // the webhook itself must still succeed even though AI failed

    const errorLog = loggedLines.find((l) => l.includes('AI response failed'));
    assert.ok(errorLog, 'must log an AI response failure line');
    assert.match(errorLog, /credit balance is too low/, 'the REAL Claude error body must appear in the log, not just "responded 400"');
  } finally {
    console.error = originalConsoleError;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});
