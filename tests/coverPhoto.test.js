'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-coverPhoto.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const publicCatalogService = require('../src/services/publicCatalogService');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });

test('The FIRST photo uploaded for a truck automatically becomes its cover', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-A', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const p1 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-A', file_name: 'a.jpg', storage_reference: 'https://example.com/a.jpg', content_hash: 'ha' });
  assert.strictEqual(p1.is_cover, 1);
});

test('The SECOND photo does NOT become cover — the first one keeps that role', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-B', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const p1 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-B', file_name: 'a.jpg', storage_reference: 'https://example.com/a.jpg', content_hash: 'hb1' });
  const p2 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-B', file_name: 'b.jpg', storage_reference: 'https://example.com/b.jpg', content_hash: 'hb2' });
  assert.strictEqual(p1.is_cover, 1);
  assert.strictEqual(p2.is_cover, 0);
});

test('Deleting the cover photo promotes the next remaining photo to cover automatically', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-C', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const p1 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-C', file_name: 'a.jpg', storage_reference: 'https://example.com/a.jpg', content_hash: 'hc1' });
  const p2 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-C', file_name: 'b.jpg', storage_reference: 'https://example.com/b.jpg', content_hash: 'hc2' });
  photoService.deactivatePhoto(managerCtx, p1.photo_id);
  const remaining = photoService.listActivePhotos(managerCtx, 'TRK-C');
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].photo_id, p2.photo_id);
  assert.strictEqual(remaining[0].is_cover, 1);
});

test('Deleting the only photo leaves cover_photo as null again, no crash', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-D', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  const p1 = photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-D', file_name: 'a.jpg', storage_reference: 'https://example.com/a.jpg', content_hash: 'hd1' });
  photoService.deactivatePhoto(managerCtx, p1.photo_id);
  const publicTruck = publicCatalogService.getTruckById(managerCtx, 'TRK-D');
  assert.strictEqual(publicTruck.cover_photo, null);
});

test('End-to-end: publicCatalogService returns the real cover photo set by the auto-cover logic', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-E', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-E', file_name: 'a.jpg', storage_reference: 'https://example.com/e-cover.jpg', content_hash: 'he1' });
  const listed = publicCatalogService.listAvailableTrucks(managerCtx);
  const truck = listed.find((t) => t.truck_id === 'TRK-E');
  assert.strictEqual(truck.cover_photo, 'https://example.com/e-cover.jpg');
});

test('Retroactive fix: a truck with photos but NO cover set (simulating old pre-fix data) gets one promoted after migration', () => {
  // Simulate the state of real production data uploaded BEFORE the
  // is_cover-always-0 bug was fixed — insert directly, bypassing
  // uploadPhoto()'s (now-fixed) auto-cover logic.
  stockService.addTruck(managerCtx, { truck_id: 'TRK-RETRO-1', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  db.prepare('INSERT INTO truck_photos (photo_id, dealer_id, truck_id, storage_reference, photo_status, is_cover, display_order) VALUES (?,?,?,?,?,?,?)')
    .run('PHOTO-RETRO-1', 'DEALER_SOMKIAT', 'TRK-RETRO-1', 'https://example.com/retro1.jpg', 'ACTIVE', 0, 1);
  db.prepare('INSERT INTO truck_photos (photo_id, dealer_id, truck_id, storage_reference, photo_status, is_cover, display_order) VALUES (?,?,?,?,?,?,?)')
    .run('PHOTO-RETRO-2', 'DEALER_SOMKIAT', 'TRK-RETRO-1', 'https://example.com/retro2.jpg', 'ACTIVE', 0, 2);

  // Migration 009 already ran once (idempotent, at module load, before
  // these rows existed) — un-mark it so this test can genuinely re-run
  // its SQL logic against data inserted AFTER that point, proving the
  // logic itself is correct independent of the one-time-ever scheduling.
  db.prepare("DELETE FROM schema_migrations WHERE filename = '009_retroactive_cover_photo.sql'").run();
  runMigrations();

  const photos = photoService.listActivePhotos(managerCtx, 'TRK-RETRO-1');
  const covers = photos.filter((p) => p.is_cover === 1);
  assert.strictEqual(covers.length, 1, 'exactly one photo must become the cover');
  assert.strictEqual(covers[0].photo_id, 'PHOTO-RETRO-1', 'the EARLIEST photo (by display_order) must be the one promoted');
});

test('Retroactive fix never overrides a cover a manager already deliberately chose', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-RETRO-2', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  db.prepare('INSERT INTO truck_photos (photo_id, dealer_id, truck_id, storage_reference, photo_status, is_cover, display_order) VALUES (?,?,?,?,?,?,?)')
    .run('PHOTO-RETRO-3', 'DEALER_SOMKIAT', 'TRK-RETRO-2', 'https://example.com/retro3.jpg', 'ACTIVE', 0, 1);
  db.prepare('INSERT INTO truck_photos (photo_id, dealer_id, truck_id, storage_reference, photo_status, is_cover, display_order) VALUES (?,?,?,?,?,?,?)')
    .run('PHOTO-RETRO-4', 'DEALER_SOMKIAT', 'TRK-RETRO-2', 'https://example.com/retro4.jpg', 'ACTIVE', 1, 2); // manager already chose THIS one

  db.prepare("DELETE FROM schema_migrations WHERE filename = '009_retroactive_cover_photo.sql'").run();
  runMigrations();

  const photos = photoService.listActivePhotos(managerCtx, 'TRK-RETRO-2');
  const covers = photos.filter((p) => p.is_cover === 1);
  assert.strictEqual(covers.length, 1);
  assert.strictEqual(covers[0].photo_id, 'PHOTO-RETRO-4', 'the manager\'s deliberate choice must never be overridden');
});

test('Admin-facing getTruck/searchTrucks also include cover_photo (dashboard cards had the same bug)', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-F', brand: 'ISUZU', model: 'NLR', price: 600000, down_payment: 20000, installment_amount: 14000, installment_count: 60 });
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-F', file_name: 'a.jpg', storage_reference: 'https://example.com/f-cover.jpg', content_hash: 'hf1' });
  const single = stockService.getTruck(managerCtx, 'TRK-F');
  assert.strictEqual(single.cover_photo, 'https://example.com/f-cover.jpg');
  const list = stockService.searchTrucks(managerCtx);
  const found = list.find((t) => t.truck_id === 'TRK-F');
  assert.strictEqual(found.cover_photo, 'https://example.com/f-cover.jpg');
});
