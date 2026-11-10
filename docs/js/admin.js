import { $, h, fill, busy, toast, pill, ago, fmtDate, fmtDay, fmtTime, fmtSize, byDay, STATUS, LOGO } from './common.js';
import { sb, config, configured, rpc, rows, fileUrl, uploadFile, safeName, setupNotice, inviteAdmin } from './db.js';

$('#brand').insertAdjacentHTML('afterbegin', LOGO);
$('#brand').lastChild.textContent = config.SITE_NAME;
const app = $('#app');

// Fine-grained permissions. Each admin has their own set (Team tab), enforced by the database.
const SCOPES = {
  'orders:read': 'View requests, files and the Outbox',
  'orders:write': 'Print updates, previews, marking emails sent',
  'pickups:write': 'Record hand-offs at pickup',
  'schedule:write': 'Set up pickup times',
  'team:write': 'Add and remove admins, change permissions',
};

let me = null; // { id, name, email, scopes }
const can = (scope) => Boolean(me?.scopes.includes(scope));
const fail = (err) => toast(err.message, { error: true });
// This page's clean address (no ?query or #hash), used in email links and Supabase redirects.
// Arrived by clicking an activation / sign-in email link? Then ask them to choose a password.
const fromEmailLink = /type=(magiclink|signup|invite)/.test(window.PD_ARRIVED_FROM || '');
const pageUrl = () => location.origin + location.pathname.replace(/\/docs\/admin\.html$/, '/admin.html');

// ================= sign in =================
async function start() {
  if (!configured) { setupNotice(app); return; }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showNewPassword();
    if (event === 'SIGNED_OUT') { me = null; $('#tabs').hidden = true; showLogin(); }
  });
  const { data } = await sb.auth.getSession();
  if (data.session && fromEmailLink) showNewPassword(true);
  else if (data.session) await loadMe(data.session.user);
  else showLogin(/error_description=/.test(window.PD_ARRIVED_FROM || '')
    ? 'That email link has expired or was already used. Ask the owner to send a new one.' : null);
}

async function loadMe(user) {
  try {
    const admin = await rows(sb.from('admins').select('*').eq('id', user.id).maybeSingle());
    if (!admin) return showNotAdmin(user.email);
    me = admin;
    enter();
  } catch (err) { showLogin(err.message); }
}

function authShell(title, sub, ...content) {
  fill(app, h('div.auth-wrap', h('div.auth-card',
    h('div.lock', { html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' }),
    h('h1.h2', title),
    h('p.muted', { style: { margin: 0 } }, sub),
    ...content,
  )));
}

function authError(err) {
  const m = err?.message || '';
  if (/invalid login credentials/i.test(m)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first — check your inbox for the link.';
  if (/already registered/i.test(m)) return 'There’s already an account with that email. Try signing in.';
  if (/signups? not allowed/i.test(m)) return 'Supabase has sign-ups turned off. Turn on “Allow new users to sign up” (Authentication → Sign In / Providers). Strangers still can’t join — only people on your Team list.';
  if (/database error saving new user/i.test(m)) return 'That email isn’t on the Team list, so it can’t have an account.';
  if (/rate limit|too many/i.test(m)) return 'Supabase’s email limit was reached. Wait a while, or connect your own email sender (see the README).';
  return m || 'Something went wrong.';
}

// Sign in only — there is no "create account". The owner creates every login
// in Supabase (see Team → Add admin), and the database rejects anyone else.
function showLogin(message) {
  const err = h('div.form-error', { hidden: !message }, message || '');
  const note = h('div.callout.green', { hidden: true, style: { marginBottom: '14px' } });
  const email = h('input.input', { type: 'email', autocomplete: 'username', placeholder: 'Email', required: true });
  const password = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
  const submit = h('button.btn.block', { type: 'submit' }, 'Sign in');
  const showMsg = (text) => { fill(note, h('span.ci', '✉️'), h('div.small', text)); note.hidden = false; };

  const form = h('form', { onsubmit: (e) => {
    e.preventDefault(); err.hidden = true;
    busy(submit, async () => {
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        await loadMe(data.user);
      } catch (e2) { err.textContent = authError(e2); err.hidden = false; }
    });
  } }, note, h('label.field', email), h('label.field', password), err, submit);

  const forgot = h('button.btn.plain.sm', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    if (!email.value.trim()) { err.textContent = 'Enter your email above first.'; err.hidden = false; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: pageUrl() });
    if (error) { err.textContent = authError(error); err.hidden = false; } else showMsg('If that email has an account, a password-reset link is on its way.');
  }) }, 'Forgot password?');

  authShell('Admin sign in', `${config.SITE_NAME} staff only. Accounts are created by the owner.`,
    form, h('div.btn-row', { style: { justifyContent: 'center', marginTop: '14px' } }, forgot));
  setTimeout(() => email.focus(), 50);
}

function showNewPassword(welcome = false) {
  const pw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (10+ characters)' });
  const err = h('div.form-error', { hidden: true });
  const submit = h('button.btn.block', { type: 'submit' }, 'Save new password');
  authShell(welcome ? 'Welcome! Choose a password' : 'Choose a new password',
    welcome ? 'Your account is active. Pick a password to sign in with from now on.' : '', h('form', { onsubmit: (e) => {
    e.preventDefault();
    busy(submit, async () => {
      if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters.'; err.hidden = false; return; }
      const { data, error } = await sb.auth.updateUser({ password: pw.value });
      if (error) { err.textContent = authError(error); err.hidden = false; return; }
      toast('Password updated');
      loadMe(data.user);
    });
  } }, h('label.field', pw), err, submit));
}

function showNotAdmin(email) {
  authShell('Not an admin yet', `You’re signed in as ${email}, but this account doesn’t have admin access.`,
    h('p.muted.small', { style: { marginTop: '16px' } }, 'Ask an admin to invite this email under Team. Then sign in again.'),
    h('button.btn.secondary', { style: { marginTop: '10px' }, onclick: () => sb.auth.signOut() }, 'Sign out'));
}

// ================= shell =================
const views = { requests: viewRequests, schedule: viewSchedule, team: viewTeam, emails: viewOutbox, account: viewAccount };

