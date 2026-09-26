-- 01 — Identity, permission scope, and row level security
\set admin    '00000000-0000-4000-8000-000000001001'
\set fd       '00000000-0000-4000-8000-000000001002'
\set fd_other '00000000-0000-4000-8000-000000001003'
\set dr_derm  '00000000-0000-4000-8000-000000001004'
\set dr_dent  '00000000-0000-4000-8000-000000001005'
\set chief    '00000000-0000-4000-8000-000000001006'
\set nobody   '00000000-0000-4000-8000-000000001008'
\set b1       '00000000-0000-4000-8000-000000000101'
\set b2       '00000000-0000-4000-8000-000000000102'

-- Front desk registers a patient in its own branch.
set role authenticated;
select test.login(:'fd');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, national_id, date_of_birth, sex)
values (:'b1', 'ليلى', 'حسن', '0100 123 4567', '29001011234567', '1990-01-01', 'female')
returning id as pid \gset
select test.assert((select count(*) from public.patients where id = :'pid') = 1, 'front desk reads own branch patient');

-- ...but cannot register into a branch it has no grant for.
select test.expect_error(format($q$insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw)
  values (%L, 'س', 'ص', '01011111111')$q$, :'b2'), 'row-level security');

-- Other-branch front desk cannot see branch 1 patients.
select test.login(:'fd_other');
select test.assert((select count(*) from public.patients where id = :'pid') = 0, 'other branch cannot read patient');

-- A signed-in user with no roles sees nothing and can do nothing.
select test.login(:'nobody');
select test.assert((select count(*) from public.patients) = 0, 'no-role user sees no patients');
select test.assert((select count(*) from public.appointments) = 0, 'no-role user sees no appointments');
select test.assert((select count(*) from public.invoices) = 0, 'no-role user sees no invoices');
select test.assert((select count(*) from public.journal_entries) = 0, 'no-role user sees no journal');
select test.assert((select count(*) from public.audit_events) = 0, 'no-role user sees no audit');
select test.assert((select count(*) from public.branches) = 0, 'user with a profile but no active role sees no reference data');

-- Doctor: no access to a patient until scheduled to treat them.
select test.login(:'dr_derm');
select test.assert((select count(*) from public.patients where id = :'pid') = 0, 'doctor cannot see unassigned patient');
select test.login(:'fd');
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pid', '00000000-0000-4000-8000-000000002004', (select id from public.specialties where code = 'derm'),
        tstzrange('2026-10-01 10:00+03', '2026-10-01 10:15+03'));
select test.login(:'dr_derm');
select test.assert((select count(*) from public.patients where id = :'pid') = 1, 'treating doctor can see patient');
select test.login(:'dr_dent');
select test.assert((select count(*) from public.patients where id = :'pid') = 0, 'other doctor still cannot see patient');
select test.assert((select count(*) from public.appointments) = 0, 'other doctor sees none of these appointments');

-- Finance: no direct patient access, only the minimal directory with a masked phone.
select test.login(:'chief');
select test.assert((select count(*) from public.patients) = 0, 'accountant cannot read patient table');
select test.assert((select phone_masked from public.patient_directory(array[:'pid'::uuid])) = '+20100*****67', 'directory masks phone');
select test.assert((select count(*) from public.patient_alerts) = 0, 'accountant cannot read clinical alerts');

-- Role administration: nobody grants themselves a role.
select test.login(:'admin');
select test.expect_error(format($q$insert into public.user_roles (user_id, role_code, granted_by) values (%L, 'owner', %L)$q$,
  :'admin', :'admin'), 'row-level security');
insert into public.user_roles (user_id, role_code, branch_id, granted_by, valid_to, reason)
values (:'nobody', 'front_desk', :'b1', :'admin', now() + interval '1 day', 'temporary cover');
-- System admin configures but cannot read clinical alerts or post journals.
select test.assert((select count(*) from public.patient_alerts) = 0, 'admin cannot read clinical alerts');
select test.expect_error($q$select public.reverse_journal_entry(gen_random_uuid(), 'x')$q$, 'permission denied');

-- Temporary delegation works while valid, then expires.
select test.login(:'nobody');
select test.assert((select count(*) from public.patients where id = :'pid') = 1, 'delegated user can read during window');
reset role;
update public.user_roles set valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' where user_id = :'nobody';
set role authenticated;
select test.login(:'nobody');
select test.assert((select count(*) from public.patients where id = :'pid') = 0, 'expired delegation denies access');

-- Users cannot switch off their own account controls.
select test.login(:'fd');
select test.expect_error(format($q$update public.profiles set is_active = false where user_id = %L$q$, :'fd'), 'only through the administration screens');

-- Anonymous role has no access at all.
reset role;
set role anon;
select test.expect_error('select count(*) from public.patients', 'permission denied');
select test.expect_error('select count(*) from public.invoices', 'permission denied');
reset role;
