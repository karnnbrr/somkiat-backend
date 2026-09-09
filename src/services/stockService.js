// ============================================================
// Stock Service — Step 18/19/24/29
// Every function takes `context` FIRST and uses context.dealer_id for
// every query. There is no function here that accepts a dealer_id as
// a plain argument from a caller — this is what makes cross-dealer
// access structurally impossible, not just checked-and-blocked.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');

const STOCK_STATUSES = ['พร้อมขาย', 'จองแล้ว', 'ขายแล้ว'];

function getTruck(context, truck_id) {
  const db = getDb();
  return db.prepare(
    `SELECT t.*, (SELECT p.storage_reference FROM truck_photos p
                  WHERE p.dealer_id = t.dealer_id AND p.truck_id = t.truck_id
                    AND p.is_cover = 1 AND p.photo_status = 'ACTIVE' LIMIT 1) AS cover_photo
     FROM trucks t WHERE t.dealer_id = ? AND t.truck_id = ?`
  ).get(context.dealer_id, truck_id) || null;
}

function searchTrucks(context, { model, status, maxPrice, bodyType } = {}) {
  const db = getDb();
  let sql = `
    SELECT t.*, (SELECT p.storage_reference FROM truck_photos p
                 WHERE p.dealer_id = t.dealer_id AND p.truck_id = t.truck_id
                   AND p.is_cover = 1 AND p.photo_status = 'ACTIVE' LIMIT 1) AS cover_photo
    FROM trucks t WHERE t.dealer_id = ?`;
  const params = [context.dealer_id];
  if (model) { sql += ' AND t.model = ?'; params.push(model); }
  if (status) { sql += ' AND t.stock_status = ?'; params.push(status); }
  if (maxPrice != null) { sql += ' AND t.price <= ?'; params.push(maxPrice); }
  if (bodyType) { sql += ' AND t.body_type LIKE ?'; params.push(`%${bodyType}%`); }
  return db.prepare(sql).all(...params);
}

