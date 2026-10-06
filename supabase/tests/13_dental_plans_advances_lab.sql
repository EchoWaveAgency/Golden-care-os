-- 13 — Treatment plans, installments, patient advances, lab cases, supplier bills, lab cost share
\set fd      '00000000-0000-4000-8000-000000001002'
\set drderm  '00000000-0000-4000-8000-000000001004'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set acc     '00000000-0000-4000-8000-000000001060'
\set b1      '00000000-0000-4000-8000-000000000101'
\set dent    '00000000-0000-4000-8000-000000002005'
\set pl      '00000000-0000-4000-8000-000000005001'

-- Fixtures: dental services with prices, a laboratory, an accountant
insert into public.services (specialty_id, code, name_ar, name_en) values
  ((select id from public.specialties where code = 'dental'), 'T-FILL', 'حشو', 'Filling'),
  ((select id from public.specialties where code = 'dental'), 'T-CROWN', 'تاج زيركون', 'Zirconia crown');
select id as fill from public.services where code = 'T-FILL' \gset
select id as crown from public.services where code = 'T-CROWN' \gset
insert into public.price_list_items (price_list_id, service_id, price, effective) values
  (:'pl', :'fill', 1200, daterange('2026-01-01', null)), (:'pl', :'crown', 6000, daterange('2026-01-01', null));
insert into public.suppliers (name_ar, is_lab) values ('معمل اختبار', true) returning id as lab \gset
insert into public.suppliers (name_ar) values ('مورد عادي') returning id as notlab \gset
insert into auth.users (id, email) values (:'acc', 'acc13@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'acc', 'محاسب');
insert into public.user_roles (user_id, role_code, branch_id) values (:'acc', 'accountant', :'b1');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'خطة', 'أسنان', '01099990013') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pat', :'dent', (select id from public.specialties where code = 'dental'), tstzrange(now() + interval '900 days', now() + interval '900 days 30 minutes'));
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'غير', 'معالج', '01099990014') returning id as stranger \gset

-- ---------- Plan: only the treating doctor writes it; prices come from the price list
set role authenticated;
select test.login(:'drderm');
select test.expect_error(format($q$select public.save_treatment_plan(%L)$q$, jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'doctor_id', :'dent', 'title', 'x')), 'not under your care');
select test.login(:'drdent');
select test.expect_error(format($q$select public.save_treatment_plan(%L)$q$, jsonb_build_object('patient_id', :'stranger', 'branch_id', :'b1', 'title', 'خطة')), 'not under your care');
select test.expect_error(format($q$select public.save_treatment_plan(%L)$q$, jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'title', 'خطة',
  'items', jsonb_build_array(jsonb_build_object('service_id', :'fill', 'tooth', '19')))), 'FDI');
select id as tp from public.save_treatment_plan(jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'title', 'حشو وتاج',
  'items', jsonb_build_array(
    jsonb_build_object('service_id', :'fill', 'tooth', '16', 'surfaces', 'mo', 'discount', 100, 'unit_price', 1),
    jsonb_build_object('service_id', :'crown', 'tooth', '36', 'lab_required', true)))) \gset
select test.assert((select total = 7100 and subtotal = 7200 and discount_total = 100 and status = 'draft' from public.treatment_plans where id = :'tp'), 'priced from the list (client price ignored): 1,200 − 100 + 6,000');
select test.assert((select surfaces = 'MO' from public.treatment_plan_items where plan_id = :'tp' and seq = 1), 'surfaces normalised');
select test.login(:'fd');
select test.expect_error(format($q$select public.propose_plan(%L)$q$, :'tp'), 'only your own');
select test.expect_error(format($q$update public.treatment_plans set total = 1 where id = %L$q$, :'tp'), 'permission denied');
select test.login(:'drdent');
select quote_no from public.propose_plan(:'tp', 30) \gset
select test.assert(:'quote_no' like 'QT-%', 'quotation number issued');
select test.expect_error(format($q$select public.save_treatment_plan(%L)$q$, jsonb_build_object('id', :'tp', 'title', 'x')), 'only a draft');

-- ---------- Acceptance with an installment schedule that adds up to the total
select test.login(:'fd');
select test.expect_error(format($q$select public.accept_plan(%L, 'signed_paper', %L)$q$, :'tp',
  jsonb_build_array(jsonb_build_object('due_on', current_date, 'amount', 3000))), 'add up');
select test.expect_error(format($q$select public.accept_plan(%L, 'signed_paper', %L)$q$, :'tp',
  jsonb_build_array(jsonb_build_object('due_on', current_date - 1, 'amount', 7100))), 'today or later');
