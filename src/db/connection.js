// ============================================================
// Database Connection Foundation
// Uses Node.js built-in `node:sqlite` (DatabaseSync) — zero external
// dependencies. Chosen because this build environment has no network
// access to install packages (see README "Why no framework/ORM").
// SQLite is file-based, real relational SQL, trivial to back up
// (copy one file), and appropriate for a single-dealer deployment
// that may later be cloned per Step 27.1.
// ============================================================
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'somkiat.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db = null;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, DB_PATH };
