-- Test fixtures: synthetic users, staff, second branch, services, prices.
-- Synthetic data only.

create schema if not exists test;
grant usage on schema test to authenticated, anon;

create or replace function test.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;

-- Runs SQL and asserts that it fails with an error message containing p_expect.
create or replace function test.expect_error(p_sql text, p_expect text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception 'ASSERTION FAILED: expected error containing "%", got "%"', p_expect, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERTION FAILED: expected error "%" but statement succeeded: %', p_expect, p_sql;
end $$;

-- Test sessions are two-factor (aal2) by default; test.login_aal simulates a password-only session.
create or replace function test.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false), set_config('request.jwt.claim.aal', 'aal2', false)
$$;
create or replace function test.login_aal(p_user uuid, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false), set_config('request.jwt.claim.aal', p_aal, false)
$$;
grant execute on all functions in schema test to authenticated, anon;

-- Second branch for scope tests
insert into public.branches (id, organization_id, code, name_ar, name_en)
values ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'TST', 'فرع اختبار', 'Test Branch');

-- Users
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000001001', 'admin@test.local'),
  ('00000000-0000-4000-8000-000000001002', 'frontdesk@test.local'),
  ('00000000-0000-4000-8000-000000001003', 'frontdesk.other@test.local'),
  ('00000000-0000-4000-8000-000000001004', 'dr.derm@test.local'),
  ('00000000-0000-4000-8000-000000001005', 'dr.dental@test.local'),
  ('00000000-0000-4000-8000-000000001006', 'chief.accountant@test.local'),
  ('00000000-0000-4000-8000-000000001007', 'cashier@test.local'),
  ('00000000-0000-4000-8000-000000001008', 'nobody@test.local'),
  ('00000000-0000-4000-8000-000000001009', 'frontdesk2@test.local');

insert into public.profiles (user_id, full_name_ar, full_name_en) values
  ('00000000-0000-4000-8000-000000001001', 'مدير النظام', 'Admin'),
  ('00000000-0000-4000-8000-000000001002', 'منى الاستقبال', 'Mona Front Desk'),
  ('00000000-0000-4000-8000-000000001003', 'فرع آخر', 'Other Branch Desk'),
  ('00000000-0000-4000-8000-000000001004', 'د. سارة الجلدية', 'Dr. Sara Derm'),
  ('00000000-0000-4000-8000-000000001005', 'د. كريم الأسنان', 'Dr. Karim Dental'),
  ('00000000-0000-4000-8000-000000001006', 'رئيس الحسابات', 'Chief Accountant'),
  ('00000000-0000-4000-8000-000000001007', 'أمين الخزينة', 'Cashier'),
  ('00000000-0000-4000-8000-000000001008', 'بدون صلاحيات', 'No Roles'),
  ('00000000-0000-4000-8000-000000001009', 'علي الاستقبال', 'Ali Front Desk');

insert into public.user_roles (user_id, role_code, branch_id) values
  ('00000000-0000-4000-8000-000000001001', 'system_admin', null),
  ('00000000-0000-4000-8000-000000001002', 'front_desk', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000001003', 'front_desk', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000001004', 'doctor',     '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000001005', 'doctor',     '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000001006', 'chief_accountant', null),
  ('00000000-0000-4000-8000-000000001007', 'cashier',    '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000001009', 'front_desk', '00000000-0000-4000-8000-000000000101');

insert into public.staff (id, user_id, branch_id, kind, full_name_ar, full_name_en, specialty_id) values
  ('00000000-0000-4000-8000-000000002004', '00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000101',
   'doctor', 'د. سارة الجلدية', 'Dr. Sara Derm', (select id from public.specialties where code = 'derm')),
  ('00000000-0000-4000-8000-000000002005', '00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000101',
   'doctor', 'د. كريم الأسنان', 'Dr. Karim Dental', (select id from public.specialties where code = 'dental'));

insert into public.rooms (id, branch_id, code, name_ar, name_en, kind) values
  ('00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000000101', 'L1', 'غرفة الليزر ١', 'Laser Room 1', 'laser');

insert into public.services (id, specialty_id, code, name_ar, name_en, revenue_account_id) values
  ('00000000-0000-4000-8000-000000004001', (select id from public.specialties where code = 'derm'),
   'DERM-CONS', 'كشف جلدية', 'Dermatology consultation', null),
  ('00000000-0000-4000-8000-000000004002', (select id from public.specialties where code = 'derm'),
   'LASER-FULL', 'جلسة ليزر كامل الجسم', 'Full body laser session',
   (select id from public.accounts where code = '4110'));

insert into public.price_lists (id, branch_id, code, name_ar, name_en, is_default) values
  ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000000101', 'STD', 'قائمة الأسعار الأساسية', 'Standard', true);
insert into public.price_list_items (price_list_id, service_id, price, effective) values
  ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000004001', 500, daterange('2026-01-01', null)),
  ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000004002', 3000, daterange('2026-01-01', null));
