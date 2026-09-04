// ============================================================
// AI Orchestrator — Step 31 Phase B
//
// This is the piece that matters most for safety: it consumes a
// Claude-shaped response (content blocks, possibly including
// `tool_use` blocks) and dispatches each tool call to the Approved
// AI Tool Interface (src/ai/aiTools.js) — nothing else. This is
// fully real code and fully tested offline (see
// tests/aiOrchestrator.test.js) using fixture responses shaped like
// what Claude would return; the `claudeClient` is injected so a real
// one (claudeService.js) can be swapped in the moment credentials
// exist, with ZERO changes to this file.
//
// The enforcement here is structural, not just "checked": a tool_use
// block naming anything other than a key that exists on
// `makeAiTools(context)` is rejected — and makeAiTools() never
// contained approveSale/changeStockStatus/etc. in the first place
// (see aiTools.js FORBIDDEN_TOOL_NAMES + its tests). There is no
// separate "is this a dangerous tool?" check to forget to write.
// ============================================================
'use strict';
const { makeAiTools, FORBIDDEN_TOOL_NAMES } = require('./aiTools');
const { TOOL_DEFINITIONS } = require('./toolDefinitions');
const audit = require('../services/auditService');
const realClaudeClient = require('./claudeService');

const MAX_TURNS = 6; // hard cap so a misbehaving loop can never run forever

const SYSTEM_PROMPT_SUMMARY =
  'You are assisting S.K.AUTOTRUCK. Use the provided tools for any Stock, Photo, or Customer question ' +
  'never answer from memory. You cannot approve sales, change stock status, or confirm reservations; hand off to a human for those.';

function dispatchToolUse(context, tools, toolUseBlock) {
  const { name, input, id } = toolUseBlock;

  if (FORBIDDEN_TOOL_NAMES.includes(name)) {
    // Belt-and-suspenders: this branch should be unreachable since `tools`
    // never contains these names, but if it's ever hit, audit it loudly as
    // a security event rather than just silently falling through to the
    // generic "unknown tool" branch below.
    audit.record(context, { action_type: 'AI_FORBIDDEN_TOOL_ATTEMPT', reason: 'tool_use requested forbidden action "' + name + '"' });
    return { tool_use_id: id, is_error: true, content: '"' + name + '" is not an available action.' };
  }

  if (!(name in tools)) {
    audit.record(context, { action_type: 'AI_TOOL_CALL_REJECTED', reason: 'unknown tool "' + name + '" requested' });
    return { tool_use_id: id, is_error: true, content: '"' + name + '" is not an available tool.' };
  }

  try {
    const result = tools[name](input);
    return { tool_use_id: id, content: JSON.stringify(result) };
  } catch (e) {
    return { tool_use_id: id, is_error: true, content: e.message };
  }
}

/**
 * Runs one full conversation turn: calls the (injected) Claude client,
 * dispatches any tool_use blocks, feeds results back, repeats until
 * Claude returns a final text-only response or MAX_TURNS is hit.
 *
 * @param {object} context - trusted dealer context (see dealerContext.js)
 * @param {Array}  conversationHistory - Anthropic Messages API `messages` array
 * @param {object} [claudeClient] - defaults to the real claudeService; tests
 *   inject a fixture-based Test Double instead (see tests/aiOrchestrator.test.js)
 * @returns {{ finalText: string, toolCallsMade: Array, turns: number }}
 */
async function runConversationTurn(context, conversationHistory, claudeClient) {
  const client = claudeClient || realClaudeClient;
  const tools = makeAiTools(context);
  const toolCallsMade = [];
  let messages = conversationHistory.slice();
  let turns = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const response = await client.sendMessage({ messages: messages, system: SYSTEM_PROMPT_SUMMARY, tools: TOOL_DEFINITIONS });

    const content = response.content || [];
    const toolUseBlocks = content.filter(function (b) { return b.type === 'tool_use'; });
    const textBlocks = content.filter(function (b) { return b.type === 'text'; });

    if (toolUseBlocks.length === 0) {
      return { finalText: textBlocks.map(function (b) { return b.text; }).join('\n'), toolCallsMade: toolCallsMade, turns: turns };
    }

    messages = messages.concat([{ role: 'assistant', content: content }]);
    const toolResults = toolUseBlocks.map(function (block) {
      const result = dispatchToolUse(context, tools, block);
      toolCallsMade.push({ name: block.name, input: block.input, result: result });
      return { type: 'tool_result', tool_use_id: result.tool_use_id, content: result.content, is_error: result.is_error || false };
    });
    messages = messages.concat([{ role: 'user', content: toolResults }]);
  }

  return { finalText: '', toolCallsMade: toolCallsMade, turns: turns, truncated: true };
}

module.exports = { runConversationTurn: runConversationTurn, dispatchToolUse: dispatchToolUse, MAX_TURNS: MAX_TURNS };