select status from public.accept_plan(:'tp', 'signed_paper', jsonb_build_array(
  jsonb_build_object('due_on', current_date, 'amount', 3000), jsonb_build_object('due_on', current_date + 30, 'amount', 2100),
  jsonb_build_object('due_on', current_date + 60, 'amount', 2000)), 'وقّع المريض على عرض السعر') \gset
select test.assert(:'status' = 'accepted', 'plan accepted');

-- ---------- Advances: down payment against the plan pays installment 1
select test.expect_error(format($q$select public.record_deposit(%L, %L, 3000, 'cash', 'dep-x')$q$, :'pat', :'b1'), 'open a cashier session');
select test.expect_error(format($q$select public.record_deposit(%L, %L, 3000, 'advance', 'dep-y')$q$, :'pat', :'b1'), 'unknown payment method');
select test.expect_error(format($q$select public.record_deposit(%L, %L, 10, 'card', 'apply:K1', 'R')$q$, :'pat', :'b1'), 'idempotency key is required');
select id as dep1, journal_entry_id as dje from public.record_deposit(:'pat', :'b1', 3000, 'card', 'dep-1', 'POS-77', :'tp') \gset
select test.assert((select id from public.record_deposit(:'pat', :'b1', 3000, 'card', 'dep-1', 'POS-77', :'tp')) = :'dep1', 'retry returns the same deposit');
select test.assert((select paid_amount = 3000 from public.plan_installments where plan_id = :'tp' and seq = 1)
               and (select paid_amount = 0 from public.plan_installments where plan_id = :'tp' and seq = 2), 'installment 1 paid in full');
reset role;
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'dje' and a.code = '2200') = 3000, 'Cr patient advances 3,000');
set role authenticated;
select test.login(:'cashier');
select test.assert((select balance = 3000 and available = 3000 from public.patient_advance(:'pat')), 'advance balance 3,000');

-- ---------- Work done → invoiced → paid from the advance
select test.login(:'drdent');
select id as it1 from public.treatment_plan_items where plan_id = :'tp' and seq = 1 \gset
select id as it2 from public.treatment_plan_items where plan_id = :'tp' and seq = 2 \gset
select status from public.complete_plan_item(:'it1') \gset
select test.assert((select status = 'in_progress' from public.treatment_plans where id = :'tp'), 'plan in progress');
select test.expect_error(format($q$select public.complete_plan_item(%L)$q$, :'it1'), 'already done');
select test.login(:'fd');
select id as inv1, total as t1, status as s1 from public.bill_plan_items(:'tp') \gset
select test.assert(:'t1'::numeric = 1100 and :'s1' = 'paid', 'completed filling invoiced (1,100) and paid from the advance');
select test.expect_error(format($q$select public.bill_plan_items(%L)$q$, :'tp'), 'no completed items');
select test.assert((select balance = 1900 from public.patient_advance(:'pat')), 'advance balance 1,900 after use');
select test.assert((select doctor_id = :'dent' from public.invoice_lines where invoice_id = :'inv1'), 'invoice line carries the plan doctor');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as inv_big \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv_big', :'crown', 6000);
select public.issue_invoice(:'inv_big') is not null as x \gset
select test.expect_error(format($q$select public.record_payment(%L, 1, 'advance', 'adv-direct')$q$, :'inv_big'), 'its own button');
select test.expect_error(format($q$select public.apply_advance(%L, 1901, 'ap-1')$q$, :'inv_big'), 'exceeds the advance balance');
select test.login(:'chief');
select public.void_invoice(:'inv_big', 'اختبار') is not null as x \gset

