-- 25 — Stock transfers (FEFO out, same lots in, shortage write-off, in-transit between branches); device double booking
\set fd      '00000000-0000-4000-8000-000000001002'
\set b1      '00000000-0000-4000-8000-000000000101'
\set b2      '00000000-0000-4000-8000-000000000102'
\set inv_u   '00000000-0000-4000-8000-000000001020'
\set cat     '00000000-0000-4000-8000-000000001022'
\set derm    '00000000-0000-4000-8000-000000002004'

select id as loc from public.inv_locations where code = 'MAIN' and branch_id = :'b1' \gset
insert into public.inv_locations (branch_id, code, name_ar, name_en) values (:'b2', 'B2MAIN', 'مخزن فرع الاختبار', 'Test branch store') returning id as loc2 \gset
insert into public.suppliers (name_ar) values ('مورد التحويل') returning id as sup \gset
set role authenticated;
select test.login(:'cat');
insert into public.inv_items (code, name_ar, name_en, unit, category) values ('TRF-ITEM', 'صنف تحويل', 'Transfer item', 'box', 'consumable') returning id as it \gset
select test.login(:'inv_u');
select id as gr from public.receive_goods(:'loc', :'sup', 'S-TRF-1', jsonb_build_array(
  jsonb_build_object('item_id', :'it', 'lot_no', 'LATE', 'qty', 10, 'unit_cost', 25, 'expiry', (current_date + 400)::text),
  jsonb_build_object('item_id', :'it', 'lot_no', 'SOON', 'qty', 4, 'unit_cost', 20, 'expiry', (current_date + 60)::text)), 'trf-1') \gset

-- Request and dispatch: FEFO takes the 4 expiring soon first, then 2 from the later lot
select test.login(:'fd');
select test.expect_error(format($q$select public.request_stock_transfer(%L, %L, %L, null)$q$, :'loc', :'loc2', jsonb_build_array(jsonb_build_object('item_id', :'it', 'qty', 1))), 'permission denied');
select test.login(:'inv_u');
select test.expect_error(format($q$select public.request_stock_transfer(%L, %L, '[]', null)$q$, :'loc', :'loc2'), 'at least one line');
select id as t1 from public.request_stock_transfer(:'loc', :'loc2', jsonb_build_array(jsonb_build_object('item_id', :'it', 'qty', 6)), 'لفرع الاختبار') \gset
select status, value, out_journal_id as oje from public.dispatch_stock_transfer(:'t1') \gset
select test.assert(:'status' = 'dispatched' and :'value'::numeric = 130, 'dispatched FEFO: 4 × 20 + 2 × 25 = 130');
select test.assert((select qty_on_hand = 0 from public.inv_lots where lot_no = 'SOON' and item_id = :'it') and (select qty_on_hand = 8 from public.inv_lots where lot_no = 'LATE' and item_id = :'it'), 'source lots reduced');
reset role;
select test.assert((select sum(debit) filter (where a.code = '1310') = 130 and sum(credit) filter (where a.code = '1300') = 130
                    from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'oje'), 'Dr in transit / Cr inventory at the sending branch');

-- Receive at the other branch: one box missing → note required, written off
set role authenticated;
select test.login(:'inv_u');
select test.expect_error(format($q$select public.receive_stock_transfer(%L, '{}', null)$q$, :'t1'), 'permission denied');
select test.login(:'cat');
select id as soonlot from public.stock_transfer_lots where transfer_id = :'t1' and lot_no = 'SOON' \gset
select test.expect_error(format($q$select public.receive_stock_transfer(%L, %L, null)$q$, :'t1', jsonb_build_object(:'soonlot', 3)), 'explain the shortage');
select test.expect_error(format($q$select public.receive_stock_transfer(%L, %L, 'x')$q$, :'t1', jsonb_build_object(:'soonlot', 5)), 'between 0 and what was sent');
select status, shortage_value, in_journal_id as ije from public.receive_stock_transfer(:'t1', jsonb_build_object(:'soonlot', 3), 'علبة ناقصة عند الاستلام') \gset
select test.assert(:'status' = 'received' and :'shortage_value'::numeric = 20, 'received with a shortage of one box (20)');
select test.assert((select sum(qty_on_hand) = 5 and count(*) = 2 from public.inv_lots where item_id = :'it' and location_id = :'loc2'), 'same lots recreated at the destination (3 + 2)');
select test.assert((select expiry = current_date + 60 and unit_cost = 20 from public.inv_lots where item_id = :'it' and location_id = :'loc2' and lot_no = 'SOON'), 'expiry and cost kept');
reset role;
select test.assert((select sum(credit) filter (where a.code = '1310') = 130 and sum(debit) filter (where a.code = '1300') = 110 and sum(debit) filter (where a.code = '5310') = 20
                    from public.journal_lines l join public.accounts a on a.id = l.account_id where l.entry_id = :'ije'), 'Cr in transit / Dr inventory 110 + shortage 20');
select test.assert((select coalesce(sum(debit - credit), 0) = 0 from public.journal_lines l join public.accounts a on a.id = l.account_id where a.code = '1310'), 'nothing left in transit');

-- Not enough stock; cancel
set role authenticated;
select test.login(:'inv_u');
select id as t2 from public.request_stock_transfer(:'loc', :'loc2', jsonb_build_array(jsonb_build_object('item_id', :'it', 'qty', 100)), null) \gset
select test.expect_error(format($q$select public.dispatch_stock_transfer(%L)$q$, :'t2'), 'not enough stock');
select test.expect_error(format($q$select public.cancel_stock_transfer(%L, '')$q$, :'t2'), 'reason is required');
select status from public.cancel_stock_transfer(:'t2', 'الكمية غير متاحة') \gset
select test.assert(:'status' = 'cancelled', 'cancelled before sending');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');

-- ---------- Devices on appointments
select id as dev from public.devices where asset_no = 'LSR-ELITE-01' \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'جهاز', 'أول', '01088880101') returning id as pa \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'جهاز', 'ثاني', '01088880102') returning id as pb \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, device_id)
values (:'b1', :'pa', :'derm', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '1000 days', now() + interval '1000 days 40 minutes'), :'dev') returning id as a1 \gset
select test.expect_error(format($q$insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, device_id)
  values (%L, %L, '00000000-0000-4000-8000-000000002012', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '1000 days 20 minutes', now() + interval '1000 days 50 minutes'), %L)$q$, :'b1', :'pb', :'dev'), 'no_device_overlap');
select set_config('app.device_rpc', 'on', false);
update public.devices set status = 'down' where id = :'dev';
select set_config('app.device_rpc', '', false);
select test.expect_error(format($q$insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, device_id)
  values (%L, %L, '00000000-0000-4000-8000-000000002012', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '1001 days', now() + interval '1001 days 30 minutes'), %L)$q$, :'b1', :'pb', :'dev'), 'out of service');
set role authenticated;
select test.login(:'fd');
select test.assert((select count(*) = 1 from public.device_bookings_at_risk(:'b1') where appointment_id = :'a1'), 'booking on a device that went down is flagged');
reset role;
select set_config('app.device_rpc', 'on', false);
update public.devices set status = 'active' where id = :'dev';
select set_config('app.device_rpc', '', false);
