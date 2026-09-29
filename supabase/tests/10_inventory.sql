-- 10 — Inventory: receipts, FEFO issue, expiry, controlled items, counts (maker-checker), journals, RLS
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set b1      '00000000-0000-4000-8000-000000000101'
\set b2      '00000000-0000-4000-8000-000000000102'
\set inv_u   '00000000-0000-4000-8000-000000001020'
\set nurse_u '00000000-0000-4000-8000-000000001021'
\set dr      '00000000-0000-4000-8000-000000002004'

insert into auth.users (id, email) values (:'inv_u', 'store@test.local'), (:'nurse_u', 'nurse@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'inv_u', 'أمين المخزن'), (:'nurse_u', 'ممرضة');
insert into public.user_roles (user_id, role_code, branch_id) values (:'inv_u', 'inventory_controller', :'b1'), (:'nurse_u', 'nurse', :'b1');

set role authenticated;
select test.login(:'inv_u');
insert into public.inv_locations (branch_id, code, name_ar, name_en) values (:'b1', 'MAIN', 'المخزن الرئيسي', 'Main store') returning id as loc \gset
select test.expect_error($q$insert into public.inv_locations (branch_id, code, name_ar, name_en) values ('00000000-0000-4000-8000-000000000102', 'X', 'x', 'x')$q$, 'row-level security');
-- The item catalog is shared by all branches: a branch-scoped manager cannot change it
select test.expect_error($q$insert into public.inv_items (code, name_ar, name_en) values ('X-1', 'x', 'x')$q$, 'row-level security');
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000001022', 'catalog@test.local') on conflict do nothing;
insert into public.profiles (user_id, full_name_ar) values ('00000000-0000-4000-8000-000000001022', 'مسؤول الأصناف') on conflict do nothing;
insert into public.user_roles (user_id, role_code, branch_id) values ('00000000-0000-4000-8000-000000001022', 'inventory_controller', null);
set role authenticated;
select test.login('00000000-0000-4000-8000-000000001022');
insert into public.inv_items (code, name_ar, name_en, unit, category, reorder_level) values ('GEL-US', 'جل سونار', 'Ultrasound gel', 'bottle', 'consumable', 5) returning id as gel \gset
insert into public.inv_items (code, name_ar, name_en, unit, category) values ('ANES-CRM', 'كريم مخدر', 'Numbing cream', 'tube', 'drug') returning id as crm \gset
select test.expect_error($q$insert into public.inv_items (code, name_ar, name_en, category, is_controlled) values ('TRAM-50', 'ترامادول', 'Tramadol 50', 'drug', true)$q$, 'controlled-items authority');
select test.expect_error(format($q$update public.inv_items set category = 'consumable' where id = %L$q$, :'crm'), 'controlled-items authority');
insert into public.suppliers (name_ar) values ('مورد تجريبي') returning id as sup \gset
reset role;
insert into public.inv_items (code, name_ar, name_en, unit, category, is_controlled) values ('TRAM-50', 'ترامادول', 'Tramadol 50', 'capsule', 'drug', true) returning id as ctl \gset
set role authenticated;
select test.login(:'inv_u');

-- Receipts: expiry required for drugs; already-expired refused; totals and journal
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-1', %L, 'g0')$q$, :'loc', :'sup',
  jsonb_build_array(jsonb_build_object('item_id', :'crm', 'lot_no', 'L0', 'qty', 5, 'unit_cost', 10))), 'expiry date is required');
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-1', %L, 'g0')$q$, :'loc', :'sup',
  jsonb_build_array(jsonb_build_object('item_id', :'crm', 'lot_no', 'L0', 'qty', 5, 'unit_cost', 10, 'expiry', (current_date - 1)::text))), 'already expired');
select id as gr1, total, journal_entry_id as gje from public.receive_goods(:'loc', :'sup', 'S-100', jsonb_build_array(
  jsonb_build_object('item_id', :'crm', 'lot_no', 'LATE', 'qty', 10, 'unit_cost', 20, 'expiry', (current_date + 300)::text),
  jsonb_build_object('item_id', :'crm', 'lot_no', 'SOON', 'qty', 4, 'unit_cost', 25, 'expiry', (current_date + 20)::text),
  jsonb_build_object('item_id', :'gel', 'lot_no', 'G1', 'qty', 8, 'unit_cost', 30),
  jsonb_build_object('item_id', :'ctl', 'lot_no', 'T1', 'qty', 20, 'unit_cost', 2, 'expiry', (current_date + 400)::text)), 'g-1') \gset
