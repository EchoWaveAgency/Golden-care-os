-- 15 — HR and payroll: employees, attendance import and computation, leave, loans, payroll math, journals, separation of duties
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set hr      '00000000-0000-4000-8000-000000001080'
\set dir     '00000000-0000-4000-8000-000000001081'
\set nurseu  '00000000-0000-4000-8000-000000001082'
\set b1      '00000000-0000-4000-8000-000000000101'

insert into auth.users (id, email) values (:'hr', 'hr15@test.local'), (:'dir', 'dir15@test.local'), (:'nurseu', 'nurse15@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'hr', 'موارد بشرية'), (:'dir', 'مدير'), (:'nurseu', 'ممرضة');
insert into public.user_roles (user_id, role_code, branch_id) values (:'hr', 'hr_manager', :'b1'), (:'dir', 'center_director', null), (:'nurseu', 'nurse', :'b1');
insert into public.staff (user_id, branch_id, kind, full_name_ar) values (:'nurseu', :'b1', 'nurse', 'ممرضة الاختبار') returning id as nstaff \gset
select (date_trunc('month', (now() at time zone 'Africa/Cairo')) - interval '1 month')::date as pm \gset
select (date_trunc('month', (now() at time zone 'Africa/Cairo')) - interval '1 day')::date as pmend \gset

-- ---------- Shift and employee file
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.save_employee(%L)$q$, jsonb_build_object('staff_id', :'nstaff')), 'permission denied');
select test.login(:'hr');
select id as shift from public.save_shift(jsonb_build_object('branch_id', :'b1', 'code', 'D', 'name_ar', 'صباحي', 'start_time', '08:00', 'end_time', '16:00',
  'break_minutes', 30, 'grace_minutes', 10, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6))) \gset
select id as emp, employee_no from public.save_employee(jsonb_build_object('staff_id', :'nstaff', 'hire_date', :'pm', 'job_title_ar', 'ممرضة',
  'insured_wage', 5000, 'biometric_id', '77', 'shift_id', :'shift', 'basic_salary', 9000, 'housing', 1000, 'bank_account', 'EG00TEST')) \gset
select test.assert((select count(*) = 2 from public.employee_pay_items where employee_id = :'emp'), 'basic and housing recorded');
select test.expect_error(format($q$select public.save_employee(%L)$q$, jsonb_build_object('staff_id', :'nstaff')), 'already has an employee file');

-- ---------- Attendance import: every day of last month present, except one absent day and one late day
select public.import_attendance(:'b1', (
  select jsonb_agg(x) from (
    select jsonb_build_object('biometric_id', '77', 'at', to_char(d + case when d = :'pm'::date + 1 then time '08:40' else time '07:55' end, 'YYYY-MM-DD HH24:MI')) x
    from generate_series(:'pm'::date, :'pmend'::date, interval '1 day') d where d <> :'pm'::date + 2
    union all
    select jsonb_build_object('biometric_id', '77', 'at', to_char(d + time '16:05', 'YYYY-MM-DD HH24:MI'))
    from generate_series(:'pm'::date, :'pmend'::date, interval '1 day') d where d <> :'pm'::date + 2
    union all select jsonb_build_object('biometric_id', '999', 'at', to_char(:'pm'::date + time '09:00', 'YYYY-MM-DD HH24:MI'))
    union all select jsonb_build_object('biometric_id', '77', 'at', 'not a date')) t), 'test-file') as imp \gset
select test.assert((:'imp'::jsonb)->>'unmatched' = '1' and (:'imp'::jsonb)->>'rejected' = '1', 'unknown id kept unmatched; bad row rejected');
select test.assert((public.import_attendance(:'b1', jsonb_build_array(jsonb_build_object('biometric_id', '77', 'at', to_char(:'pm'::date + time '07:55', 'YYYY-MM-DD HH24:MI'))), 'again'))->>'duplicates' = '1',
  're-importing the same punch is ignored');
