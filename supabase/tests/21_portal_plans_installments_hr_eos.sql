-- 21 — Treatment plans in the portal (acceptance, online installment payment, reminders); annual increments; end of service
\set fd      '00000000-0000-4000-8000-000000001002'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set chief   '00000000-0000-4000-8000-000000001006'
\set hr      '00000000-0000-4000-8000-000000001080'
\set dir     '00000000-0000-4000-8000-000000001081'
\set b1      '00000000-0000-4000-8000-000000000101'
\set dent    '00000000-0000-4000-8000-000000002005'
\set pu      '00000000-0000-4000-8000-000000009021'
\set pu2     '00000000-0000-4000-8000-000000009002'
\set nu      '00000000-0000-4000-8000-000000001092'

select id as fill from public.services where code = 'T-FILL' \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'خطة', 'بوابة', '01088880071') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pat', :'dent', (select id from public.specialties where code = 'dental'), tstzrange(now() + interval '950 days', now() + interval '950 days 30 minutes'));
insert into auth.users (id, email) values (:'pu', 'plan@portal.local');
select app.portal_link_account(:'pu', :'pat');

-- ---------- The doctor proposes; reception allows up to 3 monthly installments online
set role authenticated;
select test.login(:'drdent');
select id as tp from public.save_treatment_plan(jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'title', 'حشو',
  'items', jsonb_build_array(jsonb_build_object('service_id', :'fill', 'tooth', '11')))) \gset
select public.propose_plan(:'tp', 30) is not null as x \gset
select test.expect_error(format($q$select public.set_plan_portal_options(%L, 3)$q$, :'tp'), 'permission denied');
select test.login(:'fd');
select public.set_plan_portal_options(:'tp', 3) is not null as x \gset

-- ---------- The patient sees and accepts it in the portal
select test.login(:'pu');
select test.assert((select (x->>'status') = 'proposed' and (x->>'max_installments')::int = 3 and (x->>'total')::numeric = 1200
                    from jsonb_array_elements(public.portal_plans(:'pat')) x where x->>'id' = :'tp'), 'patient sees the proposed plan with its price');
select test.expect_error(format($q$select public.portal_accept_plan(%L, 4)$q$, :'tp'), 'between 1 and 3');
select status, acceptance_method from public.portal_accept_plan(:'tp', 3) \gset
select test.assert(:'status' = 'accepted' and :'acceptance_method' = 'portal', 'accepted from the portal');
select test.assert((select count(*) = 3 and sum((x->>'amount')::numeric) = 1200 and min((x->>'due_on')::date) = app.cairo_today()
                    from jsonb_array_elements((select x->'installments' from jsonb_array_elements(public.portal_plans(:'pat')) x where x->>'id' = :'tp')) x),
  'three monthly installments of 400 starting today');
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_plans(%L)$q$, :'pat'), 'not found');
select test.expect_error(format($q$select public.portal_pay_installment(%L)$q$, :'tp'), 'not found');

-- ---------- Online payment of the installment due now → advance deposit allocated to the installment
select test.login(:'pu');
select (public.portal_pay_installment(:'tp'))->>'intent_id' as intent \gset
reset role;
select test.assert((select amount = 400 and plan_id = :'tp' and invoice_id is null from public.payment_intents where id = :'intent'), 'intent for the 400 due today');
select public.svc_payment_intent_attach(:'intent', 'dev', 'ORD-PLAN-1') as attached \gset
select test.assert((public.svc_payment_intent(:'intent'))->>'invoice_no' = (select ref from public.treatment_plans where id = :'tp'), 'gateway description uses the plan reference');
select test.assert(app.payment_confirm('dev', 'ORD-PLAN-1', 'TX-PLAN-1', 40000, true) = 'paid', 'gateway confirmation accepted');
select test.assert(app.payment_confirm('dev', 'ORD-PLAN-1', 'TX-PLAN-1', 40000, true) = 'paid', 'duplicate callback ignored');
select test.assert((select count(*) = 1 and sum(amount) = 400 from public.patient_deposits where plan_id = :'tp' and method = 'online'), 'one online deposit of 400');
select test.assert((select paid_amount = 400 from public.plan_installments where plan_id = :'tp' and seq = 1), 'first installment paid');
select test.assert(app.advance_available(:'pat') = 400, 'money held in the advance until the work is billed');
select test.assert((select sum(l.debit) = 400 from public.journal_lines l join public.accounts a on a.id = l.account_id join public.patient_deposits d on d.journal_entry_id = l.entry_id
                    where d.plan_id = :'tp' and a.code = '1150'), 'Dr gateway clearing 400');
set role authenticated;
select test.login(:'pu');
select test.assert((public.portal_payment_status(:'intent'))->>'kind' = 'plan' and (public.portal_payment_status(:'intent'))->>'receipt_no' like 'DEP%', 'status page shows the deposit receipt');

