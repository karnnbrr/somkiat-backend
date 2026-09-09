-- ============================================================
-- Migration 008 — Cargo bed/box dimensions
--
-- Customers frequently ask about the size of the cargo bed/box
-- (e.g. "ขนาดกระบะ/ตู้เท่าไหร่") — this was never captured anywhere,
-- so staff had no field to record it and the AI had nothing to answer
-- from. Free-text on purpose (dimensions are commonly given as
-- "กว้าง x ยาว x สูง (ม.)" strings, not separate numeric fields).
-- ============================================================

ALTER TABLE trucks ADD COLUMN cargo_dimensions TEXT;