select test.assert(:'total'::numeric = 200 + 100 + 240 + 40, 'receipt total 580');
select test.assert((select id from public.receive_goods(:'loc', :'sup', 'S-100', '[]', 'g-1')) = :'gr1', 'idempotent retry returns the same receipt');
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-100', %L, 'g-2')$q$, :'loc', :'sup',
  jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'G2', 'qty', 1, 'unit_cost', 1))), 'duplicate key');
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'gje' and a.code = '1300') = 580, 'Dr inventory 580');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'gje' and a.code = '2100') = 580, 'Cr suppliers 580');
-- An expired lot already on the shelf (simulate time passing)
select set_config('app.inventory_rpc', 'on', false);
insert into public.inv_lots (item_id, location_id, lot_no, expiry, unit_cost, qty_on_hand, value_remaining) values (:'crm', :'loc', 'OLD', current_date - 5, 15, 3, 45) returning id as old_lot \gset
select set_config('app.inventory_rpc', '', false);

-- Direct stock edits are impossible
set role authenticated;
select test.login(:'inv_u');
select test.expect_error(format($q$update public.inv_lots set qty_on_hand = 999 where id = %L$q$, :'old_lot'), 'permission denied');
reset role;
select test.expect_error(format($q$update public.inv_lots set qty_on_hand = 999 where id = %L$q$, :'old_lot'), 'only through receipts');

-- Issue: FEFO (SOON first, then LATE), expired OLD skipped; cost by lot
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'سلوى', 'مخزون', '01077770001') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status)
values (:'b1', :'pat', :'dr', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '3 days', now() + interval '3 days 30 minutes'), 'booked') returning id as apt \gset
set role authenticated;
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.issue_stock(%L, %L, null, '', 'i0')$q$, :'loc', jsonb_build_array(jsonb_build_object('item_id', :'crm', 'qty', 1))), 'purpose');
select test.expect_error(format($q$select public.issue_stock(%L, %L, %L, null, 'i0')$q$, :'loc', jsonb_build_array(jsonb_build_object('item_id', :'crm', 'qty', 15)), :'apt'), 'insufficient stock');
select id as iss, total_cost, journal_entry_id as ije from public.issue_stock(:'loc', jsonb_build_array(jsonb_build_object('item_id', :'crm', 'qty', 6)), :'apt', null, 'i-1') \gset
select test.assert(:'total_cost'::numeric = 4 * 25 + 2 * 20, 'FEFO: 4 from the soonest lot, 2 from the next (140)');
select test.assert((select qty_on_hand from public.inv_lots where lot_no = 'SOON') = 0 and (select qty_on_hand from public.inv_lots where lot_no = 'LATE') = 8, 'lot balances');
select test.assert((select qty_on_hand from public.inv_lots where id = :'old_lot') = 3, 'expired lot never issued');
select test.assert((select patient_id = :'pat' from public.stock_issues where id = :'iss'), 'issue linked to the patient through the appointment');
select test.assert((select id from public.issue_stock(:'loc', '[]', :'apt', null, 'i-1')) = :'iss', 'idempotent issue retry');
select test.expect_error(format($q$select public.issue_stock(%L, %L, null, 'تسكين', 'i-2')$q$, :'loc', jsonb_build_array(jsonb_build_object('item_id', :'ctl', 'qty', 1))), 'controlled item');
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-9', '[]', 'g-9')$q$, :'loc', :'sup'), 'permission denied');
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'ije' and a.code = '5300') = 140, 'Dr consumables 140');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'ije' and a.code = '1300') = 140, 'Cr inventory 140');

-- Template suggestion for an appointment comes from the services invoiced for it
reset role;
insert into public.service_consumables (service_id, item_id, qty) values ('00000000-0000-4000-8000-000000004001', :'gel', 2);
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id, appointment_id) values (:'b1', :'pat', :'apt') returning id as tinv \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price, quantity) values (:'tinv', '00000000-0000-4000-8000-000000004001', 500, 2);
select test.assert((select count(*) = 0 from public.issue_template(:'apt')), 'no template for users without issue permission');
select test.login(:'nurse_u');
select test.assert((select qty from public.issue_template(:'apt') where item_id = :'gel') = 4, 'template: 2 per service × 2 services');

