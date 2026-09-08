'use strict';
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

function register(router) {
  router.post('/api/auth/login', async ({ body, correlationId }) => {
    const { username, password } = body;
    const { session_token, context } = authService.login(username, password, correlationId);
    return { data: { session_token, dealer_id: context.dealer_id, role: context.role } };
  });

  router.post('/api/auth/change-password', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    authService.changePassword(context, { currentPassword: body.currentPassword, newPassword: body.newPassword });
    return { data: { status: 'PASSWORD_CHANGED' } };
  });
}

module.exports = { register };
