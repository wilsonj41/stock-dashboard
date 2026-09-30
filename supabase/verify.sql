-- Run after setup.sql. Everything changed here is rolled back.
begin;
do $$
declare t text;
begin
  foreach t in array array['dashboard_settings', 'dashboard_stocks', 'dashboard_logos', 'dashboard_quotes', 'dashboard_detail_cache', 'dashboard_requests', 'dashboard_gate'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'RLS missing on %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') or
       has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Browser role has direct privileges on %', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.dashboard_claim(text,text,boolean)', 'EXECUTE') then
    raise exception 'Public access to rate-limit RPC';
  end if;
end $$;
set local role service_role;
delete from public.dashboard_requests;
do $$
begin
  if not public.dashboard_claim('quote', 'TEST1', true) then raise exception 'First request denied'; end if;
  if public.dashboard_claim('quote', 'TEST1', true) then raise exception 'Duplicate request allowed'; end if;
  for i in 2..15 loop
    if not public.dashboard_claim('quote', 'TEST' || i, true) then raise exception 'Request under quota denied'; end if;
  end loop;
  if public.dashboard_claim('quote', 'TEST16', true) then raise exception 'Short burst quota exceeded'; end if;
  delete from public.dashboard_requests where kind in ('quote', 'profile', 'news', 'recommendations');
  insert into public.dashboard_requests (kind, request_key, created_at)
  select 'quote', 'MINUTE' || i, now() - interval '2 seconds' from generate_series(1, 55) as i;
  if public.dashboard_claim('profile', 'PROFILE1', true) then raise exception 'Minute quota exceeded'; end if;
  for i in 1..5 loop
    if not public.dashboard_claim('unlock', 'test', false) then raise exception 'Unlock under limit denied'; end if;
  end loop;
  if public.dashboard_claim('unlock', 'test', false) then raise exception 'Unlock rate limit bypassed'; end if;
end $$;
rollback;
-- Success means no exceptions. Existing data has not been changed.
