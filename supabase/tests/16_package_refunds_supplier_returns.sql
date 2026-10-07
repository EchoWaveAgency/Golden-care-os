-- 16 — Package refunds (maker-checker, fee kept, redemption hold) and transfers; returns to suppliers
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set inv_u   '00000000-0000-4000-8000-000000001020'
\set b1      '00000000-0000-4000-8000-000000000101'

select id as tpl from public.package_templates where lower(code) = 'lsr-full-3' \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'استرداد', 'باقة', '01088880031') returning id as p1 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'تحويل', 'باقة', '01088880032') returning id as p2 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'مستلم', 'التحويل', '01088880033') returning id as p3 \gset

-- ---------- Refund of an unused package: 900 unused, fee 100 kept, 800 paid back
set role authenticated;
select test.login(:'fd');
select id as pkg, invoice_id as inv from public.sell_package(:'p1', :'tpl', :'b1', 100) \gset
select test.expect_error(format($q$select public.request_package_refund(%L, 0, 'card', 'سفر')$q$, :'pkg'), 'not fully paid');
select test.login(:'cashier');
select public.record_payment(:'inv', 900, 'card', 'prf-pay-1', 'POS-PRF') is not null as x \gset
select test.login(:'fd');
select test.expect_error(format($q$select public.request_package_refund(%L, 1000, 'card', 'سفر')$q$, :'pkg'), 'between 0 and the unused value');
select test.expect_error(format($q$select public.request_package_refund(%L, 0, 'advance', 'سفر')$q$, :'pkg'), 'cash, card, transfer or wallet');
select id as rf, amount, fee from public.request_package_refund(:'pkg', 100, 'card', 'سفر للخارج') \gset
select test.assert(:'amount'::numeric = 800 and :'fee'::numeric = 100, '900 unused: 800 back, 100 fee');
select test.expect_error(format($q$select public.request_package_refund(%L, 0, 'card', 'مرة أخرى')$q$, :'pkg'), 'duplicate key');
select test.expect_error(format($q$select public.decide_package_refund(%L, true)$q$, :'rf'), 'permission denied');
reset role;
select set_config('app.package_rpc', 'on', false);
select test.expect_error(format($q$update public.patient_packages set units_used = 1, value_used = 300 where id = %L$q$, :'pkg'), 'refund of this package is in progress');
select set_config('app.package_rpc', '', false);
set role authenticated;
select test.login(:'chief');
select status from public.decide_package_refund(:'rf', true) \gset
select test.login(:'cashier');
select test.expect_error(format($q$select public.pay_package_refund(%L)$q$, :'rf'), 'requires a reference');
select journal_entry_id as rje, status from public.pay_package_refund(:'rf', 'POS-REV-1') \gset
reset role;
select test.assert(:'status' = 'paid' and (select status = 'refunded' from public.patient_packages where id = :'pkg'), 'refund paid; package closed');
select test.assert((select sum(debit) = 900 and sum(credit) = 900 from public.journal_lines where entry_id = :'rje'), 'journal balanced');
select test.assert((select debit = 900 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'rje' and a.code = '2210'), 'deferred balance released');
select test.assert((select credit = 100 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'rje' and a.code = '4130'), 'fee kept as other income');

-- ---------- Transfer of remaining sessions to another patient
set role authenticated;
select test.login(:'fd');
select id as pkg2, invoice_id as inv2 from public.sell_package(:'p2', :'tpl', :'b1', 0) \gset
select test.login(:'cashier');
select public.record_payment(:'inv2', 1000, 'card', 'ptr-pay-1', 'POS-PTR') is not null as x \gset
select test.login(:'fd');
select test.expect_error(format($q$select public.transfer_package(%L, %L, 'هدية')$q$, :'pkg2', :'p3'), 'permission denied');
select test.login(:'chief');
select test.expect_error(format($q$select public.transfer_package(%L, %L, 'هدية')$q$, :'pkg2', :'p2'), 'choose another patient');
select units, value, journal_entry_id as tje from public.transfer_package(:'pkg2', :'p3', 'هدية لأختها') \gset
reset role;
select test.assert(:'units'::int = 3 and :'value'::numeric = 1000 and (select patient_id = :'p3' from public.patient_packages where id = :'pkg2'), 'sessions moved to the new patient');
select test.assert((select sum(debit) filter (where patient_id = :'p2') = 1000 and sum(credit) filter (where patient_id = :'p3') = 1000 from public.journal_lines where entry_id = :'tje'),
  'deferred balance moved between patients');

-- ---------- Return to supplier: recorded by the store, approved by purchasing; reduces what is owed
select id as loc from public.inv_locations where code = 'MAIN' and branch_id = :'b1' \gset
select id as gel from public.inv_items where code = 'GEL-US' \gset
select id as sup from public.suppliers where name_ar = 'مورد تجريبي' \gset
set role authenticated;
select test.login(:'inv_u');
select id as gr, total from public.receive_goods(:'loc', :'sup', 'S-RET-1', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'RET1', 'qty', 10, 'unit_cost', 30)), 'ret-1') \gset
select id as lot from public.inv_lots where receipt_id = :'gr' \gset
select test.expect_error(format($q$select public.request_supplier_return(%L, %L, 'تالف')$q$, :'gr', jsonb_build_array(jsonb_build_object('lot_id', :'lot', 'qty', 11))), 'between 0 and what is in stock');
select id as srn from public.request_supplier_return(:'gr', jsonb_build_array(jsonb_build_object('lot_id', :'lot', 'qty', 4)), 'عبوات تالفة') \gset
select test.expect_error(format($q$select public.decide_supplier_return(%L, true)$q$, :'srn'), 'cannot approve a return you recorded');
select test.login(:'chief');
select status, total as rtotal, journal_entry_id as sje from public.decide_supplier_return(:'srn', true) \gset
reset role;
select test.assert(:'status' = 'approved' and :'rtotal'::numeric = 120, 'return valued at lot cost (4 × 30)');
select test.assert((select qty_on_hand = 6 and value_remaining = 180 from public.inv_lots where id = :'lot'), 'stock and value reduced');
select test.assert((select returned_amount = 120 and total - amount_paid = 180 from public.goods_receipts where id = :'gr'), 'delivery now owes 180');
select test.assert((select count(*) = 1 from public.stock_moves where ref_id = :'srn' and kind = 'supplier_return' and qty = -4), 'stock move recorded');
select test.assert((select debit = 120 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'sje' and a.code = '2100'), 'Dr suppliers payable');
select test.assert((select credit = 120 from public.journal_lines jl join public.accounts a on a.id = jl.account_id where jl.entry_id = :'sje' and a.code = '1300'), 'Cr inventory');
set role authenticated;
select test.login(:'inv_u');
select id as srn2 from public.request_supplier_return(:'gr', jsonb_build_array(jsonb_build_object('lot_id', :'lot', 'qty', 1)), 'تجربة الرفض') \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.decide_supplier_return(%L, false)$q$, :'srn2'), 'note is required');
select status from public.decide_supplier_return(:'srn2', false, 'لا يوجد عيب') \gset
reset role;
select test.assert(:'status' = 'rejected' and (select qty_on_hand = 6 from public.inv_lots where id = :'lot'), 'rejected return leaves stock unchanged');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