-- ---------- Lab case for the crown
select test.login(:'drdent');
select test.expect_error(format($q$select public.create_lab_case(%L)$q$, jsonb_build_object('plan_item_id', :'it2', 'lab_id', :'notlab', 'work_type', 'تاج')), 'dental laboratory');
select id as lc, service_id as lc_svc from public.create_lab_case(jsonb_build_object('plan_item_id', :'it2', 'lab_id', :'lab', 'work_type', 'تاج زيركون', 'shade', 'A2', 'due_on', (current_date + 7)::text)) \gset
select test.assert(:'lc_svc' = :'crown' and (select teeth = '36' and doctor_id = :'dent' from public.lab_cases where id = :'lc'), 'case linked to the crown, tooth and doctor');
select test.expect_error(format($q$select public.lab_case_set_status(%L, 'delivered')$q$, :'lc'), 'cannot move from ordered to delivered');
select test.login(:'drderm');
select test.assert((select count(*) = 0 from public.lab_cases where id = :'lc'), 'another doctor does not see the lab case');
select test.login(:'acc');
select test.expect_error(format($q$select public.record_supplier_bill(%L)$q$, jsonb_build_object('kind', 'lab', 'supplier_id', :'lab', 'lab_case_id', :'lc', 'bill_no', 'LB-0', 'amount', 10)), 'not been sent');
select test.login(:'drdent');
select public.lab_case_set_status(:'lc', 'sent') is not null as x \gset
select public.lab_case_set_status(:'lc', 'returned') is not null as x \gset
select test.expect_error(format($q$select public.lab_case_set_status(%L, 'remake')$q$, :'lc'), 'reason is required');
select public.lab_case_set_status(:'lc', 'remake', 'اللون غير مطابق') is not null as x \gset
select public.lab_case_set_status(:'lc', 'sent') is not null as x \gset
select public.lab_case_set_status(:'lc', 'returned') is not null as x \gset
select status, remakes from public.lab_case_set_status(:'lc', 'delivered') \gset
select test.assert(:'status' = 'delivered' and :'remakes'::int = 1 and (select count(*) = 7 from public.lab_case_events where case_id = :'lc'), 'lab flow with one remake, every step logged');
select test.login(:'fd');
select test.expect_error(format($q$select public.lab_case_set_status(%L, 'sent')$q$, :'lc'), 'permission denied');

-- ---------- Lab bill: expense + payable; confirmed by another person; paid through the supplier payment flow
select test.login(:'acc');
select id as bill, journal_entry_id as bje from public.record_supplier_bill(jsonb_build_object('kind', 'lab', 'supplier_id', :'lab', 'lab_case_id', :'lc', 'bill_no', 'LB-1', 'amount', 1500)) \gset
select test.expect_error(format($q$select public.record_supplier_bill(%L)$q$, jsonb_build_object('kind', 'lab', 'supplier_id', :'lab', 'lab_case_id', :'lc', 'bill_no', 'LB-1', 'amount', 10)), 'already recorded');
select test.expect_error(format($q$select public.record_supplier_bill(%L)$q$, jsonb_build_object('kind', 'lab', 'supplier_id', :'notlab', 'lab_case_id', :'lc', 'bill_no', 'X', 'amount', 10)), 'case''s laboratory');
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'bje' and a.code = '5500') = 1500, 'Dr lab costs 1,500');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'bje' and a.code = '2100') = 1500, 'Cr suppliers payable 1,500');
select test.assert((select cost = 1500 from public.lab_cases where id = :'lc'), 'case cost updated');
set role authenticated;
select test.login(:'acc');
select test.expect_error(format($q$select public.request_supplier_payment(%L, %L, 'bank_transfer', 'TRF-L1')$q$, :'lab', jsonb_build_array(jsonb_build_object('bill_id', :'bill', 'amount', 1500))), 'must be confirmed');
select test.expect_error(format($q$select public.confirm_supplier_bill(%L)$q$, :'bill'), 'permission denied');
select test.login(:'chief');
select public.confirm_supplier_bill(:'bill') is not null as x \gset
select test.login(:'acc');
select test.expect_error(format($q$select public.request_supplier_payment(%L, %L, 'bank_transfer', 'TRF-L1')$q$, :'lab', jsonb_build_array(jsonb_build_object('bill_id', :'bill', 'amount', 1501))), 'exceeds what is outstanding');
select id as sp from public.request_supplier_payment(:'lab', jsonb_build_array(jsonb_build_object('bill_id', :'bill', 'amount', 1500)), 'bank_transfer', 'TRF-L1') \gset
select test.assert((select (x->>'pending')::numeric = 1500 and x->>'kind' = 'bill' from jsonb_array_elements((public.supplier_statement(:'lab'))->'receipts') x), 'statement shows the bill with the pending payment');
select test.login(:'chief');
select public.decide_supplier_payment(:'sp', true) is not null as x \gset
reset role;
select test.assert((select amount_paid = 1500 from public.supplier_bills where id = :'bill'), 'bill paid');

-- An unconfirmed bill stays out of settlements; a wrong bill is voided (journal reversed, case cost reduced)
set role authenticated;
select test.login(:'acc');
select id as bill2, journal_entry_id as bje2 from public.record_supplier_bill(jsonb_build_object('kind', 'lab', 'supplier_id', :'lab', 'lab_case_id', :'lc', 'bill_no', 'LB-2', 'amount', 400)) \gset

