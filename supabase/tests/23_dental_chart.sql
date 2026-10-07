-- 23 — Dental chart: only the treating dentist records findings; latest finding per tooth; plan work on the chart; void with reason
\set fd      '00000000-0000-4000-8000-000000001002'
\set drderm  '00000000-0000-4000-8000-000000001004'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set b1      '00000000-0000-4000-8000-000000000101'
\set dent    '00000000-0000-4000-8000-000000002005'

insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'مخطط', 'أسنان', '01088880091') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pat', :'dent', (select id from public.specialties where code = 'dental'), tstzrange(now() + interval '990 days', now() + interval '990 days 30 minutes'));
select id as fill from public.services where code = 'T-FILL' \gset

set role authenticated;
select test.login(:'drderm');
select test.expect_error(format($q$select public.record_dental_findings(%L, '[{"tooth": "16", "condition": "caries"}]')$q$, :'pat'), 'only the treating dentist');
select test.login(:'fd');
select test.expect_error(format($q$select public.record_dental_findings(%L, '[{"tooth": "16", "condition": "caries"}]')$q$, :'pat'), 'only the treating dentist');
select test.assert(public.dental_chart(:'pat') is null, 'front desk does not see the chart');
select test.login(:'drdent');
select test.expect_error(format($q$select public.record_dental_findings(%L, '[{"tooth": "19", "condition": "caries"}]')$q$, :'pat'), 'FDI');
select test.expect_error(format($q$select public.record_dental_findings(%L, '[{"tooth": "16", "condition": "broken"}]')$q$, :'pat'), 'check');
select public.record_dental_findings(:'pat', '[{"tooth": "16", "condition": "caries", "surfaces": "mo"}, {"tooth": "36", "condition": "missing"}, {"tooth": "55", "condition": "healthy"}]') as n \gset
select test.assert(:'n'::int = 3, 'three findings recorded');
select public.record_dental_findings(:'pat', '[{"tooth": "16", "condition": "filled", "surfaces": "MO", "note": "حشو كومبوزيت"}]') is not null as x \gset
select test.assert((public.dental_chart(:'pat'))->'teeth'->'16'->>'condition' = 'filled', 'latest finding wins (caries → filled)');
select test.assert((select count(*) = 4 from jsonb_array_elements((public.dental_chart(:'pat'))->'history')), 'history keeps every entry');
-- plan work appears on the chart
select id as tp from public.save_treatment_plan(jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'title', 'زرعة',
  'items', jsonb_build_array(jsonb_build_object('service_id', :'fill', 'tooth', '26')))) \gset
select public.propose_plan(:'tp') is not null as x \gset
select test.assert((select count(*) = 1 from jsonb_array_elements((public.dental_chart(:'pat'))->'plan') x where x->>'tooth' = '26' and x->>'status' = 'planned'), 'planned work on tooth 26 shown');
-- void
select (public.dental_chart(:'pat'))->'teeth'->'36'->>'id' as f36 \gset
select test.expect_error(format($q$select public.void_dental_finding(%L, '')$q$, :'f36'), 'reason is required');
select public.void_dental_finding(:'f36', 'سجلت على السن الخطأ');
select test.assert((public.dental_chart(:'pat'))->'teeth'->'36' is null, 'voided finding leaves the chart');
reset role;
select test.expect_error(format($q$delete from public.dental_chart_entries where id = %L$q$, :'f36'), 'cannot be deleted');
