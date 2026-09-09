-- ============================================================
-- Migration 007 — News/content posts
--
-- Lets the dealer post updates, articles, or video links for
-- customers to see on the public site (e.g. "ความรู้เกี่ยวกับรถ").
-- Deliberately simple: title, body text, an optional video/image
-- link, and a status so a post can be drafted before publishing.
-- ============================================================

CREATE TABLE IF NOT EXISTS news_posts (
  post_id       TEXT PRIMARY KEY,
  dealer_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  cover_image   TEXT,
  video_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'DRAFT')),
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dealer_id) REFERENCES dealers(dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_news_posts_dealer_status ON news_posts(dealer_id, status, created_at DESC);
