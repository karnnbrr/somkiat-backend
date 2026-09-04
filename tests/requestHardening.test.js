'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-requestHardening.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { buildRouter } = require('../src/server');

runMigrations();

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => {
    server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});
after(() => new Promise((resolve) => server.close(resolve)));

function rawRequest(method, path, rawBody) {
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl + path, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    if (rawBody != null) req.write(rawBody);
    req.end();
  });
}

test('27. Malformed request (invalid JSON body) -> 400 VALIDATION_ERROR, not a crash', async () => {
  const res = await rawRequest('POST', '/api/auth/login', '{ this is not valid json');
  assert.strictEqual(res.status, 400);
  const body = JSON.parse(res.raw);
  assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
});

test('28. Missing required field -> 400/401 handled gracefully, never a raw stack trace', async () => {
  const res = await rawRequest('POST', '/api/auth/login', JSON.stringify({}));
  assert.ok([400, 401].includes(res.status));
  assert.ok(!res.raw.includes('at Object.'), 'response must never contain a raw stack trace');
});

test('29. Unknown route -> 404 NOT_FOUND', async () => {
  const res = await rawRequest('GET', '/api/this-route-does-not-exist', null);
  assert.strictEqual(res.status, 404);
  const body = JSON.parse(res.raw);
  assert.strictEqual(body.error.code, 'NOT_FOUND');
});

test('Health check endpoint responds 200 with a minimal, safe payload', async () => {
  const res = await rawRequest('GET', '/health', null);
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.raw);
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual('databasePath' in body, false);
  assert.strictEqual(JSON.stringify(body).toLowerCase().includes('secret'), false);
});
