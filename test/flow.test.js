'use strict';
// End-to-end API test: teacher submits → admin updates → teacher books pickup → hand-off.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'printdesk-'));
delete process.env.SMTP_HOST;
const app = require('../server');

let server, base, adminToken;
const j = async (url, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch(base + url, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const STL = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('first-run setup creates an admin with all scopes', async () => {
  assert.equal((await j('/api/admin/setup')).data.needsSetup, true);
  const r = await j('/api/admin/setup', { body: { name: 'Sam Admin', email: 'sam@school.org', password: 'correct horse battery' } });
  assert.equal(r.status, 201);
  assert.match(r.data.token, /^pd_ses_/);
  assert.equal((await j('/api/admin/setup', { body: { name: 'x', email: 'x@y.z', password: '0123456789' } })).status, 409);
});

test('password sign-in and wrong password', async () => {
  assert.equal((await j('/api/admin/login', { body: { email: 'sam@school.org', password: 'nope' } })).status, 401);
  const r = await j('/api/admin/login', { body: { email: 'SAM@school.org', password: 'correct horse battery' } });
  assert.equal(r.status, 200);
  adminToken = r.data.token;
  assert.equal((await j('/api/admin/orders')).status, 401);
});

test('submission requires an email', async () => {
  const fd = new FormData();
  fd.append('type', 'idea'); fd.append('teacherName', 'T'); fd.append('title', 'x'); fd.append('description', 'y');
  const r = await j('/api/requests', { body: fd });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /email/i);
});

test('rejects non-STL/3MF uploads', async () => {
  const fd = new FormData();
  fd.append('type', 'file'); fd.append('teacherName', 'T'); fd.append('email', 't@s.org'); fd.append('title', 'x');
  fd.append('file', new Blob(['hi']), 'virus.exe');
  assert.equal((await j('/api/requests', { body: fd })).status, 400);
});

test('STL flow: printing → finished → book PU3 → hand-off email from admin', async () => {
  const fd = new FormData();
  fd.append('type', 'file'); fd.append('teacherName', 'Ms. Rivera'); fd.append('email', 'rivera@school.org'); fd.append('title', 'Gear');
  fd.append('file', new Blob([STL]), 'gear.stl');
  const sub = await j('/api/requests', { body: fd });
  assert.equal(sub.status, 201);
  const trackToken = sub.data.trackUrl.split('/').pop();

  const orders = (await j('/api/admin/orders', { token: adminToken })).data;
  const id = orders[0].id;
  assert.equal((await j(`/api/admin/orders/${id}/file`, { token: adminToken })).status, 200 /* json parse fails but status ok */);

  // Can't book before printed
  assert.equal((await j(`/api/track/${trackToken}/pickup`, { body: { slotId: 'x', location: 'PU2' } })).status, 400);

  assert.equal((await j(`/api/admin/orders/${id}/status`, { token: adminToken, body: { status: 'printing' } })).data.status, 'printing');
  assert.equal((await j(`/api/admin/orders/${id}/status`, { token: adminToken, body: { status: 'printed' } })).data.status, 'printed');

  const start = new Date(Date.now() + 86400e3);
  const slots = await j('/api/admin/slots', { token: adminToken, body: { slots: [{ start: start.toISOString(), end: new Date(+start + 1800e3).toISOString() }], locations: ['PU3'], capacity: 1 } });
  assert.equal(slots.status, 201);
  const slotId = slots.data[0].id;

  assert.equal((await j(`/api/track/${trackToken}/pickup`, { body: { slotId, location: 'PU2' } })).status, 400, 'slot is PU3 only');
  const booked = await j(`/api/track/${trackToken}/pickup`, { body: { slotId, location: 'PU3' } });
  assert.equal(booked.data.status, 'scheduled');
  assert.equal(booked.data.pickup.location, 'PU3');

  const h = await j(`/api/admin/orders/${id}/handoff`, { token: adminToken, body: { location: 'PU3 front desk', receivedBy: 'Ms. Rivera' } });
  assert.equal(h.data.status, 'picked_up');
  assert.equal(h.data.handoff.adminName, 'Sam Admin');

  const emails = (await j('/api/admin/emails', { token: adminToken })).data.filter((e) => e.to === 'rivera@school.org');
  const subjects = emails.map((e) => e.subject).join('\n');
  for (const s of ['We got your request', 'Started printing', 'Finished printing', 'Pickup booked', 'Pickup confirmation']) assert.match(subjects, new RegExp(s));
  assert.match(emails.find((e) => /confirmation/.test(e.subject)).from, /Sam Admin/);
});

test('idea flow requires preview approval before printing', async () => {
  const fd = new FormData();
  fd.append('type', 'idea'); fd.append('teacherName', 'Mr. Lee'); fd.append('email', 'lee@school.org'); fd.append('title', 'Cell model'); fd.append('description', 'A plant cell');
  const sub = await j('/api/requests', { body: fd });
  const trackToken = sub.data.trackUrl.split('/').pop();
  const id = (await j('/api/admin/orders', { token: adminToken })).data.find((o) => o.title === 'Cell model').id;

  assert.equal((await j(`/api/admin/orders/${id}/status`, { token: adminToken, body: { status: 'printing' } })).status, 400);
  const img = new FormData();
  img.append('image', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'p.png');
  img.append('note', 'Here you go');
  const pv = await j(`/api/admin/orders/${id}/preview`, { token: adminToken, body: img });
  assert.equal(pv.data.status, 'awaiting_approval');

  const t = (await j(`/api/track/${trackToken}`)).data;
  assert.equal(t.previews.length, 1);
  assert.equal(t.trackToken, undefined);
  assert.equal((await j(`/api/track/${trackToken}/approve`, { method: 'POST' })).data.status, 'approved');
  assert.equal((await j(`/api/admin/orders/${id}/status`, { token: adminToken, body: { status: 'printing' } })).data.status, 'printing');
});

test('fine-grained tokens are limited to their scopes and revocable', async () => {
  const r = await j('/api/admin/tokens', { token: adminToken, body: { name: 'Kiosk', days: 30, scopes: ['orders:read'] } });
  assert.equal(r.status, 201);
  const pat = r.data.token;
  assert.match(pat, /^pd_pat_/);
  assert.equal((await j('/api/admin/orders', { token: pat })).status, 200);
  const id = (await j('/api/admin/orders', { token: pat })).data[0].id;
  assert.equal((await j(`/api/admin/orders/${id}/cancel`, { token: pat, body: {} })).status, 403);
  // Tokens can't mint tokens.
  assert.equal((await j('/api/admin/tokens', { token: pat, body: { name: 'x', days: 7, scopes: ['orders:read'] } })).status, 403);
  await j(`/api/admin/tokens/${r.data.record.id}`, { method: 'DELETE', token: adminToken });
  assert.equal((await j('/api/admin/orders', { token: pat })).status, 401);
});

test('team: limited admin cannot manage schedule', async () => {
  const add = await j('/api/admin/admins', { token: adminToken, body: { name: 'Pat Helper', email: 'pat@school.org', password: 'helper-password', scopes: ['orders:read', 'pickups:write'] } });
  assert.equal(add.status, 201);
  const login = await j('/api/admin/login', { body: { email: 'pat@school.org', password: 'helper-password' } });
  const t = login.data.token;
  assert.equal((await j('/api/admin/slots', { token: t, body: { slots: [], locations: ['PU2'] } })).status, 403);
  assert.equal((await j('/api/admin/orders', { token: t })).status, 200);
});
