'use strict';
// The emails teachers receive as their request moves along.
// Each one is signed by (and, in draft mode, sent from the Gmail of) the admin
// handling the request.
const path = require('path');
const { send, BASE_URL } = require('./mail');
const db = require('./db');

const trackUrl = (o) => `${BASE_URL}/track/${o.trackToken}`;
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZone: process.env.TZ || undefined,
});
const label = (o) => `#${o.number} ${o.title}`;
/** The admin looking after this request, if any. */
const handler = (o) => (o.handler ? db.data.admins.find((a) => a.id === o.handler.id) || null : null);

const notify = {
  received(o) {
    const what = o.type === 'file' ? `your file "${o.file.original}"` : `your request "${o.title}"`;
    const next = o.type === 'file'
      ? 'We’ll let you know when it starts printing and again when it’s ready to pick up.'
      : 'Before anything is printed, we’ll send you a preview image to approve.';
    return send({
      order: o,
      subject: `We got your request — ${label(o)}`,
      heading: 'Request received.',
      paragraphs: [`Thanks — we received ${what}. ${next}`, `Your request number is #${o.number}.`],
      button: { label: 'Track your request', href: trackUrl(o) },
    });
  },

  preview(o, note, admin) {
    const img = o.previews[o.previews.length - 1];
    return send({
      order: o, sender: admin,
      subject: `Preview ready for your approval — ${label(o)}`,
      heading: 'Here’s a preview.',
      paragraphs: [
        `Here’s what we’re planning to print for "${o.title}". Please take a look and let us know if it’s good to go, or what you’d like changed.`,
        note ? `Note: ${note}` : null,
        'You can see the preview and approve it here:',
      ].filter(Boolean),
      button: { label: 'Approve or request changes', href: trackUrl(o) },
      attachment: { previewId: img.id, filename: img.original || 'preview.png', path: path.join(db.UPLOAD_DIR, img.stored) },
    });
  },

  printing(o, admin) {
    return send({
      order: o, sender: admin,
      subject: `Started printing — ${label(o)}`,
      heading: 'Your print has started.',
      paragraphs: [`"${o.title}" is on the printer now. I’ll email you as soon as it’s finished.`],
      button: { label: 'View status', href: trackUrl(o) },
    });
  },

  printed(o, admin) {
    return send({
      order: o, sender: admin,
      subject: `Finished printing — choose a pickup time — ${label(o)}`,
      heading: 'It’s ready.',
      paragraphs: [`"${o.title}" has finished printing! Please pick a time and a pickup spot (PU2 or PU3) that works for you.`],
      button: { label: 'Schedule your pickup', href: trackUrl(o) },
    });
  },

  scheduled(o) {
    return send({
      order: o, sender: handler(o),
      subject: `Pickup booked: ${o.pickup.location}, ${fmtTime(o.pickup.start)} — ${label(o)}`,
      heading: 'Pickup booked.',
      paragraphs: [
        `You’re all set to pick up "${o.title}" at ${o.pickup.location} on ${fmtTime(o.pickup.start)}.`,
        'Need a different time? You can change it here:',
      ],
      button: { label: 'View or change your pickup', href: trackUrl(o) },
    });
  },

  /** Sent by the admin who handed the print over, as confirmation. */
  handedOff(o, admin) {
    const h = o.handoff;
    return send({
      order: o, sender: admin,
      subject: `Pickup confirmation — ${label(o)}`,
      heading: 'Picked up. Enjoy!',
      paragraphs: [
        `This confirms that "${o.title}" (#${o.number}) was handed over.`,
        `Given by: ${admin.name}\nReceived by: ${h.receivedBy}\nLocation: ${h.location}\nWhen: ${fmtTime(h.at)}`,
        'If anything looks wrong, just reply to this email.',
      ],
    });
  },

  cancelled(o, reason, admin) {
    return send({
      order: o, sender: admin,
      subject: `Request closed — ${label(o)}`,
      heading: 'Request closed.',
      paragraphs: [`I’ve closed your request "${o.title}" (#${o.number}).`, reason ? `Reason: ${reason}` : null, 'Reply to this email if you have any questions.'].filter(Boolean),
    });
  },
};

module.exports = notify;
