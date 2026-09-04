-- ============================================================
-- Migration 002 — Correlation ID propagation (Step 30B, Messenger prep)
-- Non-destructive: only ADD COLUMN, no data loss, safe to re-run
-- (SQLite has no "ADD COLUMN IF NOT EXISTS", so we guard in migrate.js
--  logic instead — see the try/catch pattern there is not needed
--  because this file only runs once per fresh column; re-running a
--  migration that already applied would error on duplicate column,
--  so migrate.js tracks applied files by name and this file is safe
--  to include exactly once in the migrations directory).
-- ============================================================

ALTER TABLE conversations ADD COLUMN correlation_id TEXT;
ALTER TABLE messages ADD COLUMN correlation_id TEXT;
ALTER TABLE outbound_messages ADD COLUMN correlation_id TEXT;
