-- 02 — Patient record: normalization, validation, duplicates, no deletes
\set fd '00000000-0000-4000-8000-000000001002'
\set b1 '00000000-0000-4000-8000-000000000101'

set role authenticated;
select test.login(:'fd');

-- Arabic-Indic digits and spacing normalize to E.164
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, date_of_birth)
values (:'b1', 'أحمد', 'إبراهيم', '٠١٢ ٢٣٤٥ ٦٧٨٩', '1985-05-05') returning id as p1 \gset
select test.assert((select phone from public.patients where id = :'p1') = '+201223456789', 'arabic digits normalized to E.164');

-- Name search ignores hamza/alef variants and diacritics
select test.assert((select name_search from public.patients where id = :'p1') like 'احمد ابراهيم%', 'arabic name normalized');

-- Invalid inputs rejected
select test.expect_error(format($q$insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (%L, 'س', 'ص', 'abc')$q$, :'b1'), 'invalid phone');
select test.expect_error(format($q$insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, national_id) values (%L, 'س', 'ص', '01000000000', '123')$q$, :'b1'), 'check constraint');

-- Duplicate detection by phone (in a different format) and by similar name + DOB
select test.assert((select count(*) from public.find_patient_duplicates('+20 122 345 6789')) = 1, 'duplicate found by phone');
select test.assert((select match_reason from public.find_patient_duplicates('01099999999', null, 'احمد ابراهيم', '1985-05-05') limit 1) = 'name_dob',
                   'duplicate found by normalized name + DOB');

-- National ID must be unique across active records
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, national_id)
values (:'b1', 'نور', 'علي', '01111111111', '29505051234567');
select test.expect_error(format($q$insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, national_id) values (%L, 'نور', 'ع', '01122222222', '29505051234567')$q$, :'b1'), 'duplicate key');

-- Patients cannot be deleted (and front desk has no delete grant at all)
reset role;
select test.expect_error(format('delete from public.patients where id = %L', :'p1'), 'cannot be deleted');
set role authenticated;
select test.login(:'fd');
select test.expect_error(format('delete from public.patients where id = %L', :'p1'), 'permission denied');

-- Every change is audited with the actor
update public.patients set email = 'ahmed@example.com' where id = :'p1';
reset role;
select test.assert((select count(*) from public.audit_events where table_name = 'patients' and record_id = :'p1'
                     and action = 'UPDATE' and actor_id = :'fd' and changed @> array['email']) = 1, 'patient update audited with actor and changed columns');
select test.expect_error('update public.audit_events set reason = ''x''', 'append-only');
select test.expect_error('delete from public.audit_events', 'append-only');

-- Consents are append-only history; latest state wins
set role authenticated;
select test.login(:'fd');
insert into public.patient_consents (patient_id, kind, granted, document_version) values (:'p1', 'whatsapp_messages', true, 'v1');
insert into public.patient_consents (patient_id, kind, granted, document_version) values (:'p1', 'whatsapp_messages', false, 'v1');
select test.assert((select granted from public.patient_consent_current where patient_id = :'p1' and kind = 'whatsapp_messages') = false, 'latest consent wins');
reset role;
