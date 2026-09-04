'use strict';
const { requireAuth } = require('../middleware/auth');
const crmService = require('../services/crmService');

function register(router) {
  router.post('/api/follow-ups', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const follow_up = crmService.createFollowUp(context, body);
    return { status: 201, data: { follow_up } };
  });

  router.post('/api/follow-ups/:follow_up_id/complete', async ({ req, params, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const follow_up = crmService.completeFollowUp(context, params.follow_up_id, body.result);
    return { data: { follow_up } };
  });
}

module.exports = { register };
