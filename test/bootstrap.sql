-- Accounts made before setup.sql ran: the earliest becomes owner.
\set ON_ERROR_STOP 1
do $$ begin
  if (select email from public.admins) is distinct from 'tonkla@school.org' or (select count(*) from public.admins) <> 1 then
    raise exception 'FAILED: earliest existing account should become the only owner';
  end if;
  raise notice 'ok - existing first account became owner when setup ran';
end $$;
