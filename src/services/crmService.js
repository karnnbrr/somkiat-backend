// ============================================================
// CRM Service — Step 15/15.1/17/17.1/17.2/27.1
// Customer matching key is (dealer_id, phone) — never phone alone.
// ============================================================
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../db/connection');
const { requirePermission } = require('../middleware/permission');
const { AppError } = require('../errors');
const audit = require('./auditService');

function findCustomerByPhone(context, phone) {
  const db = getDb();
  return db.prepare('SELECT * FROM customers WHERE dealer_id = ? AND phone = ?').get(context.dealer_id, phone) || null;
}

function createCustomer(context, { name, phone, contact_channel, source, assigned_staff, notes }) {
  requirePermission(context, 'customer.create');
  if (phone) {
    const existing = findCustomerByPhone(context, phone);
    if (existing) return existing; // never silently duplicate within the same dealer
  }
  const db = getDb();
  const customer_id = 'CUST-' + crypto.randomUUID();
  db.prepare(
    `INSERT INTO customers (customer_id, dealer_id, name, phone, contact_channel, source, assigned_staff, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(customer_id, context.dealer_id, name || null, phone || null, contact_channel || null, source || null, assigned_staff || null, notes || null);
  audit.record(context, { action_type: 'CUSTOMER_CREATED', entity: 'customer', entity_id: customer_id });
  return db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customer_id);
}

function createInteraction(context, { conversation_id, customer_id, campaign_id, adset_id, ad_id, source }) {
  requirePermission(context, 'interaction.create');
  const db = getDb();
  const interaction_id = 'INT-' + crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO interactions (interaction_id, dealer_id, conversation_id, customer_id, campaign_id, adset_id, ad_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(interaction_id, context.dealer_id, conversation_id || null, customer_id || null, campaign_id || null, adset_id || null, ad_id || null, source || null);
    audit.record(context, { action_type: 'INTERACTION_CREATED', entity: 'interaction', entity_id: interaction_id });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'create interaction failed', { message: e.message });
  }
  return db.prepare('SELECT * FROM interactions WHERE interaction_id = ?').get(interaction_id);
}

function createTruckInterest(context, { truck_id, customer_id, lead_id, campaign_id, adset_id, ad_id, interest_level }) {
  requirePermission(context, 'truck_interest.create');
  const db = getDb();
  const truck = db.prepare('SELECT 1 FROM trucks WHERE dealer_id = ? AND truck_id = ?').get(context.dealer_id, truck_id);
  if (!truck) throw new AppError('VALIDATION_ERROR', 'truck_id does not exist for this dealer');
  const truck_interest_id = 'TI-' + crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO truck_interests (truck_interest_id, dealer_id, truck_id, customer_id, lead_id, captured_campaign_id, captured_adset_id, captured_ad_id, interest_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(truck_interest_id, context.dealer_id, truck_id, customer_id, lead_id || null, campaign_id || null, adset_id || null, ad_id || null, interest_level || null);
    audit.record(context, { action_type: 'TRUCK_INTEREST_CREATED', entity: 'truck_interest', entity_id: truck_interest_id, new_value: truck_id });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'create truck interest failed', { message: e.message });
  }
  return db.prepare('SELECT * FROM truck_interests WHERE truck_interest_id = ?').get(truck_interest_id);
}

function createFollowUp(context, { customer_id, truck_id, due_date, reason, next_action, assigned_staff }) {
  requirePermission(context, 'follow_up.create');
  const db = getDb();
  const follow_up_id = 'FU-' + crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO follow_ups (follow_up_id, dealer_id, customer_id, truck_id, due_date, reason, next_action, assigned_staff, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Upcoming')`
    ).run(follow_up_id, context.dealer_id, customer_id, truck_id || null, due_date || null, reason || null, next_action || null, assigned_staff || null);
    audit.record(context, { action_type: 'FOLLOWUP_CREATED', entity: 'follow_up', entity_id: follow_up_id });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new AppError('DATABASE_ERROR', 'create follow_up failed', { message: e.message });
  }
  return db.prepare('SELECT * FROM follow_ups WHERE follow_up_id = ?').get(follow_up_id);
}

function completeFollowUp(context, follow_up_id, result) {
  requirePermission(context, 'follow_up.complete');
  const db = getDb();
  const fu = db.prepare('SELECT * FROM follow_ups WHERE dealer_id = ? AND follow_up_id = ?').get(context.dealer_id, follow_up_id);
  if (!fu) throw new AppError('NOT_FOUND', 'follow_up not found for this dealer');
  db.prepare("UPDATE follow_ups SET status = 'Completed', result = ? WHERE dealer_id = ? AND follow_up_id = ?")
    .run(result || null, context.dealer_id, follow_up_id);
  audit.record(context, { action_type: 'FOLLOWUP_COMPLETED', entity: 'follow_up', entity_id: follow_up_id });
  return db.prepare('SELECT * FROM follow_ups WHERE follow_up_id = ?').get(follow_up_id);
}

function listTruckInterestsForCustomer(context, customer_id) {
  const db = getDb();
  return db.prepare('SELECT * FROM truck_interests WHERE dealer_id = ? AND customer_id = ?').all(context.dealer_id, customer_id);
}

function listCustomers(context, { search } = {}) {
  const db = getDb();
  if (search) {
    const like = `%${search}%`;
    return db.prepare('SELECT * FROM customers WHERE dealer_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY rowid DESC').all(context.dealer_id, like, like);
  }
  return db.prepare('SELECT * FROM customers WHERE dealer_id = ? ORDER BY rowid DESC').all(context.dealer_id);
}

function getCustomer(context, customer_id) {
  const db = getDb();
  return db.prepare('SELECT * FROM customers WHERE dealer_id = ? AND customer_id = ?').get(context.dealer_id, customer_id) || null;
}

function listFollowUpsForCustomer(context, customer_id) {
  const db = getDb();
  return db.prepare('SELECT * FROM follow_ups WHERE dealer_id = ? AND customer_id = ? ORDER BY rowid DESC').all(context.dealer_id, customer_id);
}

function listHandoffsForCustomer(context, customer_id) {
  const db = getDb();
  return db.prepare('SELECT * FROM handoffs WHERE dealer_id = ? AND customer_id = ? ORDER BY rowid DESC').all(context.dealer_id, customer_id);
}

module.exports = {
  findCustomerByPhone, createCustomer, createInteraction, createTruckInterest,
  createFollowUp, completeFollowUp, listTruckInterestsForCustomer,
  listCustomers, getCustomer, listFollowUpsForCustomer, listHandoffsForCustomer,
};
