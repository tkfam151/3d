import { $, h, fill, api, upload, busy, toast, pill, ago, fmtDate, fmtDay, fmtTime, fmtSize, byDay, STATUS, LOGO } from './common.js';

$('#brand').insertAdjacentHTML('afterbegin', LOGO);
const app = $('#app');
const KEY = 'pd_admin_token';
let token = null;
let me = null; // { admin, token, allScopes, locations, emailMode }
try { token = sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { /* storage blocked */ }

const can = (scope) => me?.token.scopes.includes(scope);
const call = (url, opts = {}) => api(url, { ...opts, token }).catch((err) => {
  if (err.status === 401) signOut(true);
  throw err;
});
const fail = (err) => toast(err.message, { error: true });

function saveToken(t, remember) {
  token = t;
  try {
    sessionStorage.removeItem(KEY); localStorage.removeItem(KEY);
    (remember ? localStorage : sessionStorage).setItem(KEY, t);
  } catch { /* ignore */ }
}
function signOut(expired) {
  if (!expired && token) api('/api/admin/logout', { method: 'POST', token }).catch(() => {});
  token = null; me = null;
  try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ }
  $('#tabs').hidden = true;
  showLogin(expired ? 'Your session ended. Please sign in again.' : null);
}

// ================= sign in =================
async function start() {
  if (token) {
    try { me = await api('/api/admin/me', { token }); return enter(); } catch { saveToken(null); }
  }
  const { needsSetup } = await api('/api/admin/setup').catch(() => ({ needsSetup: false }));
  needsSetup ? showSetup() : showLogin();
}

function authShell(title, sub, form) {
  fill(app, h('div.auth-wrap', h('div.auth-card',
    h('div.lock', { html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' }),
    h('h1.h2', title),
    h('p.muted', { style: { margin: 0 } }, sub),
    form,
  )));
}

function showLogin(message) {
  let mode = 'password';
  const err = h('div.form-error', { hidden: !message }, message || '');
  const email = h('input.input', { name: 'email', type: 'email', autocomplete: 'username', placeholder: 'Email', required: true });
  const password = h('input.input', { name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
  const tokenIn = h('input.input', { name: 'token', autocomplete: 'off', placeholder: 'pd_pat_…', spellcheck: false });
  const remember = h('input', { type: 'checkbox' });
  const pwFields = h('div', h('label.field', email), h('label.field', password));
  const tokFields = h('div', { hidden: true }, h('label.field', h('span', 'Access token'), tokenIn), h('p.hint', { style: { marginTop: '-8px', marginBottom: '14px' } }, 'Fine-grained tokens are created under Tokens after a password sign-in.'));
  const submit = h('button.btn.block', { type: 'submit' }, 'Sign in');
  const toggle = h('button.btn.plain.sm', { type: 'button', style: { margin: '14px auto 0', display: 'flex' } }, 'Use an access token instead');
  toggle.onclick = () => {
    mode = mode === 'password' ? 'token' : 'password';
    pwFields.hidden = mode !== 'password'; tokFields.hidden = mode !== 'token';
    toggle.textContent = mode === 'password' ? 'Use an access token instead' : 'Use email and password';
  };
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault(); err.hidden = true;
    busy(submit, async () => {
      try {
        if (mode === 'password') {
          const r = await api('/api/admin/login', { method: 'POST', body: { email: email.value, password: password.value } });
          saveToken(r.token, remember.checked);
        } else {
          saveToken(tokenIn.value.trim(), remember.checked);
        }
        me = await api('/api/admin/me', { token });
        enter();
      } catch (e2) { saveToken(null); err.textContent = e2.message; err.hidden = false; }
    });
  } }, pwFields, tokFields, err,
    h('label.check', { style: { background: 'none', padding: '0 4px 16px' } }, remember, h('span.small', 'Keep me signed in on this device')),
    submit, toggle);
  authShell('Admin sign in', 'Print Desk staff only.', form);
  setTimeout(() => email.focus(), 50);
}

function showSetup() {
  const err = h('div.form-error', { hidden: true });
  const f = {
    name: h('input.input', { placeholder: 'Your name', autocomplete: 'name' }),
    email: h('input.input', { type: 'email', placeholder: 'Email', autocomplete: 'username' }),
    password: h('input.input', { type: 'password', placeholder: 'Password (10+ characters)', autocomplete: 'new-password' }),
    setupCode: h('input.input', { placeholder: 'Setup code (if your server has one)', autocomplete: 'off' }),
  };
  const submit = h('button.btn.block', { type: 'submit' }, 'Create admin account');
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault(); err.hidden = true;
    busy(submit, async () => {
      try {
        const r = await api('/api/admin/setup', { method: 'POST', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) });
        saveToken(r.token);
        me = await api('/api/admin/me', { token });
        enter();
        toast('Welcome! You’re the first admin.');
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    });
  } }, ...Object.values(f).map((i) => h('label.field', i)), err, submit);
  authShell('Set up Print Desk', 'Create the first admin account. You can add more people later.', form);
}

