import { $, h, fill, busy, toast, pill, fmtDate, fmtDay, fmtTime, fmtSize, byDay, STATUS, LOGO } from './common.js';

$('#brand').insertAdjacentHTML('afterbegin', LOGO);
import { config, configured, rpc, fileUrl, setupNotice } from './db.js';

let token = location.hash.slice(1);
const app = $('#app');
let order;

async function load() {
  try {
    if (!token) throw new Error('This link is missing its tracking code. Check the link in your email.');
    order = await rpc('get_request', { p_token: token });
    render();
  } catch (err) {
    fill(app, h('div.empty', h('div.big', '🔍'), h('h1.h3', 'We couldn’t find that request.'), h('p', err.message), h('a.btn', { href: './' }, 'Start a new request')));
  }
}

function stepsFor(o) {
  const s = ['Received'];
  if (o.type === 'idea') s.push('Preview');
  s.push('Printing', 'Ready', 'Picked up');
  return s;
}
function stepIndex(o) {
  const idea = o.type === 'idea' ? 1 : 0;
  switch (o.status) {
    case 'received': return idea ? 1 : 0; // ideas are waiting on a preview
    case 'awaiting_approval': case 'changes_requested': return idea ? 1 : 0;
    case 'approved': return 1 + idea;
    case 'printing': return 1 + idea;
    case 'printed': case 'scheduled': return 2 + idea;
    case 'picked_up': return 4 + idea;
    default: return 0;
  }
}

function headline(o) {
  return {
    received: o.type === 'idea' ? ['We’re on it.', 'We’re working on a design. You’ll get a preview image to approve before we print.'] : ['Request received.', 'Your file is in the queue. We’ll email you when it starts printing.'],
    awaiting_approval: ['Your preview is ready.', 'Take a look below and let us know if it’s good to print.'],
    changes_requested: ['Thanks for the feedback.', 'We’re making changes and will send a new preview.'],
    approved: ['Approved. Up next.', 'Your print is in the queue. We’ll email you when it starts.'],
    printing: ['Printing now.', 'It’s on the printer. We’ll email you the moment it’s done.'],
    printed: ['It’s ready.', 'Choose a pickup time and spot below.'],
    scheduled: ['You’re all set.', 'See you at pickup.'],
    picked_up: ['Picked up. Enjoy!', 'This request is complete.'],
    cancelled: ['This request was closed.', 'Reach out if you have questions, or send a new request.'],
  }[o.status] || [STATUS[o.status]?.label || o.status, ''];
}

function render() {
  const o = order;
  const [title, sub] = headline(o);
  const steps = stepsFor(o);
  const idx = stepIndex(o);
  const done = o.status === 'picked_up';

  fill(app, 
    h('div', { style: { textAlign: 'center', marginBottom: '28px' } },
      h('p.muted.small', { style: { margin: '0 0 8px' } }, `Request #${o.number} · ${o.title}`),
      h('h1.h2', title),
      h('p.muted', { style: { margin: 0 } }, sub),
    ),
    o.status === 'cancelled' ? null : h('div.card.card-tight',
      h('div.progress', steps.map((label, i) => h(`div.p-step${i < idx || done ? '.done' : i === idx ? '.current' : ''}`, h('div.dot'), label))),
    ),
    previewCard(o),
    pickupCard(o),
    handoffCard(o),
    detailsCard(o),
    activityCard(o),
  );
}

