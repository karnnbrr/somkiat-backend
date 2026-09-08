// ============================================================
// Authentication Foundation — Step 6/29
// Uses Node's built-in crypto.scrypt for password hashing (no bcrypt
// dependency needed) and random opaque session tokens stored server
// side (no JWT library needed). Deliberately simple for a small team;
// see README for what a larger future deployment might add.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { AppError } = require('../errors');
const { contextFromSession } = require('../context/dealerContext');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function createUser(dealer_id, { name, username, password, role }) {
  const db = getDb();
  if (!['staff', 'manager'].includes(role)) throw new AppError('VALIDATION_ERROR', 'role must be staff or manager');
  const { hash, salt } = hashPassword(password);
  const user_id = 'USER-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (user_id, dealer_id, name, username, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(user_id, dealer_id, name, username, hash, salt, role);
  return { user_id, username, role };
}

function login(username, password, correlationId) {
  if (!username || !password) {
    throw new AppError('VALIDATION_ERROR', 'username and password are required');
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) throw new AppError('AUTH_ERROR', 'invalid credentials');
  const { hash } = hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) throw new AppError('AUTH_ERROR', 'invalid credentials');

  const session_token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (session_token, user_id, dealer_id, role, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(session_token, user.user_id, user.dealer_id, user.role, expires_at);

  return { session_token, context: contextFromSession({ dealer_id: user.dealer_id, user_id: user.user_id, role: user.role }, correlationId) };
}

function contextFromToken(session_token, correlationId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE session_token = ?').get(session_token);
  if (!row) throw new AppError('AUTH_ERROR', 'invalid or expired session');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError('AUTH_ERROR', 'session expired');
  return contextFromSession(row, correlationId);
}

function changePassword(context, { currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw new AppError('VALIDATION_ERROR', 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 8) {
    throw new AppError('VALIDATION_ERROR', 'newPassword must be at least 8 characters');
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE user_id = ? AND dealer_id = ?').get(context.user_id, context.dealer_id);
  if (!user) throw new AppError('AUTH_ERROR', 'invalid session');

  const { hash: currentHashCheck } = hashPassword(currentPassword, user.password_salt);
  if (currentHashCheck !== user.password_hash) {
    throw new AppError('AUTH_ERROR', 'current password is incorrect');
  }

  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE user_id = ?').run(hash, salt, user.user_id);

  // Log the user out of every existing session — a password change should
  // invalidate old sessions, not leave them silently valid forever.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id);
}

module.exports = { createUser, login, contextFromToken, hashPassword, changePassword };
