-- ============================================================
-- S.K.AUTOTRUCK — Production Foundation — Initial Schema
-- Covers entities from Step 14-28 Data Contract.
-- SQLite (node:sqlite) — relational, file-based, zero external deps.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- DEALER (Step 27.1) ----------
CREATE TABLE IF NOT EXISTS dealers (
  dealer_id     TEXT PRIMARY KEY,
  dealer_name   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- USERS (Staff / Manager) ----------
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  dealer_id     TEXT NOT NULL REFERENCES dealers(dealer_id),
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('staff','manager')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  dealer_id     TEXT NOT NULL REFERENCES dealers(dealer_id),
  role          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

-- ---------- FACEBOOK PAGE CONNECTION (Step 28) ----------
CREATE TABLE IF NOT EXISTS facebook_page_connections (
  connection_id     TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL REFERENCES dealers(dealer_id),
  facebook_page_id  TEXT NOT NULL UNIQUE,
  page_name         TEXT,
  status            TEXT NOT NULL DEFAULT 'CONNECTED',
  connected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at   TEXT
);

-- ---------- TRUCK (Stock Master — Step 14/18/19/24) ----------
CREATE TABLE IF NOT EXISTS trucks (
  truck_id            TEXT NOT NULL,
  dealer_id           TEXT NOT NULL REFERENCES dealers(dealer_id),
  brand               TEXT,
  model               TEXT,
  year                INTEGER,
  price               REAL NOT NULL CHECK (price >= 0),
  down_payment        REAL NOT NULL CHECK (down_payment >= 0),
  installment_amount  REAL NOT NULL CHECK (installment_amount >= 0),
  installment_count   INTEGER NOT NULL CHECK (installment_count > 0),
  body_type           TEXT,
  license_plate       TEXT,
  stock_status        TEXT NOT NULL DEFAULT 'พร้อมขาย'
                       CHECK (stock_status IN ('พร้อมขาย','จองแล้ว','ขายแล้ว')),
  reserved_by_customer_id TEXT,
  listing_date        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dealer_id, truck_id)
);

-- ---------- TRUCK_PHOTO (Step 25) ----------
CREATE TABLE IF NOT EXISTS truck_photos (
  photo_id          TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  truck_id          TEXT NOT NULL,
  storage_reference TEXT,
  file_name         TEXT,
  content_hash      TEXT,
  photo_status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (photo_status IN ('ACTIVE','INACTIVE','PURGED')),
  is_cover          INTEGER NOT NULL DEFAULT 0,
  display_order     INTEGER NOT NULL DEFAULT 1,
  uploaded_by       TEXT,
  uploaded_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dealer_id, truck_id) REFERENCES trucks(dealer_id, truck_id)
);

-- ---------- CUSTOMER (Step 15/15.1/27.1 — scoped by dealer_id+phone) ----------
CREATE TABLE IF NOT EXISTS customers (
  customer_id     TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL REFERENCES dealers(dealer_id),
  name            TEXT,
  phone           TEXT,
  contact_channel TEXT,
  source          TEXT,
  assigned_staff  TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dealer_id, phone)
);

-- ---------- CONVERSATION / MESSAGE / INTERACTION (Step 28) ----------
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL REFERENCES dealers(dealer_id),
  page_id         TEXT,
  sender_psid     TEXT,
  customer_id     TEXT REFERENCES customers(customer_id),
  channel         TEXT DEFAULT 'facebook_messenger',
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  message_id        TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  conversation_id   TEXT NOT NULL REFERENCES conversations(conversation_id),
  direction         TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  sender_type       TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER','AI','STAFF','SYSTEM')),
  message_type      TEXT NOT NULL DEFAULT 'TEXT',
  text              TEXT,
  raw_platform_reference TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
  interaction_id  TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL REFERENCES dealers(dealer_id),
  conversation_id TEXT REFERENCES conversations(conversation_id),
  customer_id     TEXT REFERENCES customers(customer_id),
  campaign_id     TEXT,
  adset_id        TEXT,
  ad_id           TEXT,
  source          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- CUSTOMER_ATTACHMENT (Step 28 — separate from TRUCK_PHOTO) ----------
