'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-toolDefinitions.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const { makeAiTools, FORBIDDEN_TOOL_NAMES } = require('../src/ai/aiTools');
const { TOOL_DEFINITIONS } = require('../src/ai/toolDefinitions');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
const ctx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'ai', request_id: 'r1' });

test('Step 32 fix: every name in TOOL_DEFINITIONS exists as a real tool on makeAiTools()', () => {
  const tools = makeAiTools(ctx);
  for (const def of TOOL_DEFINITIONS) {
    assert.strictEqual(def.name in tools, true, 'TOOL_DEFINITIONS lists "' + def.name + '" but it is not a real tool');
  }
});

test('Step 32 fix: every real tool on makeAiTools() has a matching definition (nothing undocumented to Claude)', () => {
  const tools = makeAiTools(ctx);
  const definedNames = TOOL_DEFINITIONS.map(function (d) { return d.name; });
  for (const toolName of Object.keys(tools)) {
    assert.strictEqual(definedNames.includes(toolName), true, 'tool "' + toolName + '" exists but has no TOOL_DEFINITIONS entry');
  }
});

test('No forbidden tool name ever appears in TOOL_DEFINITIONS', () => {
  const definedNames = TOOL_DEFINITIONS.map(function (d) { return d.name; });
  for (const forbidden of FORBIDDEN_TOOL_NAMES) {
    assert.strictEqual(definedNames.includes(forbidden), false);
  }
});

test('Step 32 fix: every TOOL_DEFINITIONS input_schema is a valid object schema (Anthropic rejects any non-object schema with a 400 — this bug reached real production once already)', () => {
  for (const def of TOOL_DEFINITIONS) {
    assert.strictEqual(def.input_schema.type, 'object', `${def.name}'s input_schema.type must be "object" — Anthropic's real API rejects tool calls whose input isn't a JSON object at the top level`);
  }
});

test('aiOrchestrator now actually passes tools to the Claude client (regression guard for the Step 32 gap)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/ai/aiOrchestrator.js'), 'utf8');
  assert.match(src, /tools:\s*TOOL_DEFINITIONS/, 'aiOrchestrator.js must pass the tools schema to client.sendMessage(), or a real Claude call could never use any tool');
});
