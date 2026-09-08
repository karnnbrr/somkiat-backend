'use strict';
const { requireAuth } = require('../middleware/auth');
const dealerInfoService = require('../services/dealerInfoService');

function register(router) {
  router.get('/api/dealer-info', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { dealer: dealerInfoService.getDealerInfo(context) } };
  });

  router.patch('/api/dealer-info', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { dealer: dealerInfoService.updateDealerInfo(context, body) } };
  });
}

module.exports = { register };
