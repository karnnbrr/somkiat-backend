// ============================================================
// Photo Service — Step 25/29
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');

function listActivePhotos(context, truck_id) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM truck_photos WHERE dealer_id = ? AND truck_id = ? AND photo_status = 'ACTIVE'
     ORDER BY is_cover DESC, display_order ASC`
  ).all(context.dealer_id, truck_id);
}

function uploadPhoto(context, { truck_id, file_name, content_hash, storage_reference }) {
  requirePermission(context, 'photo.upload');
  const db = getDb();
  const truck = db.prepare('SELECT 1 FROM trucks WHERE dealer_id = ? AND truck_id = ?').get(context.dealer_id, truck_id);
  if (!truck) throw new AppError('VALIDATION_ERROR', 'truck_id does not exist for this dealer');

  // content_hash is optional (the URL-paste upload flow never provides one) —
  // SQLite bindings reject `undefined` outright, and there's nothing
  // meaningful to duplicate-check against without a real hash anyway.
  const dup = content_hash
    ? db.prepare(
        `SELECT photo_id FROM truck_photos WHERE dealer_id = ? AND truck_id = ? AND content_hash = ? AND photo_status = 'ACTIVE'`
      ).get(context.dealer_id, truck_id, content_hash)
    : null;
  if (dup) throw new AppError('VALIDATION_ERROR', 'duplicate photo content already exists for this truck');

  const maxOrderRow = db.prepare(
    'SELECT MAX(display_order) as maxOrder FROM truck_photos WHERE dealer_id = ? AND truck_id = ?'
  ).get(context.dealer_id, truck_id);
  const nextOrder = (maxOrderRow.maxOrder || 0) + 1;

  // Real gap found while chasing "photos never show up on the public site":
  // is_cover always inserted as 0, with nothing anywhere that ever called
  // setCover automatically OR exposed a "set as cover" button in either
  // dashboard — meaning NO truck's photo could ever become a cover photo
  // in practice. The first photo uploaded for a truck now becomes its
  // cover automatically; later uploads leave the existing cover alone
  // (still changeable via setCover).
  const hasCoverAlready = db.prepare(
    "SELECT 1 FROM truck_photos WHERE dealer_id = ? AND truck_id = ? AND is_cover = 1 AND photo_status = 'ACTIVE'"
  ).get(context.dealer_id, truck_id);
  const isCover = hasCoverAlready ? 0 : 1;

  const photo_id = 'PHOTO-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO truck_photos (photo_id, dealer_id, truck_id, storage_reference, file_name, content_hash, photo_status, is_cover, display_order, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
  ).run(photo_id, context.dealer_id, truck_id, storage_reference || `local://${photo_id}`, file_name || null, content_hash || null, isCover, nextOrder, context.user_id || context.role);
  audit.record(context, { action_type: 'PHOTO_UPLOAD', entity: 'truck_photo', entity_id: photo_id, new_value: truck_id });
  return db.prepare('SELECT * FROM truck_photos WHERE photo_id = ?').get(photo_id);
}

function setCover(context, photo_id) {
  requirePermission(context, 'photo.set_cover');
  const db = getDb();
  const photo = db.prepare('SELECT * FROM truck_photos WHERE dealer_id = ? AND photo_id = ?').get(context.dealer_id, photo_id);
  if (!photo) throw new AppError('NOT_FOUND', 'photo not found for this dealer');
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE truck_photos SET is_cover = 0 WHERE dealer_id = ? AND truck_id = ?').run(context.dealer_id, photo.truck_id);
    db.prepare('UPDATE truck_photos SET is_cover = 1 WHERE dealer_id = ? AND photo_id = ?').run(context.dealer_id, photo_id);
    audit.record(context, { action_type: 'SET_COVER', entity: 'truck_photo', entity_id: photo_id });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'set cover failed', { message: e.message });
  }
  return listActivePhotos(context, photo.truck_id);
}

function deactivatePhoto(context, photo_id) {
  requirePermission(context, 'photo.deactivate');
  const db = getDb();
  const photo = db.prepare('SELECT * FROM truck_photos WHERE dealer_id = ? AND photo_id = ?').get(context.dealer_id, photo_id);
  if (!photo) throw new AppError('NOT_FOUND', 'photo not found for this dealer');
  db.prepare("UPDATE truck_photos SET photo_status = 'INACTIVE', is_cover = 0 WHERE dealer_id = ? AND photo_id = ?")
    .run(context.dealer_id, photo_id);
  // If the deleted photo WAS the cover, promote the next remaining active
  // photo (if any) — otherwise deleting a cover photo would silently
  // leave the truck with zero cover forever, even with other photos left.
  if (photo.is_cover) {
    const next = db.prepare(
      "SELECT photo_id FROM truck_photos WHERE dealer_id = ? AND truck_id = ? AND photo_status = 'ACTIVE' ORDER BY display_order ASC LIMIT 1"
    ).get(context.dealer_id, photo.truck_id);
    if (next) {
      db.prepare('UPDATE truck_photos SET is_cover = 1 WHERE dealer_id = ? AND photo_id = ?').run(context.dealer_id, next.photo_id);
    }
  }
  audit.record(context, { action_type: 'DEACTIVATE_PHOTO', entity: 'truck_photo', entity_id: photo_id });
  return { photo_id, photo_status: 'INACTIVE' };
}

function restorePhoto(context, photo_id) {
  requirePermission(context, 'photo.restore'); // manager only
  const db = getDb();
  const photo = db.prepare('SELECT * FROM truck_photos WHERE dealer_id = ? AND photo_id = ?').get(context.dealer_id, photo_id);
  if (!photo) throw new AppError('NOT_FOUND', 'photo not found for this dealer');
  db.prepare("UPDATE truck_photos SET photo_status = 'ACTIVE' WHERE dealer_id = ? AND photo_id = ?").run(context.dealer_id, photo_id);
  audit.record(context, { action_type: 'RESTORE_PHOTO', entity: 'truck_photo', entity_id: photo_id });
  return { photo_id, photo_status: 'ACTIVE' };
}

module.exports = { listActivePhotos, uploadPhoto, setCover, deactivatePhoto, restorePhoto };