// ================= shell =================
const views = { requests: viewRequests, schedule: viewSchedule, team: viewTeam, tokens: viewTokens, emails: viewEmails, account: viewAccount };

function enter() {
  $('#tabs').hidden = false;
  $('#me-link').textContent = me.admin.name.split(' ')[0];
  route();
}
function route() {
  if (!me) return;
  document.querySelectorAll('.scrim').forEach((el) => el.remove());
  const tab = location.hash.slice(1) || 'requests';
  refreshBadge();
  const view = views[tab] || viewRequests;
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  fill(app, h('div.wrap', { style: { paddingBottom: '60px' } }, h('div.empty', h('span.spinner'))));
  view(app.firstChild).catch((err) => fill(app.firstChild, h('div.empty', h('div.big', '🔒'), h('p', err.message))));
}
addEventListener('hashchange', route);

const head = (title, sub, ...right) => h('div.admin-head', h('div', h('h1.h2', title), sub ? h('p.muted', { style: { margin: '4px 0 0' } }, sub) : null), h('div.btn-row', right));
const noScope = (scope) => h('div.callout.orange', h('span.ci', '🔒'), h('div', `Your sign-in doesn’t include the `, h('code', scope), ` permission.`));

function modal(title, body, { side = false } = {}) {
  const close = () => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 250); removeEventListener('keydown', esc); };
  const esc = (e) => e.key === 'Escape' && close();
  const scrim = h(`div.scrim${side ? '' : '.modal-center'}`, { onclick: (e) => e.target === scrim && close() },
    h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('div.grow', title), h('button.icon-btn', { onclick: () => close(), 'aria-label': 'Close' }, '✕')),
      h('div.sheet-body', body)));
  document.body.append(scrim);
  addEventListener('keydown', esc);
  requestAnimationFrame(() => scrim.classList.add('show'));
  return { close, body: scrim.querySelector('.sheet-body'), setTitle: (t) => { scrim.querySelector('.sheet-head .grow').textContent = t; } };
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
  const orders = await call('/api/admin/orders');
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, orders.filter((o) => f.match.includes(o.status)).length]));
  const listEl = h('div');
  const search = h('input.input', { type: 'search', placeholder: 'Search name, title, email, #number', value: query, oninput: (e) => { query = e.target.value; draw(); } });
  const allSeg = h('div.segmented', ['active', 'all'].map((k) => h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; viewRequests(root); } }, k === 'active' ? 'All open' : 'Everything')));

  function draw() {
    const q = query.trim().toLowerCase();
    let rows = orders;
    if (FILTERS[filter]) rows = rows.filter((o) => FILTERS[filter].match.includes(o.status));
    else if (filter === 'active') rows = rows.filter((o) => !['picked_up', 'cancelled'].includes(o.status));
    if (q) rows = rows.filter((o) => [o.title, o.teacherName, o.email, `#${o.number}`, o.file?.original].join(' ').toLowerCase().includes(q));
    if (!rows.length) { fill(listEl, h('div.list', h('div.empty', h('div.big', '✓'), h('p', { style: { margin: 0 } }, q ? 'No matches.' : 'Nothing here — all caught up.')))); return; }
    fill(listEl, h('div.list', rows.map((o) => h('button.list-row', { type: 'button', onclick: () => openOrder(o.id, () => viewRequests(root)) },
      h('div.num', `#${o.number}`),
      h('div', { style: { minWidth: 0 } },
        h('div.ttl', o.title),
        h('div.sub', `${o.teacherName} · `, o.type === 'file' ? `${o.file.original.split('.').pop().toUpperCase()} file` : 'Idea',
          o.pickup && o.status === 'scheduled' ? ` · ${o.pickup.location} ${fmtDate(o.pickup.start)}` : ''),
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

async function openOrder(id, onChange) {
  const m = modal('Request', h('div.empty', h('span.spinner')), { side: true });
  const refresh = async () => {
    const o = await call(`/api/admin/orders/${id}`);
    m.setTitle(`#${o.number} · ${o.title}`);
    fill(m.body, orderDetail(o, async () => { await refresh(); onChange?.(); }));
  };
  refresh().catch((e) => { fail(e); m.close(); });
}

function orderDetail(o, refresh) {
  const out = [];
  const act = (fn) => async (e) => busy(e.currentTarget, async () => {
    try { const r = await fn(); await refresh(); if (r?.draft) showDraft(r.draft, refresh); } catch (err) { fail(err); }
  });

  // --- header ---
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
      h('dt', 'Handled by'), h('dd', o.handler ? (o.handler.id === me.admin.id ? `${o.handler.name} (you)` : o.handler.name) : 'Nobody yet'),
    ),
    h('div.btn-row', { style: { marginTop: '16px', justifyContent: 'space-between' } },
      h('a.btn.plain.sm', { href: `/track/${o.trackToken}`, target: '_blank', rel: 'noopener' }, 'Open teacher’s page ↗'),
      can('orders:write') && o.handler?.id !== me.admin.id && !['picked_up', 'cancelled'].includes(o.status)
        ? h('button.btn.secondary.sm', { title: 'Teacher emails for this request will be drafted for you to send', onclick: act(() => call(`/api/admin/orders/${o.id}/claim`, { method: 'POST' }).then(() => toast('You’re handling this request'))) }, 'I’ll handle this')
        : null),
  ));

  // --- next action ---
  out.push(nextAction(o, act, refresh));

  // --- content ---
  if (o.file) {
    const viewer = h('div');
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '14px' } }, 'Model'),
      viewer,
      h('div.file-chip',
        h('div.ext', o.file.original.split('.').pop().toUpperCase()),
        h('div.grow', h('div.name', o.file.original), h('div.muted.small', fmtSize(o.file.size))),
        h('button.btn.sm', { onclick: () => download(`/api/admin/orders/${o.id}/file?download=1`, o.file.original) }, 'Download'),
      )));
    const buf = fetch(`/api/admin/orders/${o.id}/file`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.arrayBuffer());
    import('./viewer.js').then(({ mountViewer }) => mountViewer(viewer, buf, o.file.original));
  }
  if (o.description) {
    out.push(h('div.card', { style: { marginBottom: '16px' } }, h('div.h3', { style: { marginBottom: '10px' } }, 'What they want'), h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, o.description)));
  }
  if (o.previews.length) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '10px' } }, 'Previews sent'),
      [...o.previews].reverse().map((p) => h('div', { style: { marginBottom: '14px' } },
        authedImg(`/api/admin/orders/${o.id}/preview/${p.id}`),
        h('div.muted.small', `${fmtDate(p.at)}${p.note ? ` — “${p.note}”` : ''}`))),
      o.feedback ? h('div.callout.orange', h('span.ci', '✎'), h('div', h('b', 'Teacher asked for: '), o.feedback)) : null,
    ));
  }
  if (o.handoff) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.card-head', h('div.h3', 'Hand-off'), h('span.pill.green', 'Done')),
      h('dl.kv', h('dt', 'Given by'), h('dd', o.handoff.adminName), h('dt', 'Received by'), h('dd', o.handoff.receivedBy), h('dt', 'Location'), h('dd', o.handoff.location), h('dt', 'When'), h('dd', fmtDate(o.handoff.at)))));
  }

  // --- emails + history ---
  out.push(h('div.card', { style: { marginBottom: '16px' } },
    h('div.h3', { style: { marginBottom: '14px' } }, 'Activity'),
    h('ul.timeline', [...o.history].reverse().map((e) => h('li', h('div.tdot'), h('div',
      h('div.t-title', STATUS[e.status]?.label || e.status, e.by ? h('span.muted', ` · ${e.by}`) : null),
      e.note ? h('div.t-sub', e.note) : null,
      h('div.t-sub', fmtDate(e.at))))))));
  if (o.emails?.length) {
    out.push(h('div.card', { style: { marginBottom: '16px' } },
      h('div.h3', { style: { marginBottom: '10px' } }, 'Emails to teacher'),
      o.emails.map((e) => h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--hairline)' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.small', e.subject),
          h('div.tiny.muted', `${fmtDate(e.at)} · from ${e.from}`, e.sentBy ? ` · ${e.status} by ${e.sentBy}` : '')),
        e.status === 'draft'
          ? h('button.btn.sm', { onclick: () => showDraft(e, refresh) }, 'Send…')
          : h('button.btn.plain.sm', { onclick: () => showDraft(e, refresh) }, emailStatus(e.status)))),
    ));
  }

  if (can('orders:write') && !['picked_up', 'cancelled'].includes(o.status)) {
    const reason = h('input.input', { placeholder: 'Reason (optional, emailed to the teacher)' });
    const box = h('div', { hidden: true, style: { marginTop: '12px' } }, reason,
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn.danger.sm', { onclick: act(() => call(`/api/admin/orders/${o.id}/cancel`, { method: 'POST', body: { reason: reason.value } })) }, 'Close request'),
      ));
    out.push(h('div', { style: { textAlign: 'center', padding: '6px 0 20px' } },
      h('button.btn.plain.sm', { style: { color: 'var(--red)' }, onclick: (e) => { e.currentTarget.hidden = true; box.hidden = false; } }, 'Close this request…'), box));
  }
  return out;
}

