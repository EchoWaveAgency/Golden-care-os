-- 12 — Devices & maintenance, laser sessions, patient packages
\set fd      '00000000-0000-4000-8000-000000001002'
\set chief   '00000000-0000-4000-8000-000000001006'
\set cashier '00000000-0000-4000-8000-000000001007'
\set dr_u    '00000000-0000-4000-8000-000000001004'
\set b1      '00000000-0000-4000-8000-000000000101'
\set b2      '00000000-0000-4000-8000-000000000102'
\set room    '00000000-0000-4000-8000-000000003001'
\set nurse_u '00000000-0000-4000-8000-000000001021'
\set dev_u   '00000000-0000-4000-8000-000000001050'
\set dr      '00000000-0000-4000-8000-000000002004'
\set laser   '00000000-0000-4000-8000-000000004002'

insert into auth.users (id, email) values (:'dev_u', 'devices@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'dev_u', 'مسؤول الأجهزة');
insert into public.user_roles (user_id, role_code, branch_id) values (:'dev_u', 'device_officer', :'b1');

-- ---------- Devices: registration, guard, counters
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.save_device('{"asset_no":"X-1","name_ar":"جهاز","branch_id":"00000000-0000-4000-8000-000000000101"}')$q$, 'permission denied');
select test.login(:'dev_u');
select id as dev, counter_value from public.save_device(jsonb_build_object('asset_no', 'lsr-elite-01', 'branch_id', :'b1', 'room_id', :'room',
  'name_ar', 'سينوشور إليت بلس', 'name_en', 'Cynosure Elite+', 'category', 'laser', 'manufacturer', 'Cynosure', 'model', 'Elite+', 'serial_no', 'EP-TEST-1',
  'counter_unit', 'pulses', 'counter_value', 100000, 'expected_life', 3000000, 'service_every', 500000, 'pm_interval_days', 90, 'calibration_interval_days', 180,
  'params', '{"wavelengths":[755,1064],"spot_mm":[6,8,10,12,15,18],"fluence":{"755":[2,50],"1064":[2,300]},"pulse_width_ms":[0.35,300]}'::jsonb)) \gset
select test.assert((select asset_no = 'LSR-ELITE-01' and next_pm_due = app.cairo_today() + 90 and counter_next_service = 600000 from public.devices where id = :'dev'), 'registered with schedule');
select test.assert((select count(*) = 1 from public.device_counter_readings where device_id = :'dev' and source = 'initial' and reading = 100000), 'initial reading recorded');
select test.expect_error(format($q$select public.save_device(%L)$q$, jsonb_build_object('asset_no', 'LSR-ELITE-01', 'branch_id', :'b1', 'name_ar', 'x')), 'already registered');
select test.expect_error(format($q$select public.save_device(%L)$q$, jsonb_build_object('asset_no', 'LSR-2', 'branch_id', :'b2', 'name_ar', 'x')), 'permission denied');
select test.expect_error(format($q$update public.devices set status = 'down' where id = %L$q$, :'dev'), 'permission denied');
reset role;
select test.expect_error(format($q$update public.devices set counter_value = 1 where id = %L$q$, :'dev'), 'only through the device screens');
set role authenticated;
select test.login(:'dev_u');
select test.expect_error(format($q$select public.record_counter_reading(%L, 99999)$q$, :'dev'), 'lower than the last recorded');
select gap from public.record_counter_reading(:'dev', 100050, 'فحص شهري') \gset
select test.assert(:'gap'::int = 50, 'manual reading above last known is unlogged use');
select test.assert(exists (select 1 from public.device_alerts(:'b1') where alert = 'unlogged_use' and detail = '50'), 'unlogged use alert');
select test.expect_error(format($q$select public.record_counter_reading(%L, 200000, 'x', true)$q$, :'dev'), 'a reset must be lower');

