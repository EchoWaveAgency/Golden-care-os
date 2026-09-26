-- 09 — Doctor contracts & settlements, database-enforced two-factor sign-in
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set admin   '00000000-0000-4000-8000-000000001001'
\set nobody  '00000000-0000-4000-8000-000000001008'
\set dr_u    '00000000-0000-4000-8000-000000001012'
\set dr      '00000000-0000-4000-8000-000000002012'
\set dr2_u   '00000000-0000-4000-8000-000000001013'
\set dr2     '00000000-0000-4000-8000-000000002013'
\set b1      '00000000-0000-4000-8000-000000000101'
\set cons    '00000000-0000-4000-8000-000000004001'
\set laser   '00000000-0000-4000-8000-000000004002'
\set prep    '00000000-0000-4000-8000-000000001010'
\set cd      '00000000-0000-4000-8000-000000001011'

-- An accountant (preparer) and a center director (approver)
insert into auth.users (id, email) values (:'prep', 'accountant@test.local'), (:'cd', 'director@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'prep', 'محاسب'), (:'cd', 'مدير المركز');
insert into public.user_roles (user_id, role_code, branch_id) values (:'prep', 'accountant', null), (:'cd', 'center_director', null);
-- Two fresh doctors so earlier suites' invoices do not affect the figures
insert into auth.users (id, email) values (:'dr_u', 'dr.s1@test.local'), (:'dr2_u', 'dr.s2@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'dr_u', 'د. تسوية'), (:'dr2_u', 'د. بلا عقد');
insert into public.user_roles (user_id, role_code, branch_id) values (:'dr_u', 'doctor', :'b1'), (:'dr2_u', 'doctor', :'b1');
insert into public.staff (id, user_id, branch_id, kind, full_name_ar, specialty_id) values
  (:'dr', :'dr_u', :'b1', 'doctor', 'د. تسوية', (select id from public.specialties where code = 'derm')),
  (:'dr2', :'dr2_u', :'b1', 'doctor', 'د. بلا عقد', (select id from public.specialties where code = 'derm'));

-- ---------- Two-factor enforcement
select test.assert((select mfa_required from public.profiles where user_id = :'cd'), 'privileged role turns MFA on automatically');
select test.assert(not (select mfa_required from public.profiles where user_id = :'prep'), 'non-privileged role does not');
set role authenticated;
select test.login_aal(:'cd', 'aal1');
select test.assert(not app.has_permission('settlement.approve'), 'password-only session gets no permission');
select test.assert((select count(*) = 0 from public.my_permissions()), 'menu is empty until second factor');
select test.assert((public.my_security())->>'mfa_required' = 'true', 'UI can see MFA is required');
select test.assert((select count(*) = 0 from public.invoices), 'no data readable at aal1');
select test.login(:'cd');   -- aal2
select test.assert(app.has_permission('settlement.approve'), 'second factor restores access');
select test.login_aal(:'prep', 'aal1');
select test.assert(app.has_permission('settlement.prepare'), 'users without the MFA requirement are unaffected');
select test.login(:'admin');
select test.expect_error(format($q$select public.admin_set_mfa(%L, false, 'x')$q$, :'cd'), 'mandatory for privileged roles');
select public.admin_set_mfa(:'prep', true, 'يتعامل مع مدفوعات الأطباء');
select test.login_aal(:'prep', 'aal1');
select test.assert(not app.has_permission('settlement.prepare'), 'administrator can require MFA for any user');
select test.login(:'admin');
select public.admin_set_mfa(:'prep', false, 'مؤقت للاختبار');
select test.expect_error(format($q$select public.admin_set_mfa(%L, false, 'x')$q$, :'admin'), 'your own sign-in security');
select public.admin_mfa_reset(:'cd', 'فقد الهاتف');
reset role;
select test.assert((select count(*) = 1 from public.audit_events where action = 'MFA_RESET'), 'MFA reset audited');
select test.assert((select must_change_password from public.profiles where user_id = :'cd'), 'MFA reset forces a new temporary password');
select set_config('app.admin_rpc', 'on', false);
update public.profiles set must_change_password = false where user_id = :'cd';
select set_config('app.admin_rpc', '', false);
set role authenticated;
select test.login(:'admin');
select test.expect_error(format($q$update public.profiles set mfa_required = false where user_id = %L$q$, :'cd'), 'only through the administration screens');
select test.expect_error(format($q$update public.user_roles set role_code = 'owner' where user_id = %L$q$, :'prep'), 'cannot be rewritten');
select test.assert(public.admin_count() >= 1, 'administrator count available for the lock-out warning');
select test.expect_error(format($q$select public.svc_password_changed(%L)$q$, :'cd'), 'permission denied');
reset role;
-- A doctor who must use MFA has no doctor identity from a password-only session
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000001014', 'dr.mfa@test.local');
insert into public.profiles (user_id, full_name_ar) values ('00000000-0000-4000-8000-000000001014', 'د. حساس');
insert into public.user_roles (user_id, role_code, branch_id) values ('00000000-0000-4000-8000-000000001014', 'medical_director', null);
insert into public.staff (user_id, branch_id, kind, full_name_ar, specialty_id)
values ('00000000-0000-4000-8000-000000001014', :'b1', 'doctor', 'د. حساس', (select id from public.specialties where code = 'derm'));
set role authenticated;
select test.login_aal('00000000-0000-4000-8000-000000001014', 'aal1');
select test.assert(app.current_staff_id() is null, 'no doctor identity at aal1');
select test.login('00000000-0000-4000-8000-000000001014');
select test.assert(app.current_staff_id() is not null, 'doctor identity at aal2');
reset role;

-- ---------- Contracts
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.save_doctor_contract(%L, '2026-01-01', 40, '[]')$q$, :'dr'), 'permission denied');
select test.expect_error(format($q$insert into public.doctor_contracts (doctor_id, valid, default_percent) values (%L, '[2026-01-01,)', 40)$q$, :'dr'), 'permission denied');
select test.login(:'chief');
select public.save_doctor_contract(:'dr', '2026-01-01', 40, jsonb_build_array(jsonb_build_object('service_id', :'laser', 'fixed_amount', 250)), 'عقد تجريبي') as c1 \gset
select test.expect_error(format($q$select public.save_doctor_contract(%L, '2026-01-01', 45, '[]')$q$, :'dr'), 'already starts');

