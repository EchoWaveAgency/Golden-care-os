-- Golden Care OS — 0002 Identity, staff, roles and permissions (RBAC + scope)
-- Deny by default: a user has no access unless an active role grant gives it.

create type public.staff_kind as enum (
  'doctor', 'nurse', 'medical_assistant', 'reception', 'patient_relations',
  'finance', 'hr', 'inventory', 'maintenance', 'management', 'admin', 'other'
);

-- One profile per auth user.
create table public.profiles (
  user_id     uuid primary key references auth.users(id) on delete restrict,
  full_name_ar text not null,
  full_name_en text,
  phone       text,
  locale      text not null default 'ar' check (locale in ('ar', 'en')),
  digits      text not null default 'latn' check (digits in ('latn', 'arab')),
  is_active   boolean not null default true,
  mfa_required boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Staff record (employees and doctors). A staff member may or may not have a login.
create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique references auth.users(id) on delete restrict,
  branch_id    uuid not null references public.branches(id),
  kind         public.staff_kind not null,
  full_name_ar text not null,
  full_name_en text,
  specialty_id uuid references public.specialties(id),
  title_ar     text,
  title_en     text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint doctor_has_specialty check (kind <> 'doctor' or specialty_id is not null)
);

create table public.roles (
  code        text primary key,
  name_ar     text not null,
  name_en     text not null,
  description text,
  is_privileged boolean not null default false  -- privileged roles require MFA
);

create table public.permissions (
  code        text primary key,          -- e.g. 'patient.read'
  module      text not null,
  description text not null
);

create table public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- Role grants are scoped to a branch (NULL = all branches) and a validity window,
-- which also covers temporary delegation.
create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete restrict,
  role_code   text not null references public.roles(code),
  branch_id   uuid references public.branches(id),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  granted_by  uuid references auth.users(id),
  reason      text,
  created_at  timestamptz not null default now(),
  constraint valid_window check (valid_to is null or valid_to > valid_from),
  constraint no_self_grant check (granted_by is null or granted_by <> user_id)
);
create index on public.user_roles (user_id);

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger trg_staff_updated before update on public.staff
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers used by RLS and RPCs
-- ---------------------------------------------------------------------------

create or replace function app.current_user_id()
returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function app.current_staff_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from public.staff s where s.user_id = auth.uid() and s.is_active
$$;

-- True when the current user holds the permission through an active grant
-- valid for the given branch (NULL branch = "in any branch").
create or replace function app.has_permission(p_permission text, p_branch uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
    where ur.user_id = auth.uid()
      and rp.permission_code = p_permission
      and now() >= ur.valid_from
      and (ur.valid_to is null or now() < ur.valid_to)
      and (p_branch is null or ur.branch_id is null or ur.branch_id = p_branch)
  )
$$;

create or replace function app.require_permission(p_permission text, p_branch uuid default null)
returns void language plpgsql stable as $$
begin
  if not app.has_permission(p_permission, p_branch) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
end $$;

-- Effective permissions for the signed-in user (used by the UI to build navigation).
create or replace function public.my_permissions()
returns table (permission_code text, branch_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct rp.permission_code, ur.branch_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_code = ur.role_code
  join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
  where ur.user_id = auth.uid()
    and now() >= ur.valid_from
    and (ur.valid_to is null or now() < ur.valid_to)
$$;

create or replace function public.my_roles()
returns table (role_code text, branch_id uuid, valid_to timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select ur.role_code, ur.branch_id, ur.valid_to
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and now() >= ur.valid_from
    and (ur.valid_to is null or now() < ur.valid_to)
$$;

grant usage on schema app to authenticated;
grant execute on function app.has_permission(text, uuid) to authenticated;
grant execute on function app.current_staff_id() to authenticated;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.normalize_name(text) to authenticated;
grant execute on function app.normalize_phone(text) to authenticated;
