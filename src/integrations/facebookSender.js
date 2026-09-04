// ============================================================
// Facebook Send API — Step 31 Phase C
//
// STATUS IN THIS ENVIRONMENT: BLOCKED / NEEDS CREDENTIALS.
// This sandbox has no network egress to graph.facebook.com (confirmed:
// the egress proxy returns `x-deny-reason: host_not_allowed`) and no
// FACEBOOK_PAGE_ACCESS_TOKEN exists anywhere in this environment.
//
// What follows is a REAL implementation using Node's built-in `https`
// module (no SDK needed) matching Facebook's documented Send API
// contract (POST https://graph.facebook.com/v19.0/me/messages).
// It has NOT been exercised against the real endpoint — that requires
// credentials and network access this environment does not have. Every
// call is guarded to fail loudly and explicitly (AppError with a
// message containing "NEEDS CREDENTIALS") rather than pretend to
// succeed, per the Step 31 rule against faking integration tests.
// ============================================================
'use strict';
const https = require('node:https');
const http = require('node:http');
const { AppError } = require('../errors');

const REQUEST_TIMEOUT_MS = 30_000;

/** Overridable for tests only — see claudeService.js for the same pattern/rationale. */
function getApiBaseUrl() {
  return process.env.FACEBOOK_GRAPH_BASE_URL_OVERRIDE_FOR_TESTS_ONLY || 'https://graph.facebook.com';
}

function isConfigured() {
  return !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
}

/**
 * Real Graph API call shape. Will only ever execute if a real
 * FACEBOOK_PAGE_ACCESS_TOKEN is configured; otherwise throws immediately.
 * NEVER put the token in a log line, error message, or AI context.
 */
function sendMessage({ recipientPsid, text }) {
  if (!isConfigured()) {
    throw new AppError('FACEBOOK_SEND_FAILED', 'BLOCKED: NEEDS CREDENTIALS — FACEBOOK_PAGE_ACCESS_TOKEN is not configured in this environment');
  }
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const payload = JSON.stringify({ recipient: { id: recipientPsid }, message: { text } });

  const url = `${getApiBaseUrl()}/v19.0/me/messages?access_token=${encodeURIComponent(token)}`;
  const transport = url.startsWith('http://') ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (parseErr) {
              reject(new AppError('FACEBOOK_SEND_FAILED', 'malformed response body from Facebook API', { message: parseErr.message }));
            }
          } else {
            // Never include the token in the rejected error.
            reject(new AppError('FACEBOOK_SEND_FAILED', `Facebook API responded ${res.statusCode}`, { body: data }));
          }
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Facebook API request timed out'));
    });
    req.on('error', (e) => reject(new AppError('FACEBOOK_SEND_FAILED', 'network error calling Facebook', { message: e.message })));
    req.write(payload);
    req.end();
  });
}

module.exports = { sendMessage, isConfigured };