-- Invoices this month: consultation 500 (40% → 200) + laser x2 with 200 discount (fixed 250 x 2 → 500)
select test.login(:'fd');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'منى', 'تسوية', '01066660001') returning id as pat \gset
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i1 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i1', :'cons', :'dr', 500);
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price, quantity, discount) values (:'i1', :'laser', :'dr', 3000, 2, 200);
select public.issue_invoice(:'i1') is not null as x \gset
select public.record_payment(:'i1', 6300, 'instapay', 'k-09-1', 'IP-9') is not null as x \gset
-- an unpaid invoice (voided after settlement below)
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i3 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i3', :'cons', :'dr', 1000);
select public.issue_invoice(:'i3') is not null as x \gset
-- a line for another doctor must not appear
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i2 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i2', :'cons', :'dr2', 500);
select public.issue_invoice(:'i2') is not null as x \gset
-- refund 630 on i1 (10%) → deduct 10% of the doctor's 700 share = 70
select id as rf from public.request_refund(:'i1', 630, 'instapay', 'تعويض جزئي') \gset
select test.login(:'chief');
select public.decide_refund(:'rf', true, 'ok') is not null as x \gset
select public.pay_refund(:'rf', 'IP-R9') is not null as x \gset

-- ---------- Prepare → approve → pay
select test.login(:'prep');
select id as run, amount, gross_base, deductions from public.prepare_settlement(:'dr', current_date) \gset
select test.assert(:'gross_base'::numeric = 7300, 'base = net lines (500 + 5800 + 1000)');
select test.assert(:'deductions'::numeric = 70, 'refund deducted in proportion to the doctor share');
select test.assert(:'amount'::numeric = 1030, 'amount = 200 + 500 + 400 - 70');
select test.assert((select count(*) = 4 from public.settlement_lines where run_id = :'run'), 'three service lines + one refund line, other doctor excluded');
select test.expect_error(format($q$select public.prepare_settlement(%L, current_date)$q$, :'dr'), 'duplicate key');
select test.expect_error(format($q$select public.prepare_settlement(%L, (current_date + interval '2 months')::date)$q$, :'dr'), 'future month');
select test.expect_error(format($q$select public.approve_settlement(%L)$q$, :'run'), 'permission denied');
-- Doctor cannot see a draft
select test.login(:'dr_u');
select test.assert((select count(*) = 0 from public.settlement_runs where id = :'run'), 'doctor does not see drafts');
-- The preparer cannot approve even with the permission
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'prep', 'center_director', null);
select set_config('app.admin_rpc', 'on', false);
update public.profiles set mfa_required = false where user_id = :'prep';
select set_config('app.admin_rpc', '', false);
set role authenticated;
select test.login(:'prep');
select test.expect_error(format($q$select public.approve_settlement(%L)$q$, :'run'), 'separation of duties');
select test.login(:'cd');
select journal_entry_id as sje from public.approve_settlement(:'run') \gset
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'sje' and a.code = '5100') = 1030, 'Dr doctor fees 1030');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'sje' and a.code = '2300') = 1030, 'Cr doctor fees payable 1030');
set role authenticated;
select test.login(:'dr_u');
select test.assert((select count(*) = 1 from public.settlement_runs where id = :'run'), 'doctor sees own approved statement');
select test.assert((select count(*) = 4 from public.settlement_lines where run_id = :'run'), 'doctor sees its lines');
select test.assert((select count(*) = 0 from public.settlement_runs where doctor_id <> :'dr'), 'doctor sees no one else''s statements');
select test.login(:'chief');
select test.expect_error(format($q$select public.pay_settlement(%L, '')$q$, :'run'), 'requires a reference');
select pay_journal_entry_id as pje from public.pay_settlement(:'run', 'BANK-TRF-0926') \gset
select public.pay_settlement(:'run', 'BANK-TRF-0926') is not null as retry \gset
reset role;
select test.assert((select count(*) = 1 from public.journal_entries where source_type = 'settlement_payment' and source_id = :'run'), 'payment posted once');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');

