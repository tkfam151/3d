// Supabase Edge Function: invite-admin
//
// Sends Supabase's "You have been invited" email to someone the owner added
// under Team in the admin page. It runs on Supabase's servers because inviting
// needs the secret service-role key, which must never be in the website.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor →
// name it  invite-admin  → paste this whole file → Deploy function.
//
// Who can call it: a signed-in admin with the "team:write" permission, and only
// for an email that is already on the Team list (added in the admin page).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !serviceKey) return reply({ error: 'The function is missing its Supabase settings.' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is calling? Must be a signed-in admin with team:write.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return reply({ error: 'Please sign in again.' }, 401);
  const { data: me } = await admin.from('admins').select('scopes').eq('id', caller.user.id).maybeSingle();
  if (!me?.scopes?.includes('team:write')) return reply({ error: 'You need the “team:write” permission to invite admins.' }, 403);

  // 2. Who is being invited? Must already be on the Team list.
  let body: { email?: string; name?: string; redirectTo?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Bad request.' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Add a valid email.' }, 400);
  const { data: invite } = await admin.from('admin_invites').select('name').eq('email', email).maybeSingle();
  const { data: existing } = await admin.from('admins').select('id').eq('email', email).maybeSingle();
  if (!invite && !existing) return reply({ error: 'Add this person under Team first.' }, 400);

  // 3. Send Supabase's invitation email. The link brings them to the admin page to choose a password.
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo || undefined,
    data: { name: invite?.name ?? body.name ?? '' },
  });
  if (error) {
    if (/already been registered|already registered|already exists/i.test(error.message)) {
      return reply({ error: 'They already have an account. Use “Send password reset” instead.', code: 'exists' }, 409);
    }
    return reply({ error: error.message }, 400);
  }
  return reply({ ok: true });
});
