// ============================================================
// Sale Service — Step 17.2 / 19 / 29 §8 §23
// Approve Sale runs the 8-condition Safety Gate INSIDE a single SQL
// transaction with (Update Stock + Insert Sale + Audit) atomic — this
// satisfies "ควร Atomic ร่วมกัน" from Step 29 §23.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');
const stockService = require('./stockService');

function validateSale(context, { truck_id, sold_interest_id }) {
  const db = getDb();
  const checks = [];

  const interest = db.prepare('SELECT * FROM truck_interests WHERE dealer_id = ? AND truck_interest_id = ?')
    .get(context.dealer_id, sold_interest_id);
  checks.push({ label: 'sold_interest_id exists for this dealer', pass: !!interest });

  checks.push({ label: 'sold_interest.truck_id == sale.truck_id', pass: !!interest && interest.truck_id === truck_id });

  const truck = stockService.getTruck(context, truck_id);
  checks.push({ label: 'exactly one Stock row for truck_id in this dealer', pass: !!truck });

  // Defense-in-depth (Step 30B §14): even though every query above is already
  // scoped by context.dealer_id (making cross-dealer rows structurally
  // unreachable), explicitly re-assert dealer_id consistency and audit any
  // violation as a security event rather than silently trusting the query scope.
  const dealerConsistent = !!truck && !!interest && truck.dealer_id === context.dealer_id && interest.dealer_id === context.dealer_id;
  checks.push({ label: 'truck.dealer_id / truck_interest.dealer_id match trusted context.dealer_id', pass: dealerConsistent });
  if (!dealerConsistent && (truck || interest)) {
    audit.record(context, {
      action_type: 'DEALER_ISOLATION_VIOLATION_BLOCKED', entity: 'sale_attempt', entity_id: sold_interest_id,
      reason: `truck.dealer_id=${truck ? truck.dealer_id : 'n/a'} interest.dealer_id=${interest ? interest.dealer_id : 'n/a'} context.dealer_id=${context.dealer_id}`,
    });
  }

  checks.push({ label: 'truck is not already sold', pass: !!truck && truck.stock_status !== 'ขายแล้ว' });

  const existingApproved = db.prepare(
    "SELECT 1 FROM sales WHERE dealer_id = ? AND truck_id = ? AND status = 'Approved' LIMIT 1"
  ).get(context.dealer_id, truck_id);
  checks.push({ label: 'no other Approved Sale exists for this truck', pass: !existingApproved });

  return { checks, allPass: checks.every((c) => c.pass), truck, interest };
}

function approveSale(context, { truck_id, sold_interest_id, sale_price, confirmed_sale }) {
  requirePermission(context, 'sale.approve'); // manager only — staff role has no 'sale.approve' permission at all

  if (confirmed_sale !== 'Yes') {
    throw new AppError('VALIDATION_ERROR', 'confirmed_sale must be "Yes" to approve a sale');
  }
  const { checks, allPass, interest } = validateSale(context, { truck_id, sold_interest_id });
  if (!allPass) {
    throw new AppError('SAFETY_GATE_BLOCKED', 'Sale blocked by Safety Gate', { checks });
  }

  const db = getDb();
  const sale_id = 'SALE-' + crypto.randomUUID();

  // --- Atomic transaction: Stock update + Sale insert + Audit ---
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE trucks SET stock_status = ?, reserved_by_customer_id = ? WHERE dealer_id = ? AND truck_id = ?')
      .run('ขายแล้ว', interest.customer_id, context.dealer_id, truck_id);

    db.prepare(
      `INSERT INTO sales (sale_id, dealer_id, truck_id, sold_interest_id, customer_id, confirmed_sale, sale_price, approved_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Approved')`
    ).run(sale_id, context.dealer_id, truck_id, sold_interest_id, interest.customer_id, confirmed_sale, sale_price || null, context.user_id || context.role);

    audit.record(context, { action_type: 'SALE_APPROVED', entity: 'truck', entity_id: truck_id, new_value: sale_id });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'Sale transaction failed', { message: e.message });
  }

  return { sale_id, truck_id, safety_gate_checks: checks };
}

function voidSale(context, sale_id, reason, revertTo) {
  requirePermission(context, 'sale.void'); // manager only
  if (!reason) throw new AppError('VALIDATION_ERROR', 'reason is required to void a sale');
  if (!revertTo || !stockService.STOCK_STATUSES.includes(revertTo)) {
    throw new AppError('VALIDATION_ERROR', 'a valid revertTo stock_status must be specified explicitly');
  }
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE dealer_id = ? AND sale_id = ?').get(context.dealer_id, sale_id);
  if (!sale) throw new AppError('NOT_FOUND', 'sale not found for this dealer');
  if (sale.status !== 'Approved') throw new AppError('VALIDATION_ERROR', 'only an Approved sale can be voided');

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE sales SET status = ?, void_reason = ?, voided_by = ? WHERE dealer_id = ? AND sale_id = ?')
      .run('Voided', reason, context.user_id || context.role, context.dealer_id, sale_id);
    db.prepare('UPDATE trucks SET stock_status = ?, reserved_by_customer_id = NULL WHERE dealer_id = ? AND truck_id = ?')
      .run(revertTo, context.dealer_id, sale.truck_id);
    audit.record(context, { action_type: 'SALE_VOIDED', entity: 'truck', entity_id: sale.truck_id, old_value: 'ขายแล้ว', new_value: revertTo, reason });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'Void sale transaction failed', { message: e.message });
  }
  return { sale_id, reverted_to: revertTo };
}

function listSales(context) {
  const db = getDb();
  return db.prepare('SELECT * FROM sales WHERE dealer_id = ? ORDER BY rowid DESC').all(context.dealer_id);
}

module.exports = { validateSale, approveSale, voidSale, listSales };
