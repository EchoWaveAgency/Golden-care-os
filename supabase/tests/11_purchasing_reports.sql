-- 11 — Purchase orders, supplier payments, profitability report
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set b1      '00000000-0000-4000-8000-000000000101'
\set inv_u   '00000000-0000-4000-8000-000000001020'
\set nurse_u '00000000-0000-4000-8000-000000001021'
\set acct    '00000000-0000-4000-8000-000000001040'
\set ops     '00000000-0000-4000-8000-000000001041'
\set dr      '00000000-0000-4000-8000-000000002004'
\set cons    '00000000-0000-4000-8000-000000004001'

insert into auth.users (id, email) values (:'acct', 'ap@test.local'), (:'ops', 'ops@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'acct', 'محاسب موردين'), (:'ops', 'مدير تشغيل');
insert into public.user_roles (user_id, role_code, branch_id) values (:'acct', 'accountant', :'b1'), (:'ops', 'operations_manager', :'b1');
select id as loc from public.inv_locations where code = 'MAIN' and branch_id = :'b1' \gset
select id as sup from public.suppliers limit 1 \gset
select id as gel from public.inv_items where code = 'GEL-US' \gset
select id as crm from public.inv_items where code = 'ANES-CRM' \gset

-- ---------- Purchase order: create → submit → approve (not by the creator) → receive (partial, then rest)
set role authenticated;
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.create_po(%L, %L, %L)$q$, :'loc', :'sup', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 1, 'unit_cost', 1))), 'permission denied');
select test.login(:'inv_u');
select test.expect_error(format($q$select public.create_po(%L, %L, %L)$q$, :'loc', :'sup',
  jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 1, 'unit_cost', 1), jsonb_build_object('item_id', :'gel', 'qty', 2, 'unit_cost', 1))), 'only once');
select id as po, total from public.create_po(:'loc', :'sup', jsonb_build_array(
  jsonb_build_object('item_id', :'gel', 'qty', 10, 'unit_cost', 30), jsonb_build_object('item_id', :'crm', 'qty', 5, 'unit_cost', 150)), current_date + 7, 'طلب شهري') \gset
select test.assert(:'total'::numeric = 1050, 'PO total 1050');
select test.expect_error(format($q$select public.receive_po(%L, 'X', '[]', 'r0')$q$, :'po'), 'must be approved');
select test.expect_error(format($q$select public.create_po(%L, %L, %L)$q$, :'loc', :'sup', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 1, 'unit_cost', 0))), 'unit cost are required');
select public.submit_po(:'po') is not null as x \gset
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'inv_u', 'operations_manager', :'b1') on conflict do nothing;
set role authenticated;
select test.login(:'inv_u');
select test.expect_error(format($q$select public.approve_po(%L)$q$, :'po'), 'you created');
select test.login(:'ops');
select public.approve_po(:'po') is not null as x \gset
select test.login(:'inv_u');
select id as gl from public.po_lines where po_id = :'po' and item_id = :'gel' \gset
select id as cl from public.po_lines where po_id = :'po' and item_id = :'crm' \gset
select test.expect_error(format($q$select public.receive_po(%L, 'SUP-PO-1', %L, 'r1')$q$, :'po', jsonb_build_array(jsonb_build_object('po_line_id', :'gl', 'lot_no', 'P1', 'qty', 11))), 'more than ordered');
select id as gr1, total as t1 from public.receive_po(:'po', 'SUP-PO-1', jsonb_build_array(jsonb_build_object('po_line_id', :'gl', 'lot_no', 'P1', 'qty', 6)), 'r1') \gset
select test.assert(:'t1'::numeric = 180, 'receipt priced from the order (6 × 30)');
select test.assert((select id from public.receive_po(:'po', 'SUP-PO-1', jsonb_build_array(jsonb_build_object('po_line_id', :'gl', 'lot_no', 'P1', 'qty', 6)), 'r1')) = :'gr1', 'retry does not receive twice');
select test.assert((select received_qty from public.po_lines where id = :'gl') = 6 and (select status from public.purchase_orders where id = :'po') = 'partially_received', 'partially received');
select test.expect_error(format($q$select public.cancel_po(%L, 'x')$q$, :'po'), 'nothing received');
select id as gr2, total as t2 from public.receive_po(:'po', 'SUP-PO-2', jsonb_build_array(
  jsonb_build_object('po_line_id', :'gl', 'lot_no', 'P2', 'qty', 4),
  jsonb_build_object('po_line_id', :'cl', 'lot_no', 'C9', 'qty', 5, 'expiry', (current_date + 200)::text)), 'r2') \gset