-- ---------- Reminder 3 days before an installment, once
reset role;
select set_config('app.plan_rpc', 'on', false);
update public.plan_installments set due_on = app.cairo_today() + 3 where plan_id = :'tp' and seq = 2;
select set_config('app.plan_rpc', '', false);
select test.assert(app.enqueue_installment_reminders() = 1, 'one reminder queued');
select test.assert(app.enqueue_installment_reminders() = 0, 'not queued twice');
select test.assert((select vars->>'amount' = '400.00' and template_code = 'installment_due' from public.message_outbox where patient_id = :'pat' order by created_at desc limit 1), 'reminder carries the amount');

-- ---------- Annual increment: 10% on the basic salary from next month
insert into auth.users (id, email) values (:'nu', 'eos@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'nu', 'موظف مغادر');
insert into public.user_roles (user_id, role_code, branch_id) values (:'nu', 'nurse', :'b1');
insert into public.staff (user_id, branch_id, kind, full_name_ar) values (:'nu', :'b1', 'nurse', 'موظف مغادر') returning id as nstaff \gset
select (date_trunc('month', (now() at time zone 'Africa/Cairo')) + interval '1 month')::date as nm \gset
set role authenticated;
select test.login(:'hr');
select id as emp from public.save_employee(jsonb_build_object('staff_id', :'nstaff', 'hire_date', date_trunc('month', current_date)::date, 'basic_salary', 6000, 'annual_leave_days', 21)) \gset
select test.expect_error(format($q$select public.apply_salary_increment(%L, '2026-01-15', 10)$q$, :'b1'), 'first day of a month');
select test.expect_error(format($q$select public.apply_salary_increment(%L, %L, 10, 'OVERTIME')$q$, :'b1', :'nm'), 'fixed earning');
select public.apply_salary_increment(:'b1', :'nm', 10, 'BASIC', array[:'emp']::uuid[]) as n \gset
select test.assert(:'n'::int = 1 and (select amount = 6600 from public.employee_pay_items where employee_id = :'emp' and component_code = 'BASIC' and lower(effective) = :'nm'::date),
  'basic 6,000 → 6,600 from next month; history kept');
select test.login(:'fd');
select test.expect_error(format($q$select public.apply_salary_increment(%L, %L, 10)$q$, :'b1', :'nm'), 'permission denied');

-- ---------- End of service: leave encashment and loan from the records; gratuity and tax entered by HR
select test.login(:'hr');
select id as loan from public.request_loan(:'emp', 500, 2, date_trunc('month', current_date)::date, 'سلفة') \gset
select test.login(:'chief');
select public.decide_loan(:'loan', true) is not null as x \gset
select test.login(:'dir');
select public.disburse_loan(:'loan', 'cash', 'C-1') is not null as x \gset
select test.login(:'hr');
select test.expect_error(format($q$select public.prepare_eos(%L, true, 0, 0, 0, 0, null)$q$, :'emp'), 'end the employment first');
select public.end_employment(:'emp', current_date, 'استقالة') is not null as x \gset
select id as eos, leave_days, leave_amount, loan_deduction, net from public.prepare_eos(:'emp', true, 1000, 0, 50, 0, 'تسوية نهائية') \gset
select test.assert(:'leave_days'::numeric = 21 and :'leave_amount'::numeric = 4200, '21 unused days × 6,000 ÷ 30 = 4,200');
select test.assert(:'loan_deduction'::numeric = 500 and :'net'::numeric = 4650, 'net = 4,200 + 1,000 − 500 loan − 50 tax = 4,650');
select test.expect_error(format($q$select public.prepare_eos(%L, false, 0, 0, 0, 0, null)$q$, :'emp'), 'already exists');
select test.expect_error(format($q$select public.decide_eos(%L, true)$q$, :'eos'), 'permission denied');
select test.login(:'chief');
select journal_entry_id as eje from public.decide_eos(:'eos', true) \gset
select test.expect_error(format($q$select public.pay_eos(%L, 'bank_transfer', 'T')$q$, :'eos'), 'approver cannot also record');
select test.login(:'dir');
select status from public.pay_eos(:'eos', 'bank_transfer', 'TRF-EOS') \gset
select test.assert(:'status' = 'paid', 'paid by a third person');
reset role;
select test.assert((select status = 'settled' and repaid = 500 from public.employee_loans where id = :'loan'), 'loan settled from the payout');
select test.assert((select sum(debit) filter (where a.code = '5200') = 5200 and sum(credit) filter (where a.code = '2400') = 4650
                    and sum(credit) filter (where a.code = '1160') = 500 and sum(credit) filter (where a.code = '2420') = 50
                    from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'eje'), 'Dr salaries 5,200 / Cr payable 4,650, advances 500, tax 50');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
