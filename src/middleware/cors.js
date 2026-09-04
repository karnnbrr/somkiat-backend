// ============================================================
// CORS Handling — added for the browser-based frontend to reach this
// backend when they are deployed on separate origins.
//
// Policy (deliberately the smallest safe thing that works):
//   - Production (NODE_ENV=production): allow EXACTLY ONE origin, read
//     from process.env.ALLOWED_ORIGIN. Never a wildcard. If
//     ALLOWED_ORIGIN isn't set, no origin is allowed — this fails closed,
//     not open.
//   - Non-production: reflect back whatever Origin the request actually
//     came from (still never a literal "*"), UNLESS ALLOWED_ORIGIN is
//     explicitly set, in which case that exact value is honored even in
//     dev/test — useful for rehearsing the production policy locally.
//     Reflecting the origin in dev preserves today's behavior: nothing
//     in this codebase or its tests currently depends on any particular
//     CORS policy (confirmed: no test sends an Origin header at all), so
//     this is purely additive.
//
// Access-Control-Allow-Credentials is intentionally NEVER sent. The
// frontend authenticates with a Bearer token in the Authorization
// header, not cookies (confirmed: no `credentials: 'include'` anywhere
// in skautotruck-dashboard.jsx) — credentialed CORS is not needed here,
// and combining it with a reflected/wildcard origin is a well-known
// unsafe pattern this design avoids by simply never needing it.
// ============================================================
'use strict';

const ALLOWED_METHODS = 'GET, POST, PATCH, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

function resolveAllowedOrigin(requestOrigin) {
  const env = process.env.NODE_ENV || 'development';
  const configuredOrigin = process.env.ALLOWED_ORIGIN;

  if (env === 'production') {
    if (configuredOrigin && requestOrigin === configuredOrigin) return configuredOrigin;
    return null; // fail closed: no configured origin => nobody is allowed, never '*'
  }

  if (configuredOrigin) {
    return requestOrigin === configuredOrigin ? configuredOrigin : null;
  }
  return requestOrigin || null;
}

/** Sets CORS response headers for the given request. Returns the allowed origin (or null). */
function applyCorsHeaders(req, res) {
  const requestOrigin = req.headers['origin'];
  const allowedOrigin = resolveAllowedOrigin(requestOrigin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  return allowedOrigin;
}

module.exports = { applyCorsHeaders, resolveAllowedOrigin, ALLOWED_METHODS, ALLOWED_HEADERS };
