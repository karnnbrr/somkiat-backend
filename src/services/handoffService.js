'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');

const PRIORITY_MAP = {
  RESERVATION_REQUEST: 'HIGH', PRICE_NEGOTIATION: 'HIGH', SPECIAL_PRICE: 'HIGH',
  FINANCE_SPECIFIC: 'HIGH', COMPLAINT: 'HIGH', CUSTOMER_REQUEST_HUMAN: 'HIGH', DATA_CONFLICT: 'HIGH',
  AI_UNCERTAIN: 'NORMAL', OUT_OF_SCOPE: 'NORMAL', OTHER: 'LOW',
};

/** Creates a new handoff, OR appends to an existing open one for the same conversation+reason (Step 23 dedup rule). */
function createHandoff(context, { conversation_id, customer_id, truck_interest_id, truck_id, reason, summary }) {
  const db = getDb();
  const existing = db.prepare(
    `SELECT * FROM handoffs WHERE dealer_id = ? AND conversation_id = ? AND reason = ? AND status NOT IN ('Resolved','Closed')`
  ).get(context.dealer_id, conversation_id, reason);
  if (existing) {
    db.prepare('UPDATE handoffs SET summary = ? WHERE dealer_id = ? AND handoff_id = ?').run(summary || existing.summary, context.dealer_id, existing.handoff_id);
    return { ...existing, summary: summary || existing.summary, created: false };
  }
  const handoff_id = 'HO-' + crypto.randomUUID();
  const priority = PRIORITY_MAP[reason] || 'NORMAL';
  db.prepare(
    `INSERT INTO handoffs (handoff_id, dealer_id, conversation_id, customer_id, truck_interest_id, truck_id, reason, priority, summary, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')`
  ).run(handoff_id, context.dealer_id, conversation_id || null, customer_id || null, truck_interest_id || null, truck_id || null, reason, priority, summary || null);
  audit.record(context, { action_type: 'HANDOFF_CREATED', entity: 'handoff', entity_id: handoff_id, reason });
  return db.prepare('SELECT * FROM handoffs WHERE handoff_id = ?').get(handoff_id);
}

function acceptHandoff(context, handoff_id) {
  requirePermission(context, 'handoff.accept');
  const db = getDb();
  const h = db.prepare('SELECT * FROM handoffs WHERE dealer_id = ? AND handoff_id = ?').get(context.dealer_id, handoff_id);
  if (!h) throw new AppError('NOT_FOUND', 'handoff not found for this dealer');
  db.prepare("UPDATE handoffs SET status = 'Assigned', assigned_staff = ? WHERE dealer_id = ? AND handoff_id = ?")
    .run(context.user_id || context.role, context.dealer_id, handoff_id);
  audit.record(context, { action_type: 'HANDOFF_ACCEPTED', entity: 'handoff', entity_id: handoff_id });
  return db.prepare('SELECT * FROM handoffs WHERE handoff_id = ?').get(handoff_id);
}

function listOpenHandoffs(context) {
  const db = getDb();
  return db.prepare("SELECT * FROM handoffs WHERE dealer_id = ? AND status NOT IN ('Resolved','Closed') ORDER BY priority ASC, created_at ASC")
    .all(context.dealer_id);
}

module.exports = { createHandoff, acceptHandoff, listOpenHandoffs };
