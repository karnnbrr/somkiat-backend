// ============================================================
// Outbound Message Service — Step 28 §12 / 29 §12 / 30B §7
// Nothing in this file calls Facebook. It only manages the local
// record of what SHOULD be sent, so that a future Facebook Sender
// worker has a real, auditable queue to consume from.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { AppError } = require('../errors');
const audit = require('./auditService');

function queueMessage(context, { conversation_id, page_id, recipient_psid, message_type, message_content }) {
  if (!recipient_psid || !message_content) {
    throw new AppError('VALIDATION_ERROR', 'recipient_psid and message_content are required');
  }
  const db = getDb();
  const message_id = 'OUT-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO outbound_messages (message_id, dealer_id, page_id, conversation_id, recipient_psid, message_content, status, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?)`
  ).run(message_id, context.dealer_id, page_id || null, conversation_id || null, recipient_psid, message_content, context.request_id || null);
  audit.record(context, { action_type: 'OUTBOUND_MESSAGE_QUEUED', entity: 'outbound_message', entity_id: message_id });
  return db.prepare('SELECT * FROM outbound_messages WHERE message_id = ?').get(message_id);
}

function markSent(context, message_id) {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM outbound_messages WHERE dealer_id = ? AND message_id = ?').get(context.dealer_id, message_id);
  if (!msg) throw new AppError('NOT_FOUND', 'outbound message not found for this dealer');
  db.prepare("UPDATE outbound_messages SET status = 'SENT' WHERE dealer_id = ? AND message_id = ?").run(context.dealer_id, message_id);
  audit.record(context, { action_type: 'OUTBOUND_MESSAGE_SENT', entity: 'outbound_message', entity_id: message_id });
  return db.prepare('SELECT * FROM outbound_messages WHERE message_id = ?').get(message_id);
}

function markFailed(context, message_id, reason) {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM outbound_messages WHERE dealer_id = ? AND message_id = ?').get(context.dealer_id, message_id);
  if (!msg) throw new AppError('NOT_FOUND', 'outbound message not found for this dealer');
  db.prepare("UPDATE outbound_messages SET status = 'FAILED' WHERE dealer_id = ? AND message_id = ?").run(context.dealer_id, message_id);
  audit.record(context, { action_type: 'OUTBOUND_MESSAGE_FAILED', entity: 'outbound_message', entity_id: message_id, reason: reason || null });
  return db.prepare('SELECT * FROM outbound_messages WHERE message_id = ?').get(message_id);
}

function listQueued(context) {
  const db = getDb();
  return db.prepare("SELECT * FROM outbound_messages WHERE dealer_id = ? AND status = 'QUEUED' ORDER BY rowid ASC").all(context.dealer_id);
}

module.exports = { queueMessage, markSent, markFailed, listQueued };
