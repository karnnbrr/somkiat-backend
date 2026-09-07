// ============================================================
// CORS Handling — added for the browser-based frontend to reach this
// backend when they are deployed on separate origins.
//
// Policy (deliberately the smallest safe thing that works):
//   - Production (NODE_ENV=production): allow a SET of exact origins,
//     read from process.env.ALLOWED_ORIGIN as a comma-separated list
//     (a single value still works exactly as before — this is a
//     backward-compatible extension, not a breaking change). Never a
//     wildcard. If ALLOWED_ORIGIN isn't set, no origin is allowed —
//     this fails closed, not open.
//   - Non-production: reflect back whatever Origin the request actually
//     came from (still never a literal "*"), UNLESS ALLOWED_ORIGIN is
//     explicitly set, in which case only origins in that list are
//     honored even in dev/test — useful for rehearsing the production
//     policy locally. Reflecting the origin in dev preserves today's
//     behavior: nothing in this codebase or its tests currently depends
//     on any particular CORS policy (confirmed: no test sends an Origin
//     header at all), so this is purely additive.
//
// Why multiple origins: this backend serves more than one deployed
// frontend on different domains (e.g. the admin dashboard and the
// public customer site) — CORS must allow each of them by exact
// string, never by wildcard, and never by loosely matching a prefix.
//
// Gotcha this parsing defends against: a trailing slash. A browser's
// Origin header is ALWAYS scheme+host+port with NO trailing slash and
// NO path (e.g. "https://example.com", never "https://example.com/").
// If someone pastes a URL with a trailing slash into ALLOWED_ORIGIN, an
// exact-match comparison would silently never match anything — so
// trailing slashes and surrounding whitespace are stripped from each
// configured entry before comparison.
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

/** Parses ALLOWED_ORIGIN into a clean array — comma-separated, trailing
 *  slashes and surrounding whitespace stripped, empty entries dropped. */
function parseConfiguredOrigins() {
  const raw = process.env.ALLOWED_ORIGIN;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
}

function resolveAllowedOrigin(requestOrigin) {
  const env = process.env.NODE_ENV || 'development';
  const configuredOrigins = parseConfiguredOrigins();

  if (env === 'production') {
    if (requestOrigin && configuredOrigins.includes(requestOrigin)) return requestOrigin;
    return null; // fail closed: no match => nobody is allowed, never '*'
  }

  if (configuredOrigins.length > 0) {
    return requestOrigin && configuredOrigins.includes(requestOrigin) ? requestOrigin : null;
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
