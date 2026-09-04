// ============================================================
// Dashboard Service — Step 33
// Read-only aggregation ONLY. Every number here is a COUNT/SELECT
// against tables that already exist and are already dealer-scoped
// by every other service in this codebase — nothing new is computed
// or invented. This exists so the frontend never has to fake numbers.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');

function getSummary(context) {
  const db = getDb();
  const d = context.dealer_id;

  const stockCounts = db.prepare(
    "SELECT stock_status, COUNT(*) as n FROM trucks WHERE dealer_id = ? GROUP BY stock_status"
  ).all(d);
  const stock = { 'พร้อมขาย': 0, 'จองแล้ว': 0, 'ขายแล้ว': 0 };
  stockCounts.forEach((row) => { stock[row.stock_status] = row.n; });

  const customerCount = db.prepare('SELECT COUNT(*) as n FROM customers WHERE dealer_id = ?').get(d).n;
  const openFollowUps = db.prepare("SELECT COUNT(*) as n FROM follow_ups WHERE dealer_id = ? AND status != 'Completed'").get(d).n;
  const overdueFollowUps = db.prepare("SELECT COUNT(*) as n FROM follow_ups WHERE dealer_id = ? AND status = 'Overdue'").get(d).n;
  const openHandoffs = db.prepare("SELECT COUNT(*) as n FROM handoffs WHERE dealer_id = ? AND status NOT IN ('Resolved','Closed')").get(d).n;
  const truckInterestCount = db.prepare('SELECT COUNT(*) as n FROM truck_interests WHERE dealer_id = ?').get(d).n;
  const salesThisMonth = db.prepare(
    "SELECT COUNT(*) as n FROM sales WHERE dealer_id = ? AND status = 'Approved' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
  ).get(d).n;

  const recentActivity = db.prepare('SELECT * FROM audit_log WHERE dealer_id = ? ORDER BY rowid DESC LIMIT 10').all(d);
  const recentConversations = db.prepare('SELECT * FROM conversations WHERE dealer_id = ? ORDER BY rowid DESC LIMIT 5').all(d);

  return {
    stock,
    crm: {
      customers: customerCount,
      truck_interests: truckInterestCount,
      open_follow_ups: openFollowUps,
      overdue_follow_ups: overdueFollowUps,
      open_handoffs: openHandoffs,
      sales_this_month: salesThisMonth,
    },
    recent_activity: recentActivity,
    recent_conversations: recentConversations,
  };
}

module.exports = { getSummary };
