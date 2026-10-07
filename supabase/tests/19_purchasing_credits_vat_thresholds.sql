-- 19 — Purchasing finance: approval thresholds, VAT from the supplier's tax invoice, returns on paid deliveries → supplier credits
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cd      '00000000-0000-4000-8000-000000001011'
\set inv_u   '00000000-0000-4000-8000-000000001020'
\set acct    '00000000-0000-4000-8000-000000001040'
\set ops     '00000000-0000-4000-8000-000000001041'
\set b1      '00000000-0000-4000-8000-000000000101'
select id as loc from public.inv_locations where code = 'MAIN' and branch_id = :'b1' \gset
select id as gel from public.inv_items where code = 'GEL-US' \gset
insert into public.suppliers (name_ar, name_en) values ('مورد الضريبة', 'VAT supplier') returning id as sup \gset

-- ---------- Settings: thresholds are the clinic's decision (empty = off)
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.save_purchasing_settings('{"po_high_approval_above": 1}')$q$, 'permission denied');
select test.login(:'chief');
select public.save_purchasing_settings('{"po_high_approval_above": 1000, "payment_high_approval_above": 500}') is not null as x \gset

-- ---------- Purchase order above the limit needs two approvers, the second with the higher approval
select test.login(:'inv_u');
select id as po from public.create_po(:'loc', :'sup', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 50, 'unit_cost', 30))) \gset
select public.submit_po(:'po') is not null as x \gset
select test.login(:'ops');
select status as st1 from public.approve_po(:'po') \gset
select test.assert(:'st1' = 'submitted' and (select first_approved_by = :'ops' from public.purchase_orders where id = :'po'), 'first approval recorded, still waiting');
select test.expect_error(format($q$select public.approve_po(%L)$q$, :'po'), 'second, different approver');
select test.login(:'chief');
select test.expect_error(format($q$select public.approve_po(%L)$q$, :'po'), 'permission denied');
select test.login(:'cd');
select status as st2 from public.approve_po(:'po') \gset
select test.assert(:'st2' = 'approved', 'center director gives the second approval');
select test.login(:'inv_u');
select id as po2 from public.create_po(:'loc', :'sup', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 10, 'unit_cost', 30))) \gset
select public.submit_po(:'po2') is not null as x \gset
select test.login(:'ops');
select status as st3 from public.approve_po(:'po2') \gset
select test.assert(:'st3' = 'approved', 'below the limit one approval is enough');

-- ---------- VAT on a delivery: refused until the treatment is chosen; posted from the supplier's tax invoice
select test.login(:'inv_u');
select id as gr from public.receive_goods(:'loc', :'sup', 'S-VAT-1', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'VAT1', 'qty', 10, 'unit_cost', 100)), 'vat-1') \gset
select id as lot from public.inv_lots where receipt_id = :'gr' \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.set_receipt_vat(%L, 140, 'TX-1')$q$, :'gr'), 'choose the VAT treatment');
select public.save_purchasing_settings('{"po_high_approval_above": 1000, "payment_high_approval_above": 500, "vat_treatment": "recoverable"}') is not null as x \gset
select test.expect_error(format($q$select public.set_receipt_vat(%L, 140, '')$q$, :'gr'), 'tax invoice number');
select total as vtotal from public.set_receipt_vat(:'gr', 140, 'TX-1') \gset
select test.assert(:'vtotal'::numeric = 1140, 'delivery total includes VAT 1000 + 140');
select test.login(:'fd');
select test.expect_error(format($q$select public.set_receipt_vat(%L, 1, 'x')$q$, :'gr'), 'permission denied');
reset role;
select test.assert((select l.debit = 140 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
                    where e.source_type = 'receipt_vat' and e.source_id = :'gr' and a.code = '1170'), 'Dr input VAT 140');

-- ---------- Payment above the limit: released only with the higher approval
set role authenticated;
select test.login(:'chief');
select public.confirm_receipt(:'gr') is not null as x \gset
select test.login(:'acct');
select id as sp from public.request_supplier_payment(:'sup', jsonb_build_array(jsonb_build_object('receipt_id', :'gr', 'amount', 1140)), 'bank_transfer', 'TRF-V1') \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.decide_supplier_payment(%L, true)$q$, :'sp'), 'need the higher approval');
select test.login(:'cd');
select status as pst from public.decide_supplier_payment(:'sp', true) \gset
select test.assert(:'pst' = 'paid', 'center director releases the large payment');

-- ---------- Return on a fully paid delivery → supplier credit (with its VAT share)
select test.login(:'inv_u');
select id as srn from public.request_supplier_return(:'gr', jsonb_build_array(jsonb_build_object('lot_id', :'lot', 'qty', 2)), 'تالف') \gset
select test.login(:'chief');
select journal_entry_id as rje, total as rcost, vat_amount as rvat from public.decide_supplier_return(:'srn', true) \gset
select test.assert(:'rcost'::numeric = 200 and :'rvat'::numeric = 28, 'return 200 at cost + 28 VAT (pro rata)');
select id as cr, amount as camt from public.supplier_credits where source_return_id = :'srn' \gset
select test.assert(:'camt'::numeric = 228, 'paid delivery → supplier credit 228');
select test.assert((select amount_paid = 1140 and returned_amount = 228 from public.goods_receipts where id = :'gr'), 'delivery stays fully paid');
select test.expect_error(format($q$select public.set_receipt_vat(%L, 100, 'TX-2')$q$, :'gr'), 'already returned');
reset role;
select test.assert((select sum(debit) filter (where a.code = '2100') = 228 and sum(credit) filter (where a.code = '1300') = 200 and sum(credit) filter (where a.code = '1170') = 28
                    from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'rje'), 'Dr payable 228 / Cr stock 200 / Cr input VAT 28');

-- ---------- Use the credit on another delivery, then the supplier refunds the rest
set role authenticated;
select test.login(:'inv_u');
select id as gr2 from public.receive_goods(:'loc', :'sup', 'S-VAT-2', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'VAT2', 'qty', 5, 'unit_cost', 30)), 'vat-2') \gset
select test.login(:'chief');
select test.expect_error(format($q$select public.apply_supplier_credit(%L, %L, 151)$q$, :'cr', :'gr2'), 'exceeds what is outstanding');
select used from public.apply_supplier_credit(:'cr', :'gr2', 150) \gset
select test.assert(:'used'::numeric = 150 and (select amount_paid = 150 from public.goods_receipts where id = :'gr2'), 'credit settles the second delivery');
select test.expect_error(format($q$select public.record_supplier_refund(%L, 100, 'bank_transfer', 'RF-1')$q$, :'cr'), 'only 78.00 left');
select refunded from public.record_supplier_refund(:'cr', 78, 'bank_transfer', 'RF-1') \gset
select test.assert(:'refunded'::numeric = 78, 'supplier refunded the remaining 78');
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.supplier_credits), 'front desk sees no supplier credits');
select test.login(:'chief');
select public.save_purchasing_settings('{}') is not null as x \gset
reset role;
select test.assert((select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id join public.journal_entries e on e.id = l.entry_id
                    where a.code = '2100' and e.source_id in (:'gr', :'sp', :'srn', :'cr', :'gr2')) = 0, 'supplier payable nets to zero: deliveries 1,140 + 150, paid 1,140, returned 228, refunded 78');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
