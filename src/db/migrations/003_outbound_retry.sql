-- ============================================================
-- Migration 003 — Outbound retry tracking (Step 31 Phase C)
-- Non-destructive ADD COLUMN, safe under the migration tracking
-- introduced in Step 30B (src/db/migrate.js).
-- ============================================================

ALTER TABLE outbound_messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_messages ADD COLUMN last_error TEXT;
