-- Scenario test for supabase/setup.sql (run by test/run.sh against a local Postgres).
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\o /dev/null

create schema t;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
grant usage on schema t to anon, authenticated;
-- A future time inside the week teachers can currently book.
create function t.in_week() returns timestamptz language sql as $$
  select greatest(now(), w.starts) + interval '5 minutes' from public.pd_booking_window() w $$;
grant execute on function t.in_week() to anon, authenticated;

-- Accounts: the first sign-up becomes the owner; later ones only if invited.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a', 'Sam@School.org', '{"name":"Sam Admin"}');
select t.ok((select scopes = pd_all_scopes() and name = 'Sam Admin' from admins where email = 'sam@school.org'), 'first sign-up is owner with all permissions');
do $$ begin
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'stranger@evil.com');
  raise exception 'no error';
exception when others then if sqlerrm not like '%Sign-ups are closed%' then raise; end if; end $$;
select t.ok(not exists (select 1 from auth.users where email = 'stranger@evil.com'), 'uninvited sign-up is rejected (account not created)');
-- An account created before setup.sql existed (trigger bypassed) to test adding existing accounts.
alter table auth.users disable trigger pd_on_signup;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'legacy@school.org');
alter table auth.users enable trigger pd_on_signup;

-- ===== teacher (anon) =====
set role anon;
select t.ok((select count(*) from requests) = 0, 'anon cannot read requests table');

do $$ begin
  perform submit_request('{"track_token":"tok_aaaaaaaaaaaaaaaaaaaaaaaa","type":"idea","teacher_name":"Mr. Lee","title":"Cell","description":"plant cell"}');
  raise exception 'no error';
exception when others then if sqlerrm not like '%valid email%' then raise; end if; end $$;
select t.ok(true, 'email is required');

do $$ begin
  insert into storage.objects (bucket_id, name, metadata) values ('uploads', 'tok_aaaaaaaaaaaaaaaaaaaaaaaa/virus.exe', '{}');
  raise exception 'no error';
exception when others then if sqlerrm not like '%row-level security%' then raise; end if; end $$;
select t.ok(true, 'teachers cannot upload non-STL/3MF files');

insert into storage.objects (bucket_id, name, metadata) values ('uploads', 'tok_aaaaaaaaaaaaaaaaaaaaaaaa/gear.stl', '{"size":1234}');
do $$ begin
  perform submit_request('{"track_token":"tok_aaaaaaaaaaaaaaaaaaaaaaaa","type":"file","teacher_name":"Ms. Rivera","email":"Rivera@School.org","title":"Gear","file_path":"tok_bbbbbbbbbbbbbbbbbbbbbbbb/gear.stl","file_name":"gear.stl"}');
  raise exception 'no error';
exception when others then if sqlerrm not like '%STL or 3MF%' then raise; end if; end $$;
select t.ok(true, 'file must be in the request''s own folder');

select t.ok((submit_request('{"track_token":"tok_aaaaaaaaaaaaaaaaaaaaaaaa","type":"file","teacher_name":"Ms. Rivera","email":"Rivera@School.org","title":"Gear","file_path":"tok_aaaaaaaaaaaaaaaaaaaaaaaa/gear.stl","file_name":"gear.stl"}') ->> 'number') = '1001', 'STL request submitted as #1001');
select t.ok((get_request('tok_aaaaaaaaaaaaaaaaaaaaaaaa') -> 'file' ->> 'size') = '1234', 'tracking page sees file + size');
select t.ok((get_request('tok_aaaaaaaaaaaaaaaaaaaaaaaa') ->> 'email') = 'rivera@school.org', 'email lower-cased');
do $$ begin
  perform submit_request('{"track_token":"tok_dddddddddddddddddddddddd","type":"idea","teacher_name":"Ms. Rivera","email":"rivera@school.org","title":"Second","description":"x"}');
  raise exception 'no error';
exception when others then if sqlerrm not like '%already have a request in progress (#1001)%' then raise; end if; end $$;
select t.ok(true, 'cooldown: one open request per email');
select t.ok((submit_request('{"track_token":"tok_cccccccccccccccccccccccc","type":"idea","teacher_name":"Mr. Lee","email":"lee@school.org","title":"Cell model","description":"A plant cell"}') ->> 'number') = '1002', 'idea request submitted');
do $$ begin perform get_request('tok_zzzzzzzzzzzzzzzzzzzzzzzz'); raise exception 'no error';
exception when others then if sqlerrm not like '%couldn’t find%' then raise; end if; end $$;
select t.ok(true, 'unknown tracking link rejected');
do $$ begin perform admin_set_status((select gen_random_uuid()), 'printing'); raise exception 'no error';
exception when others then if sqlerrm not like '%sign in as an admin%' then raise; end if; end $$;
select t.ok(true, 'anon cannot call admin actions');
reset role;

