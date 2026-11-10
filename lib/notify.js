'use strict';
// The emails teachers receive as their request moves along.
const path = require('path');
const fs = require('fs');
const { send, esc, BASE_URL } = require('./mail');
const db = require('./db');

const trackUrl = (o) => `${BASE_URL}/track/${o.trackToken}`;
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZone: process.env.TZ || undefined,
});
const label = (o) => `#${o.number} ${o.title}`;
const hi = (o) => `Hi ${esc(o.teacherName.split(' ')[0])},`;
const p = (s) => `<p style="margin:0 0 14px">${s}</p>`;

const notify = {
  received(o) {
    const what = o.type === 'file'
      ? `your file <b>${esc(o.file.original)}</b>`
      : 'your idea';
    const next = o.type === 'file'
      ? 'We’ll email you when it starts printing and again when it’s ready to pick up.'
      : 'Before anything is printed, we’ll send you a preview image to approve.';
    return send({
      to: o.email, orderId: o.id,
      subject: `We got your request — ${label(o)}`,
      heading: 'Request received.',
      html: p(hi(o)) + p(`Thanks — we received ${what}. ${next}`) + p(`Your request number is <b>#${o.number}</b>.`),
      text: `Hi ${o.teacherName},\n\nWe received your request "${o.title}" (#${o.number}). ${next}`,
      button: { label: 'Track your request', href: trackUrl(o) },
    });
  },

  preview(o, note) {
    const img = o.previews[o.previews.length - 1];
    const file = path.join(db.UPLOAD_DIR, img.stored);
    const attachments = fs.existsSync(file) ? [{ filename: img.original || 'preview.png', path: file, cid: 'preview@printdesk' }] : [];
    return send({
      to: o.email, orderId: o.id,
      subject: `Preview ready for your approval — ${label(o)}`,
      heading: 'Here’s a preview.',
      html: p(hi(o)) + p('Here’s what we’re planning to print. Take a look and let us know if it’s good to go.')
        + (note ? p(`<i>“${esc(note)}”</i>`) : '')
        + (attachments.length ? `<img src="cid:preview@printdesk" alt="Preview" style="width:100%;border-radius:12px;margin:6px 0 14px">` : ''),
      text: `Hi ${o.teacherName},\n\nA preview of "${o.title}" is ready. Please approve it or ask for changes.${note ? `\n\nNote: ${note}` : ''}`,
      button: { label: 'Approve or request changes', href: trackUrl(o) },
      attachments,
    });
  },

  printing(o) {
    return send({
      to: o.email, orderId: o.id,
      subject: `Started printing — ${label(o)}`,
      heading: 'Your print has started.',
      html: p(hi(o)) + p(`<b>${esc(o.title)}</b> is on the printer now. We’ll email you as soon as it’s finished.`),
      text: `Hi ${o.teacherName},\n\n"${o.title}" (#${o.number}) has started printing.`,
      button: { label: 'View status', href: trackUrl(o) },
    });
  },

  printed(o) {
    return send({
      to: o.email, orderId: o.id,
      subject: `Finished printing — choose a pickup time — ${label(o)}`,
      heading: 'It’s ready.',
      html: p(hi(o)) + p(`<b>${esc(o.title)}</b> has finished printing. Pick a time and a pickup spot — PU2 or PU3 — that works for you.`),
      text: `Hi ${o.teacherName},\n\n"${o.title}" (#${o.number}) has finished printing. Choose a pickup time and location (PU2 or PU3).`,
      button: { label: 'Schedule pickup', href: trackUrl(o) },
    });
  },

  scheduled(o) {
    return send({
      to: o.email, orderId: o.id,
      subject: `Pickup booked: ${o.pickup.location}, ${fmtTime(o.pickup.start)} — ${label(o)}`,
      heading: 'Pickup booked.',
      html: p(hi(o)) + p(`You’re all set to pick up <b>${esc(o.title)}</b> at <b>${esc(o.pickup.location)}</b> on <b>${esc(fmtTime(o.pickup.start))}</b>.`)
        + p('Need a different time? You can change it from your tracking page.'),
      text: `Hi ${o.teacherName},\n\nPickup booked for "${o.title}" at ${o.pickup.location}, ${fmtTime(o.pickup.start)}.`,
      button: { label: 'View or change', href: trackUrl(o) },
    });
  },

  /** Sent from the admin who handed the print over, as confirmation. */
  handedOff(o, admin) {
    const h = o.handoff;
    return send({
      to: o.email, orderId: o.id,
      sender: { name: admin.name, email: admin.email },
      subject: `Pickup confirmation — ${label(o)}`,
      heading: 'Picked up. Enjoy!',
      html: p(hi(o))
        + p(`This confirms that <b>${esc(o.title)}</b> (#${o.number}) was handed over.`)
        + `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f7;border-radius:12px;padding:14px 18px;margin:4px 0 18px;font-size:15px">
            <tr><td style="color:#86868b;padding:4px 0">Given by</td><td align="right">${esc(admin.name)}</td></tr>
            <tr><td style="color:#86868b;padding:4px 0">Received by</td><td align="right">${esc(h.receivedBy)}</td></tr>
            <tr><td style="color:#86868b;padding:4px 0">Location</td><td align="right">${esc(h.location)}</td></tr>
            <tr><td style="color:#86868b;padding:4px 0">When</td><td align="right">${esc(fmtTime(h.at))}</td></tr>
          </table>`
        + p(`If anything looks wrong, just reply to this email — it goes straight to ${esc(admin.name)}.`)
        + p(`— ${esc(admin.name)}`),
      text: `Hi ${o.teacherName},\n\nThis confirms "${o.title}" (#${o.number}) was handed over.\nGiven by: ${admin.name}\nReceived by: ${h.receivedBy}\nLocation: ${h.location}\nWhen: ${fmtTime(h.at)}\n\nReply to this email if anything looks wrong.\n— ${admin.name}`,
    });
  },

  cancelled(o, reason) {
    return send({
      to: o.email, orderId: o.id,
      subject: `Request closed — ${label(o)}`,
      heading: 'Request closed.',
      html: p(hi(o)) + p(`We’ve closed your request <b>${esc(o.title)}</b>.`) + (reason ? p(`<i>“${esc(reason)}”</i>`) : ''),
      text: `Hi ${o.teacherName},\n\nYour request "${o.title}" (#${o.number}) was closed.${reason ? `\n\n${reason}` : ''}`,
    });
  },
};

module.exports = notify;
