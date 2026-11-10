'use strict';
try { process.loadEnvFile?.(); } catch { /* no .env file — that's fine */ }

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('./lib/db');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const mail = require('./lib/mail');

const PORT = Number(process.env.PORT || 3000);
const LOCATIONS = (process.env.PICKUP_LOCATIONS || 'PU2,PU3').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MODEL_MB = Number(process.env.MAX_MODEL_MB || 100);
const MODEL_EXT = ['.stl', '.3mf'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'];

// ---------- helpers ----------
const now = () => new Date().toISOString();
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const findOrder = (id) => db.data.orders.find((o) => o.id === id);
const findByToken = (t) => db.data.orders.find((o) => o.trackToken === t);
const ACTIVE_BOOKING = ['scheduled'];

function storage(allowed) {
  return multer.diskStorage({
    destination: db.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  });
}
function uploader(allowed, maxMb) {
  return multer({
    storage: storage(allowed),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) return cb(null, true);
      const err = new Error(`Please choose a ${allowed.join(' or ')} file.`);
      err.status = 400;
      cb(err);
    },
  });
}
const modelUpload = uploader(MODEL_EXT, MAX_MODEL_MB);
const imageUpload = uploader(IMAGE_EXT, 20);

function log(order, status, by, note) {
  order.history.push({ at: now(), status, by: by || null, note: note || null });
}

function slotUsage(slot) {
  return db.data.orders.filter((o) => o.pickup && o.pickup.slotId === slot.id && ACTIVE_BOOKING.includes(o.status)).length;
}

function publicSlot(slot) {
  const booked = slotUsage(slot);
  return { ...slot, booked, remaining: Math.max(0, slot.capacity - booked) };
}

/** What the teacher sees on their tracking page. */
function teacherView(o) {
  return {
    number: o.number,
    type: o.type,
    title: o.title,
    teacherName: o.teacherName,
    email: o.email,
    notes: o.notes,
    description: o.description,
    color: o.color,
    file: o.file ? { original: o.file.original, size: o.file.size } : null,
    status: o.status,
    previews: o.previews.map((p) => ({ id: p.id, note: p.note, at: p.at })),
    feedback: o.feedback,
    pickup: o.pickup,
    handoff: o.handoff ? { ...o.handoff, adminId: undefined } : null,
    history: o.history.map((h) => ({ at: h.at, status: h.status, note: h.note })),
    createdAt: o.createdAt,
  };
}

function adminView(o) {
  return { ...teacherView(o), id: o.id, trackToken: o.trackToken, history: o.history, cancelReason: o.cancelReason, handler: o.handler || null };
}

function sendUpload(res, stored, downloadName) {
  const file = path.join(db.UPLOAD_DIR, path.basename(stored));
  if (!fs.existsSync(file)) return bad(res, 'File not found.', 404);
  res.set('Cache-Control', 'private, max-age=300');
  if (downloadName) return res.download(file, downloadName);
  res.sendFile(file);
}

