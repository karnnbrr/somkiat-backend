// ============================================================
// Audit Foundation — Step 19/29 §12
// Append-only: this module intentionally exposes no update()/delete().
// dealer_id is mandatory — record() throws if it's missing, so it is
// structurally impossible to write an audit row with no dealer scope.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');

function record(context, { action_type, entity, entity_id, old_value, new_value, reason }) {
  if (!context || !context.dealer_id) {
    throw new Error('AUDIT_WITHOUT_DEALER_ID_FORBIDDEN');
  }
  const db = getDb();
  const audit_id = 'AUD-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO audit_log (audit_id, dealer_id, actor, action_type, entity, entity_id, old_value, new_value, reason, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    audit_id,
    context.dealer_id,
    context.user_id || context.role || 'unknown',
    action_type,
    entity || null,
    entity_id || null,
    old_value != null ? String(old_value) : null,
    new_value != null ? String(new_value) : null,
    reason || null,
    context.request_id || null
  );
  return audit_id;
}

/** Read-only accessor, always scoped by dealer_id — no cross-dealer audit reads possible.
 *  Ordered by SQLite's internal rowid (insertion order) as a tiebreaker, since
 *  `created_at` only has 1-second text resolution and ties would otherwise sort
 *  unpredictably — this was caught by a Step 30B regression test. */
function listForDealer(context, { limit = 100 } = {}) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM audit_log WHERE dealer_id = ? ORDER BY rowid DESC LIMIT ?')
    .all(context.dealer_id, limit);
}

module.exports = { record, listForDealer };
