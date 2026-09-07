// ============================================================
// Minimal Router — zero external dependencies.
//
// WHY NO EXPRESS/FASTIFY: this build environment has no network
// access to npm (see README §"Why no framework"). Node's built-in
// `http` module is fully sufficient for a small API surface like
// this one. Every route handler here is a thin adapter that parses
// the request and calls into src/services/*.js — the Business Logic
// Layer is 100% framework-agnostic, so swapping in Express later
// (when network access allows it) costs only this file, not the
// services, tests, or database layer.
// ============================================================
'use strict';
const { URL } = require('node:url');
const { AppError } = require('./errors');
const { newCorrelationId } = require('./middleware/requestId');
const { applyCorsHeaders } = require('./middleware/cors');

class Router {
  constructor() {
    this.routes = []; // { method, pattern: RegExp, paramNames, handler }
  }

  _register(method, path, handler) {
    const paramNames = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:[a-zA-Z_]+/g, (m) => {
          paramNames.push(m.slice(1));
          return '([^/]+)';
        }) +
        '$'
    );
    this.routes.push({ method, pattern, paramNames, handler });
  }

  get(path, handler) { this._register('GET', path, handler); }
  post(path, handler) { this._register('POST', path, handler); }
  patch(path, handler) { this._register('PATCH', path, handler); }

  async handle(req, res) {
    const correlationId = newCorrelationId();
    applyCorsHeaders(req, res);

    // Preflight: answer immediately, before any route matching, body
    // parsing, or auth — a preflight request never carries real
    // credentials or a body that route handlers need to see.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const match = this.routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));

    if (!match) {
      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'route not found' }, correlationId });
    }

    const execMatch = match.pattern.exec(url.pathname);
    const params = {};
    match.paramNames.forEach((name, i) => { params[name] = execMatch[i + 1]; });
    const query = Object.fromEntries(url.searchParams.entries());

    let body = {};
    let rawBody = '';
    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        const parsed = await readJsonBody(req);
        body = parsed.json;
        rawBody = parsed.raw;
      } catch (e) {
        return sendJson(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'malformed JSON body' }, correlationId });
      }
    }

    try {
      const result = await match.handler({ req, params, query, body, rawBody, correlationId });
      if (result.raw) {
        // Deliberate exception to the "always JSON" rule: Facebook's GET
        // webhook verification handshake requires the raw hub.challenge
        // string back as plain text, not wrapped in JSON — Facebook's own
        // verifier rejects a JSON body here. This is the ONLY route that
        // uses this path (see routes/facebookWebhook.js).
        res.writeHead(result.status || 200, { 'Content-Type': 'text/plain' });
        res.end(String(result.body));
        return;
      }
      sendJson(res, result.status || 200, { ...result.data, correlationId });
    } catch (err) {
      if (err instanceof AppError) {
        // Log full detail server-side only; never send `err.details` to the client.
        console.error(`[${correlationId}] AppError ${err.code}:`, err.message, err.details || '');
        sendJson(res, err.httpStatus, { error: { code: err.code, message: err.message }, correlationId });
      } else {
        console.error(`[${correlationId}] UNKNOWN_ERROR:`, err);
        sendJson(res, 500, { error: { code: 'UNKNOWN_ERROR', message: 'internal error' }, correlationId });
      }
    }
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const MAX_BODY_BYTES = 1024 * 1024; // 1MB — generous for JSON API payloads, small enough to bound abuse

/**
 * Reads the raw request body AND parses it as JSON, returning both.
 * The raw bytes are required for Facebook signature verification, which
 * is computed over the exact bytes Facebook sent — re-serializing the
 * parsed object would not reproduce the same bytes (key order, spacing,
 * unicode escaping can all differ) and would break signature checking.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve({ raw: data, json: data ? JSON.parse(data) : {} }); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = { Router };