function enter() {
  $('#tabs').hidden = false;
  $('#me-link').textContent = me.name.split(' ')[0];
  route();
}
function route() {
  if (!me) return;
  document.querySelectorAll('.scrim').forEach((el) => el.remove());
  const tab = location.hash.slice(1);
  const view = views[tab] || viewRequests;
  refreshBadge();
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === (views[tab] ? tab : 'requests')));
  fill(app, h('div.wrap', { style: { paddingBottom: '60px' } }, h('div.empty', h('span.spinner'))));
  view(app.firstChild).catch((err) => fill(app.firstChild, h('div.empty', h('div.big', '⚠️'), h('p', err.message))));
}
addEventListener('hashchange', route);

const head = (title, sub, ...right) => h('div.admin-head', h('div', h('h1.h2', title), sub ? h('p.muted', { style: { margin: '4px 0 0' } }, sub) : null), h('div.btn-row', right));
const noScope = (scope) => h('div.callout.orange', h('span.ci', '🔒'), h('div', 'You don’t have the ', h('code', scope), ' permission. Ask an admin to add it under Team.'));

function modal(title, body, { side = false } = {}) {
  const close = () => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 250); removeEventListener('keydown', esc); };
  const esc = (e) => e.key === 'Escape' && [...document.querySelectorAll('.scrim')].pop() === scrim && close();
  const scrim = h(`div.scrim${side ? '' : '.modal-center'}`, { onclick: (e) => e.target === scrim && close() },
    h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('div.grow', title), h('button.icon-btn', { onclick: () => close(), 'aria-label': 'Close' }, '✕')),
      h('div.sheet-body', body)));
  document.body.append(scrim);
  addEventListener('keydown', esc);
  requestAnimationFrame(() => scrim.classList.add('show'));
  return { close, body: scrim.querySelector('.sheet-body'), setTitle: (t) => { scrim.querySelector('.sheet-head .grow').textContent = t; } };
}

/** Database row → the shape the UI uses. */
function norm(r) {
  return {
    id: r.id, number: r.number, type: r.type, title: r.title, teacherName: r.teacher_name, email: r.email,
    notes: r.notes, color: r.color, description: r.description, status: r.status, feedback: r.feedback,
    trackToken: r.track_token, createdAt: r.created_at, cancelReason: r.cancel_reason,
    file: r.file_path ? { name: r.file_name, size: r.file_size, path: r.file_path } : null,
    pickup: r.pickup_start ? { slotId: r.pickup_slot, location: r.pickup_location, start: r.pickup_start, end: r.pickup_end } : null,
    handoff: r.handoff_at ? { location: r.handoff_location, receivedBy: r.handoff_received_by, adminName: r.handoff_admin_name, at: r.handoff_at } : null,
    handler: r.handler_id ? { id: r.handler_id, name: r.handler_name } : null,
    previews: (r.previews || []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    events: (r.events || []).sort((a, b) => a.id - b.id),
  };
}

// ================= requests =================
const FILTERS = {
  todo: { label: 'To do', match: ['received', 'changes_requested', 'approved'] },
  waiting: { label: 'Awaiting teacher', match: ['awaiting_approval'] },
  printing: { label: 'Printing', match: ['printing'] },
  ready: { label: 'Ready / booked', match: ['printed', 'scheduled'] },
};
let filter = 'todo';
let query = '';

async function viewRequests(root) {
  if (!can('orders:read')) { fill(root, head('Requests'), noScope('orders:read')); return; }
  const orders = (await rows(sb.from('requests').select('*').order('created_at', { ascending: false }).limit(1000))).map(norm);
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, orders.filter((o) => f.match.includes(o.status)).length]));
  const listEl = h('div');
  const search = h('input.input', { type: 'search', placeholder: 'Search name, title, email, #number', value: query, oninput: (e) => { query = e.target.value; draw(); } });
  const allSeg = h('div.segmented', ['active', 'all'].map((k) => h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; viewRequests(root); } }, k === 'active' ? 'All open' : 'Everything')));

  function draw() {
    const q = query.trim().toLowerCase();
    let list = orders;
    if (FILTERS[filter]) list = list.filter((o) => FILTERS[filter].match.includes(o.status));
    else if (filter === 'active') list = list.filter((o) => !['picked_up', 'cancelled'].includes(o.status));
    if (q) list = list.filter((o) => [o.title, o.teacherName, o.email, `#${o.number}`, o.file?.name].join(' ').toLowerCase().includes(q));
    if (!list.length) { fill(listEl, h('div.list', h('div.empty', h('div.big', '✓'), h('p', { style: { margin: 0 } }, q ? 'No matches.' : 'Nothing here — all caught up.')))); return; }
    fill(listEl, h('div.list', list.map((o) => h('button.list-row', { type: 'button', onclick: () => openOrder(o.id, () => viewRequests(root)) },
      h('div.num', `#${o.number}`),
      h('div', { style: { minWidth: 0 } },
        h('div.ttl', o.title),
        h('div.sub', `${o.teacherName} · `, o.type === 'file' ? `${o.file.name.split('.').pop().toUpperCase()} file` : 'Idea',
          o.pickup && o.status === 'scheduled' ? ` · ${o.pickup.location} ${fmtDate(o.pickup.start)}` : '',
          o.handler ? ` · ${o.handler.id === me.id ? 'you' : o.handler.name}` : ''),
      ),
      pill(o.status),
      h('div.when', ago(o.createdAt)),
    ))));
  }

  fill(root,
    head('Requests', null, allSeg),
    h('div.counts', Object.entries(FILTERS).map(([k, f]) => h(`button.count${filter === k ? '.active' : ''}`, { type: 'button', onclick: () => { filter = k; viewRequests(root); } }, h('div.n', counts[k]), h('div.l', f.label)))),
    h('div.toolbar', h('div.search', search)),
    listEl,
  );
  draw();
}

const loadOrder = async (id) => norm(await rows(sb.from('requests').select('*, previews(*), events(*, email_log(*))').eq('id', id).single()));

