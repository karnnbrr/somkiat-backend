-- ============================================================
-- Migration 004 — Fix real Facebook Page ID
--
-- seed.js originally inserted a PLACEHOLDER facebook_page_id
-- ('PAGE_SOMKIAT') for the demo facebook_page_connections row,
-- since the real Page didn't exist yet at the time this project was
-- built. Now that a real Facebook App + Page are connected, incoming
-- webhooks carry the REAL Page ID (110595144447762), which didn't
-- match anything in this table — contextFromFacebookPage() correctly
-- refused to guess, and blocked every real message with
-- DEALER_CONTEXT_ERROR (by design — see dealerContext.js).
--
-- This UPDATE only touches the row if it still has the placeholder
-- value, so it's safe to run even if this has already been fixed
-- manually — it will simply match zero rows and do nothing.
-- ============================================================

UPDATE facebook_page_connections
SET facebook_page_id = '110595144447762'
WHERE dealer_id = 'DEALER_SOMKIAT' AND facebook_page_id = 'PAGE_SOMKIAT';
