// ============================================================
// Claude (Anthropic Messages API) Integration — Step 31 Phase B
//
// STATUS IN THIS ENVIRONMENT: BLOCKED / NEEDS CREDENTIALS.
// No CLAUDE_API_KEY exists anywhere in this environment, and this
// sandbox's egress proxy does not allow arbitrary outbound HTTPS to
// api.anthropic.com either. This module has NOT been exercised against
// the real API — every call is guarded to fail loudly rather than
// pretend to succeed.
//
// What IS real: the request shape below matches Anthropic's documented
// Messages API (model / max_tokens / system / messages / tools), built
// on Node's `https` (no SDK — this environment cannot `npm install
// @anthropic-ai/sdk` either, per the same network restriction). The
// orchestration logic that CONSUMES a response shaped like this one
// (src/ai/aiOrchestrator.js) is fully tested offline using fixture
// responses — see tests/aiOrchestrator.test.js — which is a legitimate
// test of OUR dispatch/boundary code, not a claim that real Claude was
// called.
// ============================================================
'use strict';
const https = require('node:https');
const http = require('node:http');
const { AppError } = require('../errors');

const REQUEST_TIMEOUT_MS = 30_000;

/** Overridable for tests only (points at a local stand-in HTTP server to
 *  test OUR timeout/malformed-response handling for real, without ever
 *  talking to the actual Anthropic API). Defaults to the real endpoint. */
function getApiUrl() {
  return process.env.CLAUDE_API_BASE_URL_OVERRIDE_FOR_TESTS_ONLY || 'https://api.anthropic.com/v1/messages';
}

function isConfigured() {
  return !!process.env.CLAUDE_API_KEY;
}

/**
 * @param {object} params - { model, system, messages, tools }
 * @returns {Promise<object>} the Messages API response body
 */
function sendMessage({ model, system, messages, tools }) {
  if (!isConfigured()) {
    throw new AppError('AI_ERROR', 'BLOCKED: NEEDS CREDENTIALS — CLAUDE_API_KEY is not configured in this environment');
  }
  const apiKey = process.env.CLAUDE_API_KEY;
  const payload = JSON.stringify({
    model: model || 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages,
    tools,
  });

  const url = getApiUrl();
  const transport = url.startsWith('http://') ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (parseErr) {
              // Malformed response body — never let a raw JSON.parse throw
              // escape uncaught; reject with a normal AppError instead.
              reject(new AppError('AI_ERROR', 'malformed response body from Claude API', { message: parseErr.message }));
            }
          } else {
            // Never include the API key in the rejected error.
            reject(new AppError('AI_ERROR', `Claude API responded ${res.statusCode}`, { body: data }));
          }
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Claude API request timed out'));
    });
    req.on('error', (e) => reject(new AppError('AI_ERROR', 'network error calling Claude API', { message: e.message })));
    req.write(payload);
    req.end();
  });
}

module.exports = { sendMessage, isConfigured };
