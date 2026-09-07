'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-facebookWebhookReal.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const { verifySignature, verifySubscriptionHandshake } = require('../src/integrations/facebookSignature');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare(
  'INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)'
).run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'CONNECTED');

const TEST_SECRET = 'test-app-secret-not-a-real-facebook-secret';

// ---- Pure signature verification (real crypto, no network needed) ----
test('verifySignature: a correctly computed HMAC-SHA256 signature is accepted', () => {
  const body = JSON.stringify({ page_id: 'PAGE_SOMKIAT', message_id: 'M1' });
  const sig = 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(body, 'utf8').digest('hex');
  assert.strictEqual(verifySignature(body, sig, TEST_SECRET), true);
});

test('verifySignature: a tampered body fails verification', () => {
  const originalBody = JSON.stringify({ page_id: 'PAGE_SOMKIAT', message_id: 'M1' });
  const sig = 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(originalBody, 'utf8').digest('hex');
  const tamperedBody = JSON.stringify({ page_id: 'PAGE_SOMKIAT', message_id: 'M1-TAMPERED' });
  assert.strictEqual(verifySignature(tamperedBody, sig, TEST_SECRET), false);
});

test('verifySignature: wrong secret fails verification', () => {
  const body = JSON.stringify({ x: 1 });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(body, 'utf8').digest('hex');
  assert.strictEqual(verifySignature(body, sig, TEST_SECRET), false);
});

test('verifySignature: missing header or malformed scheme fails safely (no throw)', () => {
  assert.strictEqual(verifySignature('{}', null, TEST_SECRET), false);
  assert.strictEqual(verifySignature('{}', 'md5=abc', TEST_SECRET), false);
  assert.strictEqual(verifySignature('{}', 'sha256=', TEST_SECRET), false);
});

test('verifySubscriptionHandshake: correct mode + token returns the challenge', () => {
  const r = verifySubscriptionHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'my-token', 'hub.challenge': 'CHALLENGE123' }, 'my-token');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.challenge, 'CHALLENGE123');
});

test('verifySubscriptionHandshake: wrong token is rejected', () => {
  const r = verifySubscriptionHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG', 'hub.challenge': 'X' }, 'my-token');
  assert.strictEqual(r.ok, false);
});

// ---- HTTP-level webhook tests ----
let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function postWebhook(bodyObj, extraHeaders) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(bodyObj);
    const req = http.request(baseUrl + '/api/facebook/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

test('valid webhook (no secret configured -> dev/test mode, real business logic runs)', async () => {
  const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'REAL-M1', sender_psid: 'PSID-REAL-1', text: 'hi' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'PROCESSED');
  assert.strictEqual(res.body.customer_match, 'PENDING_NO_PHONE');
});

test('invalid signature is rejected WHEN a secret is configured', async () => {
  process.env.FACEBOOK_APP_SECRET = TEST_SECRET;
  try {
    const res = await postWebhook({ page_id: 'PAGE_SOMKIAT', message_id: 'REAL-M2' }, { 'X-Hub-Signature-256': 'sha256=deadbeef' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'AUTH_ERROR');
  } finally {
    delete process.env.FACEBOOK_APP_SECRET;
  }
});

test('valid signature IS accepted when a secret is configured (real HMAC computed here, not a mock)', async () => {
  process.env.FACEBOOK_APP_SECRET = TEST_SECRET;
  try {
    const bodyObj = { page_id: 'PAGE_SOMKIAT', message_id: 'REAL-M3', sender_psid: 'PSID-REAL-3' };
    const raw = JSON.stringify(bodyObj);
    const sig = 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(raw, 'utf8').digest('hex');
    const res = await postWebhook(bodyObj, { 'X-Hub-Signature-256': sig });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'PROCESSED');
  } finally {
    delete process.env.FACEBOOK_APP_SECRET;
  }
});

test('unknown page -> BLOCKED (dealer context cannot be resolved)', async () => {
  const res = await postWebhook({ page_id: 'PAGE_DOES_NOT_EXIST', message_id: 'REAL-M4' });
  assert.strictEqual(res.body.status, 'BLOCKED');
  assert.strictEqual(res.body.reason, 'DEALER_CONTEXT_ERROR');
});

test('duplicate event -> DUPLICATE, not re-processed', async () => {
  const bodyObj = { page_id: 'PAGE_SOMKIAT', message_id: 'REAL-DUP-1', sender_psid: 'PSID-DUP' };
  const first = await postWebhook(bodyObj);
  const second = await postWebhook(bodyObj);
  assert.strictEqual(first.body.status, 'PROCESSED');
  assert.strictEqual(second.body.status, 'DUPLICATE');
});

test('malformed payload (missing message_id) -> 400 VALIDATION_ERROR', async () => {
  const res = await postWebhook({ page_id: 'PAGE_SOMKIAT' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('cross-dealer attempt: a page_id resolves to exactly one dealer, never a caller-chosen one', async () => {
  db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
  db.prepare('INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, status) VALUES (?, ?, ?, ?)')
    .run('CONN-2', 'DEALER_ABC', 'PAGE_ABC', 'CONNECTED');
  const res = await postWebhook({ page_id: 'PAGE_ABC', message_id: 'REAL-CROSS-1', sender_psid: 'PSID-CROSS' });
  assert.strictEqual(res.body.dealer_id, 'DEALER_ABC'); // never DEALER_SOMKIAT, no matter what else is in the payload
});

test('GET verification handshake works with the correct token, returning the RAW challenge as plain text (Facebook requires this, not JSON)', async () => {
  process.env.FACEBOOK_VERIFY_TOKEN = 'test-verify-token';
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(baseUrl + '/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=ABC123', (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => resolve({ status: r.statusCode, contentType: r.headers['content-type'], raw: data }));
      }).on('error', reject);
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.raw, 'ABC123'); // exactly the raw string, no JSON wrapping at all
    assert.match(res.contentType, /text\/plain/);
  } finally {
    delete process.env.FACEBOOK_VERIFY_TOKEN;
  }
});

test('Step 32 §3: unexpected event structure (wrong types, unknown extra fields) does not crash the server', async () => {
  // message_id as a number instead of a string, extra unknown fields, nested junk.
  const res = await postWebhook({
    page_id: 'PAGE_SOMKIAT',
    message_id: 999999, // wrong type — Facebook always sends strings, but we must not crash if it doesn't
    sender_psid: 'PSID-WEIRD',
    text: 'hi',
    unexpected_field: { nested: ['junk', 1, null] },
    attachments: 'not-an-array-even-though-facebook-docs-say-it-should-be',
  });
  assert.ok([200, 400].includes(res.status), 'must return a normal HTTP response, never crash/hang');
  assert.strictEqual(typeof res.body, 'object');
});

test('Step 32 §3: completely empty body -> 400 VALIDATION_ERROR, not a crash', async () => {
  const res = await postWebhook({});
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});