select test.assert(:'t2'::numeric = 870 and (select status from public.purchase_orders where id = :'po') = 'received', 'fully received (120 + 750)');
select test.assert((select count(*) = 2 from public.goods_receipts where po_id = :'po' and confirmed_by = :'ops'), 'receipts against an approved order are confirmed by its approver');

-- ---------- Close short: a partly received order can be closed at the received quantity
select id as po2 from public.create_po(:'loc', :'sup', jsonb_build_array(
  jsonb_build_object('item_id', :'gel', 'qty', 10, 'unit_cost', 30), jsonb_build_object('item_id', :'crm', 'qty', 2, 'unit_cost', 150))) \gset
select test.expect_error(format($q$select public.close_po(%L, 'x')$q$, :'po2'), 'only partly received');
select public.submit_po(:'po2') is not null as x \gset
select test.login(:'ops');
select public.approve_po(:'po2') is not null as x \gset
select test.login(:'inv_u');
select id as g2 from public.po_lines where po_id = :'po2' and item_id = :'gel' \gset
select public.receive_po(:'po2', 'SUP-PO-3', jsonb_build_array(jsonb_build_object('po_line_id', :'g2', 'lot_no', 'P3', 'qty', 3)), 'r3') is not null as x \gset
select test.expect_error(format($q$select public.close_po(%L, '')$q$, :'po2'), 'reason is required');
select status as st2, total as tot2 from public.close_po(:'po2', 'المورد لا يملك الباقي') \gset
select test.assert(:'st2' = 'received' and :'tot2'::numeric = 90, 'closed short at 3 × 30');
select test.assert((select count(*) = 2 and sum(qty - closed_short_qty) = 3 and sum(closed_short_qty) = 9 from public.po_lines where po_id = :'po2'), 'lines kept; undelivered quantity recorded as closed short');
select test.expect_error(format($q$select public.receive_po(%L, 'SUP-PO-4', %L, 'r4')$q$, :'po2', jsonb_build_array(jsonb_build_object('po_line_id', :'g2', 'lot_no', 'P4', 'qty', 1))), 'must be approved');

-- ---------- Direct receipt (no order) must be confirmed by an approver who did not record it
select id as grd from public.receive_goods(:'loc', :'sup', 'SUP-DIRECT-1', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'D1', 'qty', 2, 'unit_cost', 40)), 'rd1') \gset
select test.expect_error(format($q$select public.confirm_receipt(%L)$q$, :'grd'), 'you recorded');

-- ---------- Supplier payments: request by the accountant, release by the chief; outstanding enforced
select test.login(:'acct');
select test.expect_error(format($q$select public.request_supplier_payment(%L, %L, 'bank_transfer', 'TRF-1')$q$, :'sup', jsonb_build_array(jsonb_build_object('receipt_id', :'gr1', 'amount', 181))), 'exceeds what is outstanding');
select id as sp1, amount from public.request_supplier_payment(:'sup', jsonb_build_array(
  jsonb_build_object('receipt_id', :'gr1', 'amount', 180), jsonb_build_object('receipt_id', :'gr2', 'amount', 400)), 'bank_transfer', 'TRF-0929') \gset