select test.assert((select status = 'late' and late_minutes = 30 from public.attendance_days where employee_id = :'emp' and day = :'pm'::date + 1), 'late beyond the 10-minute grace');
select test.assert((select status = 'absent' from public.attendance_days where employee_id = :'emp' and day = :'pm'::date + 2), 'no punches → absent');
select test.assert((select status = 'present' and worked_minutes = 460 and overtime_minutes = 5 from public.attendance_days where employee_id = :'emp' and day = :'pm'), 'worked minutes net of the break');

-- Device push: only a registered device; its branch is used
select public.save_attendance_device(:'b1', 'ZK-TEST-1', 'بوابة الاختبار') is not null as x \gset
reset role;
select test.expect_error($q$select public.svc_device_punches('UNKNOWN', '[{"biometric_id": "77", "at": "2026-01-01 08:00"}]')$q$, 'unknown attendance device');
select (public.svc_device_punches('ZK-TEST-1', jsonb_build_array(jsonb_build_object('biometric_id', '77', 'at', to_char(now() at time zone 'Africa/Cairo' - interval '1 hour', 'YYYY-MM-DD HH24:MI')))))->>'inserted' as dev \gset
select test.assert(:'dev' = '1' and (select last_seen_at is not null from public.attendance_devices where serial_no = 'ZK-TEST-1'), 'registered device accepted');
set role authenticated;
select test.login(:'hr');

-- Manual punch needs another person's approval
select id as mp from public.add_manual_punch(:'emp', now() - interval '2 hours', 'نسيت البصمة') \gset
select test.expect_error(format($q$select public.decide_manual_punch(%L, true)$q$, :'mp'), 'cannot approve a punch you entered');

-- ---------- Leave: own request; the employee cannot approve it
select test.login(:'nurseu');
select test.assert((select count(*) = 1 from public.employees) and (select count(*) = 0 from public.payroll_runs), 'employee sees only their own file');
select id as lv, days from public.request_leave('ANNUAL', current_date + 10, current_date + 11, 'سفر') \gset
select test.assert(:'days'::numeric = 2, 'two working days');
select test.expect_error(format($q$select public.request_leave('ANNUAL', %L, %L)$q$, current_date + 11, current_date + 12), 'overlaps');
select test.expect_error(format($q$select public.decide_leave(%L, true)$q$, :'lv'), 'permission denied');
select test.login(:'hr');
select status from public.decide_leave(:'lv', true) \gset
select test.assert(:'status' = 'approved', 'HR approves the leave');

-- ---------- Payroll setup must be complete
select public.save_payroll_adjustment(:'emp', :'pm', 'PENALTY', 200, 'تأخير متكرر') is not null as x \gset
select test.expect_error(format($q$select public.prepare_payroll(%L, %L)$q$, :'b1', :'pm'), 'payroll setup incomplete');
select test.expect_error($q$select public.save_payroll_component('SI_EMPLOYEE', '{"rate": 11}')$q$, 'permission denied');
select test.login(:'chief');
select public.save_payroll_component('SI_EMPLOYEE', '{"rate": 11}') is not null as x \gset
select public.save_payroll_component('SI_EMPLOYER', '{"rate": 18.75}') is not null as x \gset
select public.save_payroll_component('OVERTIME', '{"rate": 1.5}') is not null as x \gset
select public.save_payroll_component('LATE', '{"rate": 1}') is not null as x \gset
select test.expect_error(format($q$select public.save_tax_brackets(%L, '[{"from": 0, "to": 40000, "rate": 0}, {"from": 50000, "rate": 10}]')$q$, :'pm'), 'without gaps');
select public.save_tax_brackets('2020-01-01', '[{"from": 0, "to": 40000, "rate": 0}, {"from": 40000, "rate": 10}]') as nb \gset

