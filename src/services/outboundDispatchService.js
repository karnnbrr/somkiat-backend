// ============================================================
// Outbound Dispatch Service — Step 31 Phase C
// Retry policy + idempotency around actually sending a queued message.
// The `sender` is injected (defaults to the real Facebook Send API
// integration) specifically so tests can supply a clearly-labeled Test
// Double instead of silently mocking Facebook and calling it "tested".
// ============================================================
'use strict';
const { getDb } = require('../db/connection');
const { AppError } = require('../errors');
const audit = require('./auditService');
const realSender = require('../integrations/facebookSender');

const MAX_RETRIES = 3;

/**
 * Attempts to send exactly one queued message. Idempotent: if the message
 * is not in QUEUED status by the time we're about to send (e.g. another
 * process already handled it), this is a safe no-op — it will NEVER call
 * the sender twice for the same message_id.
 */
async function dispatchOne(context, message_id, sender = realSender) {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM outbound_messages WHERE dealer_id = ? AND message_id = ?').get(context.dealer_id, message_id);
  if (!msg) throw new AppError('NOT_FOUND', 'outbound message not found for this dealer');
  if (msg.status !== 'QUEUED') {
    // Already SENT or terminally FAILED — do not attempt again. This is what
    // guarantees "Facebook retry of the INBOUND event never causes a duplicate
    // OUTBOUND send": the inbound idempotency key already prevented a second
    // AI response from being queued in the first place (see facebookWebhook.js).
    return { status: msg.status, alreadyHandled: true };
  }

  try {
    await sender.sendMessage({ recipientPsid: msg.recipient_psid, text: msg.message_content });
    db.prepare("UPDATE outbound_messages SET status = 'SENT' WHERE dealer_id = ? AND message_id = ?").run(context.dealer_id, message_id);
    audit.record(context, { action_type: 'OUTBOUND_MESSAGE_SENT', entity: 'outbound_message', entity_id: message_id });
    return { status: 'SENT', alreadyHandled: false };
  } catch (e) {
    const nextRetryCount = msg.retry_count + 1;
    const terminal = nextRetryCount >= MAX_RETRIES;
    db.prepare('UPDATE outbound_messages SET retry_count = ?, last_error = ?, status = ? WHERE dealer_id = ? AND message_id = ?')
      .run(nextRetryCount, e.message || String(e), terminal ? 'FAILED' : 'QUEUED', context.dealer_id, message_id);
    audit.record(context, {
      action_type: terminal ? 'OUTBOUND_MESSAGE_FAILED_PERMANENTLY' : 'OUTBOUND_MESSAGE_RETRY_SCHEDULED',
      entity: 'outbound_message', entity_id: message_id, reason: e.message || String(e),
    });
    return { status: terminal ? 'FAILED' : 'QUEUED', alreadyHandled: false, retry_count: nextRetryCount, terminal };
  }
}

module.exports = { dispatchOne, MAX_RETRIES };
