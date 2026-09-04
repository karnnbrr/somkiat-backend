'use strict';
const authService = require('../services/authService');

function register(router) {
  router.post('/api/auth/login', async ({ body, correlationId }) => {
    const { username, password } = body;
    const { session_token, context } = authService.login(username, password, correlationId);
    return { data: { session_token, dealer_id: context.dealer_id, role: context.role } };
  });
}

module.exports = { register };