// ---------- preview approval ----------
function previewCard(o) {
  if (!o.previews.length) return null;
  const latest = o.previews[o.previews.length - 1];
  const card = h('div.card',
    h('div.card-head', h('div', h('div.h3', 'Preview'), h('div.muted.small', `Sent ${fmtDate(latest.at)}`)), o.status === 'approved' || stepIndex(o) > 1 ? h('span.pill.green', 'Approved') : null),
    h('img.preview-img', { src: fileUrl(latest.path), alt: 'Preview of your print' }),
    latest.note ? h('p', { style: { margin: '0 0 16px' } }, `“${latest.note}”`) : null,
  );
  if (o.status === 'awaiting_approval') {
    const feedback = h('textarea.input', { placeholder: 'What should we change?', maxLength: 2000, style: { minHeight: '90px' } });
    const changes = h('div', { hidden: true, style: { marginTop: '14px' } },
      feedback,
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          if (!feedback.value.trim()) return toast('Tell us what you’d like changed.', { error: true });
          try { order = await rpc('request_changes', { p_token: token, p_feedback: feedback.value }); render(); toast('Feedback sent'); } catch (err) { toast(err.message, { error: true }); }
        }) }, 'Send feedback'),
        h('button.btn.plain', { onclick: () => { changes.hidden = true; actions.hidden = false; } }, 'Cancel'),
      ),
    );
    const actions = h('div.btn-row',
      h('button.btn.success', { onclick: (e) => busy(e.currentTarget, async () => {
        try { order = await rpc('approve_preview', { p_token: token }); render(); toast('Approved — thank you!'); } catch (err) { toast(err.message, { error: true }); }
      }) }, 'Looks good — print it'),
      h('button.btn.secondary', { onclick: () => { actions.hidden = true; changes.hidden = false; feedback.focus(); } }, 'Request changes'),
    );
    card.append(actions, changes);
  } else if (o.status === 'changes_requested' && o.feedback) {
    card.append(h('div.callout.orange', h('span.ci', '✎'), h('div', h('b', 'You asked for: '), o.feedback)));
  }
  return card;
}

// ---------- pickup booking ----------
function pickupCard(o) {
  if (!['printed', 'scheduled'].includes(o.status)) return null;
  const card = h('div.card', h('div.card-head', h('div', h('div.h3', o.status === 'scheduled' ? 'Your pickup' : 'Schedule pickup'), h('div.muted.small', 'Choose where and when.'))));

  if (o.status === 'scheduled' && o.pickup) {
    const summary = h('div.callout.green', h('span.ci', '📍'),
      h('div', h('b', `${o.pickup.location} · ${fmtDay(o.pickup.start)}`), h('div', `${fmtTime(o.pickup.start)} – ${fmtTime(o.pickup.end)}`)));
    const change = h('button.btn.secondary.sm', { style: { marginTop: '14px' } }, 'Change time or place');
    const picker = h('div', { hidden: true, style: { marginTop: '20px' } });
    change.onclick = () => { change.hidden = true; picker.hidden = false; buildPicker(picker, o); };
    card.append(summary, change, picker);
  } else {
    const picker = h('div');
    card.append(picker);
    buildPicker(picker, o);
  }
  return card;
}

async function buildPicker(el, o) {
  fill(el, h('div.empty', h('span.spinner')));
  let data;
  try { data = { locations: config.LOCATIONS, slots: await rpc('open_slots', { p_token: token }) }; } catch (err) { fill(el, h('p.form-error', err.message)); return; }

  let location = o.pickup?.location || data.locations[0];
  let slotId = o.pickup?.slotId || null;
  const seg = h('div.segmented.full.lg', { role: 'group', 'aria-label': 'Pickup location' });
  const list = h('div', { style: { marginTop: '20px' } });
  const confirm = h('button.btn.block', { disabled: true, style: { marginTop: '8px' } }, 'Confirm pickup');

  const draw = () => {
    fill(seg, ...data.locations.map((loc) => h('button', { type: 'button', 'aria-pressed': String(loc === location), onclick: () => { location = loc; slotId = null; draw(); } }, loc)));
    const slots = data.slots.filter((s) => s.locations.includes(location));
    if (!slots.length) {
      fill(list, h('div.empty', { style: { padding: '24px 0' } }, h('p', { style: { margin: 0 } }, `No pickup times are open at ${location} yet.`), h('p.small', 'Check back soon — or try the other location.')));
    } else {
      fill(list, ...byDay(slots).map((day) => h('div.day',
        h('div.day-label', fmtDay(day[0].start)),
        h('div.slots', day.map((s) => h('button.slot', { type: 'button', 'aria-pressed': String(s.id === slotId), onclick: () => { slotId = s.id; draw(); } },
          `${fmtTime(s.start)} – ${fmtTime(s.end)}`,
          h('small', s.remaining <= 3 ? `${s.remaining} left` : ' '),
        ))),
      )));
    }
    confirm.disabled = !slotId || !slots.some((s) => s.id === slotId);
  };
  confirm.onclick = () => busy(confirm, async () => {
    try {
      order = await rpc('book_pickup', { p_token: token, p_slot: slotId, p_location: location });
      render();
      toast('Pickup booked — check your email');
    } catch (err) { toast(err.message, { error: true }); buildPicker(el, o); }
  });
  draw();
  fill(el, h('div.field', h('span', 'Pickup location'), seg), list, confirm);
}