function emailStatus(s) {
  return { draft: 'To send', sent: 'Sent', skipped: 'Skipped', failed: 'Failed', sending: 'Sending…' }[s] || s;
}

// ================= email drafts =================
// In draft mode every teacher update is a ready-made email. "Open in Gmail"
// opens a pre-filled compose window in the admin's own Gmail; they press Send.
const enc = encodeURIComponent;
const gmailUrl = (e) => `https://mail.google.com/mail/?authuser=${enc(me.admin.email)}&view=cm&fs=1&to=${enc(e.to)}&su=${enc(e.subject)}&body=${enc(e.text)}`;
const mailtoUrl = (e) => `mailto:${enc(e.to)}?subject=${enc(e.subject)}&body=${enc(e.text)}`;
const GMAIL_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';

function composer(email, { onChange, onDone } = {}) {
  let e = email;
  let opened = false;
  const box = h('div');
  const mark = (status) => async (ev) => busy(ev.currentTarget, async () => {
    try {
      e = await call(`/api/admin/emails/${e.id}`, { method: 'PATCH', body: { status } });
      toast(status === 'sent' ? 'Marked as sent' : status === 'skipped' ? 'Skipped' : 'Moved back to “To send”');
      refreshBadge(); onChange?.(e);
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
        h('button.btn.secondary.sm', { onclick: () => download(`/api/admin/orders/${e.orderId}/preview/${e.attachment.previewId}`, e.attachment.filename) }, 'Download image')) : null,
      h('div', { style: { marginTop: '18px' } },
        !editable
          ? h('div.callout.green', h('span.ci', '✓'), h('div.small', `${emailStatus(e.status)}${e.sentBy ? ` by ${e.sentBy}` : ''}${e.sentAt ? ` · ${fmtDate(e.sentAt)}` : ''}`,
              can('orders:write') && e.status !== 'sending' ? h('button.btn.plain.sm', { onclick: mark('draft') }, 'Undo') : null))
          : opened
            ? [h('div.callout.orange', { style: { marginBottom: '12px' } }, h('span.ci', '✉️'), h('div.small', 'Did you press Send in Gmail?')),
               h('div.btn-row',
                 h('button.btn.success', { onclick: mark('sent') }, 'Yes, it’s sent'),
                 h('a.btn.secondary', { href: gmailUrl(e), target: '_blank', rel: 'noopener' }, 'Open again'),
                 h('button.btn.plain', { onclick: () => { opened = false; draw(); } }, 'Not yet'))]
            : [h('div.btn-row',
                 h('a.btn', { href: gmailUrl(e), target: '_blank', rel: 'noopener', html: `${GMAIL_ICON} Open in Gmail`, onclick: () => { opened = true; setTimeout(draw, 300); } }),
                 h('a.btn.secondary', { href: mailtoUrl(e), onclick: () => { opened = true; setTimeout(draw, 300); } }, 'Other mail app'),
                 h('button.btn.plain', { style: { marginLeft: 'auto' }, onclick: mark('skipped') }, 'Don’t send')),
               h('p.hint', `Opens a new email in ${me.admin.email}’s Gmail with everything filled in — just press Send.`)],
      ),
    );
  };
  draw();
  return box;
}