async function openOrder(id, onChange) {
  const m = modal('Request', h('div.empty', h('span.spinner')), { side: true });
  const refresh = async (showEventId) => {
    const o = await loadOrder(id);
    m.setTitle(`#${o.number} · ${o.title}`);
    fill(m.body, orderDetail(o, refresh));
    if (showEventId) {
      const ev = o.events.find((e) => e.id === showEventId);
      if (ev) showDraft(compose(ev, o), () => { refresh(); onChange?.(); });
    }
    onChange?.();
  };
  refresh().catch((e) => { fail(e); m.close(); });
}

function orderDetail(o, refresh) {
  const out = [];
  // Run an action; if it created an event (an email to send), pop the draft up.
  const act = (fn) => async (e) => busy(e.currentTarget, async () => {
    try { const ev = await fn(); await refresh(typeof ev === 'number' ? ev : null); } catch (err) { fail(err); }
  });

  out.push(h('div.card', { style: { marginBottom: '16px' } },
    h('div.card-head', { style: { marginBottom: '6px' } }, h('div.h3', o.title), pill(o.status)),
    h('div.muted.small', `${o.type === 'file' ? 'File upload' : 'Idea'} · sent ${fmtDate(o.createdAt)}`),
    h('hr.divider'),
    h('dl.kv',
      h('dt', 'Teacher'), h('dd', o.teacherName),
      h('dt', 'Email'), h('dd', h('a', { href: `mailto:${o.email}` }, o.email)),
      o.color ? [h('dt', 'Color'), h('dd', o.color)] : null,
      o.notes ? [h('dt', 'Notes'), h('dd', o.notes)] : null,
      o.pickup ? [h('dt', 'Pickup'), h('dd', `${o.pickup.location} · ${fmtDay(o.pickup.start)}, ${fmtTime(o.pickup.start)}`)] : null,
      h('dt', 'Handled by'), h('dd', o.handler ? (o.handler.id === me.id ? `${o.handler.name} (you)` : o.handler.name) : 'Nobody yet'),
    ),
    h('div.btn-row', { style: { marginTop: '16px', justifyContent: 'space-between' } },
      h('a.btn.plain.sm', { href: `track.html#${o.trackToken}`, target: '_blank', rel: 'noopener' }, 'Open teacher’s page ↗'),
      can('orders:write') && o.handler?.id !== me.id && !['picked_up', 'cancelled'].includes(o.status)
        ? h('button.btn.secondary.sm', { title: 'Teacher emails for this request will be drafted for you to send', onclick: act(async () => { await rpc('admin_claim', { p_id: o.id }); toast('You’re handling this request'); }) }, 'I’ll handle this')
        : null),
  ));

  out.push(nextAction(o, act, refresh));

  if (o.file) {
    const viewer = h('div');
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '14px' } }, 'Model'),
      viewer,
      h('div.file-chip',
        h('div.ext', o.file.name.split('.').pop().toUpperCase()),
        h('div.grow', h('div.name', o.file.name), h('div.muted.small', o.file.size ? fmtSize(o.file.size) : '')),
        h('a.btn.sm', { href: fileUrl(o.file.path, o.file.name) }, 'Download'),
      )));
    import('./viewer.js').then(({ mountViewer }) => mountViewer(viewer, fetch(fileUrl(o.file.path)).then((r) => r.arrayBuffer()), o.file.name));
  }
  if (o.description) {
    out.push(h('div.card', { style: { marginBottom: '16px' } }, h('div.h3', { style: { marginBottom: '10px' } }, 'What they want'), h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, o.description)));
  }
  if (o.previews.length) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '10px' } }, 'Previews sent'),
      [...o.previews].reverse().map((p) => h('div', { style: { marginBottom: '14px' } },
        h('img.preview-img', { src: fileUrl(p.path), alt: 'Preview' }),
        h('div.muted.small', `${fmtDate(p.created_at)}${p.note ? ` — “${p.note}”` : ''}`))),
      o.feedback ? h('div.callout.orange', h('span.ci', '✎'), h('div', h('b', 'Teacher asked for: '), o.feedback)) : null,
    ));
  }
  if (o.handoff) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.card-head', h('div.h3', 'Hand-off'), h('span.pill.green', 'Done')),
      h('dl.kv', h('dt', 'Given by'), h('dd', o.handoff.adminName), h('dt', 'Received by'), h('dd', o.handoff.receivedBy), h('dt', 'Location'), h('dd', o.handoff.location), h('dt', 'When'), h('dd', fmtDate(o.handoff.at)))));
  }

  const emails = o.events.filter((e) => EMAILABLE.includes(e.status)).map((e) => compose(e, o)).reverse();
  if (emails.length) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '10px' } }, 'Emails to teacher'),
      emails.map((e) => h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--hairline)' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.small', e.subject),
          h('div.tiny.muted', `${fmtDate(e.at)} · from ${e.from}`, e.sentBy ? ` · ${emailStatus(e.status).toLowerCase()} by ${e.sentBy}` : '')),
        e.status === 'draft'
          ? h('button.btn.sm', { onclick: () => showDraft(e, refresh) }, 'Send…')
          : h('button.btn.plain.sm', { onclick: () => showDraft(e, refresh) }, emailStatus(e.status)))),
    ));
  }

  out.push(h('div.card', { style: { marginBottom: '16px' } },
    h('div.h3', { style: { marginBottom: '14px' } }, 'Activity'),
    h('ul.timeline', [...o.events].reverse().map((e) => h('li', h('div.tdot'), h('div',
      h('div.t-title', STATUS[e.status]?.label || e.status, e.by_name ? h('span.muted', ` · ${e.by_name}`) : null),
      e.note ? h('div.t-sub', e.note) : null,
      h('div.t-sub', fmtDate(e.created_at))))))));

  if (can('orders:write') && !['picked_up', 'cancelled'].includes(o.status)) {
    const reason = h('input.input', { placeholder: 'Reason (optional, goes in the email to the teacher)' });
    const box = h('div', { hidden: true, style: { marginTop: '12px' } }, reason,
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn.danger.sm', { onclick: act(() => rpc('admin_cancel', { p_id: o.id, p_reason: reason.value, p_notify: true })) }, 'Close request'),
      ));
    out.push(h('div', { style: { textAlign: 'center', padding: '6px 0 20px' } },
      h('button.btn.plain.sm', { style: { color: 'var(--red)' }, onclick: (e) => { e.currentTarget.hidden = true; box.hidden = false; } }, 'Close this request…'), box));
  }
  return out;
}