select test.assert(:'amount'::numeric = 580, 'payment total 580');
select test.expect_error(format($q$select public.request_supplier_payment(%L, %L, 'bank_transfer', 'TRF-2')$q$, :'sup', jsonb_build_array(jsonb_build_object('receipt_id', :'gr2', 'amount', 471))), 'exceeds what is outstanding');
select test.expect_error(format($q$select public.decide_supplier_payment(%L, true)$q$, :'sp1'), 'permission denied');
select test.expect_error(format($q$select public.request_supplier_payment(%L, %L, 'bank_transfer', 'TRF-D')$q$, :'sup', jsonb_build_array(jsonb_build_object('receipt_id', :'grd', 'amount', 80))), 'must be confirmed by an approver');
select test.assert((select (x->>'outstanding')::numeric = 870 and (x->>'pending')::numeric = 400 from jsonb_array_elements((public.supplier_statement(:'sup'))->'receipts') x where x->>'id' = :'gr2'), 'statement shows outstanding and pending');
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'acct', 'chief_accountant', null);
select set_config('app.admin_rpc', 'on', false);
update public.profiles set mfa_required = false where user_id = :'acct';
select set_config('app.admin_rpc', '', false);
set role authenticated;
select test.login(:'acct');
select test.expect_error(format($q$select public.decide_supplier_payment(%L, true)$q$, :'sp1'), 'you requested');
select test.login(:'chief');
select public.confirm_receipt(:'grd') is not null as x \gset
select test.assert((select confirmed_by = :'chief' from public.goods_receipts where id = :'grd'), 'direct receipt confirmed by the chief accountant');
select journal_entry_id as pje from public.decide_supplier_payment(:'sp1', true, 'تم التحويل') \gset
select test.expect_error(format($q$select public.decide_supplier_payment(%L, true)$q$, :'sp1'), 'already paid');
reset role;
select test.assert((select amount_paid from public.goods_receipts where id = :'gr2') = 400, 'receipt partly paid');
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'pje' and a.code = '2100') = 580, 'Dr suppliers 580');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'pje' and a.code = '1110') = 580, 'Cr bank 580');
set role authenticated;
select test.login(:'chief');
select test.assert(((public.supplier_statement(:'sup'))->'aging'->>'d0_30')::numeric >= 470, 'aging bucket 0–30 holds the unpaid 470');
select test.login(:'fd');
select test.expect_error(format($q$select public.supplier_statement(%L)$q$, :'sup'), 'permission denied');
select test.assert((select count(*) = 0 from public.supplier_payments), 'no supplier payment visibility without permission');

-- ---------- Profitability: one invoice with consumables issued to its appointment
reset role;
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'ربح', 'تقرير', '01088880001') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status)
values (:'b1', :'pat', :'dr', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '4 days', now() + interval '4 days 20 minutes'), 'booked') returning id as apt \gset
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id, appointment_id) values (:'b1', :'pat', :'apt') returning id as inv \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price, discount) values (:'inv', :'cons', :'dr', 1000, 100);
select public.issue_invoice(:'inv') is not null as x \gset
select test.login(:'nurse_u');
select public.issue_stock(:'loc', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 1)), :'apt', null, 'prof-1') is not null as x \gset
select test.login(:'chief');
select * from public.report_profitability(current_date, current_date, :'b1') where doctor_id = :'dr' and service_code = 'DERM-CONS' \gset r_
select test.assert(:'r_net_revenue'::numeric >= 900, 'net revenue includes the 900 line');
select test.assert(:'r_consumables'::numeric > 0, 'consumables cost allocated from the appointment issue');
select test.assert(:'r_margin'::numeric = :'r_net_revenue'::numeric - :'r_doctor_share'::numeric - :'r_consumables'::numeric, 'margin = net − doctor share − consumables');
select sum(consumables) as cons_before, sum(net_revenue) as net_before from public.report_profitability(current_date, current_date, :'b1') \gset
-- A second invoice on the same appointment shares the same issued cost: consumables are split, never counted twice
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id, appointment_id) values (:'b1', :'pat', :'apt') returning id as inv2 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price, discount) values (:'inv2', :'cons', :'dr', 900, 0);
select public.issue_invoice(:'inv2') is not null as x \gset
select test.login(:'chief');
select sum(consumables) as cons_after, sum(net_revenue) as net_after from public.report_profitability(current_date, current_date, :'b1') \gset
select test.assert(abs(:'cons_after'::numeric - :'cons_before'::numeric) <= 0.01, 'second invoice on the appointment does not double the consumables cost');
select test.assert(:'net_after'::numeric - :'net_before'::numeric = 900, 'second invoice adds its revenue');
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.report_profitability(current_date, current_date, null)), 'no report without reports.finance');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
