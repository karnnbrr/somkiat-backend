'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-financePrompt.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const { runConversationTurn } = require('../src/ai/aiOrchestrator');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
const somkiat = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai', request_id: 'r1' });

test('The finance document checklist is actually sent to Claude as part of the system prompt', async () => {
  let capturedSystem = null;
  const fixtureClient = {
    sendMessage: async ({ system }) => {
      capturedSystem = system;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  await runConversationTurn(somkiat, [{ role: 'user', content: 'ต้องใช้เอกสารอะไรบ้างครับ' }], fixtureClient);
  assert.ok(capturedSystem.includes('เอกสารที่ต้องเตรียม'));
  assert.ok(capturedSystem.includes('บัตรประชาชน'));
  assert.ok(capturedSystem.includes('สลิปเงินเดือนล่าสุด'));
  assert.ok(capturedSystem.includes('Statement) 6 เดือน'));
  assert.ok(capturedSystem.includes('หนังสือรับรองบริษัท'));
});

test('The system prompt explicitly instructs handoff for occupation-eligibility questions, not a direct answer', async () => {
  let capturedSystem = null;
  const fixtureClient = {
    sendMessage: async ({ system }) => {
      capturedSystem = system;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  await runConversationTurn(somkiat, [{ role: 'user', content: 'x' }], fixtureClient);
  assert.ok(capturedSystem.includes('FINANCE_SPECIFIC'));
  assert.match(capturedSystem, /do NOT answer that yourself/);
});

test('The system prompt explicitly instructs Claude to never write photo URLs in its text reply', async () => {
  let capturedSystem = null;
  const fixtureClient = {
    sendMessage: async ({ system }) => {
      capturedSystem = system;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  await runConversationTurn(somkiat, [{ role: 'user', content: 'ขอรูปหน่อยครับ' }], fixtureClient);
  assert.match(capturedSystem, /NEVER write out/);
  assert.match(capturedSystem, /automatically sends the actual photo image/);
});

test('Existing AI Tool Boundary language (cannot approve sales/change stock/confirm reservations) is still present, unchanged', async () => {
  let capturedSystem = null;
  const fixtureClient = {
    sendMessage: async ({ system }) => {
      capturedSystem = system;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  await runConversationTurn(somkiat, [{ role: 'user', content: 'x' }], fixtureClient);
  assert.match(capturedSystem, /cannot approve sales, change stock status, or confirm reservations/);
});
