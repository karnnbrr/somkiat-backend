// ============================================================
// Dealer Context Foundation — Step 27.1 / 29 security boundary.
//
// RULE: dealer_id is NEVER trusted from client/AI input. It is only
// ever derived server-side from:
//   (a) an authenticated user's session (Staff/Manager web),
//   (b) a resolved Facebook page_id -> facebook_page_connections row, or
//   (c) a server-configured env var, for the public customer website
//       (Step 36) — a public site request carries no session and no
//       Facebook page_id, so there is nothing on the request itself
//       that could ever be trusted to pick a dealer_id. The server
//       operator configures which single dealer a given deployment of
//       the public site serves; the browser never gets a say.
//
// The context object returned here is frozen (Object.freeze) so that
// nothing downstream — including AI tool code — can mutate it to
// point at a different dealer_id after creation.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');

class DealerContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DealerContextError';
    this.code = 'DEALER_CONTEXT_ERROR';
  }
}

/** Build a trusted context from an authenticated session row. */
function contextFromSession(sessionRow, correlationId) {
  if (!sessionRow || !sessionRow.dealer_id) {
    throw new DealerContextError('No valid session / dealer could not be resolved');
  }
  return Object.freeze({
    dealer_id: sessionRow.dealer_id,
    user_id: sessionRow.user_id,
    role: sessionRow.role,
    request_id: correlationId || crypto.randomUUID(),
    source: 'session',
  });
}

/** Build a trusted context by resolving a Facebook page_id (for the future Messenger bridge). */
function contextFromFacebookPage(page_id, correlationId) {
  const db = getDb();
  const row = db
    .prepare('SELECT dealer_id FROM facebook_page_connections WHERE facebook_page_id = ? AND status = ?')
    .get(page_id, 'CONNECTED');
  if (!row) {
    throw new DealerContextError(`Cannot resolve dealer for page_id=${page_id}`);
  }
  return Object.freeze({
    dealer_id: row.dealer_id,
    user_id: null,
    role: 'ai', // AI acts under a distinct pseudo-role; see permission.js — 'ai' never maps to write-critical actions
    request_id: correlationId || crypto.randomUUID(),
    source: 'facebook_page',
  });
}

/**
 * Build a trusted context for the public customer website (Step 36).
 * Reads PUBLIC_DEALER_ID from server-side environment config only —
 * never from a request header/query/body. Fails closed (throws) if
 * unconfigured, rather than guessing or defaulting to any dealer.
 */
function contextFromPublicSite(correlationId) {
  const dealer_id = process.env.PUBLIC_DEALER_ID;
  if (!dealer_id) {
    throw new DealerContextError('PUBLIC_DEALER_ID is not configured — public site cannot resolve a dealer');
  }
  return Object.freeze({
    dealer_id,
    user_id: null,
    role: 'public', // zero permissions in permission.js — public site only ever calls read-only service functions
    request_id: correlationId || crypto.randomUUID(),
    source: 'public_site',
  });
}

module.exports = { contextFromSession, contextFromFacebookPage, contextFromPublicSite, DealerContextError };
