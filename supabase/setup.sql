-- =====================================================================
--  Print Desk — Supabase setup
--  Paste ALL of this into Supabase → SQL Editor → New query → Run.
--  It is safe to run again (e.g. after an update).
-- =====================================================================

-- ---------- tables ----------------------------------------------------

-- People who can use the admin page. `scopes` are their fine-grained permissions.
create table if not exists public.admins (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  email       text not null unique,
  scopes      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- Someone the owner added under Team. When the owner creates their login in
-- Supabase (Authentication → Users → Add user), they become an admin with these permissions.
create table if not exists public.admin_invites (
  email       text primary key,
  name        text not null,
  scopes      text[] not null default '{}',
  invited_by  text,
  created_at  timestamptz not null default now()
);

-- Pickup times admins set up.
create table if not exists public.slots (
  id          uuid primary key default gen_random_uuid(),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  locations   text[] not null,
  capacity    int not null default 1 check (capacity between 1 and 500),
  created_by  text,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Teacher requests.
create table if not exists public.requests (
  id                  uuid primary key default gen_random_uuid(),
  number              bigint generated always as identity (start with 1001) unique,
  track_token         text not null unique check (track_token ~ '^[A-Za-z0-9_-]{24,64}$'),
  type                text not null check (type in ('file', 'idea')),
  teacher_name        text not null,
  email               text not null,
  title               text not null,
  notes               text not null default '',
  color               text not null default '',
  description         text not null default '',
  file_path           text,
  file_name           text,
  file_size           bigint,
  status              text not null default 'received' check (status in
                        ('received','awaiting_approval','changes_requested','approved','printing','printed','scheduled','picked_up','cancelled')),
  feedback            text,
  pickup_slot         uuid references public.slots (id) on delete set null,
  pickup_location     text,
  pickup_start        timestamptz,
  pickup_end          timestamptz,
  handler_id          uuid references public.admins (id) on delete set null,
  handler_name        text,
  handoff_location    text,
  handoff_received_by text,
  handoff_admin_id    uuid,
  handoff_admin_name  text,
  handoff_at          timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now()
);

-- Preview images admins send before printing.
create table if not exists public.previews (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests (id) on delete cascade,
  path        text not null,
  file_name   text,
  note        text not null default '',
  by_name     text,
  created_at  timestamptz not null default now()
);

-- Everything that happens to a request. Each one can produce an email.
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests (id) on delete cascade,
  status      text not null,
  note        text,
  by_admin    uuid,
  by_name     text,
  preview_id  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists events_request_idx on public.events (request_id);

-- Which update emails have been sent (from Gmail) or skipped.
create table if not exists public.email_log (
  event_id    bigint primary key references public.events (id) on delete cascade,
  status      text not null check (status in ('sent', 'skipped')),
  by_name     text,
  created_at  timestamptz not null default now()
);

-- Site settings (currently just the school's time zone, saved from the
-- admin's browser when they add pickup times).
create table if not exists public.settings (
  key    text primary key,
  value  text not null
);

-- ---------- helpers ---------------------------------------------------

create or replace function public.pd_all_scopes() returns text[]
language sql immutable as $$
  select array['orders:read','orders:write','pickups:write','schedule:write','team:write']
$$;

create or replace function public.pd_clean_scopes(p text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct s order by s), '{}')
  from unnest(coalesce(p, '{}')) s where s = any (public.pd_all_scopes())
$$;

create or replace function public.pd_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where id = auth.uid())
$$;

create or replace function public.has_scope(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where id = auth.uid() and p = any (scopes))
$$;

-- Returns the signed-in admin, or stops with a friendly error.
create or replace function public.pd_require(p text) returns public.admins
language plpgsql stable security definer set search_path = public as $$
declare a public.admins;
begin
  select * into a from public.admins where id = auth.uid();
  if a.id is null then
    raise exception 'Please sign in as an admin.' using errcode = '42501';
  end if;
  if p is not null and not (p = any (a.scopes)) then
    raise exception 'You don’t have the “%” permission. Ask an admin to add it under Team.', p using errcode = '42501';
  end if;
  return a;
end $$;

-- What a teacher sees on their tracking page.
create or replace function public.pd_teacher_view(r public.requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', r.number, 'type', r.type, 'title', r.title,
    'teacherName', r.teacher_name, 'email', r.email,
    'notes', r.notes, 'color', r.color, 'description', r.description,
    'file', case when r.file_path is null then null
                 else jsonb_build_object('name', r.file_name, 'size', r.file_size, 'path', r.file_path) end,
    'status', r.status, 'feedback', r.feedback,
    'pickup', case when r.pickup_start is null then null
                   else jsonb_build_object('slotId', r.pickup_slot, 'location', r.pickup_location,
                                           'start', r.pickup_start, 'end', r.pickup_end) end,
    'handoff', case when r.handoff_at is null then null
                    else jsonb_build_object('location', r.handoff_location, 'receivedBy', r.handoff_received_by,
                                            'adminName', r.handoff_admin_name, 'at', r.handoff_at) end,
    'previews', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.path, 'note', p.note, 'at', p.created_at)
                                           order by p.created_at)
                          from public.previews p where p.request_id = r.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at) order by e.id)
                         from public.events e where e.request_id = r.id), '[]'::jsonb),
    'createdAt', r.created_at)
