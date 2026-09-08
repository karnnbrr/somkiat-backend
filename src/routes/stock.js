'use strict';
const { requireAuth } = require('../middleware/auth');
const stockService = require('../services/stockService');

function register(router) {
  router.get('/api/stock', async ({ req, query, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const trucks = stockService.searchTrucks(context, {
      model: query.model,
      status: query.status,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
    });
    return { data: { trucks } };
  });

  router.get('/api/stock/:truck_id', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck = stockService.getTruck(context, params.truck_id);
    return { data: { truck } };
  });

  router.post('/api/stock', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck = stockService.addTruck(context, body);
    return { status: 201, data: { truck } };
  });

  router.patch('/api/stock/:truck_id', async ({ req, params, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck = stockService.editTruckDetails(context, params.truck_id, body);
    return { data: { truck } };
  });

  router.post('/api/stock/:truck_id/delete', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    stockService.deleteTruck(context, params.truck_id);
    return { data: { status: 'DELETED' } };
  });

  router.post('/api/stock/:truck_id/reserve', async ({ req, params, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck = stockService.reserveTruck(context, params.truck_id, body.customer_id);
    return { data: { truck } };
  });

  router.post('/api/stock/:truck_id/cancel-reservation', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const truck = stockService.cancelReservation(context, params.truck_id);
    return { data: { truck } };
  });
}

module.exports = { register };
