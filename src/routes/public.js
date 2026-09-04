'use strict';
// ============================================================
// Public Routes — Step 36. No requireAuth anywhere in this file, by
// design: this is the customer-facing website's API surface. Every
// handler resolves dealer_id via contextFromPublicSite() (server env
// config only — see context/dealerContext.js), never from anything
// the browser sends. Read-only: no route here writes anything.
// ============================================================
const { contextFromPublicSite, DealerContextError } = require('../context/dealerContext');
const publicCatalogService = require('../services/publicCatalogService');
const { AppError } = require('../errors');

function resolvePublicContext(correlationId) {
  try {
    return contextFromPublicSite(correlationId);
  } catch (e) {
    if (e instanceof DealerContextError) {
      // Fails closed with a generic error — never leaks *why* (no env
      // var details) to a public, unauthenticated caller.
      throw new AppError('DEALER_CONTEXT_ERROR', 'This site is not configured yet');
    }
    throw e;
  }
}

function register(router) {
  router.get('/api/public/trucks', async ({ query, correlationId }) => {
    const context = resolvePublicContext(correlationId);
    const trucks = publicCatalogService.listAvailableTrucks(context, {
      model: query.model,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
    });
    return { data: { trucks } };
  });

  router.get('/api/public/trucks/:truck_id', async ({ params, correlationId }) => {
    const context = resolvePublicContext(correlationId);
    const truck = publicCatalogService.getTruckById(context, params.truck_id);
    if (!truck) throw new AppError('NOT_FOUND', 'truck not found');
    return { data: { truck } };
  });

  router.get('/api/public/trucks/:truck_id/photos', async ({ params, correlationId }) => {
    const context = resolvePublicContext(correlationId);
    const photos = publicCatalogService.listTruckPhotos(context, params.truck_id);
    return { data: { photos } };
  });
}

module.exports = { register };
