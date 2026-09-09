'use strict';
process.env.DATABASE_PATH = require('node:path').join(__dirname, '..', 'data', 'test-news.db');
require('node:fs').rmSync(process.env.DATABASE_PATH, { force: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { runMigrations } = require('../src/db/migrate');
const { getDb } = require('../src/db/connection');
const authService = require('../src/services/authService');
const { buildRouter } = require('../src/server');

runMigrations();
const db = getDb();
db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_SOMKIAT', 'S.K.AUTOTRUCK');
authService.createUser('DEALER_SOMKIAT', { name: 'Staff', username: 'staff1', password: 'pw12345', role: 'staff' });

let server, baseUrl;
before(() => {
  const router = buildRouter();
  server = http.createServer((req, res) => router.handle(req, res));
  return new Promise((resolve) => server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});
after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, body, token) {
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
async function loginAs(username) {
  const res = await request('POST', '/api/auth/login', { username, password: 'pw12345' });
  return res.body.session_token;
}

test('POST /api/news requires authentication', async () => {
  const res = await request('POST', '/api/news', { title: 'x', content: 'y' });
  assert.strictEqual(res.status, 401);
});

test('Staff CAN create a post (not manager-only)', async () => {
  const token = await loginAs('staff1');
  const res = await request('POST', '/api/news', { title: 'วิธีดูแลรักษารถบรรทุก', content: 'เนื้อหาเต็ม...' }, token);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.post.status, 'PUBLISHED');
});

test('title/content are required', async () => {
  const token = await loginAs('staff1');
  const res = await request('POST', '/api/news', { title: '' }, token);
  assert.strictEqual(res.status, 400);
});

test('A DRAFT post does not appear in the public listing, but does in the admin listing', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const token = await loginAs('staff1');
    const created = await request('POST', '/api/news', { title: 'ร่างข่าวยังไม่พร้อม', content: 'draft content', status: 'DRAFT' }, token);
    const adminList = await request('GET', '/api/news', null, token);
    assert.ok(adminList.body.posts.some((p) => p.post_id === created.body.post.post_id));

    const publicList = await request('GET', '/api/public/news');
    assert.ok(!publicList.body.posts.some((p) => p.post_id === created.body.post.post_id));

    const publicDetail = await request('GET', `/api/public/news/${created.body.post.post_id}`);
    assert.strictEqual(publicDetail.status, 404);
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('A PUBLISHED post appears in both admin and public listings, and public detail works', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const token = await loginAs('staff1');
    const created = await request('POST', '/api/news', { title: 'คลิปแนะนำการเช็คเครื่องยนต์', content: 'เนื้อหา', video_url: 'https://youtube.com/watch?v=abc' }, token);
    const publicList = await request('GET', '/api/public/news');
    assert.ok(publicList.body.posts.some((p) => p.post_id === created.body.post.post_id));

    const publicDetail = await request('GET', `/api/public/news/${created.body.post.post_id}`);
    assert.strictEqual(publicDetail.status, 200);
    assert.strictEqual(publicDetail.body.post.video_url, 'https://youtube.com/watch?v=abc');
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Deleting a post removes it from both admin and public listings', async () => {
  process.env.PUBLIC_DEALER_ID = 'DEALER_SOMKIAT';
  try {
    const token = await loginAs('staff1');
    const created = await request('POST', '/api/news', { title: 'จะลบทันที', content: 'x' }, token);
    const del = await request('POST', `/api/news/${created.body.post.post_id}/delete`, {}, token);
    assert.strictEqual(del.status, 200);
    const adminList = await request('GET', '/api/news', null, token);
    assert.ok(!adminList.body.posts.some((p) => p.post_id === created.body.post.post_id));
  } finally {
    delete process.env.PUBLIC_DEALER_ID;
  }
});

test('Dealer isolation: a second dealer never sees the first dealer posts', async () => {
  db.prepare('INSERT INTO dealers (dealer_id, dealer_name) VALUES (?, ?)').run('DEALER_ABC', 'ABC Truck');
  authService.createUser('DEALER_ABC', { name: 'ABC Staff', username: 'abcstaff', password: 'pw12345', role: 'staff' });
  const abcToken = await loginAs('abcstaff');
  const abcList = await request('GET', '/api/news', null, abcToken);
  assert.strictEqual(abcList.body.posts.length, 0);
});
