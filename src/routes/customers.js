'use strict';
const { requireAuth } = require('../middleware/auth');
const crmService = require('../services/crmService');

function register(router) {
  router.post('/api/customers', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const customer = crmService.createCustomer(context, body);
    return { status: 201, data: { customer } };
  });

  router.get('/api/customers/lookup', async ({ req, query, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const customer = crmService.findCustomerByPhone(context, query.phone);
    return { data: { customer } };
  });

  router.get('/api/customers/:customer_id/truck-interests', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck_interests = crmService.listTruckInterestsForCustomer(context, params.customer_id);
    return { data: { truck_interests } }; // includes captured_campaign_id/adset_id/ad_id per truck interest (Attribution context)
  });

  router.get('/api/customers', async ({ req, query, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { customers: crmService.listCustomers(context, { search: query.search }) } };
  });

  router.get('/api/customers/:customer_id', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const customer = crmService.getCustomer(context, params.customer_id);
    return { data: { customer } };
  });

  router.get('/api/customers/:customer_id/follow-ups', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { follow_ups: crmService.listFollowUpsForCustomer(context, params.customer_id) } };
  });

  router.get('/api/customers/:customer_id/handoffs', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { handoffs: crmService.listHandoffsForCustomer(context, params.customer_id) } };
  });

  router.post('/api/interactions', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const interaction = crmService.createInteraction(context, body);
    return { status: 201, data: { interaction } };
  });

  router.post('/api/truck-interests', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck_interest = crmService.createTruckInterest(context, body);
    return { status: 201, data: { truck_interest } };
  });
}

module.exports = { register };
