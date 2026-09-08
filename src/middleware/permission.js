// ============================================================
// Permission Foundation — Step 19/23/27/29
// Enforced in the SERVICE layer (see services/*.js calling requirePermission
// directly), not only as a route guard — so even a future internal caller
// (including AI tool code) cannot bypass it by skipping the HTTP layer.
// ============================================================
'use strict';
const { AppError } = require('../errors');
const audit = require('../services/auditService');

const PERMISSIONS = {
  staff: new Set([
    'stock.view', 'stock.search', 'stock.edit_general', 'stock.reserve', 'stock.cancel_reservation',
    'photo.upload', 'photo.set_cover', 'photo.reorder', 'photo.deactivate',
    'customer.view', 'customer.create', 'interaction.create', 'lead.create',
    'truck_interest.create', 'follow_up.create', 'follow_up.complete',
    'handoff.accept', 'handoff.update_status', 'sale.draft',
  ]),
  manager: new Set([
    // includes everything staff can do, plus:
    'stock.view', 'stock.search', 'stock.edit_general', 'stock.reserve', 'stock.cancel_reservation',
    'photo.upload', 'photo.set_cover', 'photo.reorder', 'photo.deactivate',
    'customer.view', 'customer.create', 'interaction.create', 'lead.create',
    'truck_interest.create', 'follow_up.create', 'follow_up.complete',
    'handoff.accept', 'handoff.update_status', 'sale.draft',
    'sale.approve', 'sale.void', 'stock.manual_edit', 'stock.delete', 'photo.restore', 'photo.purge',
    'conflict.resolve',
  ]),
  // 'ai' pseudo-role: only ever used by contextFromFacebookPage(). Deliberately
  // granted NO permissions here — AI must go through ai/aiTools.js, which has
  // its own, even narrower, allow-list (see ai/aiTools.js and its tests).
  ai: new Set([]),
};

function requirePermission(context, action) {
  const allowed = PERMISSIONS[context.role];
  if (!allowed || !allowed.has(action)) {
    // Best-effort audit of the denial — never let audit logging itself break
    // the (already-failing) request if context is malformed in some unusual way.
    try {
      if (context && context.dealer_id) {
        audit.record(context, { action_type: 'AUTHORIZATION_DENIED', reason: `role=${context.role} action=${action}` });
      }
    } catch (_) { /* swallow — the AuthorizationError below is what matters */ }
    throw new AppError('AUTHORIZATION_ERROR', `Role "${context.role}" cannot perform "${action}"`);
  }
}

module.exports = { requirePermission, PERMISSIONS };