-- ---------- Maintenance: breakdown takes the device down; closing brings it back
select id as wo1 from public.open_work_order(:'dev', 'breakdown', 'رسالة خطأ في نظام التبريد') \gset
select test.assert((select status = 'down' from public.devices where id = :'dev'), 'breakdown takes the device down');
select test.expect_error(format($q$select public.close_work_order(%L, '{}')$q$, :'wo1'), 'describe the work done');
select public.close_work_order(:'wo1', '{"result":"تغيير فلتر المياه","technician":"مهندس الوكيل","parts_cost":1200,"labor_cost":800}') is not null as x \gset
select test.assert((select status = 'active' from public.devices where id = :'dev'), 'device back in service');
select id as wo2 from public.open_work_order(:'dev', 'calibration', 'معايرة نصف سنوية', true) \gset
select test.expect_error(format($q$select public.close_work_order(%L, '{"result":"x"}')$q$, :'wo2'), 'whether the check passed');
select public.close_work_order(:'wo2', '{"result":"قراءة الطاقة خارج المدى","passed":false}') is not null as x \gset
select test.assert((select status = 'down' from public.devices where id = :'dev'), 'failed calibration keeps the device down');
select id as wo2b from public.open_work_order(:'dev', 'breakdown', 'تغيير لمبة') \gset
select public.close_work_order(:'wo2b', '{"result":"تم تغيير اللمبة"}') is not null as x \gset
select test.assert((select status = 'down' from public.devices where id = :'dev'), 'closing another order does not bypass the failed calibration');
select id as wo3 from public.open_work_order(:'dev', 'calibration', 'إعادة المعايرة بعد الإصلاح', false) \gset
select public.close_work_order(:'wo3', '{"result":"تمت المعايرة","passed":true}') is not null as x \gset
select test.assert((select status = 'active' and calibration_due = app.cairo_today() + 180 from public.devices where id = :'dev'), 'passing calibration: back in service, next due moved');
select test.assert((select maintenance_cost = 2000 and work_orders = 4 from public.device_usage(app.cairo_today(), app.cairo_today(), :'b1') where device_id = :'dev'), 'usage summary: costs and orders');
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.maintenance_orders), 'no maintenance visibility without device.read');

-- ---------- Package templates and sale
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.save_package_template(%L)$q$, jsonb_build_object('code', 'X', 'name_ar', 'x', 'service_id', :'laser', 'sessions', 3, 'price', 1000, 'validity_days', 180)), 'permission denied');
select test.login(:'chief');
select id as tpl, sale_service_id as sale_svc from public.save_package_template(jsonb_build_object('code', 'lsr-full-3', 'name_ar', 'ليزر كامل الجسم 3 جلسات',
  'name_en', 'Full body laser x3', 'service_id', :'laser', 'sessions', 3, 'price', 1000, 'validity_days', 180)) \gset