-- ---------- Loan: requested by HR, approved by the chief accountant, paid out by the director
select test.login(:'hr');
select id as loan from public.request_loan(:'emp', 1200, 3, :'pm', 'ظروف عائلية') \gset
select test.login(:'chief');
select status from public.decide_loan(:'loan', true) \gset
select test.expect_error(format($q$select public.disburse_loan(%L, 'cash', 'X')$q$, :'loan'), 'cannot pay out a loan you approved');
select test.login(:'dir');
select status from public.disburse_loan(:'loan', 'bank_transfer', 'TRF-1') \gset
select test.assert(:'status' = 'disbursed', 'loan paid out with a journal');

-- ---------- Prepare: 9,000 + 1,000; absence 300; lateness 30 min after grace × 0.625 = 18.75; penalty 200; insurance 550;
--            tax on (10,000 − 300 − 18.75 − 200 − 550) × 12 = 107,175 → (107,175 − 40,000) × 10% ÷ 12 = 559.79; loan 400
select test.login(:'hr');
select id as run, total_net from public.prepare_payroll(:'b1', :'pm') \gset
select test.assert((select earnings = 10000 and deductions = 2028.54 and net = 7971.46 and employer = 937.50 and absent_days = 1 and late_minutes = 30
                    from public.payroll_slips where run_id = :'run' and employee_id = :'emp'), 'payslip math');
select test.assert((select amount = 300 from public.payroll_lines where run_id = :'run' and component_code = 'ABSENCE')
                   and (select amount = 18.75 from public.payroll_lines where run_id = :'run' and component_code = 'LATE')
                   and (select amount = 559.79 from public.payroll_lines where run_id = :'run' and component_code = 'INCOME_TAX')
                   and (select amount = 400 from public.payroll_lines where run_id = :'run' and component_code = 'LOAN'), 'component amounts');
select test.expect_error(format($q$select public.prepare_payroll(%L, %L)$q$, :'b1', :'pm'), 'already prepared');
select test.expect_error(format($q$select public.approve_payroll(%L)$q$, :'run'), 'permission denied');
select test.expect_error($q$update public.payroll_lines set amount = 1$q$, 'permission denied');

-- ---------- Approve (accrual journal), pay (payment journal); three different people
select test.login(:'chief');
select accrual_entry_id as je from public.approve_payroll(:'run') \gset
select test.assert((select sum(debit) = sum(credit) and sum(debit) = 10937.50 from public.journal_lines where entry_id = :'je'), 'accrual balanced: earnings + employer insurance');
select test.assert((select sum(credit) = 7971.46 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'je' and a.code = '2400'), 'net pay to salaries payable');
select test.assert((select sum(credit) = 1487.50 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'je' and a.code = '2410'), 'insurance 550 + 937.50');
select test.assert((select repaid = 400 and status = 'disbursed' from public.employee_loans where id = :'loan'), 'loan installment recorded');
select test.expect_error(format($q$select public.pay_payroll(%L, 'bank_transfer', 'B1')$q$, :'run'), 'payer must be different');
select test.login(:'dir');
select status from public.pay_payroll(:'run', 'bank_transfer', 'BATCH-OCT') \gset
select test.assert(:'status' = 'paid', 'payroll paid');
select test.expect_error(format($q$select public.cancel_payroll(%L, 'x')$q$, :'run'), 'already paid');
select public.pay_payroll_liability(:'b1', 'social_insurance', :'pm', 1487.50, 'SI-OCT') is not null as x \gset

-- ---------- Locked month; self-service payslip; others cannot see it
select test.login(:'hr');
select test.expect_error(format($q$select public.set_roster(%L, %L, null)$q$, :'emp', :'pm'), 'already approved');
select test.login(:'nurseu');
select test.assert((select net = 7971.46 from public.payroll_slips where employee_id = :'emp'), 'employee sees their approved payslip');
select test.login(:'drdent');
select test.assert((select count(*) = 0 from public.payroll_slips) and (select count(*) = 0 from public.employees), 'a doctor sees no one''s pay');
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.attendance_days), 'front desk sees no attendance');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
