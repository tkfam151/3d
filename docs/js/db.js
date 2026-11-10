// Connection to Supabase (database, file storage and admin sign-in).
import { createClient } from '../vendor/supabase.js';
import * as config from './config.js';
import { h, fill } from './common.js';

export { config };
export const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_KEY);
export const sb = configured ? createClient(config.SUPABASE_URL, config.SUPABASE_KEY) : null;

function friendly(error) {
  const m = error?.message || '';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return new Error('Can’t reach the server. Check your connection.');
  if (/JWT expired|invalid jwt/i.test(m)) return Object.assign(new Error('Please sign in again.'), { auth: true });
  return new Error(m || 'Something went wrong. Please try again.');
}

/** Call a database function (see supabase/setup.sql). Throws a readable Error. */
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw friendly(error);
  return data;
}

/** Await a supabase-js query builder and return its rows. */
export async function rows(query) {
  const { data, error } = await query;
  if (error) throw friendly(error);
  return data;
}

/** Public URL of an uploaded file (files live in a folder named after the secret tracking token). */
export function fileUrl(path, downloadName) {
  return sb.storage.from('uploads').getPublicUrl(path, downloadName ? { download: downloadName } : undefined).data.publicUrl;
}

export async function uploadFile(path, file, contentType) {
  const { error } = await sb.storage.from('uploads').upload(path, file, { upsert: false, contentType, cacheControl: '3600' });
  if (error) {
    if (/exceed|too large|maximum allowed size|payload/i.test(error.message)) throw new Error(`That file is too big (max ${config.MAX_MODEL_MB} MB).`);
    throw friendly(error);
  }
}

/** A long random string for the secret tracking link. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Safe storage name for an uploaded file. */
export function safeName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return ext ? `${base}.${ext}` : base;
}

/** Shown instead of the page until config.js is filled in. */
export function setupNotice(el) {
  fill(el, h('div.narrow', { style: { padding: '80px 16px' } }, h('div.card', { style: { textAlign: 'center' } },
    h('div.big', { style: { fontSize: '44px' } }, '⚙️'),
    h('h1.h2', 'Almost there.'),
    h('p.muted', 'This site isn’t connected to Supabase yet. Add your project URL and key to ', h('code', 'docs/js/config.js'), ' — see the README for the steps.'),
  )));
}
