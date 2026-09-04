// ============================================================
// Environment / Secret Configuration Foundation — Step 29 §14/§17
// Reads from process.env only. Never logs secret VALUES — at most
// logs whether a variable is present, for startup diagnostics.
// No real secrets exist in this repository; see ../../.env.example.
// ============================================================
'use strict';

const REQUIRED_IN_PRODUCTION = [
  // Step 31: these are now actually needed once Facebook/Claude are live.
  // Left OUT of this list in Step 30A/30B because neither integration existed yet.
  'FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'CLAUDE_API_KEY',
];

function loadConfig() {
  const config = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: Number(process.env.PORT || 3001),
    DATABASE_PATH: process.env.DATABASE_PATH || null, // falls back to default in db/connection.js
  };

  if (config.NODE_ENV === 'production') {
    const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
    if (missing.length) {
      // Report WHICH names are missing, never their values.
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
  return config;
}

module.exports = { loadConfig };