-- ---------- Settlement: 40% of the service, minus 50% of the lab bill
set role authenticated;
select test.login(:'chief');
select public.save_doctor_contract(:'dent', date_trunc('month', current_date)::date, 40, '[]', 'عقد أسنان', 50) is not null as x \gset
select id as run from public.prepare_settlement(:'dent', current_date) \gset
select test.assert((select amount = 440 from public.settlement_lines where run_id = :'run' and kind = 'service' and invoice_id = :'inv1'), 'service share 40% × 1,100 = 440');
select test.assert((select count(*) = 1 and sum(base) = -1500 and sum(amount) = -750 and min(percent) = 50 from public.settlement_lines where run_id = :'run' and kind = 'lab_cost'),
  'lab share −50% × 1,500 = −750 (the unconfirmed 400 bill is left out)');
select public.cancel_settlement(:'run', 'اختبار') is not null as x \gset
select test.login(:'acc');
select test.expect_error(format($q$select public.void_supplier_bill(%L, '')$q$, :'bill2'), 'reason is required');
select test.expect_error(format($q$select public.void_supplier_bill(%L, 'خطأ')$q$, :'bill'), 'only unpaid bills');
select public.void_supplier_bill(:'bill2', 'رقم فاتورة خطأ') is not null as x \gset
select test.expect_error(format($q$select public.void_supplier_bill(%L, 'مرة أخرى')$q$, :'bill2'), 'already void');
select test.login(:'chief');
select test.expect_error(format($q$select public.confirm_supplier_bill(%L)$q$, :'bill2'), 'is void');
reset role;
select test.assert((select cost = 1500 from public.lab_cases where id = :'lc'), 'void bill removed from the case cost');
select test.assert((select status = 'reversed' from public.journal_entries where id = :'bje2'), 'void bill journal reversed');
set role authenticated;
select test.login(:'chief');
select test.assert((select count(*) = 1 from jsonb_array_elements((public.supplier_statement(:'lab'))->'receipts')), 'void bill off the supplier statement');

-- ---------- Crown done → invoice 6,000, the remaining 1,900 advance applied
select test.login(:'drdent');
select public.complete_plan_item(:'it2') is not null as x \gset
select test.assert((select status = 'completed' from public.treatment_plans where id = :'tp'), 'plan completed when every item is done');
select test.login(:'fd');
select id as inv2, total as t2, amount_paid as p2, status as s2 from public.bill_plan_items(:'tp') \gset
select test.assert(:'t2'::numeric = 6000 and :'p2'::numeric = 1900 and :'s2' = 'partially_paid', 'crown invoiced 6,000; 1,900 paid from the advance');
select test.assert((select balance = 0 from public.patient_advance(:'pat')), 'advance used up');
select public.record_deposit(:'pat', :'b1', 2100, 'card', 'dep-2', 'POS-78', :'tp') is not null as x \gset
select test.assert((select paid_amount = 2100 from public.plan_installments where plan_id = :'tp' and seq = 2), 'second installment paid');

-- ---------- Refund of an unused advance: request → approve (not the requester) → pay; cash closing counts it
select public.open_cashier_session(:'b1', 0) is not null as x \gset
select public.record_deposit(:'pat', :'b1', 500, 'cash', 'dep-3') is not null as x \gset
select test.expect_error(format($q$select public.request_deposit_refund(%L, %L, 2700, 'cash', 'المريض سافر')$q$, :'pat', :'b1'), 'exceeds the advance balance');
select id as dr1 from public.request_deposit_refund(:'pat', :'b1', 300, 'cash', 'المريض سافر') \gset
select test.assert((select available = 2300 and balance = 2600 from public.patient_advance(:'pat')), 'pending refund reserves the amount');
select test.expect_error(format($q$select public.decide_deposit_refund(%L, true)$q$, :'dr1'), 'permission denied');
select test.login(:'chief');
select public.decide_deposit_refund(:'dr1', true) is not null as x \gset
select test.login(:'cashier');
select public.open_cashier_session(:'b1', 1000) is not null as x \gset
select status, journal_entry_id as rje from public.pay_deposit_refund(:'dr1') \gset
select test.assert(:'status' = 'paid' and (select balance = 2300 from public.patient_advance(:'pat')), 'refund paid; balance 2,300');
select id as csess from public.cashier_sessions where cashier_id = :'cashier' and status = 'open' \gset
select test.assert((select expected_cash = 700 from public.close_cashier_session(:'csess', 700)), 'cashier expected cash: 1,000 float − 300 refund');
select test.login(:'fd');
select id as fsess from public.cashier_sessions where cashier_id = :'fd' and status = 'open' \gset
select test.assert((select expected_cash = 500 from public.close_cashier_session(:'fsess', 500)), 'front desk expected cash includes the 500 advance');