CREATE TABLE IF NOT EXISTS customer_attachments (
  attachment_id     TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  customer_id       TEXT,
  conversation_id   TEXT,
  message_id        TEXT,
  storage_reference TEXT,
  attachment_type   TEXT,
  received_at       TEXT NOT NULL DEFAULT (datetime('now')),
  status            TEXT NOT NULL DEFAULT 'RECEIVED'
);

-- ---------- LEAD ----------
CREATE TABLE IF NOT EXISTS leads (
  lead_id         TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL REFERENCES dealers(dealer_id),
  interaction_id  TEXT REFERENCES interactions(interaction_id),
  customer_id     TEXT REFERENCES customers(customer_id),
  status          TEXT NOT NULL DEFAULT 'New Lead',
  is_qualified    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- TRUCK_INTEREST (Step 17/17.1/17.2) ----------
CREATE TABLE IF NOT EXISTS truck_interests (
  truck_interest_id TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  truck_id          TEXT NOT NULL,
  customer_id       TEXT NOT NULL REFERENCES customers(customer_id),
  lead_id           TEXT REFERENCES leads(lead_id),
  captured_campaign_id TEXT,
  captured_adset_id    TEXT,
  captured_ad_id       TEXT,
  interest_level    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dealer_id, truck_id) REFERENCES trucks(dealer_id, truck_id)
);

-- ---------- FOLLOW_UP ----------
CREATE TABLE IF NOT EXISTS follow_ups (
  follow_up_id    TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL,
  customer_id     TEXT NOT NULL REFERENCES customers(customer_id),
  truck_id        TEXT,
  due_date        TEXT,
  reason          TEXT,
  next_action     TEXT,
  assigned_staff  TEXT,
  status          TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Upcoming','Overdue','Completed')),
  result          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- HANDOFF (Step 23/28) ----------
CREATE TABLE IF NOT EXISTS handoffs (
  handoff_id        TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  conversation_id   TEXT,
  customer_id       TEXT,
  truck_interest_id TEXT,
  truck_id          TEXT,
  reason            TEXT NOT NULL,
  priority          TEXT NOT NULL DEFAULT 'NORMAL',
  summary           TEXT,
  status            TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Assigned','In Progress','Waiting Customer','Resolved','Closed')),
  assigned_staff    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- SALE (Step 17.2/19) ----------
CREATE TABLE IF NOT EXISTS sales (
  sale_id           TEXT PRIMARY KEY,
  dealer_id         TEXT NOT NULL,
  truck_id          TEXT NOT NULL,
  sold_interest_id  TEXT NOT NULL REFERENCES truck_interests(truck_interest_id),
  customer_id       TEXT NOT NULL,
  confirmed_sale    TEXT NOT NULL CHECK (confirmed_sale IN ('Yes','No')),
  sale_price        REAL,
  approved_by       TEXT,
  status            TEXT NOT NULL DEFAULT 'Approved' CHECK (status IN ('Approved','Voided')),
  void_reason       TEXT,
  voided_by         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dealer_id, truck_id) REFERENCES trucks(dealer_id, truck_id)
);

-- ---------- OUTBOUND_MESSAGE (Step 28) ----------
CREATE TABLE IF NOT EXISTS outbound_messages (
  message_id      TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL,
  page_id         TEXT,
  conversation_id TEXT,
  recipient_psid  TEXT,
  message_content TEXT,
  status          TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- IDEMPOTENCY (Step 28 — must be persistent, unique) ----------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,   -- page_id::message_id
  page_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  dealer_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'PROCESSED',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- AUDIT LOG (append-only, dealer_id mandatory) ----------
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id        TEXT PRIMARY KEY,
  dealer_id       TEXT NOT NULL,
  actor           TEXT,
  action_type     TEXT NOT NULL,
  entity          TEXT,
  entity_id       TEXT,
  old_value       TEXT,
  new_value       TEXT,
  reason          TEXT,
  correlation_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trucks_dealer ON trucks(dealer_id);
CREATE INDEX IF NOT EXISTS idx_photos_truck ON truck_photos(dealer_id, truck_id);
CREATE INDEX IF NOT EXISTS idx_customers_dealer_phone ON customers(dealer_id, phone);
CREATE INDEX IF NOT EXISTS idx_interests_truck ON truck_interests(dealer_id, truck_id);
CREATE INDEX IF NOT EXISTS idx_audit_dealer ON audit_log(dealer_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_dealer ON handoffs(dealer_id, status);
