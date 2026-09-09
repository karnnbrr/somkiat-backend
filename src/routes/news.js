'use strict';
const { requireAuth } = require('../middleware/auth');
const newsService = require('../services/newsService');

function register(router) {
  router.get('/api/news', async ({ req, correlationId }) => {
    const context = requireAuth(req, correlationId);
    return { data: { posts: newsService.listPosts(context) } };
  });

  router.post('/api/news', async ({ req, body, correlationId }) => {
    const context = requireAuth(req, correlationId);
    const post = newsService.createPost(context, body);
    return { status: 201, data: { post } };
  });

  router.post('/api/news/:post_id/delete', async ({ req, params, correlationId }) => {
    const context = requireAuth(req, correlationId);
    newsService.deletePost(context, params.post_id);
    return { data: { status: 'DELETED' } };
  });
}

module.exports = { register };