-- ---------- Contracts are frozen for approved periods; drafts can be cancelled and redone
set role authenticated;
select test.login(:'cd');
select test.expect_error(format($q$select public.save_doctor_contract(%L, current_date, 50, '[]')$q$, :'dr'), 'already approved');
select public.save_doctor_contract(:'dr', (date_trunc('month', current_date) + interval '1 month')::date, 50, '[]') is not null as c2 \gset
reset role;
select test.assert((select upper(valid) = (date_trunc('month', current_date) + interval '1 month')::date from public.doctor_contracts where id = :'c1'), 'old contract ended the day the new one starts');
select test.expect_error(format($q$update public.doctor_contract_rates set fixed_amount = 1 where contract_id = %L$q$, :'c1'), 'used in an approved settlement');

-- Second doctor has no contract → cannot be approved
set role authenticated;
select test.login(:'prep');
select id as run2, lines_without_contract from public.prepare_settlement(:'dr2', current_date) \gset
select test.assert(:'lines_without_contract'::int = 1, 'lines without a contract are flagged');
select test.login(:'cd');
select test.expect_error(format($q$select public.approve_settlement(%L)$q$, :'run2'), 'without a contract');
select test.login(:'prep');
select public.cancel_settlement(:'run2', 'بانتظار العقد') is not null as x \gset
select test.login(:'cd');
select public.save_doctor_contract(:'dr2', '2026-01-01', 30, '[]') is not null as x \gset
select test.login(:'prep');
select id as run4, amount as amt2 from public.prepare_settlement(:'dr2', current_date) \gset
select test.assert(:'amt2'::numeric = 150, 'redo after cancel picks the lines up again (30% of 500)');
select test.login(:'cd');
select test.expect_error(format($q$select public.approve_settlement(%L)$q$, :'run4'), 'contract you entered');
select test.login(:'chief');
select public.save_doctor_contract(:'dr2', '2026-02-01', 35, '[]') is not null as x \gset
select test.login(:'cd');
select test.expect_error(format($q$select public.approve_settlement(%L)$q$, :'run4'), 'contract changed');

-- Void after settlement → reversal in the next run. (Simulate that the approved run was last month.)
reset role;
update public.settlement_runs set period = daterange((date_trunc('month', current_date) - interval '1 month')::date, date_trunc('month', current_date)::date) where id = :'run';
set role authenticated;
select test.login(:'chief');
select public.void_invoice(:'i3', 'أُصدرت بالخطأ') is not null as x \gset
select test.login(:'prep');
select id as run3, amount as amt3 from public.prepare_settlement(:'dr', current_date) \gset
select test.assert(:'amt3'::numeric = -400, 'voided invoice takes back the 400 already settled, nothing counted twice');
select test.assert((select count(*) = 1 from public.settlement_lines where run_id = :'run3' and kind = 'void_reversal'), 'one reversal line');
select test.login(:'cd');
select journal_entry_id as nje from public.approve_settlement(:'run3') \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.pay_settlement(%L, 'x')$q$, :'run3'), 'nothing to pay');
reset role;
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'nje' and a.code = '5100') = 400, 'negative settlement reverses the accrual');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger still balanced');

-- The -400 is carried into the next statement (simulate that run3 was two months ago)
update public.settlement_runs set period = daterange((date_trunc('month', current_date) - interval '2 month')::date, (date_trunc('month', current_date) - interval '1 month')::date) where id = :'run3';
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i4 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i4', :'cons', :'dr', 1000);
select public.issue_invoice(:'i4') is not null as x \gset
select test.login(:'prep');
select id as run5, amount as amt5, carried_in from public.prepare_settlement(:'dr', current_date) \gset
select test.assert(:'amt5'::numeric = 0 and :'carried_in'::numeric = -400, 'new 400 net of the carried -400 = 0');
select test.login(:'cd');
select journal_entry_id as cje from public.approve_settlement(:'run5') \gset
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'cje' and a.code = '5100') = 400, 'accrual posts only the new 400 (the -400 was posted before)');
select test.assert((select carried_to = :'run5' from public.settlement_runs where id = :'run3'), 'negative run marked as carried');
select test.assert((select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id where a.code = '2300' and l.doctor_id = :'dr') = -1030 + 1030, 'doctor payable is zero after pay, reversal and carry');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced at the end');