function showDraft(e, onChange) {
  const m = modal(e.status === 'draft' ? `Email ready for ${e.teacherName || e.to}` : e.subject, h('div'));
  fill(m.body, composer(e, { onChange, onDone: () => m.close() }));
}

async function refreshBadge() {
  if (!me || !can('orders:read')) return;
  try {
    const c = await call('/api/admin/emails/count');
    const link = $('[data-tab="emails"]');
    link.querySelector('.badge')?.remove();
    if (c.mine) link.append(h('span.badge', String(c.mine)));
  } catch { /* ignore */ }
}

function nextAction(o, act, refresh) {
  const card = h('div.card', { style: { marginBottom: '16px', boxShadow: '0 0 0 2px var(--accent-soft), var(--shadow)' } });
  const title = (t, s) => h('div', { style: { marginBottom: '14px' } }, h('div.h3', t), s ? h('div.muted.small', s) : null);
  const setStatus = (status) => act(() => call(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: { status } }));

  const previewForm = (primary) => {
    const file = h('input', { type: 'file', accept: 'image/*', style: { fontSize: '14px' } });
    const note = h('input.input', { placeholder: 'Note for the teacher (optional)', style: { margin: '10px 0' } });
    const send = h(`button.btn${primary ? '' : '.secondary'}.sm`, { onclick: (e) => busy(e.currentTarget, async () => {
      if (!file.files[0]) return toast('Choose an image first.', { error: true });
      const fd = new FormData(); fd.append('image', file.files[0]); fd.append('note', note.value);
      try { const r = await upload(`/api/admin/orders/${o.id}/preview`, fd, { token }); toast('Preview saved'); await refresh(); if (r.draft) showDraft(r.draft, refresh); } catch (err) { fail(err); }
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
        card.append(title('Ready to print?', 'The teacher gets an email as soon as you start.'),
          h('div.btn-row', h('button.btn', { onclick: setStatus('printing') }, 'Started printing')),
          h('details', { style: { marginTop: '16px' } }, h('summary.small.muted', { style: { cursor: 'pointer' } }, 'Send a preview image first (optional)'), h('div', { style: { marginTop: '12px' } }, previewForm(false))));
      }
      break;
    case 'awaiting_approval':
      card.append(title('Waiting on the teacher', 'They’ve been emailed the preview. You’ll see it here once they respond.'));
      if (o.type === 'file') card.append(h('button.btn.secondary.sm', { onclick: setStatus('printing') }, 'Start printing anyway'));
      card.append(h('details', { style: { marginTop: '14px' } }, h('summary.small.muted', { style: { cursor: 'pointer' } }, 'Send a different preview'), h('div', { style: { marginTop: '12px' } }, previewForm(false))));
      break;
    case 'approved':
      card.append(title('Approved — ready to print', 'The teacher gets an email as soon as you start.'), h('button.btn', { onclick: setStatus('printing') }, 'Started printing'));
      break;
    case 'printing':
      card.append(title('Printing', 'When it’s done, the teacher is emailed a link to book a pickup time.'), h('button.btn.success', { onclick: setStatus('printed') }, 'Finished printing'));
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
        h('div.callout', { style: { marginBottom: '14px' } }, h('span.ci', '✉️'), h('div.small', me.emailMode === 'smtp' ? `A confirmation email goes to ${o.email} in your name (${me.admin.name}). Replies come back to ${me.admin.email}.` : `Next you’ll get a confirmation email for ${o.email}, ready to send from your Gmail.`)),
        h('button.btn.success', { onclick: act(() => {
          if (!location.value.trim() || !receivedBy.value.trim()) throw new Error('Fill in the location and who received it.');
          return call(`/api/admin/orders/${o.id}/handoff`, { method: 'POST', body: { location: location.value, receivedBy: receivedBy.value } }).then((r) => { toast('Hand-off recorded'); return r; });
        }) }, 'Confirm hand-off'),
      );
      break;
    }
    default:
      return null;
  }
  return card;
}