$$;

create or replace function public.pd_by_token(p_token text) returns public.requests
language plpgsql stable security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where track_token = p_token;
  if r.id is null then raise exception 'We couldn’t find that request.'; end if;
  return r;
end $$;

create or replace function public.pd_booked(p_slot uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.requests where pickup_slot = p_slot and status = 'scheduled'
$$;

create or replace function public.pd_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.settings where key = 'timezone'), 'UTC')
$$;

-- Teachers can book one week at a time: Monday–Sunday in the school's time
-- zone. On Saturday and Sunday the school week is over, so the coming week opens.
-- Admins can add many weeks of times at once; each week appears on its own.
create or replace function public.pd_booking_window(out starts timestamptz, out ends timestamptz)
language sql stable security definer set search_path = public as $$
  with local as (select now() at time zone public.pd_tz() as t),
       monday as (select date_trunc('week', t) + case when extract(isodow from t) >= 6 then interval '7 days' else interval '0' end as d from local)
  select d at time zone public.pd_tz(), (d + interval '7 days') at time zone public.pd_tz() from monday
$$;

create or replace function public.booking_week() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('start', w.starts, 'end', w.ends, 'timezone', public.pd_tz()) from public.pd_booking_window() w
$$;

-- ---------- teacher actions (no sign-in; the secret tracking link is the key) ----------

create or replace function public.submit_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r     public.requests;
  t     text := p ->> 'track_token';
  typ   text := coalesce(p ->> 'type', 'file');
  fp    text := nullif(p ->> 'file_path', '');
  em    text := lower(trim(coalesce(p ->> 'email', '')));
  fsize bigint;
  cooldown_until timestamptz;