-- Front desk (no inventory permission) sees no stock; other branch cannot issue here
set role authenticated;
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.inv_lots), 'no stock visibility without permission');
select test.assert((select count(*) = 0 from public.inventory_position(:'loc')), 'no position without permission');
select test.login(:'inv_u');
select test.assert((select below_reorder from public.inventory_position(:'loc') where code = 'GEL-US') = false, 'gel above reorder (8 > 5)');
select test.assert((select expired_qty from public.inventory_position(:'loc') where code = 'ANES-CRM') = 3, 'expired quantity reported');

-- Count: gel counted 6 (loss 2 × 30), old expired cream counted 0 (loss 3 × 15)
select id as cnt from public.start_count(:'loc') \gset
select test.expect_error(format($q$select public.start_count(%L)$q$, :'loc'), 'already open');
select test.expect_error(format($q$select public.issue_stock(%L, %L, %L, null, 'i-frozen')$q$, :'loc', jsonb_build_array(jsonb_build_object('item_id', :'gel', 'qty', 1)), :'apt'), 'count is in progress');
select test.expect_error(format($q$select public.submit_count(%L, '[]')$q$, :'cnt'), 'every lot');
select status from public.submit_count(:'cnt', (select jsonb_agg(jsonb_build_object('lot_id', l.lot_id, 'counted',
  case lt.lot_no when 'G1' then 6 when 'OLD' then 0 else lt.qty_on_hand end))
  from public.stock_count_lines l join public.inv_lots lt on lt.id = l.lot_id where l.count_id = :'cnt')) \gset
select test.assert((select net_value from public.stock_counts where id = :'cnt') = -105, 'net difference -105 at submission');
select test.expect_error(format($q$select public.approve_count(%L)$q$, :'cnt'), 'permission denied');
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values (:'inv_u', 'operations_manager', :'b1');
update public.profiles set mfa_required = mfa_required where user_id = :'inv_u';
set role authenticated;
select test.login(:'inv_u');
select test.expect_error(format($q$select public.approve_count(%L)$q$, :'cnt'), 'your own count');
select test.login(:'chief');
select journal_entry_id as cje from public.approve_count(:'cnt') \gset
select test.assert((select qty_on_hand from public.inv_lots where lot_no = 'G1') = 6 and (select qty_on_hand from public.inv_lots where id = :'old_lot') = 0, 'differences applied');
reset role;
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'cje' and a.code = '5310') = 105, 'Dr adjustments 105');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
-- Inventory account equals the value of stock on hand
select test.assert((select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id where a.code = '1300')
                   = (select sum(value_remaining) from public.inv_lots) - 45, 'inventory ledger ties to stock value (the simulated OLD lot, 45, never went through a receipt)');
select test.assert((select value_remaining from public.inv_lots where lot_no = 'SOON') = 0, 'emptied lot keeps no value');
select test.expect_error(format($q$update public.stock_moves set qty = 1 where ref_id = %L$q$, :'iss'), 'cannot be deleted');

-- Mixed gains and losses in one count (gel +1 gain 30, tramadol -1 loss 2)
set role authenticated;
select test.login(:'inv_u');
select id as cnt2 from public.start_count(:'loc') \gset
select status from public.submit_count(:'cnt2', (select jsonb_agg(jsonb_build_object('lot_id', l.lot_id, 'counted',
  case lt.lot_no when 'G1' then 7 when 'T1' then 19 else lt.qty_on_hand end))
  from public.stock_count_lines l join public.inv_lots lt on lt.id = l.lot_id where l.count_id = :'cnt2')) \gset
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.cancel_count(%L, 'x')$q$, :'cnt2'), 'permission denied');
select test.login(:'chief');
select journal_entry_id as cje2, net_value from public.approve_count(:'cnt2') \gset
select test.assert(:'net_value'::numeric = 28, 'net +28 (gain 30, loss 2)');
reset role;
select test.assert((select count(*) = 4 from public.journal_lines where entry_id = :'cje2'), 'gains and losses posted as separate one-sided lines');
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced after mixed count');

-- Decimals beyond storage precision are refused; idempotency keys belong to their owner
set role authenticated;
select test.login(:'inv_u');
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-DEC', %L, 'g-dec')$q$, :'loc', :'sup',
  jsonb_build_array(jsonb_build_object('item_id', :'gel', 'lot_no', 'D', 'qty', 1.0005, 'unit_cost', 10))), 'too many decimals');
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.receive_goods(%L, %L, 'S-100', '[]', 'g-1')$q$, :'loc', :'sup'), 'permission denied');
reset role;