function authedImg(url) {
  const img = h('img.preview-img', { alt: 'Preview' });
  fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.blob()).then((b) => { img.src = URL.createObjectURL(b); }).catch(() => {});
  return img;
}
async function download(url, name) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('Download failed.');
    const a = h('a', { href: URL.createObjectURL(await r.blob()), download: name });
    document.body.append(a); a.click(); a.remove();
  } catch (err) { fail(err); }
}

// ================= pickup schedule =================
async function viewSchedule(root) {
  const slots = await call('/api/admin/slots');
  const upcoming = slots.filter((s) => Date.parse(s.end) > Date.now());
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
  const locs = me.locations.map((l) => h('label.chip', h('input', { type: 'checkbox', value: l, checked: true }), l));
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
      const list = build();
      const locations = locs.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      const created = await call('/api/admin/slots', { method: 'POST', body: { slots: list, locations, capacity: Number(f.capacity.value) } });
      toast(`Added ${created.length} pickup time${created.length === 1 ? '' : 's'}`);
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
      h('div.day-label', fmtDay(day[0].start)),
      h('div.list', { style: { boxShadow: 'none', background: 'var(--bg-sunken)' } }, day.map((s) => h('div.list-row.static',
        h('div', h('div.ttl', `${fmtTime(s.start)} – ${fmtTime(s.end)}`), h('div.sub', `${s.locations.join(' · ')} · ${s.booked}/${s.capacity} booked`)),
        editable ? h('button.btn.plain.sm', { style: { color: 'var(--red)' }, disabled: s.booked > 0, title: s.booked ? 'Booked — can’t remove' : '', onclick: (e) => busy(e.currentTarget, async () => {
          try { await call(`/api/admin/slots/${s.id}`, { method: 'DELETE' }); viewSchedule(root); } catch (err) { fail(err); }
        }) }, 'Remove') : null,
      ))),
    )) : h('div.empty', h('div.big', '🗓'), h('p', { style: { margin: 0 } }, 'No pickup times yet. Teachers can’t book until you add some.')),
  );

  fill(root, 
    head('Pickup times', `Teachers choose from these when their print is ready (${me.locations.join(' or ')}).`),
    h('div.grid-2', editable ? form : noScope('schedule:write'), list),
  );
}

