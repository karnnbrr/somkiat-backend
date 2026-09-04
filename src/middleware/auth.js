// ============================================================
// Auth middleware helper — extracts a trusted DealerContext from the
// Authorization header. This is the ONLY place a request's session
// token is turned into a dealer_id — every route handler downstream
// receives an already-trusted context, never a raw token or client-
// supplied dealer_id.
// ============================================================
'use strict';
const { AppError } = require('../errors');
const authService = require('../services/authService');

function requireAuth(req, correlationId) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('AUTH_ERROR', 'missing Authorization bearer token');
  return authService.contextFromToken(token, correlationId);
}

module.exports = { requireAuth };
