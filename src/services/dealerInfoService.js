// ============================================================
// Dealer Contact Info Service — customer-facing contact details
//
// getDealerInfo() is safe for the public context too (contextFromPublicSite)
// — it only ever reads dealer_id-scoped columns, same isolation guarantee
// as every other service in this codebase. updateDealerInfo() is
// manager-only (new 'dealer.edit_info' permission), matching the pattern
// used for other administrative-but-not-safety-critical actions.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');
const { AppError } = require('../errors');
const { requirePermission } = require('../middleware/permission');
const audit = require('./auditService');

const EDITABLE_FIELDS = ['dealer_name', 'phone', 'address', 'business_hours', 'line_id', 'facebook_page_url'];

function getDealerInfo(context) {
  const db = getDb();
  const row = db.prepare(
    'SELECT dealer_id, dealer_name, phone, address, business_hours, line_id, facebook_page_url FROM dealers WHERE dealer_id = ?'
  ).get(context.dealer_id);
  if (!row) throw new AppError('NOT_FOUND', 'dealer not found');
  return row;
}

function updateDealerInfo(context, updates) {
  requirePermission(context, 'dealer.edit_info');
  const db = getDb();
  const sets = [];
  const params = [];
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }
  if (sets.length === 0) return getDealerInfo(context);
  params.push(context.dealer_id);
  db.prepare(`UPDATE dealers SET ${sets.join(', ')} WHERE dealer_id = ?`).run(...params);
  audit.record(context, { action_type: 'UPDATE_DEALER_INFO', entity: 'dealer', entity_id: context.dealer_id });
  return getDealerInfo(context);
}

module.exports = { getDealerInfo, updateDealerInfo };
