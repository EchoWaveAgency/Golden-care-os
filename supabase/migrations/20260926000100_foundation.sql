-- Golden Care OS — 0001 Foundation
-- Organization structure, shared helpers, reference numbers.
-- All timestamps are timestamptz (stored UTC). Money is numeric(14,2) + currency.

-- Supabase convention: extensions live in their own schema, not in public.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to authenticated;

-- Private schema for helpers that must not be exposed through the API.
create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Arabic-aware name normalization for search and duplicate detection.
-- Removes diacritics/tatweel, unifies alef/hamza, ta marbuta, alef maqsura.
create or replace function app.normalize_name(t text)
returns text language sql immutable parallel safe as $$
  select nullif(
    trim(regexp_replace(
      lower(translate(
        regexp_replace(coalesce(t, ''), '[ً-ْـ]', '', 'g'),
        'أإآٱةىؤئ',
        'ااااهيوي'
      )),
      '\s+', ' ', 'g'
    )),
  '')
$$;

-- Egyptian phone normalization to E.164. Accepts Arabic-Indic digits.
-- Returns NULL when the input cannot be a valid number.
create or replace function app.normalize_phone(t text)
returns text language plpgsql immutable parallel safe as $$
declare d text;
begin
  if t is null then return null; end if;
  d := regexp_replace(translate(t, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
  if d = '' then return null; end if;
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 2) = '01' then return '+2' || d; end if;   -- 01xxxxxxxxx
  if length(d) = 12 and left(d, 3) = '201' then return '+' || d; end if;   -- 201xxxxxxxxx
  if length(d) between 8 and 15 then return '+' || d; end if;              -- international
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  name_en       text not null,
  tagline_ar    text,
  tagline_en    text,
  base_currency char(3) not null default 'EGP',
  timezone      text not null default 'Africa/Cairo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name_ar         text not null,
  name_en         text not null,
  address_ar      text,
  address_en      text,
  phone           text,
  timezone        text not null default 'Africa/Cairo',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.specialties (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name_ar    text not null,
  name_en    text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id),
  code       text not null,
  name_ar    text not null,
  name_en    text not null,
  is_active  boolean not null default true,
  unique (branch_id, code)
);

create type public.room_kind as enum ('clinic', 'procedure', 'laser', 'dental', 'imaging', 'other');

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id),
  code         text not null,
  name_ar      text not null,
  name_en      text not null,
  kind         public.room_kind not null default 'clinic',
  specialty_id uuid references public.specialties(id),
  is_active    boolean not null default true,
  unique (branch_id, code)
);

create trigger trg_org_updated before update on public.organizations
  for each row execute function app.touch_updated_at();
create trigger trg_branch_updated before update on public.branches
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Human-readable reference numbers (concurrency-safe via row lock)
-- ---------------------------------------------------------------------------

create table app.ref_counters (
  prefix text not null,
  year   int  not null,
  value  bigint not null default 0,
  primary key (prefix, year)
);

-- next_ref('INV') -> 'INV-2026-000001'; next_ref('P', false) -> 'P-000001'
create or replace function app.next_ref(p_prefix text, p_yearly boolean default true)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare y int := case when p_yearly then extract(year from now() at time zone 'Africa/Cairo')::int else 0 end;
        v bigint;
begin
  insert into app.ref_counters(prefix, year, value) values (p_prefix, y, 1)
  on conflict (prefix, year) do update set value = app.ref_counters.value + 1
  returning value into v;
  if p_yearly then
    return p_prefix || '-' || y || '-' || lpad(v::text, 6, '0');
  end if;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end $$;
