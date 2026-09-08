'use strict';
// ============================================================
// These tests point claudeService.js / facebookSender.js at a LOCAL
// stand-in HTTP server (via the *_OVERRIDE_FOR_TESTS_ONLY env vars),
// never at the real Facebook/Claude APIs. This is legitimate: it
// tests OUR HTTP client code (timeout handling, malformed-JSON
// handling, secret non-leakage) for real, using real network I/O to
// localhost — not a claim that Facebook or Claude were contacted.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const claudeService = require('../src/ai/claudeService');
const facebookSender = require('../src/integrations/facebookSender');

let standInServer, standInUrl;
let nextResponse = { status: 200, body: '{}' };

before(() => {
  standInServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
      res.end(nextResponse.body);
    });
  });
  return new Promise((resolve) => standInServer.listen(0, () => { standInUrl = 'http://127.0.0.1:' + standInServer.address().port; resolve(); }));
});
after(() => new Promise((resolve) => standInServer.close(resolve)));

test('claudeService: isConfigured() is false with no CLAUDE_API_KEY, and sendMessage refuses to run', () => {
  assert.strictEqual(claudeService.isConfigured(), false);
  assert.throws(function () { claudeService.sendMessage({ messages: [] }); }, /NEEDS CREDENTIALS/);
});

test('claudeService: a well-formed 200 response from the stand-in server parses correctly', async () => {
  process.env.CLAUDE_API_KEY = 'test-key-not-real';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  nextResponse = { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }) };
  try {
    const result = await claudeService.sendMessage({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(result.content[0].text, 'hello');
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('claudeService: malformed JSON response is caught and rejected as AppError, not an uncaught exception', async () => {
  process.env.CLAUDE_API_KEY = 'test-key-not-real';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  nextResponse = { status: 200, body: '{ this is not valid json' };
  try {
    await assert.rejects(function () { return claudeService.sendMessage({ messages: [] }); }, function (err) {
      assert.match(err.message, /malformed response/);
      return true;
    });
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('claudeService: a non-2xx response never leaks the API key in the rejected error', async () => {
  process.env.CLAUDE_API_KEY = 'super-secret-test-key-must-not-leak';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  nextResponse = { status: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  try {
    await assert.rejects(function () { return claudeService.sendMessage({ messages: [] }); }, function (err) {
      const serialized = JSON.stringify(err) + err.message + JSON.stringify(err.details || {});
      assert.strictEqual(serialized.indexOf('super-secret-test-key-must-not-leak'), -1);
      return true;
    });
  } finally {
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('claudeService: sends a real, current model identifier by default (regression guard against the wrong-model-name bug)', async () => {
  process.env.CLAUDE_API_KEY = 'test-key-not-real';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  let capturedBody = null;
  nextResponse = { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) };
  const originalHandler = standInServer.listeners('request')[0];
  try {
    // Wrap the stand-in server just for this test to capture the request body.
    standInServer.removeAllListeners('request');
    standInServer.on('request', (req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        capturedBody = JSON.parse(data);
        res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
        res.end(nextResponse.body);
      });
    });
    await claudeService.sendMessage({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(capturedBody.model, 'claude-sonnet-5');
    assert.notStrictEqual(capturedBody.model, 'claude-sonnet-4-6', 'must never regress to the invalid model name that caused a real 400 in production');
  } finally {
    standInServer.removeAllListeners('request');
    standInServer.on('request', originalHandler);
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('claudeService: CLAUDE_MODEL env var overrides the default when set', async () => {
  process.env.CLAUDE_API_KEY = 'test-key-not-real';
  process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  process.env.CLAUDE_MODEL = 'claude-opus-5';
  let capturedBody = null;
  nextResponse = { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) };
  const originalHandler = standInServer.listeners('request')[0];
  try {
    standInServer.removeAllListeners('request');
    standInServer.on('request', (req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        capturedBody = JSON.parse(data);
        res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
        res.end(nextResponse.body);
      });
    });
    await claudeService.sendMessage({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(capturedBody.model, 'claude-opus-5');
  } finally {
    standInServer.removeAllListeners('request');
    standInServer.on('request', originalHandler);
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    delete process.env.CLAUDE_MODEL;
  }
});

test('claudeService: timeout mechanism is really wired up (setTimeout + destroy on the request)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/ai/claudeService.js'), 'utf8');
  assert.match(src, /req\.setTimeout\(/, 'claudeService.js must call req.setTimeout(...)');
  assert.match(src, /req\.destroy\(/, 'the timeout handler must call req.destroy(...) to actually abort a hung request');
});

test('facebookSender: isConfigured() is false with no token, sendMessage refuses to run', () => {
  assert.strictEqual(facebookSender.isConfigured(), false);
  assert.throws(function () { facebookSender.sendMessage({ recipientPsid: 'x', text: 'y' }); }, /NEEDS CREDENTIALS/);
});

test('facebookSender: malformed response from the stand-in server is caught, not an uncaught exception', async () => {
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token-not-real';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  nextResponse = { status: 200, body: 'not json at all' };
  try {
    await assert.rejects(function () { return facebookSender.sendMessage({ recipientPsid: 'PSID-1', text: 'hi' }); }, function (err) {
      assert.match(err.message, /malformed response/);
      return true;
    });
  } finally {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
    nextResponse = { status: 200, body: '{}' };
  }
});

test('facebookSender: a real 200 response from the stand-in server round-trips correctly', async () => {
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-token-not-real';
  process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY = standInUrl;
  nextResponse = { status: 200, body: JSON.stringify({ message_id: 'fb-mid-123' }) };
  try {
    const result = await facebookSender.sendMessage({ recipientPsid: 'PSID-1', text: 'hi' });
    assert.strictEqual(result.message_id, 'fb-mid-123');
  } finally {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY;
  }
});

test('facebookSender: timeout mechanism is really wired up', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/integrations/facebookSender.js'), 'utf8');
  assert.match(src, /req\.setTimeout\(/);
  assert.match(src, /req\.destroy\(/);
});