select test.assert((select s.is_package and a.code = '2210' from public.services s join public.accounts a on a.id = s.revenue_account_id where s.id = :'sale_svc'), 'sale service posts to deferred package revenue');
reset role;
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'باقة', 'ليزر', '01088880012') returning id as pat \gset
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as manual_inv \gset
select test.expect_error(format($q$insert into public.invoice_lines (invoice_id, service_id, unit_price) values (%L, %L, 1000)$q$, :'manual_inv', :'sale_svc'), 'sold from the package screen');
select test.expect_error(format($q$select public.sell_package(%L, %L, %L, 1000)$q$, :'pat', :'tpl', :'b1'), 'below the package price');
select id as pkg, invoice_id as pinv, units_total, value_total from public.sell_package(:'pat', :'tpl', :'b1', 100) \gset
select test.assert(:'units_total'::int = 3 and :'value_total'::numeric = 900, 'package opened with 3 units worth the net 900');
select total as ptotal, journal_entry_id as sje from public.invoices where id = :'pinv' \gset
select test.assert(:'ptotal'::numeric = 900, 'invoice total after discount');
reset role;
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'sje' and a.code = '2210') = 1000, 'Cr deferred package revenue 1000');
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'sje' and a.code = '4900') = 100, 'Dr discounts 100');
select test.assert((select sum(l.credit - l.debit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
                    where a.code = '2210' and e.source_id = :'pinv') = 900, 'deferred balance is the net 900 (discount reclassified)');
select test.assert((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
                    where a.code = '4900' and e.source_id = :'pinv') = 0, 'package discount does not stay in discounts allowed');

-- ---------- Laser session: validation, reconciliation, redemption
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, room_id, slot, status)
select :'b1', :'pat', :'dr', (select id from public.specialties where code = 'derm'), :'room', tstzrange(now() + make_interval(days => 700 + g), now() + make_interval(days => 700 + g, mins => 30)), 'booked'
from generate_series(1, 6) g;
update public.appointments set status = 'arrived' where patient_id = :'pat';
select array_agg(id order by lower(slot)) as apts from public.appointments where patient_id = :'pat' \gset
select (:'apts'::uuid[])[1] as a1, (:'apts'::uuid[])[2] as a2, (:'apts'::uuid[])[3] as a3, (:'apts'::uuid[])[4] as a4, (:'apts'::uuid[])[5] as a5, (:'apts'::uuid[])[6] as a6 \gset
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.save_laser_session(%L, '{}')$q$, :'a1'), 'permission denied');
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.save_laser_session(%L, %L)$q$, :'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser',
  'areas', jsonb_build_array(jsonb_build_object('area_code', 'axilla', 'wavelength_nm', 532, 'fluence', 20, 'spot_mm', 12, 'pulses', 100)))), 'not available on this device');
select test.expect_error(format($q$select public.save_laser_session(%L, %L)$q$, :'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser',
  'areas', jsonb_build_array(jsonb_build_object('area_code', 'axilla', 'wavelength_nm', 755, 'fluence', 60, 'spot_mm', 12, 'pulses', 100)))), 'outside the approved range');
\set areas_bad '[{"area_code":"axilla","wavelength_nm":755,"fluence":18,"pulse_width_ms":3,"spot_mm":15,"pulses":150},{"area_code":"legs_full","wavelength_nm":1064,"fluence":40,"spot_mm":18,"pulses":100}]'
\set areas_ok  '[{"area_code":"axilla","wavelength_nm":755,"fluence":18,"pulse_width_ms":3,"spot_mm":15,"pulses":150},{"area_code":"legs_full","wavelength_nm":1064,"fluence":40,"spot_mm":18,"pulses":140}]'
\set ck_no  '{"pregnancy":"no","isotretinoin":"no","photosensitizing":"no","recent_tan":"no","active_lesion":"no","herpes_history":"no","keloid":"no","light_epilepsy":"no","gold_therapy":"no"}'
\set ck_tan '{"pregnancy":"no","isotretinoin":"no","photosensitizing":"no","recent_tan":"yes","active_lesion":"no","herpes_history":"no","keloid":"no","light_epilepsy":"no","gold_therapy":"no"}'
select id as s1 from public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg',
  'checklist', '{"pregnancy":"no"}'::jsonb, 'counter_before', 100040, 'counter_after', 100340, 'test_spot', true, 'test_spot_pulses', 10,
  'areas', :'areas_bad'::jsonb)) \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'skin type');
select public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', '{"pregnancy":"no"}'::jsonb, 'counter_before', 100040, 'counter_after', 100340, 'test_spot', true, 'test_spot_pulses', 10, 'areas', :'areas_bad'::jsonb)) is not null as x \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'answer every checklist question');
select public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_tan'::jsonb, 'counter_before', 100040, 'counter_after', 100340, 'test_spot', true, 'test_spot_pulses', 10, 'areas', :'areas_bad'::jsonb)) is not null as x \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'a doctor must review');
select public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100040, 'counter_after', 100340, 'test_spot', true, 'test_spot_pulses', 10, 'areas', :'areas_bad'::jsonb)) is not null as x \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'lower than the last recorded reading');
select public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100060, 'counter_after', 100360, 'test_spot', true, 'test_spot_pulses', 10, 'areas', :'areas_bad'::jsonb)) is not null as x \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'pulses do not match the counter');
select public.save_laser_session(:'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100060, 'counter_after', 100360, 'test_spot', true, 'test_spot_pulses', 10, 'areas', :'areas_ok'::jsonb,
  'reaction', 'perifollicular_edema', 'outcome', 'تحمل جيد', 'follow_up_on', (current_date + 42)::text)) is not null as x \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'not fully paid');