// ================= team =================
async function viewTeam(root) {
  const admins = await call('/api/admin/admins');
  const editable = can('team:write');
  const scopeChecks = (selected = []) => h('div.checks', Object.entries(me.allScopes).map(([k, d]) =>
    h('label.check', h('input', { type: 'checkbox', value: k, checked: selected.includes(k) }), h('div', h('code', k), h('div.d', d)))));
  const picked = (el) => [...el.querySelectorAll('input:checked')].map((i) => i.value);

  const addAdmin = () => {
    const f = {
      name: h('input.input', { placeholder: 'Full name' }),
      email: h('input.input', { type: 'email', placeholder: 'Email' }),
      password: h('input.input', { type: 'text', placeholder: 'Temporary password (10+ characters)', autocomplete: 'off' }),
    };
    const scopes = scopeChecks(['orders:read', 'orders:write', 'pickups:write']);
    const m = modal('Add admin', h('div',
      ...Object.values(f).map((i) => h('label.field', i)),
      h('label.field', h('span', 'Permissions'), scopes),
      h('p.hint', { style: { marginBottom: '16px' } }, 'Share the temporary password with them privately. They can change it under Account.'),
      h('button.btn.block', { onclick: (e) => busy(e.currentTarget, async () => {
        try {
          await call('/api/admin/admins', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value, scopes: picked(scopes) } });
          m.close(); toast('Admin added'); viewTeam(root);
        } catch (err) { fail(err); }
      }) }, 'Add admin'),
    ));
  };

  const edit = (a) => {
    const scopes = scopeChecks(a.scopes);
    const m = modal(a.name, h('div',
      h('p.muted.small', { style: { marginTop: 0 } }, a.email),
      h('label.field', h('span', 'Permissions'), scopes),
      h('div.btn-row',
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          try { await call(`/api/admin/admins/${a.id}`, { method: 'PATCH', body: { scopes: picked(scopes) } }); m.close(); toast('Saved'); viewTeam(root); } catch (err) { fail(err); }
        }) }, 'Save'),
        a.id !== me.admin.id ? h('button.btn.danger', { onclick: (e) => busy(e.currentTarget, async () => {
          if (!confirm(`Remove ${a.name}? Their tokens stop working immediately.`)) return;
          try { await call(`/api/admin/admins/${a.id}`, { method: 'DELETE' }); m.close(); toast('Removed'); viewTeam(root); } catch (err) { fail(err); }
        }) }, 'Remove admin') : null,
      ),
    ));
  };

  fill(root, 
    head('Team', 'People who can sign in to this admin. Each has their own permissions.', editable ? h('button.btn.sm', { onclick: addAdmin }, '+ Add admin') : null),
    h('div.list', admins.map((a) => h(`${editable ? 'button' : 'div'}.list-row${editable ? '' : '.static'}`, { type: 'button', style: { gridTemplateColumns: '44px 1fr auto' }, onclick: editable ? () => edit(a) : null },
      h('div', { style: { width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,#0a84ff,#bf5af2)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: '14px' } }, a.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()),
      h('div', { style: { minWidth: 0 } }, h('div.ttl', a.name, a.id === me.admin.id ? h('span.muted', ' (you)') : null), h('div.sub', a.email)),
      h('div.chips', { style: { justifyContent: 'flex-end' } }, a.scopes.length === Object.keys(me.allScopes).length ? h('span.tag', 'Full access') : a.scopes.map((s) => h('span.tag', s))),
    ))),
  );
}

// ================= tokens =================
async function viewTokens(root) {
  const tokens = await call('/api/admin/tokens');
  const isSession = me.token.kind === 'session';

  const create = () => {
    const name = h('input.input', { placeholder: 'e.g. Print room iPad', maxLength: 60 });
    const days = h('select.input', [[7, '7 days'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [365, '1 year']].map(([v, l]) => h('option', { value: v, selected: v === 30 }, l)));
    const scopes = h('div.checks', me.admin.scopes.map((k) => h('label.check', h('input', { type: 'checkbox', value: k }), h('div', h('code', k), h('div.d', me.allScopes[k])))));
    const m = modal('New fine-grained token', h('div',
      h('p.muted.small', { style: { marginTop: 0 } }, 'Give a device or script only the permissions it needs. You can revoke it any time.'),
      h('label.field', h('span', 'Name'), name),
      h('label.field', h('span', 'Expiration'), days),
      h('label.field', h('span', 'Permissions'), scopes),
      h('button.btn.block', { onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const r = await call('/api/admin/tokens', { method: 'POST', body: { name: name.value, days: Number(days.value), scopes: [...scopes.querySelectorAll('input:checked')].map((i) => i.value) } });
          fill(m.body, 
            h('div.callout.green', { style: { marginBottom: '14px' } }, h('span.ci', '✓'), h('div', 'Copy your token now. You won’t be able to see it again.')),
            h('div.token-box', r.token),
            h('div.btn-row', { style: { marginTop: '14px' } },
              h('button.btn', { onclick: () => navigator.clipboard.writeText(r.token).then(() => toast('Copied')) }, 'Copy'),
              h('button.btn.secondary', { onclick: () => m.close() }, 'Done')),
          );
          viewTokens(root);
        } catch (err) { fail(err); }
      }) }, 'Generate token'),
    ));
  };

  fill(root, 
    head('Access tokens', 'Fine-grained tokens let admins sign in with only the permissions they need.',
      isSession ? h('button.btn.sm', { onclick: create }, 'Generate new token') : null),
    isSession ? null : h('div.callout.orange', { style: { marginBottom: '16px' } }, h('span.ci', '🔒'), h('div', 'You’re signed in with a token. Sign in with your password to create new tokens.')),
    h('div.list', tokens.map((t) => h('div.list-row.static',
      h('div', { style: { minWidth: 0 } },
        h('div.ttl', t.name, t.current ? h('span.pill.green', { style: { marginLeft: '8px' } }, 'This device') : null, h('span.tag', { style: { marginLeft: '8px' } }, t.kind === 'session' ? 'Password sign-in' : 'Personal token')),
        h('div.sub', `${t.scopes.join(', ') || 'no permissions'}`),
        h('div.sub', `Expires ${fmtDate(t.expiresAt)} · ${t.lastUsedAt ? `last used ${ago(t.lastUsedAt)}` : 'never used'}`),
      ),
      h('button.btn.plain.sm', { style: { color: 'var(--red)' }, onclick: (e) => busy(e.currentTarget, async () => {
        if (!confirm(t.current ? 'Revoke this token? You’ll be signed out.' : `Revoke “${t.name}”?`)) return;
        try { await call(`/api/admin/tokens/${t.id}`, { method: 'DELETE' }); if (t.current) signOut(true); else { toast('Revoked'); viewTokens(root); } } catch (err) { fail(err); }
      }) }, 'Revoke'),
    ))),
  );
}

