'use strict';
// Email delivery. Configure SMTP with environment variables (see README).
// Without SMTP, emails are still recorded in the admin "Email log" and printed
// to the console, so the whole flow can be tried locally.
const nodemailer = require('nodemailer');
const db = require('./db');
const auth = require('./auth');

const SITE_NAME = process.env.SITE_NAME || 'Print Desk';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'print-desk@localhost';

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ heading, body, button }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:#1d1d1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;padding:40px 36px">
      <tr><td style="font-size:13px;color:#86868b;letter-spacing:.02em;padding-bottom:18px">${esc(SITE_NAME)}</td></tr>
      <tr><td style="font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-.02em;padding-bottom:16px">${esc(heading)}</td></tr>
      <tr><td style="font-size:16px;line-height:1.5;color:#1d1d1f">${body}</td></tr>
      ${button ? `<tr><td style="padding-top:28px"><a href="${esc(button.href)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;font-size:16px;padding:12px 22px;border-radius:980px">${esc(button.label)}</a></td></tr>` : ''}
    </table>
    <p style="font-size:12px;color:#86868b;margin-top:20px">You’re receiving this because you sent a request to ${esc(SITE_NAME)}.</p>
  </td></tr></table></body></html>`;
}

/**
 * Send an email and log it.
 * @param {object} o
 * @param {string} o.to
 * @param {string} o.subject
 * @param {string} o.heading
 * @param {string} o.html      trusted HTML body (escape user data with esc())
 * @param {string} o.text      plain-text version
 * @param {{label:string,href:string}} [o.button]
 * @param {{name:string,email:string}} [o.sender]  send "from" a specific admin
 * @param {string} [o.orderId]
 * @param {Array} [o.attachments]
 */
async function send(o) {
  const from = o.sender ? { name: `${o.sender.name} via ${SITE_NAME}`, address: FROM } : { name: SITE_NAME, address: FROM };
  const message = {
    from,
    replyTo: o.sender ? { name: o.sender.name, address: o.sender.email } : undefined,
    to: o.to,
    subject: o.subject,
    text: o.text + (o.button ? `\n\n${o.button.label}: ${o.button.href}` : ''),
    html: layout({ heading: o.heading, body: o.html, button: o.button }),
    attachments: o.attachments,
  };
  const entry = {
    id: auth.id(),
    to: o.to,
    from: o.sender ? `${o.sender.name} <${o.sender.email}>` : SITE_NAME,
    subject: o.subject,
    text: message.text,
    orderId: o.orderId || null,
    at: new Date().toISOString(),
    status: transport ? 'sending' : 'logged',
    error: null,
  };
  db.tx((s) => {
    s.emails.unshift(entry);
    s.emails = s.emails.slice(0, 500);
  });
  if (!transport) {
    console.log(`\n✉️  [email not sent — SMTP not configured]\nTo: ${o.to}\nSubject: ${o.subject}\n${message.text}\n`);
    return entry;
  }
  try {
    await transport.sendMail(message);
    db.tx(() => { entry.status = 'sent'; });
  } catch (err) {
    console.error('Email failed:', err.message);
    db.tx(() => { entry.status = 'failed'; entry.error = err.message; });
  }
  return entry;
}

module.exports = { send, esc, BASE_URL, SITE_NAME, configured: () => Boolean(transport) };