select test.login(:'cashier');
select public.record_payment(:'pinv', 900, 'card', 'pkg-pay-1', 'POS-1') is not null as x \gset
select test.login(:'nurse_u');
select status, signed_by from public.sign_laser_session(:'s1') \gset
select test.assert(:'status' = 'signed' and :'signed_by' = :'nurse_u', 'session signed by the nurse');
select test.expect_error(format($q$select public.save_laser_session(%L, %L)$q$, :'a1', jsonb_build_object('device_id', :'dev', 'service_id', :'laser')), 'cannot be modified');
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s1'), 'already signed');
select public.add_laser_note(:'s1', 'اتصال متابعة: الاحمرار زال خلال يومين', 'adverse_followup') is not null as x \gset
reset role;
select test.expect_error(format($q$update public.laser_session_areas set pulses = 1 where session_id = %L$q$, :'s1'), 'only through the laser session screen');
select test.assert((select counter_value = 100360 from public.devices where id = :'dev'), 'device counter moved to the after-reading');
select test.assert((select gap = 10 and delta = 300 from public.device_counter_readings where session_id = :'s1'), 'gap of 10 unlogged pulses before the session is kept');
select test.assert((select units_used = 1 and value_used = 300 from public.patient_packages where id = :'pkg'), 'one unit redeemed at the net 300');
select journal_entry_id as rje from public.package_redemptions where session_id = :'s1' \gset
select test.assert((select debit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'rje' and a.code = '2210') = 300, 'Dr deferred 300');
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'rje' and a.code = '4110') = 300, 'Cr laser revenue 300');

-- Doctor override of a contraindication; last unit takes the rounding remainder
set role authenticated;
select test.login(:'nurse_u');
select id as s2 from public.save_laser_session(:'a2', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 4,
  'checklist', :'ck_tan'::jsonb, 'counter_before', 100360, 'counter_after', 100500, 'areas', '[{"area_code":"axilla","wavelength_nm":1064,"fluence":30,"spot_mm":12,"pulses":140}]'::jsonb)) \gset
select test.expect_error(format($q$select public.sign_laser_session(%L, 'ok')$q$, :'s2'), 'a doctor must review');
select test.login(:'dr_u');
select test.expect_error(format($q$select public.sign_laser_session(%L, 'ok')$q$, :'s2'), 'write the clinical reason');
select public.sign_laser_session(:'s2', 'تسمير خفيف؛ استخدام 1064 نانومتر بطاقة منخفضة مع تبريد') is not null as x \gset
select test.login(:'nurse_u');
select id as s3 from public.save_laser_session(:'a3', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100500, 'counter_after', 100600, 'areas', '[{"area_code":"axilla","wavelength_nm":755,"fluence":20,"spot_mm":15,"pulses":100}]'::jsonb)) \gset
select public.sign_laser_session(:'s3') is not null as x \gset
reset role;
select test.assert((select units_used = 3 and value_used = value_total and status = 'used' from public.patient_packages where id = :'pkg'), 'package fully used; values add up exactly');
set role authenticated;
select test.login(:'nurse_u');
select id as s4 from public.save_laser_session(:'a4', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100600, 'counter_after', 100700, 'areas', '[{"area_code":"axilla","wavelength_nm":755,"fluence":20,"spot_mm":15,"pulses":100}]'::jsonb)) \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s4'), 'package is used');

-- Guards on the package invoice
select test.login(:'chief');
select test.expect_error(format($q$select public.void_invoice(%L, 'x')$q$, :'pinv'), 'only issued invoices');
select test.login(:'fd');
select test.expect_error(format($q$select public.request_refund(%L, 100, 'card', 'المريضة لم تكمل')$q$, :'pinv'), 'use the package refund');
select id as pkg2, invoice_id as pinv2 from public.sell_package(:'pat', :'tpl', :'b1') \gset
select test.login(:'chief');
select public.void_invoice(:'pinv2', 'بيع بالخطأ') is not null as x \gset
select test.assert((select status = 'cancelled' from public.patient_packages where id = :'pkg2'), 'voiding an unused package invoice cancels the package');