-- ===== admin =====
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select t.ok((select count(*) from requests) = 2, 'admin can read requests');

do $$ declare id uuid := (select id from requests where number = 1002); begin
  perform admin_set_status(id, 'printing'); raise exception 'no error';
exception when others then if sqlerrm not like '%approve a preview%' then raise; end if; end $$;
select t.ok(true, 'idea cannot print before approval');

insert into storage.objects (bucket_id, name, metadata) values ('uploads', 'tok_cccccccccccccccccccccccc/preview-1.png', '{"size":10}');
select admin_add_preview((select id from requests where number = 1002), 'tok_cccccccccccccccccccccccc/preview-1.png', 'p.png', 'Here you go') as ev \gset
select t.ok((select status from requests where number = 1002) = 'awaiting_approval', 'preview sent → awaiting approval');
select t.ok((select handler_name from requests where number = 1002) = 'Sam Admin', 'first admin to act becomes handler');
select t.ok((select preview_id is not null from events where id = :ev), 'preview event links the image');

select admin_set_status((select id from requests where number = 1001), 'printing') as ev1 \gset
select admin_set_status((select id from requests where number = 1001), 'printed') as ev2 \gset
select t.ok((select status from requests where number = 1001) = 'printed', 'STL printing → printed');

select admin_add_slots(jsonb_build_array(
  jsonb_build_object('start', t.in_week(), 'end', t.in_week() + interval '30 min'),
  jsonb_build_object('start', now() - interval '1 day', 'end', now() - interval '23 hours'),
  jsonb_build_object('start', (select ends from pd_booking_window()) + interval '1 day', 'end', (select ends from pd_booking_window()) + interval '1 day 30 min')),
  array['PU3'], 1, 'America/New_York') as n \gset
select t.ok(:n = 3, 'added pickup times (this week, past, next week)');
select t.ok((select value from settings where key = 'timezone') = 'America/New_York', 'school time zone saved from admin');
select id as slot from slots where starts_at > now() and starts_at < (select ends from pd_booking_window()) \gset
select id as oldslot from slots where starts_at < now() \gset
select id as nextslot from slots where starts_at >= (select ends from pd_booking_window()) \gset
reset role;

