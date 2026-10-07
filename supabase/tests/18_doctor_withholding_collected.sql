-- 18 — Doctor fees: collected-basis contracts, withholding tax, cash payout, withholding remittance
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set prep    '00000000-0000-4000-8000-000000001010'
\set cd      '00000000-0000-4000-8000-000000001011'
\set b1      '00000000-0000-4000-8000-000000000101'
\set cons    '00000000-0000-4000-8000-000000004001'
\set d3_u    '00000000-0000-4000-8000-000000001090'
\set d3      '00000000-0000-4000-8000-000000002090'
\set d4_u    '00000000-0000-4000-8000-000000001091'
\set d4      '00000000-0000-4000-8000-000000002091'

insert into auth.users (id, email) values (:'d3_u', 'dr.wht@test.local'), (:'d4_u', 'dr.cash@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'d3_u', 'د. محصّل'), (:'d4_u', 'د. نقدي');
insert into public.user_roles (user_id, role_code, branch_id) values (:'d3_u', 'doctor', :'b1'), (:'d4_u', 'doctor', :'b1');
insert into public.staff (id, user_id, branch_id, kind, full_name_ar, specialty_id) values
  (:'d3', :'d3_u', :'b1', 'doctor', 'د. محصّل', (select id from public.specialties where code = 'derm')),
  (:'d4', :'d4_u', :'b1', 'doctor', 'د. نقدي', (select id from public.specialties where code = 'derm'));
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'تسوية', 'محصلة', '01088880051') returning id as pat \gset

-- Contracts: d3 40% on the collected basis with 5% withholding; d4 50% invoiced, no withholding
set role authenticated;
select test.login(:'chief');
select test.expect_error(format($q$select public.save_doctor_contract(%L, '2026-01-01', 40, '[]', null, 0, 120, 'collected')$q$, :'d3'), 'withholding tax must be 0 to 100');
select test.expect_error(format($q$select public.save_doctor_contract(%L, '2026-01-01', 40, '[]', null, 0, 5, 'weekly')$q$, :'d3'), 'basis must be');
select public.save_doctor_contract(:'d3', '2026-01-01', 40, '[]', null, 0, 5, 'collected') is not null as x \gset
select public.save_doctor_contract(:'d4', '2026-01-01', 50, '[]') is not null as x \gset

-- Invoice for d3, partly paid → nothing due yet on the collected basis
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i1 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i1', :'cons', :'d3', 1000);
select public.issue_invoice(:'i1') is not null as x \gset
select test.login(:'cashier');
select public.record_payment(:'i1', 400, 'card', 'wht-1', 'POS-W1') is not null as x \gset
select test.login(:'prep');
select id as r0, amount as a0 from public.prepare_settlement(:'d3', current_date) \gset
select test.assert(:'a0'::numeric = 0 and (select count(*) = 0 from public.settlement_lines where run_id = :'r0'), 'collected basis: a partly paid invoice is not due yet');
select public.cancel_settlement(:'r0', 'بانتظار التحصيل') is not null as x \gset

-- Fully paid → due: 40% of 1000 = 400, withholding 5% = 20, net 380
select test.login(:'cashier');
select public.record_payment(:'i1', 600, 'card', 'wht-2', 'POS-W2') is not null as x \gset
select test.login(:'prep');
select id as r1, amount, withholding, net_payable from public.prepare_settlement(:'d3', current_date) \gset
select test.assert(:'amount'::numeric = 400 and :'withholding'::numeric = 20 and :'net_payable'::numeric = 380, 'fully paid: share 400, withholding 20, net 380');
select test.login(:'cd');
select journal_entry_id as je from public.approve_settlement(:'r1') \gset
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '5100') = 400, 'Dr doctor fees 400');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '2300') = 380, 'Cr doctor payable 380');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'je' and a.code = '2430') = 20, 'Cr withholding tax payable 20');

-- Bank payout of the net
set role authenticated;
select test.login(:'chief');
select test.expect_error(format($q$select public.pay_settlement(%L, 'x', 'cheque')$q$, :'r1'), 'bank transfer or cash');
select pay_journal_entry_id as pje from public.pay_settlement(:'r1', 'BANK-W1') \gset
reset role;
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'pje' and a.code = '1110') = 380, 'bank pays the net 380');

-- Cash payout from the payer's open session; the drawer expects it
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as i2 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'i2', :'cons', :'d4', 500);
select public.issue_invoice(:'i2') is not null as x \gset
select test.login(:'prep');
select id as r2, net_payable as n2 from public.prepare_settlement(:'d4', current_date) \gset
select test.assert(:'n2'::numeric = 250, 'invoiced basis unchanged: 50% of 500 on issue');
select test.login(:'cd');
select public.approve_settlement(:'r2') is not null as x \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.pay_settlement(%L, null, 'cash')$q$, :'r2'), 'open a cashier session');
reset role;
insert into public.cashier_sessions (branch_id, cashier_id, opening_float) values (:'b1', :'chief', 1000) returning id as sess \gset
set role authenticated;
select test.login(:'chief');
select public.pay_settlement(:'r2', null, 'cash') is not null as x \gset
reset role;
select test.assert(app.session_expected_cash(:'sess') = 750, 'cash payout of 250 leaves the drawer (1000 − 250)');
select test.assert((select pay_method = 'cash' and cashier_session_id = :'sess' from public.settlement_runs where id = :'r2'), 'payout recorded on the session');

-- Remitting the withheld tax
set role authenticated;
select test.login(:'chief');
select test.assert(public.withholding_due(:'b1') = 20, 'withholding due 20');
select test.expect_error(format($q$select public.pay_withholding_tax(%L, '2026-10', 25, 'ETA-1')$q$, :'b1'), 'more than the withholding tax due');
select test.expect_error(format($q$select public.pay_withholding_tax(%L, '2026-10', 20, '')$q$, :'b1'), 'requires a reference');
select public.pay_withholding_tax(:'b1', '2026-10', 20, 'ETA-1') is not null as x \gset
select test.assert(public.withholding_due(:'b1') = 0, 'nothing due after remittance');
select test.login(:'fd');
select test.expect_error(format($q$select public.pay_withholding_tax(%L, '2026-10', 1, 'x')$q$, :'b1'), 'permission denied');
select test.assert(public.withholding_due(:'b1') is null and (select count(*) = 0 from public.tax_remittances), 'front desk sees nothing');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
