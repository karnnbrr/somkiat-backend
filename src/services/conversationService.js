// ============================================================
// Conversation Service — Step 20-22 / 28 / 30B (Messenger prep)
//
// Implements the Customer/Conversation matching state machine:
//   New PSID, no phone         -> PENDING_NO_PHONE (Interaction ok, no Customer yet)
//   Existing PSID               -> MATCHED (reuse existing Customer)
//   New PSID + phone matches    -> MATCHED (link PSID to existing Customer)
//   New PSID + phone new        -> CREATED (new Customer)
//   Phone matches >1 candidate  -> AMBIGUOUS -> caller must Handoff, never auto-merge
//
// The AMBIGUOUS branch is intentionally defensive: the database schema
// enforces UNIQUE(dealer_id, phone), so more than one candidate is not
// reachable through this service today. `decideMatchOutcome` is
// exported and unit-tested in isolation specifically so this branch's
// LOGIC is verified even though the current schema can't construct the
// scenario end-to-end — see tests/conversationService.test.js.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');

/** Pure decision function — no DB access — so the branching logic itself is directly testable. */
function decideMatchOutcome(candidates) {
  if (!candidates || candidates.length === 0) return 'NONE';
  if (candidates.length === 1) return 'ONE';
  return 'AMBIGUOUS';
}

function startOrGetConversation(context, { page_id, sender_psid }) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM conversations WHERE dealer_id = ? AND page_id = ? AND sender_psid = ? ORDER BY rowid DESC LIMIT 1'
  ).get(context.dealer_id, page_id, sender_psid);
  if (existing) return existing;

  const conversation_id = 'CONV-' + crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (conversation_id, dealer_id, page_id, sender_psid, correlation_id) VALUES (?, ?, ?, ?, ?)'
  ).run(conversation_id, context.dealer_id, page_id || null, sender_psid || null, context.request_id || null);
  return db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(conversation_id);
}

/**
 * Matches (or creates) a Customer for an inbound conversation.
 * Returns { status, customer, conversation }.
 */
function matchCustomerForConversation(context, { page_id, sender_psid, phone, name }) {
  const db = getDb();
  const conversation = startOrGetConversation(context, { page_id, sender_psid });

  // 1) PSID already linked to a Customer on a prior conversation -> MATCHED, no re-asking.
  if (conversation.customer_id) {
    const customer = db.prepare('SELECT * FROM customers WHERE dealer_id = ? AND customer_id = ?')
      .get(context.dealer_id, conversation.customer_id);
    if (customer) return { status: 'MATCHED', customer, conversation, matchedBy: 'psid' };
  }

  // 2) No PSID match yet. If no phone was given either, this is a legitimate
  //    pending state — an Interaction can still be created, just no formal Customer yet.
  if (!phone) {
    return { status: 'PENDING_NO_PHONE', customer: null, conversation, matchedBy: 'none' };
  }

  // 3) Phone given — look up ALL candidates for (dealer_id, phone), never assume at most one
  //    even though the schema's UNIQUE constraint already guarantees it (defense in depth).
  const candidates = db.prepare('SELECT * FROM customers WHERE dealer_id = ? AND phone = ?').all(context.dealer_id, phone);

  const outcome = decideMatchOutcome(candidates);

  if (outcome === 'AMBIGUOUS') {
    audit.record(context, {
      action_type: 'CUSTOMER_MATCH_AMBIGUOUS', entity: 'conversation', entity_id: conversation.conversation_id,
      reason: `phone=${phone} matched ${candidates.length} customer rows`,
    });
    return { status: 'AMBIGUOUS', customer: null, conversation, candidates };
  }

  let customer;
  if (outcome === 'ONE') {
    customer = candidates[0];
  } else {
    // outcome === 'NONE' -> create a new Customer
    const customer_id = 'CUST-' + crypto.randomUUID();
    db.prepare(
      'INSERT INTO customers (customer_id, dealer_id, name, phone, contact_channel, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(customer_id, context.dealer_id, name || null, phone, 'facebook_messenger', 'Facebook Ad');
    customer = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customer_id);
    audit.record(context, { action_type: 'CUSTOMER_CREATED', entity: 'customer', entity_id: customer_id });
  }

  // Link this conversation (and therefore this PSID) to the resolved customer.
  db.prepare('UPDATE conversations SET customer_id = ? WHERE dealer_id = ? AND conversation_id = ?')
    .run(customer.customer_id, context.dealer_id, conversation.conversation_id);

  return { status: 'MATCHED', customer, conversation: { ...conversation, customer_id: customer.customer_id }, matchedBy: outcome === 'ONE' ? 'phone' : 'created' };
}

function recordMessage(context, { conversation_id, direction, sender_type, message_type, text, raw_platform_reference, message_id }) {
  const db = getDb();
  const id = message_id || 'MSG-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (message_id, dealer_id, conversation_id, direction, sender_type, message_type, text, raw_platform_reference, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, context.dealer_id, conversation_id, direction, sender_type, message_type || 'TEXT', text || null, raw_platform_reference || null, context.request_id || null);
  db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE dealer_id = ? AND conversation_id = ?")
    .run(context.dealer_id, conversation_id);
  return db.prepare('SELECT * FROM messages WHERE message_id = ?').get(id);
}

function getConversationHistory(context, conversation_id, { limit = 50 } = {}) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM messages WHERE dealer_id = ? AND conversation_id = ? ORDER BY rowid ASC LIMIT ?'
  ).all(context.dealer_id, conversation_id, limit);
}

function listConversations(context, { limit = 50 } = {}) {
  const db = getDb();
  const conversations = db.prepare(
    'SELECT * FROM conversations WHERE dealer_id = ? ORDER BY rowid DESC LIMIT ?'
  ).all(context.dealer_id, limit);
  // Attach a lightweight preview of the last message + customer name, since
  // that's what a conversation list UI needs — still just SELECTs, no new logic.
  return conversations.map((c) => {
    const lastMessage = db.prepare(
      'SELECT * FROM messages WHERE dealer_id = ? AND conversation_id = ? ORDER BY rowid DESC LIMIT 1'
    ).get(context.dealer_id, c.conversation_id);
    const customer = c.customer_id
      ? db.prepare('SELECT customer_id, name, phone FROM customers WHERE dealer_id = ? AND customer_id = ?').get(context.dealer_id, c.customer_id)
      : null;
    return { ...c, last_message_preview: lastMessage ? lastMessage.text : null, customer };
  });
}

module.exports = {
  decideMatchOutcome, startOrGetConversation, matchCustomerForConversation,
  recordMessage, getConversationHistory, listConversations,
};