function nextAction(o, act) {
  const card = h('div.card', { style: { marginBottom: '16px', boxShadow: '0 0 0 2px var(--accent-soft), var(--shadow)' } });
  const title = (t, s) => h('div', { style: { marginBottom: '14px' } }, h('div.h3', t), s ? h('div.muted.small', s) : null);
  const setStatus = (status) => act(() => rpc('admin_set_status', { p_id: o.id, p_status: status }));

  const previewForm = (primary) => {
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { fontSize: '14px' } });
    const note = h('input.input', { placeholder: 'Note for the teacher (optional)', style: { margin: '10px 0' } });
    const send = h(`button.btn${primary ? '' : '.secondary'}.sm`, { onclick: act(async () => {
      const f = file.files[0];
      if (!f) throw new Error('Choose an image first.');
      if (!/\.(png|jpe?g|webp|gif)$/i.test(f.name)) throw new Error('Use a PNG, JPG, WebP or GIF image.');
      const path = `${o.trackToken}/preview-${Date.now()}-${safeName(f.name)}`;
      await uploadFile(path, f, f.type || 'image/png');
      const ev = await rpc('admin_add_preview', { p_id: o.id, p_path: path, p_file_name: f.name, p_note: note.value });
      toast('Preview saved');
      return ev;
    }) }, 'Send preview for approval');
    return h('div', h('label.field', h('span', 'Preview image'), h('div.file-chip', file)), note, send);
  };

  if (!can('orders:write') && !['printed', 'scheduled'].includes(o.status)) return null;

  switch (o.status) {
    case 'received':
    case 'changes_requested':
      if (o.type === 'idea') {
        card.append(title(o.status === 'received' ? 'Show a preview' : 'Send an updated preview', 'Upload an image of what you’ll print. The teacher approves it before printing.'), previewForm(true));
      } else {
        card.append(title('Ready to print?', 'Click when it’s on the printer — you’ll get an email ready to send.'),
          h('div.btn-row', h('button.btn', { onclick: setStatus('printing') }, 'Started printing')),
          h('details', { style: { marginTop: '16px' } }, h('summary.small.muted', { style: { cursor: 'pointer' } }, 'Send a preview image first (optional)'), h('div', { style: { marginTop: '12px' } }, previewForm(false))));
      }
      break;
    case 'awaiting_approval':
      card.append(title('Waiting on the teacher', 'Once they approve on their tracking page, it shows up here.'));
      if (o.type === 'file') card.append(h('button.btn.secondary.sm', { onclick: setStatus('printing') }, 'Start printing anyway'));
      card.append(h('details', { style: { marginTop: '14px' } }, h('summary.small.muted', { style: { cursor: 'pointer' } }, 'Send a different preview'), h('div', { style: { marginTop: '12px' } }, previewForm(false))));
      break;
    case 'approved':
      card.append(title('Approved — ready to print', 'Click when it’s on the printer — you’ll get an email ready to send.'), h('button.btn', { onclick: setStatus('printing') }, 'Started printing'));
      break;
    case 'printing':
      card.append(title('Printing', 'When it’s done, the teacher gets a link to book a pickup time.'), h('button.btn.success', { onclick: setStatus('printed') }, 'Finished printing'));
      break;
    case 'printed':
    case 'scheduled': {
      if (!can('pickups:write')) { card.append(title('Ready for pickup'), noScope('pickups:write')); break; }
      const location = h('input.input', { value: o.pickup?.location || '', placeholder: 'e.g. PU2 front desk', maxLength: 120 });
      const receivedBy = h('input.input', { value: o.teacherName, placeholder: 'Name of the person picking up', maxLength: 120 });
      card.append(
        title('Hand it off', o.status === 'scheduled'
          ? `Booked for ${o.pickup.location}, ${fmtDay(o.pickup.start)} at ${fmtTime(o.pickup.start)}.`
          : 'The teacher hasn’t booked a time yet — you can still hand it off.'),
        h('label.field', h('span', 'Pickup location'), location),
        h('label.field', h('span', 'Received by'), receivedBy),
        h('div.callout', { style: { marginBottom: '14px' } }, h('span.ci', '✉️'), h('div.small', `Next you’ll get a confirmation email for ${o.email}, ready to send from your Gmail.`)),
        h('button.btn.success', { onclick: act(async () => {
          if (!location.value.trim() || !receivedBy.value.trim()) throw new Error('Fill in the location and who received it.');
          const ev = await rpc('admin_handoff', { p_id: o.id, p_location: location.value, p_received_by: receivedBy.value });
          toast('Hand-off recorded');
          return ev;
        }) }, 'Confirm hand-off'),
      );
      break;
    }
    default:
      return null;
  }
  return card;
}

// ================= teacher emails =================
// Every update is an "event". Each one becomes a ready-to-send email that the
// admin opens in their own Gmail and sends.
const EMAILABLE = ['received', 'awaiting_approval', 'printing', 'printed', 'scheduled', 'picked_up', 'cancelled'];
const TEACHER_EVENTS = ['received', 'scheduled'];

function emailStatus(s) {
  return { draft: 'To send', sent: 'Sent', skipped: 'Skipped' }[s] || s;
}

