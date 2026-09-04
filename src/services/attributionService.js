// ============================================================
// Attribution Summary Service — Step 33
// Groups EXISTING truck_interests.captured_campaign_id data, joined
// against EXISTING sales, to answer "Campaign -> Leads -> Sale".
// No Facebook Platform ID is ever modified — this only reads what
// was captured (immutably) back in Step 17/17.1's Truck Interest flow.
// ============================================================
'use strict';
const { getDb } = require('../db/connection');

function getSummary(context) {
  const db = getDb();
  const d = context.dealer_id;

  const rows = db.prepare(`
    SELECT
      ti.captured_campaign_id as campaign_id,
      ti.captured_adset_id as adset_id,
      ti.captured_ad_id as ad_id,
      COUNT(DISTINCT ti.truck_interest_id) as leads,
      COUNT(DISTINCT s.sale_id) as sales
    FROM truck_interests ti
    LEFT JOIN sales s ON s.dealer_id = ti.dealer_id AND s.sold_interest_id = ti.truck_interest_id AND s.status = 'Approved'
    WHERE ti.dealer_id = ?
    GROUP BY ti.captured_campaign_id, ti.captured_adset_id, ti.captured_ad_id
    ORDER BY leads DESC
  `).all(d);

  return rows.map((r) => ({
    campaign_id: r.campaign_id || null,
    adset_id: r.adset_id || null,
    ad_id: r.ad_id || null,
    source_label: r.campaign_id ? null : 'ไม่ทราบแหล่งที่มา (Walk-in หรือไม่มี Attribution)',
    leads: r.leads,
    sales: r.sales,
  }));
}

module.exports = { getSummary };
