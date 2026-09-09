-- ============================================================
-- Migration 009 — Retroactively fix existing photos with no cover
--
-- The is_cover-always-0 bug fixed in photoService.js only applies to
-- NEW uploads going forward. Any photo already sitting in the
-- database from before that fix still has is_cover = 0 for every
-- row, so trucks with real photos uploaded earlier today still show
-- no cover_photo at all. This one-time UPDATE promotes the earliest
-- ACTIVE photo (by display_order) to cover, for every truck/dealer
-- combination that currently has photos but no cover among them.
--
-- Safe to run once: only touches trucks with zero existing is_cover=1
-- rows, so it can never override a cover a manager deliberately chose
-- via setCover.
-- ============================================================

UPDATE truck_photos
SET is_cover = 1
WHERE photo_id IN (
  SELECT tp.photo_id
  FROM truck_photos tp
  WHERE tp.photo_status = 'ACTIVE'
    AND tp.display_order = (
      SELECT MIN(tp2.display_order)
      FROM truck_photos tp2
      WHERE tp2.dealer_id = tp.dealer_id AND tp2.truck_id = tp.truck_id AND tp2.photo_status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM truck_photos tp3
      WHERE tp3.dealer_id = tp.dealer_id AND tp3.truck_id = tp.truck_id
        AND tp3.is_cover = 1 AND tp3.photo_status = 'ACTIVE'
    )
);
