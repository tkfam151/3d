'use strict';
// Email for teacher updates.
//
// Two modes (EMAIL_MODE in .env):
//   draft (default) — every update is saved as a ready-to-send draft. The admin
//                     handling the request clicks "Open in Gmail", which opens a
//                     pre-filled compose window in *their own* Gmail, and they
//                     press Send there. Nothing is sent by the server.
//   smtp            — the server sends automatically through SMTP_* settings.
const nodemailer = require('nodemailer');
const db = require('./db');
const auth = require('./auth');

const SITE_NAME = process.env.SITE_NAME || 'Print Desk';
// Public site address for links in emails. Render sets RENDER_EXTERNAL_URL automatically.
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'print-desk@localhost';

let transport = null;
if (process.env.EMAIL_MODE === 'smtp') {
  if (process.env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } else {
    console.warn('EMAIL_MODE=smtp but SMTP_HOST is not set — falling back to Gmail drafts.');
  }
}
const MODE = transport ? 'smtp' : 'draft';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ heading, paragraphs, button }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:#1d1d1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;padding:40px 36px">
      <tr><td style="font-size:13px;color:#86868b;padding-bottom:18px">${esc(SITE_NAME)}</td></tr>
      <tr><td style="font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-.02em;padding-bottom:16px">${esc(heading)}</td></tr>
      <tr><td style="font-size:16px;line-height:1.5">${body}</td></tr>
      ${button ? `<tr><td style="padding-top:14px"><a href="${esc(button.href)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;font-size:16px;padding:12px 22px;border-radius:980px">${esc(button.label)}</a></td></tr>` : ''}
    </table>
  </td></tr></table></body></html>`;
}

/**
 * Create (and in smtp mode, send) an email to a teacher.
 * @param {object} o
 * @param {object} o.order       the request this is about
 * @param {string} o.subject
 * @param {string} o.heading     big title (HTML email only)
 * @param {string[]} o.paragraphs plain-text paragraphs
 * @param {{label:string,href:string}} [o.button]
 * @param {{id:string,name:string,email:string}} [o.sender]  admin who sends / signs it
 * @param {{previewId:string,filename:string,path:string}} [o.attachment]
 */
async function send(o) {
  const order = o.order;
  const greeting = `Hi ${order.teacherName},`;
  const signoff = o.sender ? `Thanks,\n${o.sender.name}` : `Thanks,\nThe ${SITE_NAME} team`;
  const paragraphs = [greeting, ...o.paragraphs];
  const text = [...paragraphs, o.button ? `${o.button.label}:\n${o.button.href}` : null, signoff].filter(Boolean).join('\n\n');

  const entry = {
    id: auth.id(),
    orderId: order.id,
    orderNumber: order.number,
    orderTitle: order.title,
    to: order.email,
    teacherName: order.teacherName,
    subject: o.subject,
    text,
    senderId: o.sender?.id || null,
    from: o.sender ? o.sender.name : SITE_NAME,
    attachment: o.attachment ? { previewId: o.attachment.previewId, filename: o.attachment.filename } : null,
    at: new Date().toISOString(),
    status: MODE === 'smtp' ? 'sending' : 'draft',
    sentBy: null,
    sentAt: null,
    error: null,
  };
  db.tx((s) => {
    s.emails.unshift(entry);
    s.emails = s.emails.slice(0, 1000);
  });
  if (MODE === 'draft') return entry;

  try {
    await transport.sendMail({
      from: o.sender ? { name: `${o.sender.name} via ${SITE_NAME}`, address: FROM } : { name: SITE_NAME, address: FROM },
      replyTo: o.sender ? { name: o.sender.name, address: o.sender.email } : undefined,
      to: order.email,
      subject: o.subject,
      text,
      html: layout({ heading: o.heading, paragraphs: [...paragraphs, signoff], button: o.button }),
      attachments: o.attachment ? [{ filename: o.attachment.filename, path: o.attachment.path }] : undefined,
    });
    db.tx(() => { entry.status = 'sent'; entry.sentAt = new Date().toISOString(); entry.sentBy = 'Automatic'; });
  } catch (err) {
    console.error('Email failed:', err.message);
    db.tx(() => { entry.status = 'failed'; entry.error = err.message; });
  }
  return entry;
}

module.exports = { send, esc, BASE_URL, SITE_NAME, MODE };
