// ============================================================
// Idempotency Foundation — Step 28/29 §10/§19
// Persistent (SQLite), not in-memory — survives process restarts.
// Key: (page_id, message_id). UNIQUE PRIMARY KEY enforces atomicity
// even if two requests race (INSERT will fail for the loser).
// ============================================================
'use strict';
const { getDb } = require('../db/connection');

/**
 * Returns { isNew: true } and records the key if this is the first time
 * we've seen (page_id, message_id). Returns { isNew: false } if it's a
 * duplicate — caller must treat this as a no-op, not an error.
 */
function checkAndRecord({ page_id, message_id, dealer_id }) {
  const db = getDb();
  const key = `${page_id}::${message_id}`;
  const existing = db.prepare('SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key = ?').get(key);
  if (existing) {
    return { isNew: false, key };
  }
  try {
    db.prepare(
      'INSERT INTO idempotency_keys (idempotency_key, page_id, message_id, dealer_id) VALUES (?, ?, ?, ?)'
    ).run(key, page_id, message_id, dealer_id || null);
    return { isNew: true, key };
  } catch (e) {
    // Unique constraint violation = a concurrent request already recorded it first.
    return { isNew: false, key };
  }
}

module.exports = { checkAndRecord };
