// ============================================================
// Facebook Webhook Route — Step 31/36: now genuinely wired end-to-end.
//
// Two real gaps were found and fixed here when connecting to a real
// Facebook App for the first time (both previously only exercised via
// simplified test fixtures, never against real Facebook shapes):
//
// 1. PAYLOAD SHAPE: real Facebook sends a nested envelope
//    { entry: [{ id: page_id, messaging: [{ sender, message }] }] },
//    not the flat { page_id, message_id, ... } shape this project's
//    own tests used throughout. `normalizeIncomingEvents()` below
//    accepts BOTH — real Facebook envelopes are parsed into the same
//    internal shape, and the existing simplified shape (used by every
//    existing test) still works completely unchanged.
//
// 2. AI RESPONSE LOOP WAS NEVER WIRED: this route used to record the
//    inbound message and stop — nothing ever called the AI
//    orchestrator or sent a reply. `respondToMessage()` below is the
//    real wiring: build conversation history -> runConversationTurn()
//    (real Claude, via aiOrchestrator's default client) -> queue the
//    reply -> dispatchOne() (real Facebook Send API). AI/send failures
//    are caught and logged — they must never break Facebook's webhook
//    acknowledgement (the inbound message is already safely recorded
//    and idempotency-keyed by that point).
// ============================================================
'use strict';
const { contextFromFacebookPage, DealerContextError } = require('../context/dealerContext');
const idempotencyService = require('../services/idempotencyService');
const conversationService = require('../services/conversationService');
const outboundMessageService = require('../services/outboundMessageService');
const { dispatchOne } = require('../services/outboundDispatchService');
const { runConversationTurn } = require('../ai/aiOrchestrator');
const { inboundQueue } = require('../queue/queueInterface');
const { verifySignature, verifySubscriptionHandshake } = require('../integrations/facebookSignature');
const { AppError } = require('../errors');

/** Accepts EITHER a real Facebook envelope or this project's simplified
 *  flat test shape, and returns a normalized array of events. */
function normalizeIncomingEvents(body) {
  if (Array.isArray(body.entry)) {
    const events = [];
    for (const entry of body.entry) {
      const page_id = entry.id;
      for (const msg of (entry.messaging || [])) {
        if (!msg.message || msg.message.is_echo) continue; // skip delivery receipts / our own echoed sends
        events.push({
          page_id,
          message_id: msg.message.mid,
          sender_psid: msg.sender && msg.sender.id,
          text: msg.message.text,
          phone: undefined, // Facebook never puts a phone number in the message envelope itself
        });
      }
    }
    return events;
  }
  if (body.page_id && body.message_id) {
    return [{ page_id: body.page_id, message_id: body.message_id, sender_psid: body.sender_psid, text: body.text, phone: body.phone }];
  }
  return [];
}

/** The real AI response wiring. Never throws — a failure here must not
 *  break Facebook's webhook acknowledgement for an already-recorded message. */
