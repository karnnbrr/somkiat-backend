'use strict';
const { requireAuth } = require('../middleware/auth');
const attributionService = require('../services/attributionService');

function register(router) {
  router.get('/api/attribution/summary', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { summary: attributionService.getSummary(context) } };
  });
}

module.exports = { register };
