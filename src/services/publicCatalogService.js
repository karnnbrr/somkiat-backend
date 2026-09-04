// ============================================================
// Public Catalog Service — Step 36
//
// Everything here is READ-ONLY. This module never calls
// requirePermission() and never writes anything — the 'public' role
// has zero entries in permission.js's PERMISSIONS table on purpose,
// the same pattern already used for the 'ai' pseudo-role. There is no
// path from any function in this file to Stock/Sale/Customer writes.
//
// listAvailableTrucks() deliberately excludes 'ขายแล้ว' (sold) trucks
// from the public catalog listing — a customer browsing to buy a truck
// shouldn't be shown ones that are already gone. getTruckById() does
// NOT apply that filter: if a customer has a direct link to a truck
// that has since sold, they see its real, current, honest status
// ("ขายแล้ว") rather than a 404 that looks like the link is broken.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');

function listAvailableTrucks(context, { model, maxPrice } = {}) {
  const db = getDb();
  let sql = "SELECT truck_id, brand, model, year, price, down_payment, installment_amount, installment_count, body_type, stock_status FROM trucks WHERE dealer_id = ? AND stock_status != 'ขายแล้ว'";
  const params = [context.dealer_id];
  if (model) { sql += ' AND model = ?'; params.push(model); }
  if (maxPrice != null) { sql += ' AND price <= ?'; params.push(maxPrice); }
  sql += ' ORDER BY rowid DESC';
  return db.prepare(sql).all(...params);
}

function getTruckById(context, truck_id) {
  const db = getDb();
  return db.prepare(
    'SELECT truck_id, brand, model, year, price, down_payment, installment_amount, installment_count, body_type, stock_status FROM trucks WHERE dealer_id = ? AND truck_id = ?'
  ).get(context.dealer_id, truck_id) || null;
}

function listTruckPhotos(context, truck_id) {
  const db = getDb();
  return db.prepare(
    `SELECT photo_id, truck_id, storage_reference, is_cover, display_order FROM truck_photos
     WHERE dealer_id = ? AND truck_id = ? AND photo_status = 'ACTIVE'
     ORDER BY is_cover DESC, display_order ASC`
  ).all(context.dealer_id, truck_id);
}

module.exports = { listAvailableTrucks, getTruckById, listTruckPhotos };