-- Device out of service and overdue calibration block sessions
select test.login(:'dev_u');
select id as wo4 from public.open_work_order(:'dev', 'breakdown', 'عطل في المقبض') \gset
select test.login(:'nurse_u');
select id as s5 from public.save_laser_session(:'a5', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'fitzpatrick', 2,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100600, 'counter_after', 100650, 'areas', '[{"area_code":"upper_lip","wavelength_nm":755,"fluence":16,"spot_mm":10,"pulses":50}]'::jsonb)) \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s5'), 'out of service');
select test.login(:'dev_u');
select public.cancel_work_order(:'wo4', 'فُتح بالخطأ') is not null as x \gset
reset role;
select set_config('app.device_rpc', 'on', false);
update public.devices set calibration_due = current_date - 1 where id = :'dev';
select set_config('app.device_rpc', '', false);
set role authenticated;
select test.login(:'nurse_u');
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s5'), 'calibration is overdue');
reset role;
select set_config('app.device_rpc', 'on', false);
update public.devices set calibration_due = current_date + 30 where id = :'dev';
select set_config('app.device_rpc', '', false);
set role authenticated;
select test.login(:'nurse_u');
select public.sign_laser_session(:'s5') is not null as x \gset
select test.assert((select count(*) = 0 from public.package_redemptions where session_id = :'s5'), 'session without a package redeems nothing (invoiced normally)');

-- Visibility
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.laser_sessions), 'front desk cannot read laser records');
select test.assert((select count(*) >= 2 from public.patient_packages where patient_id = :'pat'), 'front desk sees package balances');
select test.login(:'dr_u');
select test.assert((select count(*) = 5 from public.laser_sessions where patient_id = :'pat'), 'appointment doctor sees the sessions');
reset role;
insert into public.user_roles (user_id, role_code, branch_id) values ('00000000-0000-4000-8000-000000001005', 'doctor', :'b1') on conflict do nothing;
set role authenticated;
select test.login('00000000-0000-4000-8000-000000001005');
select test.assert((select count(*) = 0 from public.laser_sessions where patient_id = :'pat'), 'another doctor with laser rights does not see sessions of patients they do not treat');

-- ---------- No double billing: a package session cannot also be invoiced, and an invoiced session cannot use a package
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id, appointment_id) values (:'b1', :'pat', :'a2') returning id as dbl_inv \gset
select test.expect_error(format($q$insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (%L, %L, %L, 1000)$q$, :'dbl_inv', :'laser', :'dr'), 'covered by a package');
select id as pkg5, invoice_id as pinv5 from public.sell_package(:'pat', :'tpl', :'b1', 0, 'sell-key-5') \gset
select test.assert((select id from public.sell_package(:'pat', :'tpl', :'b1', 0, 'sell-key-5')) = :'pkg5', 'retried sale returns the same package');
select test.login(:'cashier');
select public.record_payment(:'pinv5', 1000, 'card', 'pkg-pay-5', 'POS-5') is not null as x \gset
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id, appointment_id) values (:'b1', :'pat', :'a6') returning id as inv6 \gset
insert into public.invoice_lines (invoice_id, service_id, doctor_id, unit_price) values (:'inv6', :'laser', :'dr', 1000);
select test.login(:'nurse_u');
select id as s6 from public.save_laser_session(:'a6', jsonb_build_object('device_id', :'dev', 'service_id', :'laser', 'patient_package_id', :'pkg5', 'fitzpatrick', 3,
  'checklist', :'ck_no'::jsonb, 'counter_before', 100650, 'counter_after', 100700, 'areas', '[{"area_code":"chin","wavelength_nm":755,"fluence":16,"spot_mm":10,"pulses":50}]'::jsonb)) \gset
