'use strict';
const { requireAuth } = require('../middleware/auth');
const saleService = require('../services/saleService');

function register(router) {
  router.get('/api/sales', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { sales: saleService.listSales(context) } };
  });

  router.post('/api/sales/validate', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const result = saleService.validateSale(context, body);
    return { data: { checks: result.checks, allPass: result.allPass } };
  });

  router.post('/api/sales/approve', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const result = saleService.approveSale(context, body);
    return { status: 201, data: result };
  });

  router.post('/api/sales/:sale_id/void', async ({ req, params, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const result = saleService.voidSale(context, params.sale_id, body.reason, body.revertTo);
    return { data: result };
  });
}

module.exports = { register };
