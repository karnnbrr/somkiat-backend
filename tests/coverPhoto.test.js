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
