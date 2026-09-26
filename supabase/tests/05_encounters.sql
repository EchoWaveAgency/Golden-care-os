-- 05 — Clinical encounters: treating-doctor access, sign-off, immutability, addenda
\set fd      '00000000-0000-4000-8000-000000001002'
\set dr_u    '00000000-0000-4000-8000-000000001004'
\set dr2_u   '00000000-0000-4000-8000-000000001005'
\set dr      '00000000-0000-4000-8000-000000002004'
\set dr2     '00000000-0000-4000-8000-000000002005'
\set b1      '00000000-0000-4000-8000-000000000101'

set role authenticated;
select test.login(:'fd');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'سلمى', 'رءوف', '01066666666') returning id as pid \gset
select id as derm from public.specialties where code = 'derm' \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pid', :'dr', :'derm', tstzrange('2026-12-01 09:00+02', '2026-12-01 09:20+02')) returning id as apt \gset

-- Front desk cannot write clinical records
select test.expect_error(format($q$insert into public.encounters (branch_id, patient_id, doctor_id, specialty_id) values (%L, %L, %L, %L)$q$,
  :'b1', :'pid', :'dr', :'derm'), 'row-level security');

-- Treating doctor documents the visit and records an allergy
select test.login(:'dr_u');
insert into public.encounters (branch_id, patient_id, doctor_id, appointment_id, specialty_id, chief_complaint, data)
values (:'b1', :'pid', :'dr', :'apt', :'derm', 'حب الشباب', '{"skin_type": "III"}') returning id as enc \gset
insert into public.patient_alerts (patient_id, kind, severity, label) values (:'pid', 'allergy', 'high', 'Penicillin');

-- Another doctor cannot document as someone else or read the encounter
select test.login(:'dr2_u');
select test.assert((select count(*) from public.encounters where id = :'enc') = 0, 'other doctor cannot read encounter');
select test.expect_error(format($q$select public.sign_encounter(%L)$q$, :'enc'), 'not found or not accessible');
select test.expect_error(format($q$insert into public.encounters (branch_id, patient_id, doctor_id, specialty_id) values (%L, %L, %L, %L)$q$,
  :'b1', :'pid', :'dr', :'derm'), 'row-level security');

-- Reception sees that an allergy exists, not what it is
select test.login(:'fd');
select test.assert((select count(*) from public.patient_alerts where patient_id = :'pid') = 0, 'front desk cannot read alert contents');
select test.assert((select kind::text || ':' || severity::text from public.patient_alert_flags(:'pid')) = 'allergy:high', 'front desk sees alert flag');

-- Sign-off locks the record; corrections are addenda
select test.login(:'dr_u');
select test.assert((select status from public.sign_encounter(:'enc')) = 'signed', 'encounter signed');
select test.expect_error(format($q$update public.encounters set assessment = 'changed' where id = %L$q$, :'enc'), 'signed encounter cannot be modified');
insert into public.encounter_addenda (encounter_id, body) values (:'enc', 'تصحيح: نوع البشرة IV');
select test.assert((select count(*) from public.encounter_addenda where encounter_id = :'enc') = 1, 'addendum stored');
select test.expect_error(format($q$update public.encounter_addenda set body = 'x' where encounter_id = %L$q$, :'enc'), 'permission denied');
select test.expect_error(format($q$select public.sign_encounter(%L)$q$, :'enc'), 'already signed');

reset role;
select test.assert((select count(*) from public.audit_events where table_name = 'encounters' and record_id = :'enc') >= 2, 'encounter creation and signing audited');
