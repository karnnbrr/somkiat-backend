'use strict';
const { requireAuth } = require('../middleware/auth');
const handoffService = require('../services/handoffService');

function register(router) {
  router.get('/api/handoffs', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { handoffs: handoffService.listOpenHandoffs(context) } };
  });

  router.post('/api/handoffs', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const handoff = handoffService.createHandoff(context, body);
    return { status: 201, data: { handoff } };
  });

  router.post('/api/handoffs/:handoff_id/accept', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { handoff: handoffService.acceptHandoff(context, params.handoff_id) } };
  });
}

module.exports = { register };
