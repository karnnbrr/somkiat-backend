'use strict';
const { requireAuth } = require('../middleware/auth');
const conversationService = require('../services/conversationService');

function register(router) {
  router.get('/api/conversations', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { conversations: conversationService.listConversations(context) } };
  });

  router.get('/api/conversations/:conversation_id/messages', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { messages: conversationService.getConversationHistory(context, params.conversation_id) } };
  });
}

module.exports = { register };