// ---------- hand-off confirmation ----------
function handoffCard(o) {
  if (!o.handoff) return null;
  const x = o.handoff;
  return h('div.card',
    h('div.card-head', h('div.h3', 'Hand-off'), h('span.pill.green', 'Confirmed')),
    h('dl.kv',
      h('dt', 'Given by'), h('dd', x.adminName),
      h('dt', 'Received by'), h('dd', x.receivedBy),
      h('dt', 'Location'), h('dd', x.location),
      h('dt', 'When'), h('dd', fmtDate(x.at)),
    ),
    h('p.muted.small', { style: { margin: '16px 0 0' } }, `${x.adminName} will email you a confirmation.`),
  );
}

// ---------- details ----------
function detailsCard(o) {
  const card = h('div.card', h('div.card-head', h('div.h3', 'Details'), pill(o.status)));
  if (o.file) {
    const viewer = h('div');
    card.append(viewer,
      h('div.file-chip', { style: { marginBottom: '18px' } },
        h('div.ext', o.file.name.split('.').pop().toUpperCase()),
        h('div.grow', h('div.name', o.file.name), h('div.muted.small', fmtSize(o.file.size))),
        h('a.btn.plain.sm', { href: fileUrl(o.file.path, o.file.name) }, 'Download'),
      ));
    import('./viewer.js').then(({ mountViewer }) => mountViewer(viewer, fetch(fileUrl(o.file.path)).then((r) => r.arrayBuffer()), o.file.name));
  }
  if (o.description) card.append(h('p', { style: { margin: '0 0 18px', whiteSpace: 'pre-wrap' } }, o.description));
  card.append(h('dl.kv',
    h('dt', 'Name'), h('dd', o.teacherName),
    h('dt', 'Email'), h('dd', o.email),
    o.color ? [h('dt', 'Color'), h('dd', o.color)] : null,
    o.notes ? [h('dt', 'Notes'), h('dd', o.notes)] : null,
    h('dt', 'Sent'), h('dd', fmtDate(o.createdAt)),
  ));
  return card;
}

function activityCard(o) {
  const words = {
    received: 'Request received', awaiting_approval: 'Preview sent for approval', changes_requested: 'You requested changes',
    approved: 'You approved the preview', printing: 'Started printing', printed: 'Finished printing',
    scheduled: 'Pickup booked', picked_up: 'Picked up', cancelled: 'Request closed',
  };
  return h('div.card',
    h('div.h3', { style: { marginBottom: '16px' } }, 'Activity'),
    h('ul.timeline', [...o.history].reverse().map((e) => h('li', h('div.tdot'), h('div',
      h('div.t-title', words[e.status] || e.status),
      h('div.t-sub', fmtDate(e.at)),
    )))),
  );
}

if (configured) load(); else setupNotice(app);
// Refresh quietly when the teacher comes back to the tab.
addEventListener('hashchange', () => { token = location.hash.slice(1); load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && order) rpc('get_request', { p_token: token }).then((o) => { if (o.status !== order.status) { order = o; render(); } }).catch(() => {}); });
