-- ============================================================
-- Migration 010 — Hero background image
--
-- The public site's homepage hero was always a solid CSS gradient,
-- never a real photo — the customer wanted a real background image
-- (like a truck/warehouse photo) instead of the plain dark area.
-- Self-service via the same dealer-info mechanism as phone/address/etc.
-- ============================================================

ALTER TABLE dealers ADD COLUMN hero_image TEXT;
