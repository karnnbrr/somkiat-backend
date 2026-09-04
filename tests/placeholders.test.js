'use strict';
const { test } = require('node:test');

// ============================================================
// These are intentionally NOT implemented in Step 30A because the
// underlying feature does not exist yet per the Step 30A rules
// ("ห้ามเชื่อม Facebook จริง", "ห้ามเชื่อม Claude API จริง").
// Each test.skip() documents exactly what will need to be tested
// once that wiring happens in a later step.
// ============================================================

test('PLACEHOLDER — real Facebook webhook signature verification (needs real App Secret, Step 31+)', { skip: true }, () => {});
test('PLACEHOLDER — real Facebook outbound send + delivery status (needs Page Access Token, Step 31+)', { skip: true }, () => {});
test('PLACEHOLDER — Claude API wired into ai/aiTools.js end-to-end conversation (Step 31+)', { skip: true }, () => {});
test('PLACEHOLDER — Queue/Worker retry-with-backoff + dead-letter behavior once a real queue vendor is chosen (Step 29 §7/§10, still "DECIDE LATER" — the in-process interface itself IS tested, see tests/outboundAndQueue.test.js)', { skip: true }, () => {});
test('PLACEHOLDER — AI actually calling matchCustomerForConversation/lookupStock etc. mid-conversation via a real Claude tool-use loop (the tools themselves ARE tested in isolation — see tests/aiTools.test.js and tests/aiBoundaryHardening.test.js)', { skip: true }, () => {});