begin
  if t is null or t !~ '^[A-Za-z0-9_-]{24,64}$' then raise exception 'Something went wrong. Please refresh the page and try again.'; end if;
  if trim(coalesce(p ->> 'teacher_name', '')) = '' then raise exception 'Please add your name.'; end if;
  if em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Please enter a valid email so we can send you updates.'; end if;
  -- Only school accounts can send requests.
  if em !~ '@sisbschool\.com$' then raise exception 'Please use your @sisbschool.com school email.'; end if;
  if trim(coalesce(p ->> 'title', '')) = '' then raise exception 'Please give your request a short title.'; end if;
  if typ not in ('file', 'idea') then raise exception 'Unknown request type.'; end if;
  if typ = 'file' then
    if fp is null or split_part(fp, '/', 1) <> t or lower(fp) !~ '\.(stl|3mf)$' then
      raise exception 'Please attach an STL or 3MF file.';
    end if;
    select coalesce((o.metadata ->> 'size')::bigint, 0) into fsize
      from storage.objects o where o.bucket_id = 'uploads' and o.name = fp;
    if not found then raise exception 'Your file didn’t finish uploading. Please try again.'; end if;
  else
    if trim(coalesce(p ->> 'description', '')) = '' then raise exception 'Please describe what you’d like printed.'; end if;
    fp := null;
  end if;

  -- Cooldown (issue #1), for STUDENT emails only (the part before @ contains
  -- "student"): one request at a time, and a week's wait after a print
  -- finishes. Staff emails have no limit.
  if split_part(em, '@', 1) like '%student%' then
  select * into r from public.requests
   where email = em and status not in ('picked_up', 'cancelled')
   order by created_at limit 1;
  if r.id is not null then
    raise exception 'You already have a request in progress (#%). You can send a new one a week after it finishes printing.', r.number;
  end if;
  select coalesce(max(e.created_at), '-infinity') + interval '7 days' into cooldown_until
    from public.events e join public.requests q on q.id = e.request_id
   where q.email = em and e.status = 'printed';
  if cooldown_until > now() then
    raise exception 'Your last print finished recently. You can send a new request on %.',
      to_char(cooldown_until at time zone public.pd_tz(), 'FMDay, FMMonth FMDD "at" FMHH12:MI AM');
  end if;
  r := null;
  end if;

  insert into public.requests (track_token, type, teacher_name, email, title, notes, color, description, file_path, file_name, file_size)
  values (t, typ,
          left(trim(p ->> 'teacher_name'), 80), left(em, 120), left(trim(p ->> 'title'), 100),
          left(trim(coalesce(p ->> 'notes', '')), 2000), left(trim(coalesce(p ->> 'color', '')), 60),
          case when typ = 'idea' then left(trim(p ->> 'description'), 4000) else '' end,
          fp, case when fp is not null then left(coalesce(p ->> 'file_name', 'model'), 200) end, fsize)
  returning * into r;
  insert into public.events (request_id, status) values (r.id, 'received');
  return jsonb_build_object('number', r.number);
exception when unique_violation then
  raise exception 'Something went wrong. Please refresh the page and try again.';
end $$;

