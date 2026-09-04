// ============================================================
// Seed Script — DEMO DATA ONLY.
//
// Creates DEALER_SOMKIAT + demo staff/manager users + a demo truck,
// for manual smoke-testing only. The credentials below
// (staff1/manager1, password "changeme123") are NOT safe for any
// real deployment. Step 30B §27 hardening: this script now refuses
// to run in production unless SEED_ALLOW_PRODUCTION=true is set
// explicitly, so nobody can accidentally ship default credentials.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');
const { runMigrations } = require('../db/migrate');
const authService = require('../services/authService');

function seed() {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.error(
      '[seed] REFUSING to run: NODE_ENV=production and SEED_ALLOW_PRODUCTION is not "true".\n' +
      '[seed] This script creates well-known demo credentials (staff1/manager1, password "changeme123").\n' +
      '[seed] If you really intend to seed a production database with demo accounts you MUST\n' +
      '[seed] change the password immediately after, and only proceed by explicitly setting\n' +
      '[seed] SEED_ALLOW_PRODUCTION=true. This is a deliberate speed bump, not a technical limitation.'
    );
    process.exit(1);
  }

  runMigrations();
  const db = getDb();

  const dealerExists = db.prepare('SELECT 1 FROM dealers WHERE dealer_id = ?').get('DEALER_SOMKIAT');
  if (!dealerExists) {
    db.prepare('INSERT INTO dealers (dealer_id, dealer_name, status) VALUES (?, ?, ?)')
      .run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK', 'ACTIVE');
    console.log('[seed] created dealer DEALER_SOMKIAT');
  }

  const staffExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get('staff1');
  if (!staffExists) {
    authService.createUser('DEALER_SOMKIAT', { name: 'พนักงาน เอ', username: 'staff1', password: 'changeme123', role: 'staff' });
    console.log('[seed] created user staff1 / changeme123 — DEMO ONLY, CHANGE THIS before any real use');
  }
  const managerExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get('manager1');
  if (!managerExists) {
    authService.createUser('DEALER_SOMKIAT', { name: 'ผู้จัดการ', username: 'manager1', password: 'changeme123', role: 'manager' });
    console.log('[seed] created user manager1 / changeme123 — DEMO ONLY, CHANGE THIS before any real use');
  }

  const truckExists = db.prepare('SELECT 1 FROM trucks WHERE dealer_id = ? AND truck_id = ?').get('DEALER_SOMKIAT', 'TRK-001');
  if (!truckExists) {
    db.prepare(
      `INSERT INTO trucks (truck_id, dealer_id, brand, model, year, price, down_payment, installment_amount, installment_count, body_type, stock_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('TRK-001', 'DEALER_SOMKIAT', 'ISUZU', 'NLR', 2016, 629000, 29000, 15300, 60, 'ตู้แห้ง', 'พร้อมขาย');
    console.log('[seed] created DEMO truck TRK-001');
  }

  const pageExists = db.prepare('SELECT 1 FROM facebook_page_connections WHERE facebook_page_id = ?').get('PAGE_SOMKIAT');
  if (!pageExists) {
    db.prepare(
      'INSERT INTO facebook_page_connections (connection_id, dealer_id, facebook_page_id, page_name, status) VALUES (?, ?, ?, ?, ?)'
    ).run('CONN-1', 'DEALER_SOMKIAT', 'PAGE_SOMKIAT', 'S.K.AUTOTRUCK', 'CONNECTED');
    console.log('[seed] created facebook_page_connections PAGE_SOMKIAT (NOT a real connection — internal mapping row only, no real Facebook Page is linked)');
  }

  console.log('[seed] done — remember: this data is for local/manual testing only.');
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