function addTruck(context, input) {
  requirePermission(context, 'stock.edit_general');
  const db = getDb();
  if (!input.truck_id || String(input.truck_id).trim() === '') {
    throw new AppError('VALIDATION_ERROR', 'truck_id is required');
  }
  if (getTruck(context, input.truck_id)) {
    throw new AppError('VALIDATION_ERROR', 'truck_id already exists for this dealer');
  }
  for (const f of ['price', 'down_payment', 'installment_amount']) {
    if (typeof input[f] !== 'number' || input[f] < 0) {
      throw new AppError('VALIDATION_ERROR', `${f} must be a non-negative number`);
    }
  }
  if (!Number.isInteger(input.installment_count) || input.installment_count <= 0) {
    throw new AppError('VALIDATION_ERROR', 'installment_count must be a positive integer');
  }
  const status = input.stock_status || 'พร้อมขาย';
  if (!STOCK_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_ERROR', 'invalid stock_status');
  }
  db.prepare(
    `INSERT INTO trucks (truck_id, dealer_id, brand, model, year, price, down_payment, installment_amount, installment_count, body_type, license_plate, cargo_dimensions, stock_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.truck_id, context.dealer_id, input.brand || null, input.model || null, input.year || null,
    input.price, input.down_payment, input.installment_amount, input.installment_count,
    input.body_type || null, input.license_plate || null, input.cargo_dimensions || null, status);
  audit.record(context, { action_type: 'ADD_TRUCK', entity: 'truck', entity_id: input.truck_id, new_value: status });
  return getTruck(context, input.truck_id);
}

function editTruckDetails(context, truck_id, updates) {
  requirePermission(context, 'stock.edit_general');
  const truck = getTruck(context, truck_id);
  if (!truck) throw new AppError('NOT_FOUND', 'truck not found for this dealer');
  const db = getDb();
  const allowed = ['price', 'down_payment', 'installment_amount', 'installment_count', 'brand', 'model', 'year', 'body_type', 'license_plate', 'cargo_dimensions'];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k)) continue; // stock_status/reserved_by/truck_id are NOT editable here — see reserve()/sale flows
    if (['price', 'down_payment', 'installment_amount'].includes(k) && (typeof v !== 'number' || v < 0)) {
      throw new AppError('VALIDATION_ERROR', `${k} must be a non-negative number`);
    }
    db.prepare(`UPDATE trucks SET ${k} = ? WHERE dealer_id = ? AND truck_id = ?`).run(v, context.dealer_id, truck_id);
    audit.record(context, { action_type: 'EDIT_' + k.toUpperCase(), entity: 'truck', entity_id: truck_id, old_value: truck[k], new_value: v });
  }
  return getTruck(context, truck_id);
}

/** Truck Interest (customer interest) NEVER touches stock_status — enforced by not exposing that path here. */
function reserveTruck(context, truck_id, customer_id) {
  requirePermission(context, 'stock.reserve');
  const db = getDb();
  const truck = getTruck(context, truck_id);
  if (!truck) throw new AppError('NOT_FOUND', 'truck not found for this dealer');
  if (truck.stock_status === 'ขายแล้ว') throw new AppError('SAFETY_GATE_BLOCKED', 'truck already sold');
  if (truck.stock_status === 'จองแล้ว' && truck.reserved_by_customer_id !== customer_id) {
    throw new AppError('SAFETY_GATE_BLOCKED', 'truck already reserved by another customer');
  }
  db.prepare('UPDATE trucks SET stock_status = ?, reserved_by_customer_id = ? WHERE dealer_id = ? AND truck_id = ?')
    .run('จองแล้ว', customer_id, context.dealer_id, truck_id);
  audit.record(context, { action_type: 'RESERVE', entity: 'truck', entity_id: truck_id, old_value: truck.stock_status, new_value: 'จองแล้ว' });
  return getTruck(context, truck_id);
}

function cancelReservation(context, truck_id) {
  requirePermission(context, 'stock.cancel_reservation');
  const db = getDb();
  const truck = getTruck(context, truck_id);
  if (!truck) throw new AppError('NOT_FOUND', 'truck not found for this dealer');
  if (truck.stock_status !== 'จองแล้ว') throw new AppError('VALIDATION_ERROR', 'truck is not currently reserved');
  db.prepare('UPDATE trucks SET stock_status = ?, reserved_by_customer_id = NULL WHERE dealer_id = ? AND truck_id = ?')
    .run('พร้อมขาย', context.dealer_id, truck_id);
  audit.record(context, { action_type: 'CANCEL_RESERVATION', entity: 'truck', entity_id: truck_id, old_value: 'จองแล้ว', new_value: 'พร้อมขาย' });
  return getTruck(context, truck_id);
}

/**
 * Deletes a truck. Deliberately Manager-only (a stricter action than
 * general edits) and deliberately FAILS if any real activity already
 * exists against this truck (photos, customer interest, or a sale) —
 * SQLite's own foreign key enforcement (PRAGMA foreign_keys = ON) is
 * what actually blocks it; this just turns that into a clear message
 * instead of a raw database error. This is intentionally NOT possible
 * to override — a truck with real history should never be silently
 * erased, only its stock_status changed via the normal reserve/sale flows.
 */
function deleteTruck(context, truck_id) {
  requirePermission(context, 'stock.delete');
  const truck = getTruck(context, truck_id);
  if (!truck) throw new AppError('NOT_FOUND', 'truck not found for this dealer');
  const db = getDb();
  try {
    db.prepare('DELETE FROM trucks WHERE dealer_id = ? AND truck_id = ?').run(context.dealer_id, truck_id);
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) {
      throw new AppError('VALIDATION_ERROR', 'ลบไม่ได้ เพราะมีรูปภาพ ลูกค้าที่สนใจ หรือประวัติการขายผูกกับรถคันนี้อยู่แล้ว');
    }
    throw e;
  }
  audit.record(context, { action_type: 'DELETE_TRUCK', entity: 'truck', entity_id: truck_id, old_value: JSON.stringify(truck) });
}

module.exports = { STOCK_STATUSES, getTruck, searchTrucks, addTruck, editTruckDetails, deleteTruck, reserveTruck, cancelReservation };
