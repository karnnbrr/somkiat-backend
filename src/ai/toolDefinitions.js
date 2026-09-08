// ============================================================
// AI Tool Definitions — Step 32 §1 fix
//
// Found during Step 32 interface audit: aiOrchestrator.js was calling
// claudeService.sendMessage() WITHOUT a `tools` schema array, meaning a
// real Claude API call would have had no tool definitions to work
// with and could never emit a tool_use block at all. This file adds
// ONLY the JSON-schema description of the tools that already exist in
// ai/aiTools.js — it does not add, rename, or change the behavior of
// any tool. Every name here must exist as a key on makeAiTools()'s
// return value; tests/toolDefinitions.test.js asserts that.
// ============================================================
'use strict';

const TOOL_DEFINITIONS = [
  {
    name: 'lookupStock',
    description: 'Search available trucks in this dealer\'s live stock by model, status, or max price.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Truck model, e.g. "NLR"' },
        status: { type: 'string', enum: ['พร้อมขาย', 'จองแล้ว', 'ขายแล้ว'] },
        maxPrice: { type: 'number' },
      },
    },
  },
  {
    name: 'getTruck',
    description: 'Get one truck by its exact truck_id.',
    input_schema: {
      type: 'object', required: ['truck_id'],
      properties: { truck_id: { type: 'string', description: 'The truck_id, e.g. "TRK-001"' } },
    },
  },
  {
    name: 'getTruckPhotos',
    description: 'Get the ACTIVE photos for one truck by its exact truck_id, cover first.',
    input_schema: {
      type: 'object', required: ['truck_id'],
      properties: { truck_id: { type: 'string', description: 'The truck_id, e.g. "TRK-001"' } },
    },
  },
  {
    name: 'findCustomerByPhone',
    description: 'Look up a customer in this dealer by phone number.',
    input_schema: {
      type: 'object', required: ['phone'],
      properties: { phone: { type: 'string', description: 'Phone number' } },
    },
  },
  {
    name: 'listTruckInterests',
    description: 'List all trucks a customer has expressed interest in.',
    input_schema: {
      type: 'object', required: ['customer_id'],
      properties: { customer_id: { type: 'string' } },
    },
  },
  {
    name: 'createCustomer',
    description: 'Create a new customer record for this dealer.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' }, contact_channel: { type: 'string' }, source: { type: 'string' } },
    },
  },
  {
    name: 'createInteraction',
    description: 'Record a new CRM interaction/touchpoint.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string' }, customer_id: { type: 'string' },
        campaign_id: { type: 'string' }, adset_id: { type: 'string' }, ad_id: { type: 'string' }, source: { type: 'string' },
      },
    },
  },
  {
    name: 'createTruckInterest',
    description: 'Record that a customer is interested in a specific truck (validated against real stock).',
    input_schema: {
      type: 'object',
      required: ['truck_id', 'customer_id'],
      properties: { truck_id: { type: 'string' }, customer_id: { type: 'string' }, interest_level: { type: 'string' } },
    },
  },
  {
    name: 'proposeFollowUp',
    description: 'Propose a follow-up for a staff member to review; never a confirmed appointment.',
    input_schema: {
      type: 'object',
      required: ['customer_id'],
      properties: { customer_id: { type: 'string' }, truck_id: { type: 'string' }, due_date: { type: 'string' }, reason: { type: 'string' } },
    },
  },
  {
    name: 'matchCustomerForConversation',
    description: 'Match or create a customer for the current Facebook conversation (PSID/phone matching state machine).',
    input_schema: {
      type: 'object',
      properties: { page_id: { type: 'string' }, sender_psid: { type: 'string' }, phone: { type: 'string' }, name: { type: 'string' } },
    },
  },
  {
    name: 'recordInboundMessage',
    description: 'Record an inbound customer message against a conversation.',
    input_schema: {
      type: 'object',
      required: ['conversation_id'],
      properties: { conversation_id: { type: 'string' }, text: { type: 'string' } },
    },
  },
  {
    name: 'getConversationHistory',
    description: 'Get the message history for a conversation.',
    input_schema: {
      type: 'object', required: ['conversation_id'],
      properties: { conversation_id: { type: 'string' } },
    },
  },
  {
    name: 'createHandoff',
    description: 'Hand off to a human staff member. This NEVER approves, confirms, or completes anything by itself.',
    input_schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        conversation_id: { type: 'string' }, customer_id: { type: 'string' }, truck_id: { type: 'string' },
        reason: {
          type: 'string',
          enum: ['RESERVATION_REQUEST', 'PRICE_NEGOTIATION', 'SPECIAL_PRICE', 'FINANCE_SPECIFIC', 'COMPLAINT', 'CUSTOMER_REQUEST_HUMAN', 'AI_UNCERTAIN', 'DATA_CONFLICT', 'OUT_OF_SCOPE', 'OTHER'],
        },
        summary: { type: 'string' },
      },
    },
  },
];

module.exports = { TOOL_DEFINITIONS };
