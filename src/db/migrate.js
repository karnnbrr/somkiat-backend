// ============================================================
// Migration Runner — applies migrations/*.sql in filename order,
// tracking which ones have already run in a `schema_migrations`
// table so it is safe to call on every server startup.
//
// This tracking was ADDED in Step 30B: migration 001 only ever used
// `CREATE TABLE IF NOT EXISTS`, which is naturally idempotent, so the
// original runner (which just re-executed every file every time) got
// away without tracking. Migration 002 introduces `ALTER TABLE ADD
// COLUMN`, which is NOT idempotent — running it twice throws
// "duplicate column name". Tracking applied migrations is the
// correct fix, not skipping ALTER TABLE statements.
// ============================================================
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('./connection');

function ensureTrackingTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function runMigrations() {
  const db = getDb();
  ensureTrackingTable(db);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename));

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file);
      db.exec('COMMIT');
      console.log(`[migrate] applied ${file}`);
      newlyApplied.push(file);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`[migrate] FAILED applying ${file}: ${e.message}`);
    }
  }
  if (newlyApplied.length === 0) {
    console.log('[migrate] no new migrations (schema already up to date)');
  }
  return newlyApplied;
}

if (require.main === module) {
  runMigrations();
  console.log('[migrate] done');
}

module.exports = { runMigrations };