// ================= outbox =================
let outboxTab = 'mine';
async function viewEmails(root) {
  if (!can('orders:read')) { fill(root, head('Outbox'), noScope('orders:read')); return; }
  const all = await call('/api/admin/emails');
  const drafts = all.filter((e) => e.status === 'draft');
  const tabs = {
    mine: { label: `For me (${drafts.filter((e) => e.mine).length})`, rows: drafts.filter((e) => e.mine) },
    all: { label: `Everyone’s (${drafts.length})`, rows: drafts },
    done: { label: 'Sent', rows: all.filter((e) => e.status !== 'draft') },
  };
  const sub = me.emailMode === 'smtp'
    ? 'Emails are sent automatically. This is the record of everything sent to teachers.'
    : 'Updates for teachers, written and ready. Open each in Gmail and press Send.';
  const rows = tabs[outboxTab].rows;
  fill(root,
    head('Outbox', sub, h('div.segmented', Object.entries(tabs).map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(k === outboxTab), onclick: () => { outboxTab = k; viewEmails(root); } }, t.label)))),
    rows.length ? h('div.list', rows.map((e) => h('button.list-row', { type: 'button', style: { gridTemplateColumns: '1fr auto' }, onclick: () => showDraft(e, () => viewEmails(root)) },
      h('div', { style: { minWidth: 0 } }, h('div.ttl', e.subject), h('div.sub', `To ${e.to} · from ${e.from}`)),
      h('div', { style: { textAlign: 'right' } },
        e.status === 'draft' ? h('span.btn.sm', 'Send…') : h(`span.pill${e.status === 'sent' ? '.green' : e.status === 'failed' ? '.red' : ''}`, emailStatus(e.status)),
        h('div.when', { style: { marginTop: '4px' } }, ago(e.at))),
    ))) : h('div.list', h('div.empty', h('div.big', outboxTab === 'done' ? '✉️' : '✓'), h('p', { style: { margin: 0 } }, outboxTab === 'done' ? 'Nothing sent yet.' : 'All caught up — no emails waiting.'))),
  );
}