-- ===== teacher books & approves =====
set role anon;
select t.ok(jsonb_array_length(open_slots('tok_aaaaaaaaaaaaaaaaaaaaaaaa') -> 'slots') = 1, 'teacher sees only this week''s future times (not past, not next week)');
select set_config('pd.nextslot', :'nextslot', false);
do $$ begin perform book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', current_setting('pd.nextslot')::uuid, 'PU3'); raise exception 'no error';
exception when others then if sqlerrm not like '%isn’t open for booking yet%' then raise; end if; end $$;
select t.ok(true, 'next week''s time cannot be booked yet');
do $$ begin perform book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', (select gen_random_uuid()), 'PU3'); raise exception 'no error';
exception when others then if sqlerrm not like '%choose a pickup time%' then raise; end if; end $$;
select t.ok(true, 'bad slot rejected');
select set_config('pd.slot', :'slot', false);
select set_config('pd.oldslot', :'oldslot', false);
do $$ begin perform book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', current_setting('pd.slot')::uuid, 'PU2'); raise exception 'no error';
exception when others then if sqlerrm not like '%isn’t available at PU2%' then raise; end if; end $$;
select t.ok(true, 'PU3-only time cannot be booked at PU2');
do $$ begin perform book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', current_setting('pd.oldslot')::uuid, 'PU3'); raise exception 'no error';
exception when others then if sqlerrm not like '%already passed%' then raise; end if; end $$;
select t.ok(true, 'past time rejected');
select t.ok((book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', :'slot', 'PU3') -> 'pickup' ->> 'location') = 'PU3', 'booked PU3');
select t.ok((book_pickup('tok_aaaaaaaaaaaaaaaaaaaaaaaa', :'slot', 'PU3') ->> 'status') = 'scheduled', 'rebooking own slot ok');
select t.ok(jsonb_array_length(open_slots('tok_cccccccccccccccccccccccc') -> 'slots') = 0, 'full time hidden from others');
select t.ok((open_slots('tok_aaaaaaaaaaaaaaaaaaaaaaaa') -> 'slots' -> 0 ->> 'id') = :'slot', 'own booking still listed');
do $$ begin perform book_pickup('tok_cccccccccccccccccccccccc', current_setting('pd.slot')::uuid, 'PU3'); raise exception 'no error';
exception when others then if sqlerrm not like '%once printing is finished%' then raise; end if; end $$;
select t.ok(true, 'cannot book before printed');
select t.ok((approve_preview('tok_cccccccccccccccccccccccc') ->> 'status') = 'approved', 'teacher approved preview');
reset role;

-- ===== hand-off + emails =====
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select t.ok(admin_set_status((select id from requests where number = 1002), 'printing') > 0, 'approved idea can print');
do $$ begin perform admin_delete_slot(current_setting('pd.slot')::uuid); raise exception 'no error';
exception when others then if sqlerrm not like '%booked this time%' then raise; end if; end $$;
select t.ok(true, 'booked time cannot be removed');
select admin_handoff((select id from requests where number = 1001), 'PU3 front desk', 'Ms. Rivera') as ev3 \gset
select t.ok((select handoff_admin_name = 'Sam Admin' and status = 'picked_up' from requests where number = 1001), 'hand-off records giver');
reset role;
set role anon;
do $$ begin
  perform submit_request('{"track_token":"tok_eeeeeeeeeeeeeeeeeeeeeeee","type":"idea","teacher_name":"Ms. Rivera","email":"rivera@school.org","title":"Again","description":"x"}');
  raise exception 'no error';
exception when others then if sqlerrm not like '%finished recently%' then raise; end if; end $$;
select t.ok(true, 'cooldown: no new request within a week of finishing');
reset role;
update events set created_at = now() - interval '8 days' where status = 'printed' and request_id = (select id from requests where number = 1001);
set role anon;
select t.ok((submit_request('{"track_token":"tok_eeeeeeeeeeeeeeeeeeeeeeee","type":"idea","teacher_name":"Ms. Rivera","email":"rivera@school.org","title":"Again","description":"x"}') ->> 'number') is not null, 'cooldown: allowed again after a week');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select admin_mark_email(:ev3, 'sent');
select t.ok((select status = 'sent' and by_name = 'Sam Admin' from email_log where event_id = :ev3), 'email marked sent');
select admin_mark_email(:ev3, 'draft');
select t.ok(not exists (select 1 from email_log where event_id = :ev3), 'email moved back to drafts');

-- ===== team & permissions =====
select t.ok(admin_invite('pat@school.org', 'Pat Helper', array['orders:read', 'pickups:write', 'bogus']) = 'invited', 'invited Pat');
select t.ok(admin_invite('legacy@school.org', 'Legacy', array['orders:read']) = 'added', 'existing account added directly');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'pat@school.org');
select t.ok((select scopes = array['orders:read', 'pickups:write'] from admins where email = 'pat@school.org'), 'invite applied on sign-up, bogus scope dropped');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select t.ok((select count(*) from requests) = 3, 'Pat can read');
do $$ begin perform admin_add_slots('[{"start":"2030-01-01T10:00Z","end":"2030-01-01T11:00Z"}]', array['PU2'], 1); raise exception 'no error';
exception when others then if sqlerrm not like '%schedule:write%' then raise; end if; end $$;
select t.ok(true, 'Pat lacks schedule:write');
do $$ begin perform admin_remove('00000000-0000-0000-0000-00000000000a'); raise exception 'no error';
exception when others then if sqlerrm not like '%team:write%' then raise; end if; end $$;
select t.ok(true, 'Pat cannot manage team');
do $$ begin insert into storage.objects (bucket_id, name, metadata) values ('uploads', 'tok_cccccccccccccccccccccccc/x.png', '{}'); raise exception 'no error';
exception when others then if sqlerrm not like '%row-level security%' then raise; end if; end $$;
select t.ok(true, 'Pat cannot upload previews without orders:write');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select t.ok((select count(*) from requests) = 3, 'added account (orders:read) can read');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform admin_set_scopes('00000000-0000-0000-0000-00000000000a', array['orders:read']); raise exception 'no error';
exception when others then if sqlerrm not like '%At least one admin%' then raise; end if; end $$;
select t.ok(true, 'cannot remove the last team manager');
select admin_remove('00000000-0000-0000-0000-00000000000c');
select t.ok(not exists (select 1 from admins where email = 'pat@school.org'), 'removed Pat');
reset role;
\echo ALL TESTS PASSED
