-- ============================================================
-- Migration 005 — Real message_type support for outbound messages
--
-- outboundMessageService.queueMessage() has accepted a message_type
-- parameter since it was first written, but the outbound_messages
-- table never had a column for it and the INSERT never stored it —
-- every outbound message was silently treated as plain text. This
-- blocked sending photos to customers via Messenger entirely: there
-- was no way to distinguish "send this text" from "send this image".
-- ============================================================

ALTER TABLE outbound_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'TEXT' CHECK (message_type IN ('TEXT', 'IMAGE'));