const fire = (p) => Promise.resolve(p).catch((e) => { console.error('notify failed', e); return null; });
/** Create the teacher email. In draft mode, resolve to the draft so the admin can send it right away. */
const emit = (p) => (mail.MODE === 'draft' ? fire(p) : (fire(p), Promise.resolve(null)));
/** The first admin to act on a request becomes its handler; teacher-triggered emails are drafted for them. */
function claim(o, a, force = false) {
  if (!o.handler || force) o.handler = { id: a.id, name: a.name };
}
/** Wrap async route handlers so errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  next();
});

app.get('/api/config', (req, res) => {
  res.json({
    siteName: mail.SITE_NAME,
    locations: LOCATIONS,
    maxModelMb: MAX_MODEL_MB,
    modelTypes: MODEL_EXT,
  });
});

// ----- teacher: new request -----
app.post('/api/requests', modelUpload.single('file'), (req, res) => {
  const b = req.body || {};
  const type = b.type === 'idea' ? 'idea' : 'file';
  const cleanupAndFail = (msg) => {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return bad(res, msg);
  };
  const teacherName = str(b.teacherName, 80);
  const email = str(b.email, 120).toLowerCase();
  const title = str(b.title, 100);
  if (!teacherName) return cleanupAndFail('Please add your name.');
  if (!isEmail(email)) return cleanupAndFail('Please enter a valid email so we can send you updates.');
  if (!title) return cleanupAndFail('Please give your request a short title.');
  if (type === 'file' && !req.file) return cleanupAndFail('Please attach an STL or 3MF file.');
  if (type === 'idea' && !str(b.description, 4000)) return cleanupAndFail('Please describe what you’d like printed.');

  const order = {
    id: auth.id(),
    number: db.nextOrderNumber(),
    trackToken: crypto.randomBytes(18).toString('base64url'),
    type,
    teacherName,
    email,
    title,
    notes: str(b.notes, 2000),
    color: str(b.color, 60),
    description: type === 'idea' ? str(b.description, 4000) : '',
    file: type === 'file' ? { stored: req.file.filename, original: str(req.file.originalname, 200), size: req.file.size } : null,
    status: 'received',
    previews: [],
    feedback: null,
    pickup: null,
    handoff: null,
    history: [],
    createdAt: now(),
  };
  if (type === 'idea' && req.file) fs.rm(req.file.path, { force: true }, () => {});
  log(order, 'received', null, null);
  db.tx((s) => s.orders.unshift(order));
  fire(notify.received(order));
  res.status(201).json({ number: order.number, trackUrl: `/track/${order.trackToken}` });
});

// ----- teacher: tracking -----
const track = express.Router();
track.param('token', (req, res, next, token) => {
  const o = findByToken(token);
  if (!o) return bad(res, 'We couldn’t find that request.', 404);
  req.order = o;
  next();
});
track.get('/:token', (req, res) => res.json(teacherView(req.order)));
track.get('/:token/file', (req, res) => {
  if (!req.order.file) return bad(res, 'No file.', 404);
  sendUpload(res, req.order.file.stored, req.query.download ? req.order.file.original : null);
});
track.get('/:token/preview/:pid', (req, res) => {
  const p = req.order.previews.find((x) => x.id === req.params.pid);
  if (!p) return bad(res, 'Not found.', 404);
  sendUpload(res, p.stored);
});
track.post('/:token/approve', (req, res) => {
  const o = req.order;
  if (o.status !== 'awaiting_approval') return bad(res, 'There’s nothing to approve right now.');
  db.tx(() => { o.status = 'approved'; o.feedback = null; log(o, 'approved', o.teacherName); });
  res.json(teacherView(o));
});
track.post('/:token/changes', (req, res) => {
  const o = req.order;
  const feedback = str(req.body?.feedback, 2000);
  if (o.status !== 'awaiting_approval') return bad(res, 'There’s no preview waiting for feedback.');
  if (!feedback) return bad(res, 'Tell us what you’d like changed.');
  db.tx(() => { o.status = 'changes_requested'; o.feedback = feedback; log(o, 'changes_requested', o.teacherName, feedback); });
  res.json(teacherView(o));
});
track.get('/:token/slots', (req, res) => {
  const t = Date.now();
  const slots = db.data.slots
    .filter((s) => Date.parse(s.start) > t)
    .map(publicSlot)
    .filter((s) => s.remaining > 0 || (req.order.pickup && req.order.pickup.slotId === s.id))
    .sort((a, b) => a.start.localeCompare(b.start));
  res.json({ locations: LOCATIONS, slots });
});
track.post('/:token/pickup', (req, res) => {
  const o = req.order;
  if (!['printed', 'scheduled'].includes(o.status)) return bad(res, 'You can book a pickup once printing is finished.');
  const location = str(req.body?.location, 20);
  if (!LOCATIONS.includes(location)) return bad(res, `Please choose ${LOCATIONS.join(' or ')}.`);
  const slot = db.data.slots.find((s) => s.id === req.body?.slotId);
  if (!slot) return bad(res, 'Please choose a pickup time.');
  if (!slot.locations.includes(location)) return bad(res, `That time isn’t available at ${location}.`);
  if (Date.parse(slot.start) <= Date.now()) return bad(res, 'That time has already passed.');
  const mine = o.pickup && o.pickup.slotId === slot.id && o.status === 'scheduled';
  if (!mine && slotUsage(slot) >= slot.capacity) return bad(res, 'Sorry — that time just filled up. Please pick another.');
  db.tx(() => {
    o.pickup = { slotId: slot.id, location, start: slot.start, end: slot.end, bookedAt: now() };
    o.status = 'scheduled';
    log(o, 'scheduled', o.teacherName, `${location} · ${slot.start}`);
  });
  fire(notify.scheduled(o));
  res.json(teacherView(o));
});
app.use('/api/track', track);

// ----- admin: sign-in -----
const admin = express.Router();

admin.get('/setup', (req, res) => res.json({ needsSetup: db.data.admins.length === 0 }));
admin.post('/setup', (req, res) => {
  if (db.data.admins.length) return bad(res, 'Setup is already complete.', 409);
  const { name, email, password } = req.body || {};
  if (process.env.SETUP_CODE && req.body?.setupCode !== process.env.SETUP_CODE) return bad(res, 'That setup code isn’t right.', 403);
  if (!str(name) || !isEmail(str(email).toLowerCase())) return bad(res, 'Please add your name and email.');
  if (String(password || '').length < 10) return bad(res, 'Use a password with at least 10 characters.');
  const a = auth.createAdmin({ name, email, password, scopes: auth.ALL_SCOPES });
  const { token } = auth.issueSession(a);
  res.status(201).json({ token, admin: auth.publicAdmin(a) });
});

admin.post('/login', (req, res) => {
  const email = str(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  const wait = auth.throttle(`${req.ip}|${email}`);
  if (wait) return bad(res, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`, 429);
  const a = db.data.admins.find((x) => x.email === email);
  // Always run a hash so response time doesn't reveal whether the email exists.
  const ok = a ? auth.verifyPassword(password, a.password) : (auth.verifyPassword(password, auth.hashPassword('x')), false);
  if (!ok) return bad(res, 'Incorrect email or password.', 401);
  auth.clearThrottle(`${req.ip}|${email}`);
  const { token } = auth.issueSession(a);
  res.json({ token, admin: auth.publicAdmin(a) });
});

admin.use(auth.requireAuth());

admin.get('/me', (req, res) => {
  res.json({
    admin: auth.publicAdmin(req.auth.admin),
    token: { kind: req.auth.token.kind, name: req.auth.token.name, scopes: req.auth.scopes, expiresAt: req.auth.token.expiresAt },
    allScopes: auth.SCOPES,
    locations: LOCATIONS,
    emailMode: mail.MODE,
  });
});

admin.post('/logout', (req, res) => {
  if (req.auth.token.kind === 'session') {
    db.tx((s) => { s.tokens = s.tokens.filter((t) => t.id !== req.auth.token.id); });
  }
  res.json({ ok: true });
});

admin.post('/password', auth.requireAuth(null, { sessionOnly: true }), (req, res) => {
  const { current, next } = req.body || {};
  const a = req.auth.admin;
  if (!auth.verifyPassword(String(current || ''), a.password)) return bad(res, 'Your current password isn’t right.', 403);
  if (String(next || '').length < 10) return bad(res, 'Use at least 10 characters.');
  db.tx((s) => {
    a.password = auth.hashPassword(String(next));
    // Sign out every other session; keep this one.
    s.tokens = s.tokens.filter((t) => t.adminId !== a.id || t.kind !== 'session' || t.id === req.auth.token.id);
  });
  res.json({ ok: true });
});

// ----- admin: orders -----
admin.get('/orders', auth.requireAuth('orders:read'), (req, res) => {
  res.json(db.data.orders.map((o) => {
    const v = adminView(o);
    delete v.history;
    return v;
  }));
});
admin.get('/orders/:id', auth.requireAuth('orders:read'), (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  res.json({ ...adminView(o), emails: db.data.emails.filter((e) => e.orderId === o.id) });
});
admin.get('/orders/:id/file', auth.requireAuth('orders:read'), (req, res) => {
  const o = findOrder(req.params.id);
  if (!o?.file) return bad(res, 'Not found.', 404);
  sendUpload(res, o.file.stored, req.query.download ? o.file.original : null);
});
admin.get('/orders/:id/preview/:pid', auth.requireAuth('orders:read'), (req, res) => {
  const p = findOrder(req.params.id)?.previews.find((x) => x.id === req.params.pid);
  if (!p) return bad(res, 'Not found.', 404);
  sendUpload(res, p.stored);
});

admin.post('/orders/:id/preview', auth.requireAuth('orders:write'), imageUpload.single('image'), wrap(async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  if (!req.file) return bad(res, 'Please choose an image.');
  if (['printing', 'printed', 'scheduled', 'picked_up', 'cancelled'].includes(o.status)) {
    fs.rm(req.file.path, { force: true }, () => {});
    return bad(res, 'Previews can only be sent before printing starts.');
  }
  const note = str(req.body?.note, 1000);
  db.tx(() => {
    o.previews.push({ id: auth.id(4), stored: req.file.filename, original: str(req.file.originalname, 200), note, at: now(), by: req.auth.admin.name });
    o.status = 'awaiting_approval';
    o.feedback = null;
    log(o, 'awaiting_approval', req.auth.admin.name, note);
    claim(o, req.auth.admin);
  });
  const draft = await emit(notify.preview(o, note, req.auth.admin));
  res.json({ ...adminView(o), draft });
}));

admin.post('/orders/:id/status', auth.requireAuth('orders:write'), wrap(async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  const next = req.body?.status;
  if (next === 'printing') {
    if (o.type === 'idea' && o.status !== 'approved') return bad(res, 'The teacher needs to approve a preview before this can print.');
    // For STL/3MF uploads a preview is optional, so printing can start any time before pickup.
    if (!['received', 'approved', 'awaiting_approval', 'changes_requested'].includes(o.status)) return bad(res, 'This request can’t start printing from here.');
  } else if (next === 'printed') {
    if (o.status !== 'printing') return bad(res, 'Mark it as printing first.');
  } else {
    return bad(res, 'Unknown update.');
  }
  const a = req.auth.admin;
  db.tx(() => { o.status = next; log(o, next, a.name); claim(o, a); });
  const draft = await emit(next === 'printing' ? notify.printing(o, a) : notify.printed(o, a));
  res.json({ ...adminView(o), draft });
}));

admin.post('/orders/:id/handoff', auth.requireAuth('pickups:write'), wrap(async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  if (!['printed', 'scheduled'].includes(o.status)) return bad(res, 'Only finished prints can be handed off.');
  const location = str(req.body?.location, 120);
  const receivedBy = str(req.body?.receivedBy, 120);
  if (!location) return bad(res, 'Where was it picked up?');
  if (!receivedBy) return bad(res, 'Who received it?');
  const a = req.auth.admin;
  db.tx(() => {
    o.handoff = { location, receivedBy, adminId: a.id, adminName: a.name, at: now() };
    o.status = 'picked_up';
    log(o, 'picked_up', a.name, `${receivedBy} @ ${location}`);
  });
  const draft = await emit(notify.handedOff(o, a));
  res.json({ ...adminView(o), draft });
}));

admin.post('/orders/:id/cancel', auth.requireAuth('orders:write'), wrap(async (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  if (['picked_up', 'cancelled'].includes(o.status)) return bad(res, 'This request is already closed.');
  const reason = str(req.body?.reason, 1000);
  db.tx(() => { o.status = 'cancelled'; o.cancelReason = reason; log(o, 'cancelled', req.auth.admin.name, reason); });
  const draft = req.body?.notify === false ? null : await emit(notify.cancelled(o, reason, req.auth.admin));
  res.json({ ...adminView(o), draft });
}));

admin.post('/orders/:id/claim', auth.requireAuth('orders:write'), (req, res) => {
  const o = findOrder(req.params.id);
  if (!o) return bad(res, 'Not found.', 404);
  const a = req.auth.admin;
  db.tx((s) => {
    claim(o, a, true);
    // Unsent drafts for this request move to the new handler.
    for (const e of s.emails) {
      if (e.orderId === o.id && e.status === 'draft') { e.senderId = a.id; e.from = a.name; e.text = e.text.replace(/\n\nThanks,\n[^\n]*$/, `\n\nThanks,\n${a.name}`); }
    }
  });
  res.json(adminView(o));
});

// ----- admin: teacher emails (drafts + log) -----
const emailView = (e, me) => ({ ...e, mine: !e.senderId || e.senderId === me.id });
admin.get('/emails', auth.requireAuth('orders:read'), (req, res) => {
  const status = req.query.status;
  const list = db.data.emails.filter((e) => !status || e.status === status);
  res.json(list.slice(0, 300).map((e) => emailView(e, req.auth.admin)));
});
admin.get('/emails/count', (req, res) => {
  const drafts = db.data.emails.filter((e) => e.status === 'draft');
  res.json({ draft: drafts.length, mine: drafts.filter((e) => emailView(e, req.auth.admin).mine).length });
});
admin.patch('/emails/:id', auth.requireAuth('orders:write'), (req, res) => {
  const e = db.data.emails.find((x) => x.id === req.params.id);
  if (!e) return bad(res, 'Not found.', 404);
  const status = req.body?.status;
  if (!['sent', 'skipped', 'draft'].includes(status)) return bad(res, 'Unknown status.');
  db.tx(() => {
    e.status = status;
    e.sentBy = status === 'draft' ? null : req.auth.admin.name;
    e.sentAt = status === 'draft' ? null : now();
  });
  res.json(emailView(e, req.auth.admin));
});

// ----- admin: pickup schedule -----
admin.get('/slots', (req, res) => {
  const cutoff = Date.now() - 7 * 86400e3;
  res.json(db.data.slots.filter((s) => Date.parse(s.end) > cutoff).map(publicSlot).sort((a, b) => a.start.localeCompare(b.start)));
});
admin.post('/slots', auth.requireAuth('schedule:write'), (req, res) => {
  // Body: { slots: [{ start, end }], locations: [...], capacity }
  const b = req.body || {};
  const locations = (b.locations || []).filter((l) => LOCATIONS.includes(l));
  const capacity = Math.max(1, Math.min(500, parseInt(b.capacity, 10) || 1));
  if (!locations.length) return bad(res, `Choose at least one location (${LOCATIONS.join(', ')}).`);
  const list = Array.isArray(b.slots) ? b.slots.slice(0, 200) : [];
  const created = [];
  for (const s of list) {
    const start = Date.parse(s.start), end = Date.parse(s.end);
    if (!start || !end || end <= start) return bad(res, 'Each time needs a start before its end.');
    created.push({ id: auth.id(6), start: new Date(start).toISOString(), end: new Date(end).toISOString(), locations, capacity, createdBy: req.auth.admin.name });
  }
  if (!created.length) return bad(res, 'Add at least one time.');
  db.tx((st) => st.slots.push(...created));
  res.status(201).json(created.map(publicSlot));
});
admin.delete('/slots/:id', auth.requireAuth('schedule:write'), (req, res) => {
  const slot = db.data.slots.find((s) => s.id === req.params.id);
  if (!slot) return bad(res, 'Not found.', 404);
  if (slotUsage(slot) > 0) return bad(res, 'Someone has booked this time. Ask them to move first.', 409);
  db.tx((s) => { s.slots = s.slots.filter((x) => x.id !== slot.id); });
  res.json({ ok: true });
});

// ----- admin: team -----
admin.get('/admins', (req, res) => res.json(db.data.admins.map(auth.publicAdmin)));
admin.post('/admins', auth.requireAuth('team:write'), (req, res) => {
  const { name, email, password, scopes } = req.body || {};
  const e = str(email, 120).toLowerCase();
  if (!str(name)) return bad(res, 'Add a name.');
  if (!isEmail(e)) return bad(res, 'Add a valid email.');
  if (db.data.admins.some((a) => a.email === e)) return bad(res, 'That email is already an admin.', 409);
  if (String(password || '').length < 10) return bad(res, 'Use a password with at least 10 characters.');
  const a = auth.createAdmin({ name, email: e, password, scopes });
  res.status(201).json(auth.publicAdmin(a));
});
admin.patch('/admins/:id', auth.requireAuth('team:write'), (req, res) => {
  const a = db.data.admins.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Not found.', 404);
  const scopes = auth.cleanScopes(req.body?.scopes);
  const managers = db.data.admins.filter((x) => x.scopes.includes('team:write'));
  if (!scopes.includes('team:write') && managers.length === 1 && managers[0].id === a.id) {
    return bad(res, 'At least one admin needs to be able to manage the team.');
  }
  db.tx(() => { a.scopes = scopes; });
  res.json(auth.publicAdmin(a));
});
admin.delete('/admins/:id', auth.requireAuth('team:write'), (req, res) => {
  const a = db.data.admins.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Not found.', 404);
  if (a.id === req.auth.admin.id) return bad(res, 'You can’t remove yourself.');
  db.tx((s) => {
    s.admins = s.admins.filter((x) => x.id !== a.id);
    s.tokens = s.tokens.filter((t) => t.adminId !== a.id);
  });
  res.json({ ok: true });
});

// ----- admin: fine-grained access tokens -----
admin.get('/tokens', (req, res) => {
  const t = Date.now();
  res.json(db.data.tokens
    .filter((x) => x.adminId === req.auth.admin.id && (!x.expiresAt || Date.parse(x.expiresAt) > t))
    .map((x) => ({ ...auth.publicToken(x), current: x.id === req.auth.token.id }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
admin.post('/tokens', auth.requireAuth(null, { sessionOnly: true }), (req, res) => {
  const name = str(req.body?.name, 60);
  const days = parseInt(req.body?.days, 10);
  if (!name) return bad(res, 'Give the token a name so you remember what it’s for.');
  if (![7, 30, 60, 90, 365].includes(days)) return bad(res, 'Choose an expiration.');
  const scopes = auth.cleanScopes(req.body?.scopes, req.auth.admin.scopes);
  if (!scopes.length) return bad(res, 'Choose at least one permission.');
  const { token, record } = auth.issueToken({
    admin: req.auth.admin, kind: 'pat', name, scopes,
    expiresAt: new Date(Date.now() + days * 86400e3).toISOString(),
  });
  res.status(201).json({ token, record: auth.publicToken(record) });
});
admin.delete('/tokens/:id', (req, res) => {
  const t = db.data.tokens.find((x) => x.id === req.params.id && x.adminId === req.auth.admin.id);
  if (!t) return bad(res, 'Not found.', 404);
  db.tx((s) => { s.tokens = s.tokens.filter((x) => x.id !== t.id); });
  res.json({ ok: true });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, 'Not found.', 404));

// ---------- pages ----------
const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { extensions: ['html'], maxAge: '1h' }));
// three.js for the in-browser 3D model preview (only the folders the viewer needs).
const threeDir = path.join(path.dirname(require.resolve('three')), '..');
for (const sub of ['build', 'examples/jsm']) {
  app.use(`/vendor/three/${sub}`, express.static(path.join(threeDir, sub), { maxAge: '7d', immutable: true }));
}
app.get('/track/:token', (req, res) => res.sendFile(path.join(pub, 'track.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.use((req, res) => res.status(404).sendFile(path.join(pub, 'index.html')));

// Errors (including multer's file-size / type errors).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (req.file) fs.rm(req.file.path, { force: true }, () => {});
  if (err.code === 'LIMIT_FILE_SIZE') return bad(res, `That file is too big (max ${MAX_MODEL_MB} MB).`, 413);
  if (err.status && err.status < 500) return bad(res, err.message, err.status);
  console.error(err);
  bad(res, 'Something went wrong. Please try again.', 500);
});

// ---------- start ----------
function bootstrapAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (db.data.admins.length || !ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  auth.createAdmin({ name: ADMIN_NAME || 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, scopes: auth.ALL_SCOPES });
  console.log(`Created first admin ${ADMIN_EMAIL}.`);
}

if (require.main === module) {
  bootstrapAdmin();
  app.listen(PORT, () => {
    console.log(`${mail.SITE_NAME} running at ${mail.BASE_URL}`);
    console.log(mail.MODE === 'smtp' ? 'Emails are sent automatically via SMTP.' : 'Emails are drafted for admins to send from Gmail (EMAIL_MODE=draft).');
    if (!db.data.admins.length) console.log(`No admins yet. Visit ${mail.BASE_URL}/admin to create the first one.`);
  });
}

module.exports = app;
