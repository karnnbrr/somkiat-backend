'use strict';
const { requireAuth } = require('../middleware/auth');
const photoService = require('../services/photoService');

function register(router) {
  router.get('/api/photos/:truck_id', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const photos = photoService.listActivePhotos(context, params.truck_id);
    return { data: { photos } };
  });

  router.post('/api/photos', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const photo = photoService.uploadPhoto(context, body);
    return { status: 201, data: { photo } };
  });

  router.post('/api/photos/:photo_id/set-cover', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const photos = photoService.setCover(context, params.photo_id);
    return { data: { photos } };
  });

  router.post('/api/photos/:photo_id/deactivate', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const result = photoService.deactivatePhoto(context, params.photo_id);
    return { data: result };
  });

  router.post('/api/photos/:photo_id/restore', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const result = photoService.restorePhoto(context, params.photo_id);
    return { data: result };
  });
}

module.exports = { register };