select test.expect_error(format($q$select public.sign_laser_session(%L)$q$, :'s6'), 'already on an invoice');

-- Consumable template follows the laser session's service when there is no invoice for the appointment
reset role;
insert into public.service_consumables (service_id, item_id, qty) select :'laser', id, 2 from public.inv_items where code = 'GEL-US' on conflict do nothing;
set role authenticated;
select test.login(:'nurse_u');
select test.assert((select qty = 2 from public.issue_template(:'a1') t join public.inv_items i on i.id = t.item_id where i.code = 'GEL-US'), 'package session prefills its service consumables');

-- ---------- Expiry: unused value becomes revenue
select test.login(:'fd');
select id as pkg3, invoice_id as pinv3 from public.sell_package(:'pat', :'tpl', :'b1') \gset
select id as pkg4, invoice_id as pinv4 from public.sell_package(:'pat', :'tpl', :'b1') \gset
select test.login(:'cashier');
select public.record_payment(:'pinv3', 1000, 'card', 'pkg-pay-3', 'POS-3') is not null as x \gset
reset role;
select set_config('app.package_rpc', 'on', false);
update public.patient_packages set expires_on = current_date - 1 where id in (:'pkg3', :'pkg4');
select set_config('app.package_rpc', '', false);
set role authenticated;
select test.login(:'fd');
select test.expect_error($q$select public.expire_packages()$q$, 'permission denied');
select test.login(:'chief');
select public.expire_packages() >= 1 as x \gset
select journal_entry_id as eje from public.patient_packages where id = :'pkg3' and status = 'expired' \gset
reset role;
select test.assert((select credit from public.journal_lines l join public.accounts a on a.id = l.account_id where entry_id = :'eje' and a.code = '4130') = 1000, 'expired balance to package revenue 4130');
select test.assert((select status = 'active' from public.patient_packages where id = :'pkg4'), 'unpaid package is not expired into revenue');
set role authenticated;
select test.login(:'chief');
select public.void_invoice(:'pinv4', 'لم يُسدد') is not null as x \gset
select test.assert((select status = 'cancelled' from public.patient_packages where id = :'pkg4'), 'unpaid package is voided with its invoice instead');
reset role;

-- ---------- Settlement: redeemed sessions are paid to the appointment doctor
set role authenticated;
select test.login(:'chief');
select id as run from public.prepare_settlement(:'dr', current_date) \gset
select test.assert((select count(*) = 3 and sum(base) = 900 from public.settlement_lines where run_id = :'run' and kind = 'package_session'),
  'three package sessions enter the settlement at their redeemed value');
select test.assert((select sum(amount) from public.settlement_lines where run_id = :'run' and kind = 'package_session')
  = (select coalesce(sum(rt.amount), 0) from public.package_redemptions r cross join lateral app.settlement_rate(:'dr', r.service_id, r.on_date, r.value, 1) rt where r.package_id = :'pkg'),
  'doctor share follows the contract rate for the service');
select public.cancel_settlement(:'run', 'اختبار') is not null as x \gset
select id as run2 from public.prepare_settlement(:'dr', current_date) \gset
select test.assert((select count(*) = 3 from public.settlement_lines where run_id = :'run2' and kind = 'package_session'), 'cancelled run releases the sessions for the next one');
select public.cancel_settlement(:'run2', 'اختبار') is not null as x \gset

-- ---------- Profitability: revenue on redemption, not on sale
select test.assert((select coalesce(sum(net_revenue), 0) from public.report_profitability(current_date, current_date, :'b1') r
                    join public.services s on s.id = r.service_id where s.is_package) = 0, 'package sales are not revenue in the report');
select test.assert((select net_revenue >= 900 from public.report_profitability(current_date, current_date, :'b1') where service_id = :'laser' and doctor_id = :'dr'),
  'redeemed sessions appear as laser revenue for the doctor');
reset role;
select test.assert((select sum(debit) - sum(credit) from public.journal_lines) = 0, 'ledger balanced');
