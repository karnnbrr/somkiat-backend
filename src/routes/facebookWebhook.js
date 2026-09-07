// ============================================================
// Facebook Webhook Route — STUB ONLY.
//
// This endpoint is NOT connected to the real Facebook Graph API.
// There is no outbound call to facebook.com anywhere in this file
// or anywhere in this codebase. It exists only to exercise the
// Dealer Resolution + Idempotency foundation end-to-end against a
// payload SHAPE that matches the Step 28 contract, so those pieces
// are real, tested code rather than just a diagram.
//
// Wiring this to a real Facebook App (signature verification with
// the real App Secret, etc.) is explicitly out of scope until a
// later step per the Step 30A rules.
// ============================================================
'use strict';
const { contextFromFacebookPage, DealerContextError } = require('../context/dealerContext');
const idempotencyService = require('../services/idempotencyService');
const conversationService = require('../services/conversationService');
const { inboundQueue } = require('../queue/queueInterface');
const { verifySignature, verifySubscriptionHandshake } = require('../integrations/facebookSignature');
const { AppError } = require('../errors');

function register(router) {
  // ---- GET: Facebook's one-time subscription verification handshake ----
  router.get('/api/facebook/webhook', async ({ query }) => {
    const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
    const result = verifySubscriptionHandshake(query, verifyToken);
    if (!result.ok) {
      throw new AppError('AUTH_ERROR', 'webhook verification failed');
    }
    // Facebook requires the raw challenge string back as plain text, NOT
    // JSON — this is why `raw: true` exists as a special case in router.js.
    return { raw: true, body: result.challenge };
  });

  // ---- POST: actual incoming events ----
  router.post('/api/facebook/webhook', async ({ body, rawBody, req, correlationId }) => {
    const { page_id, message_id, sender_psid, text, phone } = body;
    if (!page_id || !message_id) {
      throw new AppError('VALIDATION_ERROR', 'page_id and message_id are required');
    }

    // ---- Signature verification (Step 31 Phase A) ----
    // Fail CLOSED in production: a missing/invalid signature is rejected.
    // Fail OPEN (with a loud log) outside production, so the rest of the
    // pipeline remains testable without a real Facebook App Secret — this
    // environment has neither the secret nor network access to Facebook.
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

    let context;
    try {
      context = contextFromFacebookPage(page_id, correlationId);
    } catch (e) {
      if (e instanceof DealerContextError) {
        return { status: 200, data: { status: 'BLOCKED', reason: 'DEALER_CONTEXT_ERROR' } };
      }
      throw e;
    }

    const idem = idempotencyService.checkAndRecord({ page_id, message_id, dealer_id: context.dealer_id });
    if (!idem.isNew) {
      return { data: { status: 'DUPLICATE' } };
    }

    // Boundary only: enqueue for the (future) AI Processing worker. No AI is
    // called here — the handler below just persists the conversation/message
    // via the real service layer, exercising the Customer Matching state
    // machine end-to-end without any external call.
    const job = inboundQueue.enqueue({ context, page_id, sender_psid, message_id, text, phone });

    const match = conversationService.matchCustomerForConversation(context, { page_id, sender_psid, phone });
    conversationService.recordMessage(context, {
      conversation_id: match.conversation.conversation_id, direction: 'INBOUND', sender_type: 'CUSTOMER',
      text, raw_platform_reference: message_id, message_id: 'MSG-' + message_id,
    });

    return {
      data: {
        status: 'PROCESSED',
        dealer_id: context.dealer_id,
        conversation_id: match.conversation.conversation_id,
        customer_match: match.status, // PENDING_NO_PHONE | MATCHED | AMBIGUOUS
        queued_job_id: job.id,
      },
    };
  });
}

module.exports = { register };