const longTime = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Build the email for one event. `o` is a normalized request (with previews). */
function compose(ev, o) {
  const signer = ev.by_admin ? ev.by_name : (o.handler?.name || null);
  const link = new URL(`track.html#${o.trackToken}`, pageUrl()).href;
  const label = `#${o.number} ${o.title}`;
  let subject, body, button = null, attachment = null;
  switch (ev.status) {
    case 'received':
      subject = `We got your request — ${label}`;
      body = [`Thanks — we received ${o.type === 'file' ? `your file "${o.file?.name}"` : `your request "${o.title}"`}. ${o.type === 'file'
        ? 'We’ll let you know when it starts printing and again when it’s ready to pick up.'
        : 'Before anything is printed, we’ll send you a preview image to approve.'}`, `Your request number is #${o.number}.`];
      button = ['Track your request', link];
      break;
    case 'awaiting_approval': {
      const p = o.previews.find((x) => x.id === ev.preview_id);
      subject = `Preview ready for your approval — ${label}`;
      body = [`Here’s what we’re planning to print for "${o.title}". Please take a look and let us know if it’s good to go, or what you’d like changed.`,
        ev.note ? `Note: ${ev.note}` : null, 'You can see the preview and approve it here:'];
      button = ['Approve or request changes', link];
      if (p) attachment = { path: p.path, name: p.file_name || 'preview.png' };
      break;
    }
    case 'printing':
      subject = `Started printing — ${label}`;
      body = [`"${o.title}" is on the printer now. I’ll email you as soon as it’s finished.`];
      button = ['View status', link];
      break;
    case 'printed':
      subject = `Finished printing — choose a pickup time — ${label}`;
      body = [`"${o.title}" has finished printing! Please pick a time and a pickup spot (${config.LOCATIONS.join(' or ')}) that works for you.`];
      button = ['Schedule your pickup', link];
      break;
    case 'scheduled': {
      const [loc] = (ev.note || '').split(' · ');
      const when = o.pickup ? longTime(o.pickup.start) : '';
      subject = `Pickup booked: ${loc || o.pickup?.location}${when ? `, ${when}` : ''} — ${label}`;
      body = [`You’re all set to pick up "${o.title}" at ${loc || o.pickup?.location}${when ? ` on ${when}` : ''}.`, 'Need a different time? You can change it here:'];
      button = ['View or change your pickup', link];
      break;
    }
    case 'picked_up':
      subject = `Pickup confirmation — ${label}`;
      body = [`This confirms that "${o.title}" (#${o.number}) was handed over.`,
        o.handoff ? `Given by: ${o.handoff.adminName}\nReceived by: ${o.handoff.receivedBy}\nLocation: ${o.handoff.location}\nWhen: ${longTime(o.handoff.at)}` : null,
        'If anything looks wrong, just reply to this email.'];
      break;
    case 'cancelled':
      subject = `Request closed — ${label}`;
      body = [`I’ve closed your request "${o.title}" (#${o.number}).`, ev.note ? `Reason: ${ev.note}` : null, 'Reply to this email if you have any questions.'];
      break;
    default:
      return null;
  }
  const text = [`Hi ${o.teacherName},`, ...body.filter(Boolean), button ? `${button[0]}:\n${button[1]}` : null,
    signer ? `Thanks,\n${signer}` : `Thanks,\nThe ${config.SITE_NAME} team`].filter(Boolean).join('\n\n');
  const log = Array.isArray(ev.email_log) ? ev.email_log[0] : ev.email_log;
  return {
    eventId: ev.id, at: ev.created_at, to: o.email, teacherName: o.teacherName, subject, text, attachment,
    orderNumber: o.number, orderTitle: o.title, from: signer || config.SITE_NAME,
    status: log?.status || 'draft', sentBy: log?.by_name || null, sentAt: log?.created_at || null,
    mine: ev.by_admin ? ev.by_admin === me.id : (!o.handler || o.handler.id === me.id),
  };
}

const enc = encodeURIComponent;
const gmailUrl = (e) => `https://mail.google.com/mail/?authuser=${enc(me.email)}&view=cm&fs=1&to=${enc(e.to)}&su=${enc(e.subject)}&body=${enc(e.text)}`;
const mailtoUrl = (e) => `mailto:${enc(e.to)}?subject=${enc(e.subject)}&body=${enc(e.text)}`;
const MAIL_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';

function composer(email, { onChange, onDone } = {}) {
  const e = { ...email };
  let opened = false;
  const box = h('div');
  const mark = (status) => async (ev) => busy(ev.currentTarget, async () => {
    try {
      await rpc('admin_mark_email', { p_event: e.eventId, p_status: status });
      Object.assign(e, { status, sentBy: status === 'draft' ? null : me.name, sentAt: status === 'draft' ? null : new Date().toISOString() });
      toast(status === 'sent' ? 'Marked as sent' : status === 'skipped' ? 'Skipped' : 'Moved back to “To send”');
      refreshBadge(); onChange?.();
      if (status !== 'draft' && onDone) onDone(); else draw();
    } catch (err) { fail(err); }
  });
  const draw = () => {
    const editable = e.status === 'draft' && can('orders:write');
    fill(box,
      h('dl.kv', { style: { marginBottom: '14px' } },
        h('dt', 'To'), h('dd', e.to),
        h('dt', 'Subject'), h('dd', e.subject),
        h('dt', 'Request'), h('dd', `#${e.orderNumber} ${e.orderTitle}`)),
      h('div.mail-body', e.text),
      e.attachment && editable ? h('div.callout', { style: { margin: '14px 0 0', alignItems: 'center' } },
        h('span.ci', '📎'),
        h('div.small', { style: { flex: 1 } }, 'Gmail can’t attach files automatically. Download the preview and drag it into the email.'),
        h('a.btn.secondary.sm', { href: fileUrl(e.attachment.path, e.attachment.name) }, 'Download image')) : null,
      h('div', { style: { marginTop: '18px' } },
        !editable
          ? h('div.callout.green', h('span.ci', e.status === 'draft' ? '✉️' : '✓'), h('div.small',
              e.status === 'draft' ? 'Not sent yet.' : `${emailStatus(e.status)}${e.sentBy ? ` by ${e.sentBy}` : ''}${e.sentAt ? ` · ${fmtDate(e.sentAt)}` : ''}`,
              can('orders:write') && e.status !== 'draft' ? h('button.btn.plain.sm', { onclick: mark('draft') }, 'Undo') : null))
          : opened
            ? [h('div.callout.orange', { style: { marginBottom: '12px' } }, h('span.ci', '✉️'), h('div.small', 'Did you press Send in Gmail?')),
               h('div.btn-row',
                 h('button.btn.success', { onclick: mark('sent') }, 'Yes, it’s sent'),
                 h('a.btn.secondary', { href: gmailUrl(e), target: '_blank', rel: 'noopener' }, 'Open again'),
                 h('button.btn.plain', { onclick: () => { opened = false; draw(); } }, 'Not yet'))]
            : [h('div.btn-row',
                 h('a.btn', { href: gmailUrl(e), target: '_blank', rel: 'noopener', html: `${MAIL_ICON} Open in Gmail`, onclick: () => { opened = true; setTimeout(draw, 300); } }),
                 h('a.btn.secondary', { href: mailtoUrl(e), onclick: () => { opened = true; setTimeout(draw, 300); } }, 'Other mail app'),
                 h('button.btn.plain', { style: { marginLeft: 'auto' }, onclick: mark('skipped') }, 'Don’t send')),
               h('p.hint', `Opens a new email in ${me.email}’s Gmail with everything filled in — just press Send.`)],
      ),
    );
  };
  draw();
  return box;
}

