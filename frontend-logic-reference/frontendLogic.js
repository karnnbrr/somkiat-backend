// ============================================================
// Pure logic used by the React Dashboard artifact (Step 33).
//
// This file is a TESTABLE MIRROR of the same pure functions defined
// inline inside the .jsx artifact (Claude Artifacts are single-file
// and cannot `require()` an external module, and this sandbox has no
// headless-browser/jsdom available to test React rendering directly).
// Keeping the logic here lets it be exercised by real node:test runs;
// tests/frontendLogic.test.js does exactly that. The .jsx file's
// inline copies are kept byte-for-byte identical on purpose.
// ============================================================
'use strict';

function buildApiUrl(base, path) {
  const cleanBase = (base || '').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return cleanBase + cleanPath;
}

const STATUS_BADGES = {
  'พร้อมขาย': { emoji: '🟢', colorKey: 'success' },
  'จองแล้ว': { emoji: '🟠', colorKey: 'warning' },
  'ขายแล้ว': { emoji: '⚫', colorKey: 'neutral' },
};
function getStatusBadge(status) {
  return STATUS_BADGES[status] || { emoji: '⚪', colorKey: 'neutral' };
}

function formatCurrency(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '-';
  return '฿' + n.toLocaleString('th-TH');
}

/** Builds the Leads funnel from REAL counts only — never invents a stage's number. */
function computeFunnelStages(summary) {
  if (!summary) return [];
  return [
    { label: 'ลูกค้าใหม่ (Customers)', value: summary.crm?.customers ?? 0 },
    { label: 'สนใจรถ (Truck Interests)', value: summary.crm?.truck_interests ?? 0 },
    { label: 'ติดตาม (Follow-ups เปิดอยู่)', value: summary.crm?.open_follow_ups ?? 0 },
    { label: 'ส่งต่อเจ้าหน้าที่ (Handoffs เปิดอยู่)', value: summary.crm?.open_handoffs ?? 0 },
    { label: 'ปิดการขาย (เดือนนี้)', value: summary.crm?.sales_this_month ?? 0 },
  ];
}

/** Turns a backend AppError-shaped response into a safe, user-facing message. Never echoes internals. */
function parseApiError(status, body) {
  if (status === 401) return 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
  if (status === 403) return 'คุณไม่มีสิทธิ์ทำรายการนี้';
  if (status === 404) return 'ไม่พบข้อมูลที่ต้องการ';
  if (body && body.error && body.error.message) {
    // Only ever show the message field — never `.details`, which the
    // backend deliberately never sends to clients in the first place.
    return body.error.message;
  }
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

function isLiveConnectionError(err) {
  return err instanceof TypeError || (err && err.message === 'Failed to fetch');
}

module.exports = { buildApiUrl, getStatusBadge, formatCurrency, computeFunnelStages, parseApiError, isLiveConnectionError };
