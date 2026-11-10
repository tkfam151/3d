// Shared helpers for every page.

// Old /docs/ links forward here with ?pd=1 — tidy the address bar.
try {
  const u = new URL(location.href);
  if (u.searchParams.has('pd')) { u.searchParams.delete('pd'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
} catch { /* ignore */ }

/** Tiny element builder: h('div.card#x', {onclick}, child, 'text') */
export function h(tag, props, ...children) {
  const [, name, rest] = /^([a-z0-9-]+)?(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (s, root = document) => root.querySelector(s);

/** Replace an element's children, skipping null/false and flattening arrays. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let toastTimer;
export function toast(msg, { error = false } = {}) {
  let el = $('.toast');
  if (!el) { el = h('div.toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.toggle('error', error);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 4200 : 2600);
}

/** Put a button into a busy state while an async task runs. */
export async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

export const fmtDate = (iso, opts) => new Date(iso).toLocaleString(undefined, opts || { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso, { month: 'short', day: 'numeric' });
}

export const STATUS = {
  received: { label: 'Received', color: 'blue' },
  awaiting_approval: { label: 'Preview sent', color: 'purple' },
  changes_requested: { label: 'Changes requested', color: 'orange' },
  approved: { label: 'Approved', color: 'blue' },
  printing: { label: 'Printing', color: 'orange' },
  printed: { label: 'Ready for pickup', color: 'green' },
  scheduled: { label: 'Pickup booked', color: 'green' },
  picked_up: { label: 'Picked up', color: '' },
  cancelled: { label: 'Closed', color: 'red' },
};
export const pill = (status) => h(`span.pill${STATUS[status]?.color ? '.' + STATUS[status].color : ''}`, STATUS[status]?.label || status);

export const LOGO = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#bf5af2"/></linearGradient></defs><path fill="url(#lg)" d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z"/><path fill="#fff" fill-opacity=".9" d="M12 4.6 18.8 8.5 12 12.4 5.2 8.5z"/><path fill="#fff" fill-opacity=".45" d="M12 12.4v7.4l-6.8-3.9V8.5z"/></svg>`;

/** Group slots by calendar day. */
export function byDay(slots) {
  const map = new Map();
  for (const s of slots) {
    const k = new Date(s.start).toDateString();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.values()];
}