function showDraft(e, onChange) {
  const m = modal(e.status === 'draft' ? `Email ready for ${e.teacherName}` : e.subject, h('div'));
  fill(m.body, composer(e, { onChange, onDone: () => m.close() }));
}

/** All teacher emails (newest first), with sent/skipped status. */
async function loadEmails() {
  const evs = await rows(sb.from('events')
    .select('*, email_log(*), request:requests(*, previews(*))')
    .in('status', EMAILABLE).order('id', { ascending: false }).limit(400));
  return evs.filter((ev) => ev.request).map((ev) => compose(ev, norm(ev.request))).filter(Boolean);
}

async function refreshBadge() {
  if (!me || !can('orders:read')) return;
  try {
    const mine = (await loadEmails()).filter((e) => e.status === 'draft' && e.mine).length;
    const link = $('[data-tab="emails"]');
    link.querySelector('.badge')?.remove();
    if (mine) link.append(h('span.badge', String(mine)));
  } catch { /* ignore */ }
}

let outboxTab = 'mine';
async function viewOutbox(root) {
  if (!can('orders:read')) { fill(root, head('Outbox'), noScope('orders:read')); return; }
  const all = await loadEmails();
  const drafts = all.filter((e) => e.status === 'draft');
  const tabs = {
    mine: { label: `For me (${drafts.filter((e) => e.mine).length})`, rows: drafts.filter((e) => e.mine) },
    all: { label: `Everyone’s (${drafts.length})`, rows: drafts },
    done: { label: 'Sent', rows: all.filter((e) => e.status !== 'draft') },
  };
  const list = tabs[outboxTab].rows;
  fill(root,
    head('Outbox', 'Updates for teachers, written and ready. Open each in Gmail and press Send.',
      h('div.segmented', Object.entries(tabs).map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(k === outboxTab), onclick: () => { outboxTab = k; viewOutbox(root); } }, t.label)))),
    list.length ? h('div.list', list.map((e) => h('button.list-row', { type: 'button', style: { gridTemplateColumns: '1fr auto' }, onclick: () => showDraft(e, () => viewOutbox(root)) },
      h('div', { style: { minWidth: 0 } }, h('div.ttl', e.subject), h('div.sub', `To ${e.to} · from ${e.from}`)),
      h('div', { style: { textAlign: 'right' } },
        e.status === 'draft' ? h('span.btn.sm', 'Send…') : h(`span.pill${e.status === 'sent' ? '.green' : ''}`, emailStatus(e.status)),
        h('div.when', { style: { marginTop: '4px' } }, ago(e.at))),
    ))) : h('div.list', h('div.empty', h('div.big', outboxTab === 'done' ? '✉️' : '✓'), h('p', { style: { margin: 0 } }, outboxTab === 'done' ? 'Nothing sent yet.' : 'All caught up — no emails waiting.'))),
  );
}

