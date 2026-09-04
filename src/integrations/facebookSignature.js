// ============================================================
// Facebook Webhook Signature Verification — Step 31 Phase A
//
// This is a REAL implementation of Facebook's documented verification
// scheme (X-Hub-Signature-256: sha256=<hex hmac>), not a mock. It is
// pure cryptographic math (Node's built-in `crypto`), so it is fully
// testable offline with a TEST secret — no network call to Facebook
// is needed to prove this code is correct.
//
// What IS blocked in this environment (see README §"Step 31 status"):
// actually receiving a webhook signed by a REAL Facebook App Secret
// requires a live Facebook App + a public HTTPS endpoint, neither of
// which exist here. This module is ready to verify a real signature
// the moment FACEBOOK_APP_SECRET is set to a real value in production.
// ============================================================
'use strict';
const crypto = require('node:crypto');

/**
 * @param {string} rawBody - the exact raw request body bytes Facebook sent
 * @param {string} signatureHeader - the value of the X-Hub-Signature-256 header, e.g. "sha256=abcd..."
 * @param {string} appSecret - the Facebook App Secret
 * @returns {boolean}
 */
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret || typeof rawBody !== 'string') return false;
  const [scheme, providedHex] = signatureHeader.split('=');
  if (scheme !== 'sha256' || !providedHex) return false;

  const expectedHex = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // Constant-time comparison to avoid leaking timing information about the secret.
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/** Handles Facebook's GET verification handshake (hub.mode/hub.verify_token/hub.challenge). */
function verifySubscriptionHandshake(query, verifyToken) {
  if (query['hub.mode'] !== 'subscribe') return { ok: false };
  if (!verifyToken || query['hub.verify_token'] !== verifyToken) return { ok: false };
  return { ok: true, challenge: query['hub.challenge'] };
}

module.exports = { verifySignature, verifySubscriptionHandshake };