-- ---------- Visibility and follow-up lists
select test.login(:'drderm');
select test.assert((select count(*) = 0 from public.treatment_plans where id = :'tp'), 'another doctor does not see the plan');
select test.login(:'acc');
select test.assert((select count(*) = 1 from public.treatment_plans where id = :'tp'), 'finance sees the plan (prices) for billing');
reset role;
select set_config('app.plan_rpc', 'on', false);
update public.plan_installments set due_on = current_date - 5 where plan_id = :'tp' and seq = 3;
select set_config('app.plan_rpc', '', false);
set role authenticated;
select test.login(:'fd');
select test.assert((select days_late = 5 and amount - paid_amount = 2000 from public.overdue_installments(:'b1') where plan_id = :'tp'), 'overdue installment listed');

-- ---------- Cancelling a plan keeps work done and money paid
select test.login(:'drdent');
select id as tp2 from public.save_treatment_plan(jsonb_build_object('patient_id', :'pat', 'branch_id', :'b1', 'title', 'خطة ثانية',
  'items', jsonb_build_array(jsonb_build_object('service_id', :'fill', 'tooth', '26'), jsonb_build_object('service_id', :'fill', 'tooth', '27'), jsonb_build_object('service_id', :'fill', 'tooth', '25')))) \gset
select public.propose_plan(:'tp2') is not null as x \gset
select test.login(:'fd');
select public.accept_plan(:'tp2', 'in_person', jsonb_build_array(jsonb_build_object('due_on', current_date, 'amount', 1200), jsonb_build_object('due_on', current_date + 30, 'amount', 2400))) is not null as x \gset
select id as tp2b from public.treatment_plan_items where plan_id = :'tp2' and seq = 2 \gset
select public.cancel_plan_item(:'tp2b', 'السن لا يحتاج حشو') is not null as x \gset
select test.assert((select total = 2400 from public.treatment_plans where id = :'tp2') and (select amount = 1200 from public.plan_installments where plan_id = :'tp2' and seq = 2),
  'cancelled item lowers the plan total and the last installment');
-- Plan invoice voided → items can be billed again (no advance available: a pending refund reserves it)
select id as hold from public.request_deposit_refund(:'pat', :'b1', (select available from public.patient_advance(:'pat')), 'card', 'حجز للاختبار') \gset
select test.login(:'drdent');
select id as tp2a from public.treatment_plan_items where plan_id = :'tp2' and seq = 1 \gset
select public.complete_plan_item(:'tp2a') is not null as x \gset
select test.login(:'fd');
select id as inv3, amount_paid as p3 from public.bill_plan_items(:'tp2') \gset
select test.assert(:'p3'::numeric = 0, 'nothing applied while the advance is reserved by a pending refund');
select test.login(:'chief');
select public.void_invoice(:'inv3', 'فوترة خطأ') is not null as x \gset
select public.decide_deposit_refund(:'hold', false, 'اختبار') is not null as x \gset
select test.login(:'fd');
select test.assert((select invoice_id is null from public.treatment_plan_items where id = :'tp2a'), 'voided plan invoice releases its item');
select id as inv4, amount_paid as p4 from public.bill_plan_items(:'tp2') \gset
select test.assert(:'p4'::numeric = 1200, 'item billed again and paid from the advance');
select test.expect_error(format($q$select public.cancel_plan(%L, '')$q$, :'tp2'), 'reason is required');
select status from public.cancel_plan(:'tp2', 'المريض اختار عيادة أخرى') \gset
select test.assert(:'status' = 'cancelled' and (select status = 'done' from public.treatment_plan_items where id = :'tp2a'), 'plan cancelled; work already done stays');
select test.assert((select status = 'cancelled' from public.treatment_plan_items where plan_id = :'tp2' and seq = 3), 'open items cancelled with the plan');

-- ---------- Profitability includes lab costs
select test.login(:'chief');
select test.assert((select lab_costs = 1500 and doctor_share = 2400 - 750 and margin = net_revenue - doctor_share - consumables - lab_costs
                    from public.report_profitability(current_date, current_date, :'b1') where service_id = :'crown' and doctor_id = :'dent'), 'crown row carries its lab cost');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
