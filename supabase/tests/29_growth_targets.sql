-- 29 — Growth plan targets: seeded targets, phase calendar, actual vs target (patients and leads), edits, permissions.
\set admin   '00000000-0000-4000-8000-000000001001'
\set fd      '00000000-0000-4000-8000-000000001002'
\set boss    '00000000-0000-4000-8000-000000001203'
\set mkt     '00000000-0000-4000-8000-000000001204'
\set dr      '00000000-0000-4000-8000-000000002004'
\set b1      '00000000-0000-4000-8000-000000000101'

-- Seeded from the growth plan.
select test.assert((select count(*) = 6 from public.growth_departments), 'six departments seeded');
select test.assert((select baseline_month = 8 and target_p1 = 67 and target_p2 = 94 and target_p3 = 134 from public.growth_departments where code = 'dental'), 'dental targets');
select test.assert((select growth_department = 'derm' from public.lead_campaigns where code = 'GF26-LASER'), 'laser campaign counts toward dermatology');

-- Phase calendar: no start → phase 1; then 13-week phases, capped at 3.
select test.assert(app.growth_phase('2027-01-01') = 1, 'no start date → phase 1');
update public.growth_settings set phase1_start = '2026-12-05';
select test.assert(app.growth_phase('2026-12-04') = 1 and app.growth_phase('2027-03-06') = 2 and app.growth_phase('2027-03-05') = 1
                   and app.growth_phase('2027-06-04') = 2 and app.growth_phase('2027-06-05') = 3 and app.growth_phase('2028-01-01') = 3, 'phase boundaries');

-- Baseline report for today (other suites already wrote leads and appointments; measure deltas).
set role authenticated;
select test.login(:'boss');
select actual_patients as p0, actual_leads as l0, booked as b0 from public.growth_progress(current_date, current_date) where code = 'derm' \gset

-- Target math for one week in phase 1 (dental: (67 − 8) × 1 ÷ (0.30 × 0.70) × 7 ÷ 30.31 ≈ 64.9 leads; 67 × 7 ÷ 30.31 ≈ 15.5 patients).
select test.assert((select target_leads = 64.9 and target_patients = 15.5 and phase = 1 and target_month = 67
                    from public.growth_progress('2026-12-05', '2026-12-11') where code = 'dental'), 'weekly lead and patient targets');
select test.assert((select target_leads = 0 from public.growth_progress('2026-12-05', '2026-12-11') where code = 'derm'), 'no growth in phase 1 → no extra leads needed');
select test.assert((select target_month = 335 from public.growth_progress('2027-03-06', '2027-03-12') where code = 'derm'), 'phase 2 target used in phase 2');

-- An attended dermatology visit today counts once per patient; a booked-only visit does not count.
reset role;
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'نور', 'هشام', '01099887711') returning id as gp1 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'دينا', 'فؤاد', '01099887722') returning id as gp2 \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status)
values (:'b1', :'gp1', :'dr', (select id from public.specialties where code = 'derm'),
        tstzrange(date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 01 minutes',
                  date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 20 minutes'), 'booked'),
       (:'b1', :'gp1', :'dr', (select id from public.specialties where code = 'derm'),
        tstzrange(date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 21 minutes',
                  date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 40 minutes'), 'booked'),
       (:'b1', :'gp2', :'dr', (select id from public.specialties where code = 'derm'),
        tstzrange(date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 41 minutes',
                  date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '23 hours 59 minutes'), 'booked');
update public.appointments set status = 'arrived' where patient_id = :'gp1' and status = 'booked';

-- A laser lead today counts toward dermatology leads.
select public.svc_lead_capture(jsonb_build_object('phone', '201099887733', 'name', 'Growth Lead', 'provider_id', 'wamid.GROWTH1',
  'text', 'عرض GF26-LASER لو سمحت')) as gl \gset

set role authenticated;
select test.login(:'boss');
select test.assert((select actual_patients = :p0 + 1 and actual_leads = :l0 + 1 and booked = :b0
                    from public.growth_progress(current_date, current_date) where code = 'derm'), 'actual patients (distinct, attended) and leads per department');

-- Marketing reads the report but cannot change targets; front desk can do neither.
select test.login(:'mkt');
select test.assert((select count(*) = 6 from public.growth_progress(current_date, current_date)), 'marketing reads progress');
select test.expect_error($q$select public.growth_update_department('dental', '{"target_p1": 1}')$q$, 'permission denied');
select test.expect_error($q$update public.growth_departments set target_p1 = 1 where code = 'dental'$q$, 'permission denied');
select test.login(:'fd');
select test.expect_error($q$select * from public.growth_progress(current_date, current_date)$q$, 'permission denied');
select test.assert((select count(*) = 0 from public.growth_departments), 'front desk sees no targets');

-- Operations manager replaces the booking assumption with the measured rate and edits a target (audited).
select test.login(:'boss');
select public.growth_update_settings('{"booking_rate": 0.42}');
select public.growth_update_department('dental', '{"target_p1": 70}');
select test.assert((select booking_rate = 0.42 from public.growth_settings), 'booking rate updated');
select test.assert((select target_month = 70 from public.growth_progress('2026-12-05', '2026-12-11') where code = 'dental'), 'new target used');
select test.expect_error($q$select public.growth_update_settings('{"booking_rate": 0}')$q$, 'growth_settings_booking_rate_check');
select test.expect_error($q$select public.growth_update_department('nope', '{}')$q$, 'department not found');
select test.expect_error($q$delete from public.growth_departments where code = 'dental'$q$, 'permission denied');
reset role;
select test.assert((select count(*) >= 2 from public.audit_events where table_name in ('growth_settings', 'growth_departments') and action = 'UPDATE'), 'edits audited');
update public.growth_settings set phase1_start = null, booking_rate = 0.30;
update public.growth_departments set target_p1 = 67 where code = 'dental';