// ================= account =================
async function viewAccount(root) {
  const cur = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const next = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (10+ characters)' });
  fill(root, 
    head(me.admin.name, me.admin.email, h('button.btn.secondary.sm', { onclick: () => signOut(false) }, 'Sign out')),
    h('div.grid-2',
      h('div.card',
        h('div.h3', { style: { marginBottom: '14px' } }, 'This sign-in'),
        h('dl.kv',
          h('dt', 'Method'), h('dd', me.token.kind === 'session' ? 'Password' : `Token “${me.token.name}”`),
          h('dt', 'Expires'), h('dd', fmtDate(me.token.expiresAt)),
        ),
        h('div.h3', { style: { margin: '22px 0 10px', fontSize: '17px' } }, 'Permissions'),
        h('div.chips', me.token.scopes.map((s) => h('span.tag', s))),
      ),
      me.token.kind === 'session' ? h('div.card',
        h('div.h3', { style: { marginBottom: '14px' } }, 'Change password'),
        h('label.field', cur), h('label.field', next),
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          try { await call('/api/admin/password', { method: 'POST', body: { current: cur.value, next: next.value } }); cur.value = next.value = ''; toast('Password changed. Other sessions were signed out.'); } catch (err) { fail(err); }
        }) }, 'Update password'),
      ) : null,
    ),
  );
}

start();