create or replace function public.get_request(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.pd_teacher_view(public.pd_by_token(p_token))
$$;

create or replace function public.approve_preview(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.requests := public.pd_by_token(p_token);
begin
  if r.status <> 'awaiting_approval' then raise exception 'There’s nothing to approve right now.'; end if;
  update public.requests set status = 'approved', feedback = null where id = r.id returning * into r;
  insert into public.events (request_id, status, by_name) values (r.id, 'approved', r.teacher_name);
  return public.pd_teacher_view(r);
end $$;

create or replace function public.request_changes(p_token text, p_feedback text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.requests := public.pd_by_token(p_token);
begin
  if r.status <> 'awaiting_approval' then raise exception 'There’s no preview waiting for feedback.'; end if;
  if trim(coalesce(p_feedback, '')) = '' then raise exception 'Tell us what you’d like changed.'; end if;
  update public.requests set status = 'changes_requested', feedback = left(trim(p_feedback), 2000) where id = r.id returning * into r;
  insert into public.events (request_id, status, by_name, note) values (r.id, 'changes_requested', r.teacher_name, r.feedback);
  return public.pd_teacher_view(r);
end $$;

-- Returns { week: {start, end}, slots: [...] } — only this week's open times
-- (plus the teacher's own booking, so they can see it while rescheduling).
create or replace function public.open_slots(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from public.pd_by_token(p_token)),
       w as (select * from public.pd_booking_window())
  select jsonb_build_object(
    'week', (select jsonb_build_object('start', w.starts, 'end', w.ends) from w),
    'slots', coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'start', s.starts_at, 'end', s.ends_at, 'locations', s.locations,
               'remaining', greatest(0, s.capacity - public.pd_booked(s.id))) order by s.starts_at)
             filter (where s.id is not null), '[]'::jsonb))
  from r cross join w
  left join public.slots s
    on s.starts_at > now()
   and ((s.starts_at >= w.starts and s.starts_at < w.ends and public.pd_booked(s.id) < s.capacity)
        or s.id = r.pickup_slot)
$$;

create or replace function public.book_pickup(p_token text, p_slot uuid, p_location text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.requests := public.pd_by_token(p_token);
  s public.slots;
begin
  if r.status not in ('printed', 'scheduled') then raise exception 'You can book a pickup once printing is finished.'; end if;
  select * into s from public.slots where id = p_slot for update;   -- lock: no double-booking
  if s.id is null then raise exception 'Please choose a pickup time.'; end if;
  if not (p_location = any (s.locations)) then raise exception 'That time isn’t available at %.', p_location; end if;
  if s.starts_at <= now() then raise exception 'That time has already passed.'; end if;
  if s.id is distinct from r.pickup_slot
     and not exists (select 1 from public.pd_booking_window() w where s.starts_at >= w.starts and s.starts_at < w.ends) then
    raise exception 'That time isn’t open for booking yet. Please pick a time this week.';
  end if;
  if not (r.status = 'scheduled' and r.pickup_slot = s.id) and public.pd_booked(s.id) >= s.capacity then
    raise exception 'Sorry — that time just filled up. Please pick another.';
  end if;
  update public.requests
     set status = 'scheduled', pickup_slot = s.id, pickup_location = p_location,
         pickup_start = s.starts_at, pickup_end = s.ends_at
   where id = r.id returning * into r;
  insert into public.events (request_id, status, by_name, note)
  values (r.id, 'scheduled', r.teacher_name, p_location || ' · ' || to_char(s.starts_at, 'YYYY-MM-DD HH24:MI TZ'));
  return public.pd_teacher_view(r);
end $$;

-- ---------- admin actions -------------------------------------------------

create or replace function public.pd_claim(r public.requests, a public.admins) returns void
language sql security definer set search_path = public as $$
  update public.requests set handler_id = a.id, handler_name = a.name where id = r.id and handler_id is null
$$;

create or replace function public.admin_set_status(p_id uuid, p_status text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a public.admins := public.pd_require('orders:write');
  r public.requests;
  ev bigint;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if p_status = 'printing' then
    if r.type = 'idea' and r.status <> 'approved' then
      raise exception 'The teacher needs to approve a preview before this can print.';
    end if;
    if r.status not in ('received', 'approved', 'awaiting_approval', 'changes_requested') then
      raise exception 'This request can’t start printing from here.';
    end if;
  elsif p_status = 'printed' then
    if r.status <> 'printing' then raise exception 'Mark it as printing first.'; end if;
  else
    raise exception 'Unknown update.';
  end if;
  update public.requests set status = p_status where id = r.id;
  perform public.pd_claim(r, a);
  insert into public.events (request_id, status, by_admin, by_name) values (r.id, p_status, a.id, a.name) returning id into ev;
  return ev;
end $$;

create or replace function public.admin_add_preview(p_id uuid, p_path text, p_file_name text, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a  public.admins := public.pd_require('orders:write');
  r  public.requests;
  pv uuid;
  ev bigint;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status in ('printing', 'printed', 'scheduled', 'picked_up', 'cancelled') then
    raise exception 'Previews can only be sent before printing starts.';
  end if;
  if split_part(p_path, '/', 1) <> r.track_token
     or not exists (select 1 from storage.objects where bucket_id = 'uploads' and name = p_path) then
    raise exception 'The image didn’t finish uploading. Please try again.';
  end if;
  insert into public.previews (request_id, path, file_name, note, by_name)
  values (r.id, p_path, left(p_file_name, 200), left(trim(coalesce(p_note, '')), 1000), a.name) returning id into pv;
  update public.requests set status = 'awaiting_approval', feedback = null where id = r.id;
  perform public.pd_claim(r, a);
  insert into public.events (request_id, status, by_admin, by_name, note, preview_id)
  values (r.id, 'awaiting_approval', a.id, a.name, nullif(trim(coalesce(p_note, '')), ''), pv) returning id into ev;
  return ev;
end $$;

create or replace function public.admin_handoff(p_id uuid, p_location text, p_received_by text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a  public.admins := public.pd_require('pickups:write');
  r  public.requests;
  ev bigint;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status not in ('printed', 'scheduled') then raise exception 'Only finished prints can be handed off.'; end if;
  if trim(coalesce(p_location, '')) = '' then raise exception 'Where was it picked up?'; end if;
  if trim(coalesce(p_received_by, '')) = '' then raise exception 'Who received it?'; end if;
  update public.requests
     set status = 'picked_up', handoff_location = left(trim(p_location), 120), handoff_received_by = left(trim(p_received_by), 120),
         handoff_admin_id = a.id, handoff_admin_name = a.name, handoff_at = now()
   where id = r.id;
  insert into public.events (request_id, status, by_admin, by_name, note)
  values (r.id, 'picked_up', a.id, a.name, trim(p_received_by) || ' @ ' || trim(p_location)) returning id into ev;
  return ev;
end $$;

create or replace function public.admin_cancel(p_id uuid, p_reason text, p_notify boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a  public.admins := public.pd_require('orders:write');
  r  public.requests;
  ev bigint;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status in ('picked_up', 'cancelled') then raise exception 'This request is already closed.'; end if;
  update public.requests set status = 'cancelled', cancel_reason = left(trim(coalesce(p_reason, '')), 1000) where id = r.id;
  insert into public.events (request_id, status, by_admin, by_name, note)
  values (r.id, 'cancelled', a.id, a.name, nullif(trim(coalesce(p_reason, '')), '')) returning id into ev;
  if not p_notify then insert into public.email_log (event_id, status, by_name) values (ev, 'skipped', a.name); end if;
  return ev;
end $$;

-- "I'll handle this": future teacher emails for this request are drafted for you.
create or replace function public.admin_claim(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.admins := public.pd_require('orders:write');
begin
  update public.requests set handler_id = a.id, handler_name = a.name where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
end $$;

-- Record that an update email was sent from Gmail ('sent'), skipped, or put back ('draft').
create or replace function public.admin_mark_email(p_event bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.admins := public.pd_require('orders:write');
begin
  if p_status = 'draft' then
    delete from public.email_log where event_id = p_event;
  elsif p_status in ('sent', 'skipped') then
    insert into public.email_log (event_id, status, by_name) values (p_event, p_status, a.name)
    on conflict (event_id) do update set status = excluded.status, by_name = excluded.by_name, created_at = now();
  else
    raise exception 'Unknown status.';
  end if;
end $$;

-- p_slots: [{"start": "...", "end": "..."}, ...]
drop function if exists public.admin_add_slots(jsonb, text[], int);
create or replace function public.admin_add_slots(p_slots jsonb, p_locations text[], p_capacity int, p_timezone text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  a public.admins := public.pd_require('schedule:write');
  n int;
begin
  -- The admin's browser time zone defines the school week teachers see.
  if p_timezone is not null and exists (select 1 from pg_timezone_names where name = p_timezone) then
    insert into public.settings (key, value) values ('timezone', p_timezone)
    on conflict (key) do update set value = excluded.value;
  end if;
  if coalesce(array_length(p_locations, 1), 0) = 0 then raise exception 'Choose at least one location.'; end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then raise exception 'Add at least one time.'; end if;
  if jsonb_array_length(p_slots) > 1000 then raise exception 'That’s too many times at once — try fewer weeks.'; end if;
  if exists (select 1 from jsonb_array_elements(p_slots) x where (x ->> 'end')::timestamptz <= (x ->> 'start')::timestamptz) then
    raise exception 'Each time needs a start before its end.';
  end if;
  insert into public.slots (starts_at, ends_at, locations, capacity, created_by)
  select (x ->> 'start')::timestamptz, (x ->> 'end')::timestamptz, p_locations, greatest(1, least(500, coalesce(p_capacity, 1))), a.name
  from jsonb_array_elements(p_slots) x;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_delete_slot(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.admins := public.pd_require('schedule:write');
begin
  if public.pd_booked(p_id) > 0 then raise exception 'Someone has booked this time. Ask them to move first.'; end if;
  delete from public.slots where id = p_id;
end $$;

-- ---------- team ----------------------------------------------------------

create or replace function public.admin_invite(p_email text, p_name text, p_scopes text[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  a  public.admins := public.pd_require('team:write');
  em text := lower(trim(coalesce(p_email, '')));
  u  auth.users;
begin
  if trim(coalesce(p_name, '')) = '' then raise exception 'Add a name.'; end if;
  if em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Add a valid email.'; end if;
  if exists (select 1 from public.admins where email = em) then raise exception 'That email is already an admin.'; end if;
  select * into u from auth.users where lower(email) = em;
  if u.id is not null then
    -- They already have an account: make them an admin right away.
    insert into public.admins (id, name, email, scopes) values (u.id, trim(p_name), em, public.pd_clean_scopes(p_scopes));
    return 'added';
  end if;
  insert into public.admin_invites (email, name, scopes, invited_by)
  values (em, trim(p_name), public.pd_clean_scopes(p_scopes), a.name)
  on conflict (email) do update set name = excluded.name, scopes = excluded.scopes, invited_by = excluded.invited_by;
  return 'invited';
end $$;

create or replace function public.admin_cancel_invite(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.admins := public.pd_require('team:write');
begin
  delete from public.admin_invites where email = lower(trim(p_email));
end $$;

create or replace function public.admin_set_scopes(p_id uuid, p_scopes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  a  public.admins := public.pd_require('team:write');
  sc text[] := public.pd_clean_scopes(p_scopes);
begin
  if not ('team:write' = any (sc))
     and not exists (select 1 from public.admins where id <> p_id and 'team:write' = any (scopes)) then
    raise exception 'At least one admin needs to be able to manage the team.';
  end if;
  update public.admins set scopes = sc where id = p_id;
  if not found then raise exception 'Admin not found.'; end if;
end $$;

create or replace function public.admin_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.admins := public.pd_require('team:write');
begin
  if p_id = a.id then raise exception 'You can’t remove yourself.'; end if;
  delete from public.admins where id = p_id;
end $$;

-- Accounts are CLOSED. A new login is only allowed when:
--   * there are no admins yet (the very first account becomes the owner), or
--   * the owner added that email under Team → Add admin.
-- Anything else is rejected, so nobody can create an account by themselves.
-- Helpers get logins via Team → Add admin, which asks Supabase to send its
-- invitation email (supabase/functions/invite-admin).
create or replace function public.pd_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.admin_invites;
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (id, name, email, scopes)
    values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
            lower(new.email), public.pd_all_scopes());
    return new;
  end if;
  select * into inv from public.admin_invites where email = lower(new.email);
  if inv.email is null then
    raise exception 'Sign-ups are closed. Ask the Print Desk owner to add you.' using errcode = '42501';
  end if;
  insert into public.admins (id, name, email, scopes) values (new.id, inv.name, lower(new.email), inv.scopes)
  on conflict do nothing;
  delete from public.admin_invites where email = inv.email;
  return new;
end $$;

-- If accounts were made before this script was run, nobody is an admin yet:
-- make the earliest account (the owner's) the owner.
insert into public.admins (id, name, email, scopes)
select u.id, coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)), lower(u.email), public.pd_all_scopes()
from auth.users u
where not exists (select 1 from public.admins)
order by u.created_at
limit 1;

drop trigger if exists pd_on_signup on auth.users;
create trigger pd_on_signup after insert on auth.users
  for each row execute function public.pd_on_signup();

-- ---------- owner ----------------------------------------------------------
-- Tonkla always has full access: an admin with every permission if the login
-- exists, otherwise approved so the login can be created/invited.
insert into public.admins (id, name, email, scopes)
select u.id, 'Tonkla', lower(u.email), public.pd_all_scopes()
from auth.users u where lower(u.email) = 'tonkla.pcstudent@sisbschool.com'
on conflict (id) do update set scopes = public.pd_all_scopes();
insert into public.admin_invites (email, name, scopes, invited_by)
select 'tonkla.pcstudent@sisbschool.com', 'Tonkla', public.pd_all_scopes(), 'setup'
where not exists (select 1 from public.admins where email = 'tonkla.pcstudent@sisbschool.com')
on conflict (email) do update set scopes = public.pd_all_scopes();

-- ---------- row-level security: admins can read, nobody writes directly ----------

alter table public.admins        enable row level security;
alter table public.admin_invites enable row level security;
alter table public.slots         enable row level security;
alter table public.requests      enable row level security;
alter table public.previews      enable row level security;
alter table public.events        enable row level security;
alter table public.email_log     enable row level security;
alter table public.settings      enable row level security;

drop policy if exists "pd read" on public.admins;
create policy "pd read" on public.admins for select to authenticated using (public.pd_is_admin());
drop policy if exists "pd read" on public.admin_invites;
create policy "pd read" on public.admin_invites for select to authenticated using (public.pd_is_admin());
drop policy if exists "pd read" on public.slots;
create policy "pd read" on public.slots for select to authenticated using (public.pd_is_admin());
drop policy if exists "pd read" on public.requests;
create policy "pd read" on public.requests for select to authenticated using (public.has_scope('orders:read'));
drop policy if exists "pd read" on public.previews;
create policy "pd read" on public.previews for select to authenticated using (public.has_scope('orders:read'));
drop policy if exists "pd read" on public.events;
create policy "pd read" on public.events for select to authenticated using (public.has_scope('orders:read'));
drop policy if exists "pd read" on public.email_log;
create policy "pd read" on public.email_log for select to authenticated using (public.has_scope('orders:read'));
drop policy if exists "pd read" on public.settings;
create policy "pd read" on public.settings for select to authenticated using (public.pd_is_admin());

-- Internal helpers shouldn't be callable from the browser.
revoke execute on function public.pd_claim(public.requests, public.admins) from public, anon, authenticated;
revoke execute on function public.pd_on_signup() from public, anon, authenticated;
revoke execute on function public.pd_teacher_view(public.requests) from public, anon, authenticated;

-- ---------- file storage ----------------------------------------------------
-- One bucket. Files live under a folder named after the request's secret
-- tracking token, so only people with the tracking link (and admins) can
-- find them. 50 MB is the largest upload on Supabase's free plan.

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;

drop policy if exists "pd teachers upload models" on storage.objects;
create policy "pd teachers upload models" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'uploads'
  and array_length(storage.foldername(name), 1) = 1
  and (storage.foldername(name))[1] ~ '^[A-Za-z0-9_-]{24,64}$'
  and lower(storage.extension(name)) in ('stl', '3mf')
);

drop policy if exists "pd admins upload previews" on storage.objects;
create policy "pd admins upload previews" on storage.objects for insert to authenticated
with check (
  bucket_id = 'uploads'
  and public.has_scope('orders:write')
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp', 'gif')
);

-- Done! Next: Authentication → URL Configuration → set Site URL to your GitHub Pages admin page,
-- Authentication → Sign In / Providers → turn OFF "Allow new users to sign up",
-- and deploy supabase/functions/invite-admin (Edge Functions) for invitation emails.
