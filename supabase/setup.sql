-- Run this entire file in the Supabase SQL Editor. Safe to rerun.
begin;
insert into storage.buckets (id, name, public)
values ('dashboard-logos', 'dashboard-logos', true)
on conflict (id) do update set public = true;
create table if not exists public.dashboard_settings (
  id boolean primary key default true check (id),
  green_up boolean not null default true
);
-- We add the one and only row
insert into public.dashboard_settings (id) values (true) on conflict do nothing;
create table if not exists public.dashboard_stocks (
  symbol text primary key check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  name text not null,
  added_at timestamptz not null default now()
);
-- Logo lookups live separately so removing a stock does not discard its cached logo.
create table if not exists public.dashboard_logos (
  symbol text primary key check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  name text,
  logo_url text,
  provider text not null default 'legacy' check (provider in ('legacy', 'finnhub')),
  checked_at timestamptz not null default now()
);
alter table public.dashboard_logos add column if not exists name text;
alter table public.dashboard_logos add column if not exists provider text not null default 'legacy';
alter table public.dashboard_logos drop constraint if exists dashboard_logos_provider_check;
alter table public.dashboard_logos add constraint dashboard_logos_provider_check check (provider in ('legacy', 'finnhub'));
create table if not exists public.dashboard_quotes (
  symbol text primary key,
  name text not null,
  price numeric not null check (price >= 0),
  previous_close numeric not null check (previous_close > 0),
  open numeric,
  high numeric,
  low numeric,
  market_at timestamptz not null,
  fetched_at timestamptz not null default now()
);
alter table public.dashboard_quotes add column if not exists open numeric;
alter table public.dashboard_quotes add column if not exists high numeric;
alter table public.dashboard_quotes add column if not exists low numeric;
-- Sanitized responses for the detail page. One row per stock and data type makes
-- cache freshness checks cheap without exposing provider responses to the browser.
create table if not exists public.dashboard_detail_cache (
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  kind text not null check (kind in ('profile', 'news', 'recommendations')),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, kind)
);
-- Private backend bookkeeping: no browser permissions or RLS policies.
create table if not exists public.dashboard_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('quote', 'profile', 'news', 'recommendations', 'unlock')),
  request_key text not null,
  created_at timestamptz not null default now()
);
-- Keep reruns compatible with the prior provider integration.
-- Old logo reservations do not represent Finnhub requests and must not block the
-- new request-type constraint.
delete from public.dashboard_requests where kind not in ('quote', 'profile', 'news', 'recommendations', 'unlock');
alter table public.dashboard_requests drop constraint if exists dashboard_requests_kind_check;
alter table public.dashboard_requests add constraint dashboard_requests_kind_check check (kind in ('quote', 'profile', 'news', 'recommendations', 'unlock'));
create index if not exists dashboard_requests_created_idx on public.dashboard_requests (created_at);
create index if not exists dashboard_requests_kind_key_idx on public.dashboard_requests (kind, request_key, created_at);
create table if not exists public.dashboard_gate (id boolean primary key default true check (id));
insert into public.dashboard_gate values (true) on conflict do nothing;

alter table public.dashboard_settings enable row level security;
alter table public.dashboard_stocks enable row level security;
alter table public.dashboard_logos enable row level security;
alter table public.dashboard_quotes enable row level security;
alter table public.dashboard_detail_cache enable row level security;
alter table public.dashboard_requests enable row level security;
alter table public.dashboard_gate enable row level security;
revoke all on public.dashboard_settings, public.dashboard_stocks, public.dashboard_logos, public.dashboard_quotes, public.dashboard_detail_cache,
  public.dashboard_requests, public.dashboard_gate from public, anon, authenticated;
grant all on public.dashboard_settings, public.dashboard_stocks, public.dashboard_logos, public.dashboard_quotes, public.dashboard_detail_cache,
  public.dashboard_requests, public.dashboard_gate to service_role;
grant usage, select on sequence public.dashboard_requests_id_seq to service_role;

-- Serialized across Edge Function instances. It keeps the personal Finnhub plan's
-- 55-request rolling-minute budget shared across market-data requests, while
-- preventing a brief burst from exceeding 15 provider requests per second.
create or replace function public.dashboard_claim(p_kind text, p_key text, p_force boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_kind not in ('quote', 'profile', 'news', 'recommendations', 'unlock') then return false; end if;
  perform id from public.dashboard_gate where id = true for update;
  delete from public.dashboard_requests where created_at < now() - interval '24 hours';
  if p_kind = 'unlock' then
    if (select count(*) from public.dashboard_requests where kind = 'unlock'
        and created_at > now() - interval '1 minute') >= 5 then return false; end if;
  else
    if exists (select 1 from public.dashboard_requests where kind = p_kind and request_key = p_key
        and created_at > now() - interval '20 seconds') then return false; end if;
    if (select count(*) from public.dashboard_requests where kind in ('quote', 'profile', 'news', 'recommendations')
        and created_at > now() - interval '1 second') >= 15 then return false; end if;
    if (select count(*) from public.dashboard_requests where kind in ('quote', 'profile', 'news', 'recommendations')
        and created_at > now() - interval '1 minute') >= 55 then return false; end if;
  end if;
  insert into public.dashboard_requests (kind, request_key) values (p_kind, p_key);
  return true;
end;
$$;
revoke all on function public.dashboard_claim(text, text, boolean) from public, anon, authenticated;
grant execute on function public.dashboard_claim(text, text, boolean) to service_role;
commit;
