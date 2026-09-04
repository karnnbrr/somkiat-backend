# S.K.AUTOTRUCK — Backend Foundation (Step 30A)

Production backend foundation built from the Approved System Contract in
Step 13–29. This is **not a mock** — it is a real Node.js server backed by
a real SQLite database, with automated tests that actually run.

## Quick start

```bash
npm run migrate   # create the SQLite schema (data/somkiat.db)
npm run seed       # create DEALER_SOMKIAT + demo users + 1 demo truck
npm start           # start the HTTP server (default port 3001)
npm test             # run the automated test suite (node's built-in test runner)
```

Demo logins created by `npm run seed` (change these before any real use):
- `staff1` / `changeme123` (role: staff)
- `manager1` / `changeme123` (role: manager)

## Why no framework / no npm packages (Express, an ORM, bcrypt, JWT, etc.)

This build environment has **no network access to the npm registry**
(`npm ping` returns `403 Forbidden`). Rather than leave the foundation
unbuilt, every piece here is built on **Node.js 22 built-ins only**:

| Need | Built-in used instead of a package |
|---|---|
| HTTP server / routing | `node:http` + a ~90-line custom router (`src/router.js`) |
| SQL database | `node:sqlite` (`DatabaseSync`) — real relational SQL, file-based |
| Password hashing | `crypto.scryptSync` (instead of bcrypt) |
| Session tokens | `crypto.randomBytes` opaque tokens stored server-side (instead of JWT) |
| Automated tests | `node:test` + `node:assert` (instead of Jest/Mocha) |

The Business Logic layer (`src/services/*.js`) is framework-agnostic — if a
future environment has network access and the team wants to add
Express/Fastify/an ORM for convenience, only `src/router.js` and
`src/server.js` need to change. The services, database schema, and tests
do not.

## Project structure

```
src/
  config/env.js          Environment/secret loading (Step 29 §14)
  context/dealerContext.js  Trusted server-side Dealer Context (Step 27.1/29 §5)
  db/
    connection.js         SQLite singleton connection
    migrations/001_init.sql   Full schema (Step 14-28 entities)
    migrate.js / seed.js
  errors.js               Standard Error Model (Step 29 §11/§18)
  middleware/
    auth.js                Authorization-header -> trusted context
    permission.js           STAFF/MANAGER permission table (Step 19/27)
    requestId.js             Correlation ID generator
  services/                 Business Logic Layer — the ONLY thing allowed to touch the DB
    stockService.js, saleService.js (Safety Gate), crmService.js,
    photoService.js, handoffService.js, auditService.js,
    idempotencyService.js, authService.js
  ai/aiTools.js             Approved AI Tool Interface (NOT connected to Claude yet)
  routes/                   Thin HTTP adapters -> services
  router.js, server.js
tests/                      node:test files — see "Testing" below
```

## The most important design rule in this codebase

```
AI  ─▶  Approved Tool Interface (ai/aiTools.js)  ─▶  Business Logic (services/*.js)  ─▶  Database
```

`ai/aiTools.js` is never given a `dealer_id` parameter to accept from a
caller — every tool function closes over a `context` object created
**only** by `dealerContext.js`, which in turn only ever derives
`dealer_id` from an authenticated session or a resolved Facebook
`page_id`. There is no code path, accidental or otherwise, by which an
AI response could point at a different dealer's data. This is proven,
not just asserted — see `tests/aiTools.test.js`.

## Testing

Run `npm test`. Current result (Step 31): 111 passed, 0 failed, 5 skipped
(skips are genuinely-blocked items — see "Step 31 status" below).

## Step 31 status - Facebook + Claude integration

Real and tested (no network needed):
- Facebook webhook signature verification (src/integrations/facebookSignature.js) - real HMAC-SHA256, tested with a test secret, including a tampered-body rejection test
- Facebook subscription handshake (GET /api/facebook/webhook)
- The full AI Tool Boundary + dispatch loop (src/ai/aiOrchestrator.js) - tested with fixture Claude-shaped responses proving forbidden tools/dealer overrides/prompt injection are all rejected
- Outbound message retry policy + idempotency (src/services/outboundDispatchService.js) - tested with a Test Double sender
- Startup safety - the server now refuses to start with NODE_ENV=production unless FACEBOOK_APP_SECRET, FACEBOOK_VERIFY_TOKEN, FACEBOOK_PAGE_ACCESS_TOKEN, and CLAUDE_API_KEY are all set

BLOCKED / NEEDS CREDENTIALS in this environment (not faked, not tested against the real thing):
- src/integrations/facebookSender.js - real HTTPS call structure to Facebook's Send API, never executed against graph.facebook.com (this sandbox's egress proxy returns x-deny-reason: host_not_allowed for that host, and no FACEBOOK_PAGE_ACCESS_TOKEN exists here anyway)
- src/ai/claudeService.js - real HTTPS call structure to api.anthropic.com, never executed (no CLAUDE_API_KEY in this environment)
- Any test involving these two integrations uses an explicitly-labeled Test Double, documented in that test file's header comment, and never claims to have exercised the real API

Tests are real: several spin up an actual HTTP server on an ephemeral
port and make real `http` requests against it; others force genuine
database-level failures (e.g. a foreign-key violation) to prove
transaction rollback actually works, not just that it's supposed to.

## Known limitations (see full Step 30A report for details)

- No persistence layer for Facebook/Claude API connections (intentionally
  out of scope for Step 30A).
- Only a subset of entities have HTTP routes wired (stock, sales,
  handoffs, auth). Customer/photo/follow-up logic is fully built and
  tested at the service layer, but not yet exposed over HTTP — this is
  a small, low-risk addition for a later step.
- `node:sqlite` is an experimental Node.js API (stable enough for this
  foundation; worth re-checking its status before a production launch).