async function respondToMessage(context, { conversation_id, page_id, recipient_psid, correlationId }) {
  try {
    const history = conversationService.getConversationHistory(context, conversation_id).map((m) => ({
      role: m.sender_type === 'CUSTOMER' ? 'user' : 'assistant',
      content: m.text || '',
    }));
    const result = await runConversationTurn(context, history);

    // Send any real photos the AI looked up as actual image messages —
    // this is decided structurally here, not left to the AI's judgment,
    // matching the AI Tool Boundary philosophy elsewhere in this project.
    // Only genuine http(s) URLs can be sent: Facebook's Send API fetches
    // the image itself from that URL — a base64 data: URI (what this
    // project's direct-file-upload feature stores) is never usable here,
    // since it never existed as a real internet-reachable resource.
    const photoLookups = (result.toolCallsMade || []).filter((c) => c.name === 'getTruckPhotos' && !c.result.is_error);
    for (const call of photoLookups) {
      let photos = [];
      try { photos = JSON.parse(call.result.content); } catch (_) { /* ignore malformed */ }
      const sendable = photos.find((p) => /^https?:\/\//.test(p.storage_reference || ''));
      if (!sendable) {
        if (photos.length > 0) {
          console.log(`[${correlationId}] getTruckPhotos found ${photos.length} photo(s) but none had a real http(s) URL (likely uploaded via direct file upload, which stores base64 — cannot be sent to Facebook) — skipping image send`);
        }
        continue;
      }
      const queuedImage = outboundMessageService.queueMessage(context, {
        conversation_id, page_id, recipient_psid, message_type: 'IMAGE', message_content: sendable.storage_reference,
      });
      await dispatchOne(context, queuedImage.message_id).catch((sendErr) => {
        console.error(`[${correlationId}] outbound IMAGE send failed:`, sendErr.message);
      });
    }

    if (!result.finalText) return; // AI made only tool calls / a Handoff this turn, nothing to say back yet

    const queued = outboundMessageService.queueMessage(context, {
      conversation_id, page_id, recipient_psid, message_content: result.finalText,
    });
    conversationService.recordMessage(context, {
      conversation_id, direction: 'OUTBOUND', sender_type: 'AI', text: result.finalText,
    });
    await dispatchOne(context, queued.message_id).catch((sendErr) => {
      console.error(`[${correlationId}] outbound send failed:`, sendErr.message);
    });
  } catch (aiErr) {
    // Known limitation: a failed AI turn here is logged only, not retried.
    // The inbound message itself is already safely recorded — see module header.
    // Log the FULL error detail (never just .message) — for an AI_ERROR from
    // claudeService.js this includes the real response body Claude sent
    // back explaining why (e.g. billing/credit issue, invalid request
    // field, etc.) — this was previously discarded, making a 400 essentially
    // undiagnosable from the logs alone.
    console.error(`[${correlationId}] AI response failed: ${aiErr.message}`, aiErr.details ? JSON.stringify(aiErr.details) : '');
  }
}

function register(router) {
  // ---- GET: Facebook's one-time subscription verification handshake ----
  router.get('/api/facebook/webhook', async ({ query, correlationId }) => {
    console.log(`[${correlationId}] Facebook webhook GET verification request received: mode=${query['hub.mode']}`);
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
    const result = verifySubscriptionHandshake(query, verifyToken);
    if (!result.ok) {
      console.warn(`[${correlationId}] webhook GET verification FAILED`);
      throw new AppError('AUTH_ERROR', 'webhook verification failed');
    }
    console.log(`[${correlationId}] webhook GET verification succeeded`);
    // Facebook requires the raw challenge string back as plain text, NOT
    // JSON — this is why `raw: true` exists as a special case in router.js.
    return { raw: true, body: result.challenge };
  });

  // ---- POST: actual incoming events ----
  router.post('/api/facebook/webhook', async ({ body, rawBody, req, correlationId }) => {
    console.log(`[${correlationId}] Facebook webhook POST received, body length=${(rawBody || '').length}`);
    const events = normalizeIncomingEvents(body);
    console.log(`[${correlationId}] normalized ${events.length} event(s) from the payload`);
    if (events.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'page_id and message_id are required');
    }

    // ---- Signature verification (computed once over the whole raw body) ----
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const signatureHeader = req.headers['x-hub-signature-256'];
    const env = process.env.NODE_ENV || 'development';
    if (appSecret) {
      const valid = verifySignature(rawBody, signatureHeader, appSecret);
      if (!valid) {
        throw new AppError('AUTH_ERROR', 'invalid webhook signature');
      }
    } else if (env === 'production') {
      throw new AppError('AUTH_ERROR', 'FACEBOOK_APP_SECRET is not configured; refusing to process unverified webhook in production');
    } else {
      console.warn(`[${correlationId}] Facebook signature verification SKIPPED — FACEBOOK_APP_SECRET not configured (env=${env}, dev/test only)`);
    }

    const results = [];
    for (const evt of events) {
      const { page_id, message_id, sender_psid, text, phone } = evt;

      let context;
      try {
        context = contextFromFacebookPage(page_id, correlationId);
      } catch (e) {
        if (e instanceof DealerContextError) {
          console.warn(`[${correlationId}] BLOCKED — no dealer found for page_id=${page_id}`);
          results.push({ status: 'BLOCKED', reason: 'DEALER_CONTEXT_ERROR' });
          continue;
        }
        throw e;
      }

      const idem = idempotencyService.checkAndRecord({ page_id, message_id, dealer_id: context.dealer_id });
      if (!idem.isNew) {
        console.log(`[${correlationId}] DUPLICATE — message_id=${message_id} already processed`);
        results.push({ status: 'DUPLICATE' });
        continue;
      }

      const job = inboundQueue.enqueue({ context, page_id, sender_psid, message_id, text, phone });

      const match = conversationService.matchCustomerForConversation(context, { page_id, sender_psid, phone });
      conversationService.recordMessage(context, {
        conversation_id: match.conversation.conversation_id, direction: 'INBOUND', sender_type: 'CUSTOMER',
        text, raw_platform_reference: message_id, message_id: 'MSG-' + message_id,
      });

      // Real AI wiring — awaited so failures are visible in this response's
      // processing, but internally never throws (see respondToMessage above).
      console.log(`[${correlationId}] processed event for page ${page_id}, conversation ${match.conversation.conversation_id}, calling AI now...`);
      await respondToMessage(context, { conversation_id: match.conversation.conversation_id, page_id, recipient_psid: sender_psid, correlationId });
      console.log(`[${correlationId}] AI turn finished for conversation ${match.conversation.conversation_id}`);

      results.push({
        status: 'PROCESSED',
        dealer_id: context.dealer_id,
        conversation_id: match.conversation.conversation_id,
        customer_match: match.status,
        queued_job_id: job.id,
      });
    }

    // Preserve the exact single-object response shape every existing test
    // expects when there's exactly one event (the simplified/common case).
    if (results.length === 1) {
      return { data: results[0] };
    }
    return { data: { results } };
  });
}

module.exports = { register };
