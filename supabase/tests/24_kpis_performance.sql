-- 24 — Staff KPIs and performance reviews: clinic-defined criteria, weighted score, KPI snapshot, employee acknowledgement
\set fd      '00000000-0000-4000-8000-000000001002'
\set hr      '00000000-0000-4000-8000-000000001080'
\set nurseu  '00000000-0000-4000-8000-000000001082'
\set b1      '00000000-0000-4000-8000-000000000101'
select e.id as emp from public.employees e join public.staff s on s.id = e.staff_id where s.user_id = :'nurseu' \gset
select (date_trunc('month', (now() at time zone 'Africa/Cairo')) - interval '1 month')::date as pm \gset
select (date_trunc('month', (now() at time zone 'Africa/Cairo')) - interval '1 day')::date as pmend \gset

set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.save_review_criterion('CARE', '{"name_ar": "رعاية المرضى"}')$q$, 'permission denied');
select test.expect_error(format($q$select * from public.staff_kpis(%L, %L, %L)$q$, :'b1', :'pm', :'pmend'), 'permission denied');
select test.login(:'hr');
select public.save_review_criterion('CARE', '{"name_ar": "رعاية المرضى", "name_en": "Patient care", "weight": 2}') is not null as x \gset
select public.save_review_criterion('TEAM', '{"name_ar": "العمل الجماعي", "name_en": "Teamwork"}') is not null as x \gset
select test.assert((select days_present > 20 and days_absent = 1 from public.staff_kpis(:'b1', :'pm', :'pmend') where employee_id = :'emp'), 'KPIs from attendance: present days and the one absence');

select test.expect_error(format($q$select public.save_performance_review(%L)$q$, jsonb_build_object('employee_id', :'emp', 'period_from', :'pm', 'period_to', :'pmend', 'scores', '{"CARE": 6}'::jsonb)), 'from 1 to 5');
select test.expect_error(format($q$select public.save_performance_review(%L)$q$, jsonb_build_object('employee_id', :'emp', 'period_from', :'pm', 'period_to', :'pmend', 'scores', '{"XX": 3}'::jsonb)), 'unknown criterion');
select id as rv, overall, status from public.save_performance_review(jsonb_build_object('employee_id', :'emp', 'period_from', :'pm', 'period_to', :'pmend',
  'scores', '{"CARE": 5, "TEAM": 2}'::jsonb, 'strengths', 'تعامل ممتاز مع المرضى', 'goals', 'دورة مكافحة العدوى')) \gset
select test.assert(:'overall'::numeric = 4.00 and :'status' = 'draft', 'weighted score (5×2 + 2×1) ÷ 3 = 4.00');
select test.login(:'nurseu');
select test.assert((select count(*) = 0 from public.performance_reviews), 'employee does not see a draft');
select test.login(:'hr');
select status, kpis from public.save_performance_review(jsonb_build_object('id', :'rv', 'employee_id', :'emp', 'period_from', :'pm', 'period_to', :'pmend',
  'scores', '{"CARE": 5, "TEAM": 2}'::jsonb), true) \gset
select test.assert(:'status' = 'submitted' and (:'kpis'::jsonb ->> 'days_absent')::int = 1, 'submitted with a KPI snapshot');
select test.expect_error(format($q$select public.save_performance_review(%L)$q$, jsonb_build_object('id', :'rv', 'employee_id', :'emp', 'period_from', :'pm', 'period_to', :'pmend')), 'cannot be changed');
select test.login(:'nurseu');
select test.assert((select count(*) = 1 from public.performance_reviews where id = :'rv'), 'employee sees the submitted review');
select test.assert((select count(*) = 1 from public.staff_kpis(:'b1', :'pm', :'pmend', :'emp')), 'employee sees their own KPIs');
select test.expect_error(format($q$select * from public.staff_kpis(%L, %L, %L)$q$, :'b1', :'pm', :'pmend'), 'permission denied');
select status from public.acknowledge_review(:'rv', 'شكرًا، سأحضر الدورة') \gset
select test.assert(:'status' = 'acknowledged', 'employee acknowledged with a comment');
reset role;
