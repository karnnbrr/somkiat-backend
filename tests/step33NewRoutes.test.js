'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-step33routes.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const stockService = require('../src/services/stockService');
const crmService = require('../src/services/crmService');
const conversationService = require('../src/services/conversationService');
const saleService = require('../src/services/saleService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'Somkiat Autocar');
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });

const managerCtx = Object.freeze({ dealer_id: 'DEALER_SOMKIAT', role: 'manager' });
stockService.addTruck(managerCtx, { truck_id: 'TRK-001', brand: 'ISUZU', model: 'NLR', price: 629000, down_payment: 29000, installment_amount: 15300, installment_count: 60 });
const customer = crmService.createCustomer(managerCtx, { name: 'คุณทดสอบ', phone: '0811119999' });
crmService.createTruckInterest(managerCtx, { truck_id: 'TRK-001', customer_id: customer.customer_id, campaign_id: 'CAMP_1' });
const conv = conversationService.startOrGetConversation(managerCtx, { page_id: 'PAGE_X', sender_psid: 'PSID-1' });
conversationService.recordMessage(managerCtx, { conversation_id: conv.conversation_id, direction: 'INBOUND', sender_type: 'CUSTOMER', text: 'สวัสดีครับ' });

let server, baseUrl, token;
before(async () => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  await new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
  const login = await request('POST', '/api/auth/login', { username: 'staff1', password: 'pw12345' });
  token = login.body.session_token;
});
after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, body) {
  return new Promise((resolvePromise, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolvePromise({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('GET /api/dashboard returns real aggregate counts, not fake data', async () => {
  const res = await request('GET', '/api/dashboard');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.stock['พร้อมขาย'], 1);
  assert.strictEqual(res.body.crm.customers, 1);
  assert.strictEqual(res.body.crm.truck_interests, 1);
});

test('GET /api/dashboard is dealer-scoped — a second dealer with no data sees all zeros, not the first dealer\'s numbers', async () => {
  db.prepare('INSERT INTO users (user_id, dealer_id, name, username, password_hash, password_salt, role) SELECT ?, ?, ?, ?, password_hash, password_salt, ? FROM users WHERE username = ?')
    .run('USER-ABC-1', 'DEALER_ABC', 'ABC Staff', 'abcstaff', 'staff', 'staff1');
  const login = await request('POST', '/api/auth/login', { username: 'abcstaff', password: 'pw12345' });
  const savedToken = token;
  token = login.body.session_token;
  try {
    const res = await request('GET', '/api/dashboard');
    assert.strictEqual(res.body.stock['พร้อมขาย'], 0);
    assert.strictEqual(res.body.crm.customers, 0);
  } finally {
    token = savedToken;
  }
});

test('GET /api/customers lists real customers, and ?search filters them', async () => {
  const listRes = await request('GET', '/api/customers');
  assert.strictEqual(listRes.status, 200);
  assert.ok(listRes.body.customers.some((c) => c.customer_id === customer.customer_id));

  const searchRes = await request('GET', '/api/customers?search=ทดสอบ');
  assert.ok(searchRes.body.customers.length >= 1);
  const noMatchRes = await request('GET', '/api/customers?search=ไม่มีทางเจอ');
  assert.strictEqual(noMatchRes.body.customers.length, 0);
});

test('GET /api/customers/:id returns single customer detail', async () => {
  const res = await request('GET', `/api/customers/${customer.customer_id}`);
  assert.strictEqual(res.body.customer.customer_id, customer.customer_id);
});

test('GET /api/customers/:id/follow-ups and /handoffs return empty arrays, not errors, when there is no data yet', async () => {
  const fu = await request('GET', `/api/customers/${customer.customer_id}/follow-ups`);
  const ho = await request('GET', `/api/customers/${customer.customer_id}/handoffs`);
  assert.deepStrictEqual(fu.body.follow_ups, []);
  assert.deepStrictEqual(ho.body.handoffs, []);
});

test('GET /api/conversations lists conversations with a last-message preview and linked customer', async () => {
  const res = await request('GET', '/api/conversations');
  assert.strictEqual(res.status, 200);
  const found = res.body.conversations.find((c) => c.conversation_id === conv.conversation_id);
  assert.ok(found);
  assert.strictEqual(found.last_message_preview, 'สวัสดีครับ');
});

test('GET /api/conversations/:id/messages returns the real message history', async () => {
  const res = await request('GET', `/api/conversations/${conv.conversation_id}/messages`);
  assert.strictEqual(res.body.messages.length, 1);
  assert.strictEqual(res.body.messages[0].text, 'สวัสดีครับ');
});

test('GET /api/sales lists real sales (empty until one is approved)', async () => {
  const before = await request('GET', '/api/sales');
  assert.deepStrictEqual(before.body.sales, []);
});

test('GET /api/attribution/summary groups by the REAL captured campaign_id, walk-ins labeled honestly', async () => {
  const res = await request('GET', '/api/attribution/summary');
  assert.strictEqual(res.status, 200);
  const camp1 = res.body.summary.find((s) => s.campaign_id === 'CAMP_1');
  assert.ok(camp1);
  assert.strictEqual(camp1.leads, 1);
  assert.strictEqual(camp1.sales, 0);
});

test('All new routes require authentication', async () => {
  const savedToken = token;
  token = null;
  try {
    for (const path of ['/api/dashboard', '/api/customers', '/api/conversations', '/api/sales', '/api/attribution/summary']) {
      const res = await request('GET', path);
      assert.strictEqual(res.status, 401, path + ' must require auth');
    }
  } finally {
    token = savedToken;
  }
});
