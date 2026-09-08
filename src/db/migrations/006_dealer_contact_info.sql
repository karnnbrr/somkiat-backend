-- ============================================================
-- Migration 006 — Business contact info on the dealers table
--
-- The public site's Contact page and footer, and the admin
-- dashboard's Settings page, both need somewhere to read/write real
-- business contact details (address, phone, hours, etc.) instead of
-- the honest placeholder text used until now ("กรุณากรอกข้อมูลจริง...").
-- Lives directly on `dealers` since it's a 1:1 property of the dealer,
-- not a separate entity with its own lifecycle.
-- ============================================================

ALTER TABLE dealers ADD COLUMN phone TEXT;
ALTER TABLE dealers ADD COLUMN address TEXT;
ALTER TABLE dealers ADD COLUMN business_hours TEXT;
ALTER TABLE dealers ADD COLUMN line_id TEXT;
ALTER TABLE dealers ADD COLUMN facebook_page_url TEXT;
