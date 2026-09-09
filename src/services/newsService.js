// ============================================================
// News/Content Posts Service — customer-facing updates, articles,
// video links (e.g. "ความรู้เกี่ยวกับรถ")
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { AppError } = require('../errors');
const { requirePermission } = require('../middleware/permission');
const audit = require('./auditService');

function createPost(context, { title, content, cover_image, video_url, status }) {
  requirePermission(context, 'news.create');
  if (!title || !content) throw new AppError('VALIDATION_ERROR', 'title and content are required');
  const db = getDb();
  const post_id = 'NEWS-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO news_posts (post_id, dealer_id, title, content, cover_image, video_url, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(post_id, context.dealer_id, title, content, cover_image || null, video_url || null, status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED', context.user_id || context.role);
  audit.record(context, { action_type: 'CREATE_NEWS_POST', entity: 'news_post', entity_id: post_id });
  return getPost(context, post_id);
}

function listPosts(context, { includeDrafts = true } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM news_posts WHERE dealer_id = ?';
  const params = [context.dealer_id];
  if (!includeDrafts) { sql += " AND status = 'PUBLISHED'"; }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function getPost(context, post_id) {
  const db = getDb();
  return db.prepare('SELECT * FROM news_posts WHERE dealer_id = ? AND post_id = ?').get(context.dealer_id, post_id) || null;
}

function deletePost(context, post_id) {
  requirePermission(context, 'news.create');
  const db = getDb();
  const post = getPost(context, post_id);
  if (!post) throw new AppError('NOT_FOUND', 'post not found for this dealer');
  db.prepare('DELETE FROM news_posts WHERE dealer_id = ? AND post_id = ?').run(context.dealer_id, post_id);
  audit.record(context, { action_type: 'DELETE_NEWS_POST', entity: 'news_post', entity_id: post_id });
}

function listPublicPosts(context) {
  return listPosts(context, { includeDrafts: false });
}

function getPublicPost(context, post_id) {
  const post = getPost(context, post_id);
  if (!post || post.status !== 'PUBLISHED') return null;
  return post;
}

module.exports = { createPost, listPosts, getPost, deletePost, listPublicPosts, getPublicPost };
