'use strict';
const { requireAuth } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');

function register(router) {
  router.get('/api/dashboard', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: dashboardService.getSummary(context) };
  });
}

module.exports = { register };
