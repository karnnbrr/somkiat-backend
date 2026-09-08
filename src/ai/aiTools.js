// ============================================================
// Approved AI Tool Interface — Step 20-22 / 26 / 29 §16
//
// NOT connected to a real AI/Claude API in Step 30A (per the rules of
// this step). This module exists so the *boundary* is real, testable
// code today, not just a diagram — when Claude API wiring happens in
// a later step, it will call exactly these functions and nothing else.
//
// Design rule enforced here: makeAiTools(context) takes a trusted
// context (built ONLY by dealerContext.contextFromFacebookPage or
// contextFromSession) and returns a frozen object of functions that
// close over that context. None of the returned functions accept a
// dealer_id parameter — there is no argument position an AI caller
// could use to point at a different dealer, even by mistake.
//
// The forbidden action names below are simply never defined anywhere
// in this file — tests/aiTools.test.js asserts they don't exist on
// the returned object.
// ============================================================
'use strict';
const stockService = require('../services/stockService');
const photoService = require('../services/photoService');
const crmService = require('../services/crmService');
const handoffService = require('../services/handoffService');
const conversationService = require('../services/conversationService');
const audit = require('../services/auditService');

const FORBIDDEN_TOOL_NAMES = Object.freeze([
  'approveSale', 'confirmSale', 'changeStockStatus', 'confirmReservation',
  'confirmFinance', 'approveSpecialPrice', 'deleteHistory', 'bypassSafetyGate',
  'editAttribution', 'mergeCustomer', 'purgePhoto', 'restorePhoto', 'voidSale',
]);

/**
 * Step 30B §8 hardening: if a caller-supplied object (e.g. AI-generated
 * `criteria`) contains a `dealer_id` key at all, that is treated as a
 * security-relevant event — it is stripped before use (the trusted
 * context.dealer_id is what actually governs the query) and audited so
 * the attempt is visible, even though it has zero effect on the result.
 */
function sanitizeCriteria(context, criteria) {
  if (criteria && typeof criteria === 'object' && 'dealer_id' in criteria) {
    audit.record(context, {
      action_type: 'AI_DEALER_OVERRIDE_ATTEMPT_BLOCKED',
      reason: `AI-supplied dealer_id="${criteria.dealer_id}" ignored; trusted context dealer_id="${context.dealer_id}" used instead`,
    });
    const { dealer_id, ...rest } = criteria;
    return rest;
  }
  return criteria;
}

function makeAiTools(context) {
  if (!context || !context.dealer_id) {
    throw new Error('makeAiTools requires a trusted dealer context');
  }
  return Object.freeze({
    // ---- READ ----
    lookupStock: (criteria) => stockService.searchTrucks(context, sanitizeCriteria(context, criteria)),
    getTruck: ({ truck_id } = {}) => stockService.getTruck(context, truck_id),
    // Claude never needs the raw photo bytes to reason about a conversation
    // — it just needs to know a photo exists and whether it's a real,
    // sendable URL. A base64 data: URL (from the dashboard's direct-file-
    // upload feature) can be several MB of text; feeding that into the AI
    // conversation exploded a single request past Claude's token limit in
    // production. Real http(s) URLs stay as-is (tiny, and this is exactly
    // what respondToMessage's image-sending code needs to see); base64
    // data is replaced with a short marker instead of being included.
    getTruckPhotos: ({ truck_id } = {}) => photoService.listActivePhotos(context, truck_id).map((p) => ({
      ...p,
      storage_reference: /^https?:\/\//.test(p.storage_reference || '')
        ? p.storage_reference
        : '[uploaded photo on file — not a shareable link]',
    })),
    findCustomerByPhone: ({ phone } = {}) => crmService.findCustomerByPhone(context, phone),
    listTruckInterests: ({ customer_id } = {}) => crmService.listTruckInterestsForCustomer(context, customer_id),

    // ---- LOW-RISK WRITE ----
    createCustomer: (input) => crmService.createCustomer(context, sanitizeCriteria(context, input)),
    createInteraction: (input) => crmService.createInteraction(context, sanitizeCriteria(context, input)),
    createTruckInterest: (input) => crmService.createTruckInterest(context, sanitizeCriteria(context, input)),
    proposeFollowUp: (input) => crmService.createFollowUp(context, sanitizeCriteria(context, input)),
    // Matches or creates a Customer for an inbound conversation — never
    // returns/accepts confirmation of anything financial; on AMBIGUOUS it
    // returns that status to the caller instead of guessing (caller must Handoff).
    matchCustomerForConversation: (input) => conversationService.matchCustomerForConversation(context, sanitizeCriteria(context, input)),
    recordInboundMessage: (input) => conversationService.recordMessage(context, { ...sanitizeCriteria(context, input), direction: 'INBOUND', sender_type: 'CUSTOMER' }),
    getConversationHistory: ({ conversation_id } = {}) => conversationService.getConversationHistory(context, conversation_id),

    // ---- HANDOFF (creates a request for a human — never an approval) ----
    createHandoff: (input) => handoffService.createHandoff(context, sanitizeCriteria(context, input)),
  });
}

module.exports = { makeAiTools, FORBIDDEN_TOOL_NAMES, sanitizeCriteria };
