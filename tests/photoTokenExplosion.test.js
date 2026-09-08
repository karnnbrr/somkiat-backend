'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-photoTokenExplosion.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const stockService = require('../src/services/stockService');
const photoService = require('../src/services/photoService');
const { makeAiTools } = require('../src/ai/aiTools');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });

test('A huge base64-uploaded photo (like a real direct-file-upload) never reaches the AI tool result as raw data', () => {
  const hugeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(2 * 1024 * 1024);
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-001', file_name: 'phone-upload.jpg', storage_reference: hugeBase64 });

  const aiTools = makeAiTools(managerCtx);
  const result = aiTools.getTruckPhotos({ truck_id: 'TRK-001' });

  assert.strictEqual(result.length, 1);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length < 1000, `AI tool result must be small (was ${serialized.length} bytes) — this is exactly what caused "prompt is too long: 2007023 tokens" in production`);
  assert.notStrictEqual(result[0].storage_reference, hugeBase64);
  assert.match(result[0].storage_reference, /not a shareable link/);
});

test('A real http(s) URL photo is preserved unchanged — needed so respondToMessage can still actually send images', () => {
  photoService.uploadPhoto(managerCtx, { truck_id: 'TRK-001', file_name: 'real.jpg', storage_reference: 'https://example.com/real-photo.jpg', content_hash: 'unique-1' });
  const aiTools = makeAiTools(managerCtx);
  const result = aiTools.getTruckPhotos({ truck_id: 'TRK-001' });
  const realOne = result.find((p) => p.storage_reference === 'https://example.com/real-photo.jpg');
  assert.ok(realOne, 'a real URL must be passed through unchanged so it can still actually be sent to the customer');
});

test('Multiple large base64 photos on one truck still produce a small tool result (proves this scales)', () => {
  stockService.addTruck(managerCtx, { truck_id: 'TRK-MANY', brand: 'ISUZU', model: 'NKR', price: 400000, down_payment: 20000, installment_amount: 10000, installment_count: 48 });
  for (let i = 0; i < 5; i++) {
    photoService.uploadPhoto(managerCtx, {
      truck_id: 'TRK-MANY', file_name: `photo-${i}.jpg`,
      storage_reference: 'data:image/jpeg;base64,' + 'B'.repeat(1024 * 1024),
      content_hash: `hash-${i}`,
    });
  }
  const aiTools = makeAiTools(managerCtx);
  const result = aiTools.getTruckPhotos({ truck_id: 'TRK-MANY' });
  assert.strictEqual(result.length, 5);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length < 2000, `5 photos' worth of tool result must still be small (was ${serialized.length} bytes)`);
});
