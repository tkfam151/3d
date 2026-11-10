'use strict';
// Admin authentication built on fine-grained tokens.
//
// * An admin signs in with their email + password. That exchanges the password
//   for a short-lived *session token* carrying exactly that admin's scopes.
// * From a password session an admin can mint *personal access tokens* — each
//   with its own name, a subset of their scopes, and an expiry date — for
//   scripts, a shared print-room computer, etc. Tokens can't mint tokens.
// * Only a SHA-256 hash of every token is stored. The plaintext is shown once.
const crypto = require('crypto');
const db = require('./db');

const SCOPES = {
  'orders:read': 'View requests and download files',
  'orders:write': 'Post print updates and preview images',
  'pickups:write': 'Record hand-offs at pickup',
  'schedule:write': 'Set up pickup times',
  'team:write': 'Add and remove admins',
};
const ALL_SCOPES = Object.keys(SCOPES);
const SESSION_HOURS = 12;

const id = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function cleanScopes(scopes, allowed = ALL_SCOPES) {
  return [...new Set((scopes || []).filter((s) => ALL_SCOPES.includes(s) && allowed.includes(s)))];
}

function createAdmin({ name, email, password, scopes }) {
  const admin = {
    id: id(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    password: hashPassword(password),
    scopes: cleanScopes(scopes),
    createdAt: new Date().toISOString(),
  };
  db.tx((s) => s.admins.push(admin));
  return admin;
}

function issueToken({ admin, kind, name, scopes, expiresAt }) {
  const tokenId = id(6);
  const prefix = kind === 'session' ? 'pd_ses' : 'pd_pat';
  const plaintext = `${prefix}_${tokenId}_${crypto.randomBytes(24).toString('base64url')}`;
  const record = {
    id: tokenId,
    adminId: admin.id,
    kind,
    name: name || (kind === 'session' ? 'Web sign-in' : 'Token'),
    scopes: cleanScopes(scopes, admin.scopes),
    hash: sha256(plaintext),
    createdAt: new Date().toISOString(),
    expiresAt,
    lastUsedAt: null,
  };
  db.tx((s) => {
    // Drop expired tokens while we're here.
    const now = Date.now();
    s.tokens = s.tokens.filter((t) => !t.expiresAt || Date.parse(t.expiresAt) > now);
    s.tokens.push(record);
  });
  return { token: plaintext, record };
}

function issueSession(admin) {
  return issueToken({
    admin,
    kind: 'session',
    scopes: admin.scopes,
    expiresAt: new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString(),
  });
}

/** Resolve a bearer token to { admin, token } or null. */
function resolve(plaintext) {
  const m = /^pd_(ses|pat)_([0-9a-f]{12})_[\w-]+$/.exec(String(plaintext || ''));
  if (!m) return null;
  const token = db.data.tokens.find((t) => t.id === m[2]);
  if (!token) return null;
  const a = Buffer.from(token.hash, 'hex');
  const b = Buffer.from(sha256(plaintext), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) return null;
  const admin = db.data.admins.find((x) => x.id === token.adminId);
  if (!admin) return null;
  // Lazily record usage (at most once a minute, to avoid constant disk writes).
  if (!token.lastUsedAt || Date.now() - Date.parse(token.lastUsedAt) > 60e3) {
    db.tx(() => { token.lastUsedAt = new Date().toISOString(); });
  }
  // A token can never exceed its admin's *current* scopes.
  const scopes = token.scopes.filter((s) => admin.scopes.includes(s));
  return { admin, token, scopes };
}

/** Express middleware: require a valid token, optionally with a scope. */
function requireAuth(scope, { sessionOnly = false } = {}) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const auth = resolve(raw);
    if (!auth) return res.status(401).json({ error: 'Please sign in again.' });
    if (sessionOnly && auth.token.kind !== 'session') {
      return res.status(403).json({ error: 'This needs a password sign-in, not an access token.' });
    }
    if (scope && !auth.scopes.includes(scope)) {
      return res.status(403).json({ error: `Your token is missing the “${scope}” permission.` });
    }
    req.auth = auth;
    next();
  };
}

// Very small in-memory throttle for sign-in attempts.
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, until: 0, first: now };
  if (rec.until > now) return Math.ceil((rec.until - now) / 1000);
  if (now - rec.first > 15 * 60e3) { rec.n = 0; rec.first = now; }
  rec.n += 1;
  if (rec.n > 8) rec.until = now + 5 * 60e3;
  attempts.set(key, rec);
  return 0;
}
const clearThrottle = (key) => attempts.delete(key);

const publicAdmin = (a) => ({ id: a.id, name: a.name, email: a.email, scopes: a.scopes, createdAt: a.createdAt });
const publicToken = (t) => ({
  id: t.id, kind: t.kind, name: t.name, scopes: t.scopes,
  createdAt: t.createdAt, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt,
});

module.exports = {
  SCOPES, ALL_SCOPES, id, hashPassword, verifyPassword, cleanScopes, createAdmin,
  issueToken, issueSession, resolve, requireAuth, throttle, clearThrottle, publicAdmin, publicToken,
};
