// ============================================================
// Server Entry Point
// ============================================================
'use strict';
const http = require('node:http');
const { loadConfig } = require('./config/env');
const { runMigrations } = require('./db/migrate');
const { closeDb } = require('./db/connection');
const { Router } = require('./router');

function buildRouter() {
  const router = new Router();

  // Health check (Step 30B §25) — no secrets, no internal paths, no DB details.
  router.get('/health', async () => ({ data: { status: 'ok' } }));

  require('./routes/auth').register(router);
  require('./routes/stock').register(router);
  require('./routes/sales').register(router);
  require('./routes/handoffs').register(router);
  require('./routes/customers').register(router);
  require('./routes/photos').register(router);
  require('./routes/followUps').register(router);
  require('./routes/facebookWebhook').register(router);
  require('./routes/dashboard').register(router);
  require('./routes/conversations').register(router);
  require('./routes/attribution').register(router);
  require('./routes/public').register(router);
  require('./routes/dealerInfo').register(router);
  require('./routes/news').register(router);
  return router;
}

function startServer() {
  const config = loadConfig();
  runMigrations();
  const router = buildRouter();
  const server = http.createServer((req, res) => router.handle(req, res));
  server.listen(config.PORT, () => {
    console.log(`[server] S.K.AUTOTRUCK backend listening on port ${config.PORT} (env=${config.NODE_ENV})`);
  });

  // Graceful shutdown (Step 30B §24): stop accepting new connections, let
  // in-flight requests finish, then close the DB handle and exit cleanly.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down gracefully...`);
    server.close(() => {
      closeDb();
      console.log('[server] closed HTTP server and database connection. Exiting.');
      process.exit(0);
    });
    // Safety net: force-exit if close() hangs longer than this.
    setTimeout(() => {
      console.error('[server] graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, buildRouter };
