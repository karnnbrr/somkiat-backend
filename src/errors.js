// ============================================================
// Standard Error Model — Step 29 §11 / §18
// Every thrown AppError has a stable `code` used by the error
// handler middleware to decide HTTP status + whether to leak
// details to the client (never leak internals/secrets).
// ============================================================
'use strict';

const CODES = {
  VALIDATION_ERROR: 400,
  AUTH_ERROR: 401,
  AUTHORIZATION_ERROR: 403, // role is authenticated but not permitted to perform this action
  PERMISSION_DENIED: 403,   // kept as an alias for backward compatibility
  DEALER_CONTEXT_ERROR: 403,
  NOT_FOUND: 404,
  DUPLICATE_EVENT: 200, // not an error to the caller — idempotent no-op
  STOCK_LOOKUP_FAILED: 503,
  PHOTO_LOOKUP_FAILED: 503,
  SAFETY_GATE_BLOCKED: 409,
  AI_ERROR: 502,
  FACEBOOK_SEND_FAILED: 502,
  DATABASE_ERROR: 500,
  TIMEOUT: 504,
  UNKNOWN_ERROR: 500,
};

class AppError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'AppError';
    this.code = CODES[code] ? code : 'UNKNOWN_ERROR';
    this.httpStatus = CODES[this.code] || 500;
    this.details = details || null; // internal-only; never sent to client directly
  }
}

module.exports = { AppError, CODES };