// ================= pickup schedule =================
async function viewSchedule(root) {
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
  const slots = await rows(sb.from('slots').select('*').gte('ends_at', weekAgo).order('starts_at'));
  const booked = {};
  if (can('orders:read')) {
    for (const r of await rows(sb.from('requests').select('pickup_slot').eq('status', 'scheduled'))) booked[r.pickup_slot] = (booked[r.pickup_slot] || 0) + 1;
  }
  const upcoming = slots.filter((s) => Date.parse(s.ends_at) > Date.now()).map((s) => ({ ...s, start: s.starts_at, end: s.ends_at, booked: booked[s.id] || 0 }));
  // Teachers only see one week at a time (Mon–Sun; on weekends, the coming week).
  const week = await rpc('booking_week');
  const inWeek = (iso) => Date.parse(iso) >= Date.parse(week.start) && Date.parse(iso) < Date.parse(week.end);
  const weekLabel = `${fmtDay(week.start)} – ${fmtDay(new Date(Date.parse(week.end) - 1).toISOString())}`;
  const editable = can('schedule:write');

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const f = {
    date: h('input.input', { type: 'date', value: iso(today), min: iso(today) }),
    from: h('input.input', { type: 'time', value: '15:00' }),
    to: h('input.input', { type: 'time', value: '16:00' }),
    split: h('select.input', [['0', 'One window'], ['15', 'Every 15 min'], ['20', 'Every 20 min'], ['30', 'Every 30 min'], ['60', 'Every hour']].map(([v, l]) => h('option', { value: v }, l))),
    repeat: h('select.input', [1, 2, 3, 4, 6, 8, 12].map((n) => h('option', { value: n }, n === 1 ? 'Just this day' : `Weekly for ${n} weeks`))),
    capacity: h('input.input', { type: 'number', min: 1, max: 500, value: 5 }),
  };
  const locs = config.LOCATIONS.map((l) => h('label.chip', h('input', { type: 'checkbox', value: l, checked: true }), l));
  const days = h('div.chips', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => h('label.chip', h('input', { type: 'checkbox', value: i }), d)));
  const daysWrap = h('label.field', { hidden: true }, h('span', 'On these days each week'), days);
  f.repeat.onchange = () => { daysWrap.hidden = f.repeat.value === '1'; };

  const build = () => {
    const out = [];
    const [fh, fm] = f.from.value.split(':').map(Number);
    const [th, tm] = f.to.value.split(':').map(Number);
    const weeks = Number(f.repeat.value);
    const pickedDays = [...days.querySelectorAll('input:checked')].map((i) => Number(i.value));
    const first = new Date(`${f.date.value}T00:00`);
    if (isNaN(first)) throw new Error('Pick a date.');
    const dates = [];
    if (weeks === 1 || !pickedDays.length) {
      for (let w = 0; w < weeks; w++) { const d = new Date(first); d.setDate(d.getDate() + 7 * w); dates.push(d); }
    } else {
      for (let i = 0; i < weeks * 7; i++) { const d = new Date(first); d.setDate(d.getDate() + i); if (pickedDays.includes(d.getDay())) dates.push(d); }
    }
    const step = Number(f.split.value);
    for (const d of dates) {
      const s = new Date(d); s.setHours(fh, fm, 0, 0);
      const e = new Date(d); e.setHours(th, tm, 0, 0);
      if (e <= s) throw new Error('End time needs to be after start time.');
      if (!step) out.push({ start: s.toISOString(), end: e.toISOString() });
      else for (let t = +s; t + step * 60e3 <= +e; t += step * 60e3) out.push({ start: new Date(t).toISOString(), end: new Date(t + step * 60e3).toISOString() });
    }
    return out;
  };

  const addBtn = h('button.btn.block', { onclick: (e) => busy(e.currentTarget, async () => {
    try {
      const locations = locs.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      const n = await rpc('admin_add_slots', { p_slots: build(), p_locations: locations, p_capacity: Number(f.capacity.value), p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      toast(`Added ${n} pickup time${n === 1 ? '' : 's'}`);
      viewSchedule(root);
    } catch (err) { fail(err); }
  }) }, 'Add pickup times');

  const form = h('div.card',
    h('div.h3', { style: { marginBottom: '16px' } }, 'Add pickup times'),
    h('label.field', h('span', 'Date'), f.date),
    h('div.row', h('label.field', h('span', 'From'), f.from), h('label.field', h('span', 'To'), f.to)),
    h('div.row', h('label.field', h('span', 'Split into'), f.split), h('label.field', h('span', 'Spots per time'), f.capacity)),
    h('label.field', h('span', 'Repeat'), f.repeat),
    daysWrap,
    h('label.field', h('span', 'Locations'), h('div.chips', locs)),
    addBtn,
  );

  const list = h('div.card',
    h('div.card-head', h('div.h3', 'Upcoming'), h('span.muted.small', `${upcoming.length} time${upcoming.length === 1 ? '' : 's'}`)),
    upcoming.length ? byDay(upcoming).map((day) => h('div.day',
      h('div.day-label', fmtDay(day[0].start), ' ', inWeek(day[0].start) ? h('span.pill.green', { style: { marginLeft: '6px' } }, 'Teachers can see') : h('span.tag', { style: { marginLeft: '6px' } }, 'Opens later')),
      h('div.list', { style: { boxShadow: 'none', background: 'var(--bg-sunken)' } }, day.map((s) => h('div.list-row.static',
        h('div', h('div.ttl', `${fmtTime(s.start)} – ${fmtTime(s.end)}`), h('div.sub', `${s.locations.join(' · ')} · ${s.booked}/${s.capacity} booked`)),
        editable ? h('button.btn.plain.sm', { style: { color: 'var(--red)' }, disabled: s.booked > 0, title: s.booked ? 'Booked — can’t remove' : '', onclick: (e) => busy(e.currentTarget, async () => {
          try { await rpc('admin_delete_slot', { p_id: s.id }); viewSchedule(root); } catch (err) { fail(err); }
        }) }, 'Remove') : null,
      ))),
    )) : h('div.empty', h('div.big', '🗓'), h('p', { style: { margin: 0 } }, 'No pickup times yet. Teachers can’t book until you add some.')),
  );

  fill(root,
    head('Pickup times', `Add as many weeks as you like — teachers only see one week at a time (${config.LOCATIONS.join(' or ')}).`),
    h('div.callout', { style: { marginBottom: '20px' } }, h('span.ci', '🗓'), h('div.small', h('b', 'Teachers can book now: '), weekLabel,
      '. Each Monday the next week opens automatically (on weekends, teachers already see the coming week).')),
    h('div.grid-2', editable ? form : noScope('schedule:write'), list),
  );
}

// ================= team =================
async function viewTeam(root) {
  const [admins, invites] = await Promise.all([
    rows(sb.from('admins').select('*').order('created_at')),
    rows(sb.from('admin_invites').select('*').order('created_at')),
  ]);
  const editable = can('team:write');
  const scopeChecks = (selected = []) => h('div.checks', Object.entries(SCOPES).map(([k, d]) =>
    h('label.check', h('input', { type: 'checkbox', value: k, checked: selected.includes(k) }), h('div', h('code', k), h('div.d', d)))));
  const picked = (el) => [...el.querySelectorAll('input:checked')].map((i) => i.value);

  // Fallback if email can't be sent: the owner can still create the login by hand.
  const usersPage = `https://supabase.com/dashboard/project/${new URL(config.SUPABASE_URL).hostname.split('.')[0]}/auth/users`;
  const emailFailed = (who, err) => h('div.callout.orange', { style: { marginBottom: '14px' } }, h('span.ci', '⚠️'), h('div.small',
    h('b', `Couldn’t email ${who}: `), err.message, ' ',
    'You can try again later from the Team list, or create their login in ', h('a', { href: usersPage, target: '_blank', rel: 'noopener' }, 'Supabase → Authentication → Users ↗'), '.'));
  // Not activated yet → send Supabase's invitation again. Already active → a password-reset email.
  const sendAgain = (email, name, activated) => async (e) => busy(e.currentTarget, async () => {
    try {
      if (activated) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
        if (error) throw new Error(authError(error));
        toast(`Password-reset email sent to ${email}`);
      } else {
        await inviteAdmin(email, { name, redirectTo: pageUrl() });
        toast(`Invitation sent to ${email}`);
      }
    } catch (err) { fail(err); }
  });

  const invite = () => {
    const name = h('input.input', { placeholder: 'Full name' });
    const email = h('input.input', { type: 'email', placeholder: 'Email' });
    const scopes = scopeChecks(['orders:read', 'orders:write', 'pickups:write']);
    const m = modal('Add admin', h('div',
      h('p.muted.small', { style: { marginTop: 0 } }, 'Supabase emails them an invitation. They click it, choose a password, and they’re in. Only people you add here can have an account.'),
      h('label.field', name), h('label.field', email),
      h('label.field', h('span', 'Permissions'), scopes),
      h('button.btn.block', { onclick: (e) => busy(e.currentTarget, async () => {
        const em = email.value.trim();
        const nm = name.value.trim();
        try {
          await rpc('admin_invite', { p_email: em, p_name: nm, p_scopes: picked(scopes) });
        } catch (err) { fail(err); return; }
        let sent = null;
        try { await inviteAdmin(em, { name: nm, redirectTo: pageUrl() }); sent = true; } catch (err) { sent = err; }
        fill(m.body,
          sent === true
            ? h('div.callout.green', { style: { marginBottom: '14px' } }, h('span.ci', '✉️'), h('div',
                h('b', `${nm} is invited.`), ` Supabase emailed ${em} an invitation. They click it, choose a password, and they’re in. If it expires, resend it from the Team list.`))
            : emailFailed(em, sent),
          h('div.btn-row', h('button.btn.secondary', { onclick: () => m.close() }, 'Done')));
        viewTeam(root);
      }) }, 'Add admin & send invitation'),
    ));
  };

  const edit = (a) => {
    const scopes = scopeChecks(a.scopes);
    const m = modal(a.name, h('div',
      h('p.muted.small', { style: { marginTop: 0 } }, a.email),
      h('label.field', h('span', 'Permissions'), scopes),
      h('div.btn-row',
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          try {
            await rpc('admin_set_scopes', { p_id: a.id, p_scopes: picked(scopes) });
            m.close(); toast('Saved');
            if (a.id === me.id) { me.scopes = picked(scopes); }
            viewTeam(root);
          } catch (err) { fail(err); }
        }) }, 'Save'),
        a.id !== me.id ? h('button.btn.secondary', { title: 'If they haven’t accepted their invitation yet', onclick: sendAgain(a.email, a.name, false) }, 'Resend invitation') : null,
        a.id !== me.id ? h('button.btn.secondary', { title: 'If they forgot their password', onclick: sendAgain(a.email, a.name, true) }, 'Send password reset') : null,
        a.id !== me.id ? h('button.btn.danger', { onclick: (e) => busy(e.currentTarget, async () => {
          if (!confirm(`Remove ${a.name}? They lose admin access immediately.`)) return;
          try { await rpc('admin_remove', { p_id: a.id }); m.close(); toast('Removed'); viewTeam(root); } catch (err) { fail(err); }
        }) }, 'Remove admin') : null,
      ),
    ));
  };

  const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (n, faded) => h('div', { style: { width: '36px', height: '36px', borderRadius: '50%', background: faded ? 'var(--fill-strong)' : 'linear-gradient(135deg,#0a84ff,#bf5af2)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: '14px' } }, initials(n));
  const scopeTags = (sc) => h('div.chips', { style: { justifyContent: 'flex-end' } }, sc.length === Object.keys(SCOPES).length ? h('span.tag', 'Full access') : sc.map((s) => h('span.tag', s)));

  fill(root,
    head('Team', 'People who can use this admin page. Each has their own permissions.', editable ? h('button.btn.sm', { onclick: invite }, '+ Add admin') : null),
    h('div.list', admins.map((a) => h(`${editable ? 'button' : 'div'}.list-row${editable ? '' : '.static'}`, { type: 'button', style: { gridTemplateColumns: '44px 1fr auto' }, onclick: editable ? () => edit(a) : null },
      avatar(a.name),
      h('div', { style: { minWidth: 0 } }, h('div.ttl', a.name, a.id === me.id ? h('span.muted', ' (you)') : null), h('div.sub', a.email)),
      scopeTags(a.scopes),
    ))),
    invites.length ? [
      h('div.h3', { style: { margin: '28px 0 10px' } }, 'Invitation not sent yet'),
      h('div.list', invites.map((i) => h('div.list-row.static', { style: { gridTemplateColumns: '44px 1fr auto auto auto' } },
        avatar(i.name, true),
        h('div', { style: { minWidth: 0 } }, h('div.ttl', i.name), h('div.sub', `${i.email} · added, but the invitation email didn’t go out`)),
        scopeTags(i.scopes),
        editable ? h('button.btn.plain.sm', { onclick: sendAgain(i.email, i.name, false) }, 'Send invitation') : null,
        editable ? h('button.btn.plain.sm', { style: { color: 'var(--red)' }, onclick: (e) => busy(e.currentTarget, async () => {
          try { await rpc('admin_cancel_invite', { p_email: i.email }); viewTeam(root); } catch (err) { fail(err); }
        }) }, 'Cancel') : null,
      ))),
    ] : null,
  );
}

// ================= account =================
async function viewAccount(root) {
  const next = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (10+ characters)' });
  fill(root,
    head(me.name, me.email, h('button.btn.secondary.sm', { onclick: () => sb.auth.signOut() }, 'Sign out')),
    h('div.grid-2',
      h('div.card',
        h('div.h3', { style: { marginBottom: '10px' } }, 'Your permissions'),
        h('div.checks', Object.entries(SCOPES).map(([k, d]) => h('div.check', { style: { cursor: 'default', opacity: me.scopes.includes(k) ? 1 : 0.45 } },
          h('span', { style: { width: '18px' } }, me.scopes.includes(k) ? '✓' : '–'), h('div', h('code', k), h('div.d', d))))),
      ),
      h('div.card',
        h('div.h3', { style: { marginBottom: '14px' } }, 'Change password'),
        h('label.field', next),
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          if (next.value.length < 10) return fail(new Error('Use at least 10 characters.'));
          const { error } = await sb.auth.updateUser({ password: next.value });
          if (error) return fail(new Error(authError(error)));
          next.value = '';
          toast('Password changed');
        }) }, 'Update password'),
      ),
    ),
  );
}

start();
