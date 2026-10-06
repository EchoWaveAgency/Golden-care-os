#!/usr/bin/env bash
# Concurrency checks: parallel sessions must not double-book or double-post.
# Called by db-test.sh with PG* env vars already set.
set -euo pipefail
PSQL=(psql -X -q -t -A -v ON_ERROR_STOP=1)
FD=00000000-0000-4000-8000-000000001002
DR=00000000-0000-4000-8000-000000002004
B1=00000000-0000-4000-8000-000000000101

as_fd() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$FD', false);"; }
new_invoice() {
  local id
  id=$("${PSQL[@]}" -c "$(as_fd) insert into public.invoices (branch_id, patient_id) values ('$B1','$PID') returning id;" | tail -1)
  "${PSQL[@]}" -c "$(as_fd) insert into public.invoice_lines (invoice_id, service_id, unit_price) values ('$id', '00000000-0000-4000-8000-000000004001', 500);" >/dev/null
  echo "$id"
}

PID=$("${PSQL[@]}" -c "$(as_fd) insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values ('$B1','تست','تزامن','01077777777') returning id;" | tail -1)
DERM=$("${PSQL[@]}" -c "select id from public.specialties where code='derm'")

# 1) Ten parallel bookings of the same doctor slot → exactly one succeeds.
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$(as_fd) insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
     values ('$B1','$PID','$DR','$DERM', tstzrange('2027-01-05 10:00+02','2027-01-05 10:15+02'));" >/dev/null 2>&1 &
done
wait
N=$("${PSQL[@]}" -c "select count(*) from public.appointments where doctor_id='$DR' and slot && tstzrange('2027-01-05 10:00+02','2027-01-05 10:15+02') and status not in ('canceled','no_show')")
[ "$N" = "1" ] || { echo "concurrent booking produced $N appointments"; exit 1; }

# 2) Ten parallel submissions of the same payment (same idempotency key) → one payment, one journal entry.
INV=$(new_invoice)
"${PSQL[@]}" -c "$(as_fd) select public.issue_invoice('$INV');" >/dev/null
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$(as_fd) select public.record_payment('$INV', 500, 'card', 'conc-key-1', 'POS-1');" >/dev/null 2>&1 &
done
wait
P=$("${PSQL[@]}" -c "select count(*) from public.payments where invoice_id='$INV'")
J=$("${PSQL[@]}" -c "select count(*) from public.journal_entries where source_type='payment' and source_id='$INV'")
PAID=$("${PSQL[@]}" -c "select amount_paid from public.invoices where id='$INV'")
[ "$P" = "1" ] && [ "$J" = "1" ] && [ "$PAID" = "500.00" ] || { echo "payments=$P journals=$J paid=$PAID"; exit 1; }

# 3) Ten parallel different payments of 100 on a 500 invoice → never overpaid.
INV2=$(new_invoice)
"${PSQL[@]}" -c "$(as_fd) select public.issue_invoice('$INV2');" >/dev/null
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$(as_fd) select public.record_payment('$INV2', 100, 'card', 'split-$i', 'POS-$i');" >/dev/null 2>&1 &
done
wait
PAID2=$("${PSQL[@]}" -c "select amount_paid from public.invoices where id='$INV2'")
SUMP=$("${PSQL[@]}" -c "select sum(amount) from public.payments where invoice_id='$INV2'")
[ "$PAID2" = "500.00" ] && [ "$SUMP" = "500.00" ] || { echo "paid=$PAID2 sum=$SUMP"; exit 1; }

# 4) Ten parallel gateway callbacks for the same captured payment → one payment.
INV3=$(new_invoice)
"${PSQL[@]}" -c "$(as_fd) select public.issue_invoice('$INV3');" >/dev/null
"${PSQL[@]}" -c "insert into public.payment_intents (invoice_id, branch_id, patient_id, amount, provider, provider_order_id, status)
                 values ('$INV3', '$B1', '$PID', 500, 'paymob', 'conc-order-1', 'pending');" >/dev/null
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "set role service_role; select public.svc_payment_confirm('paymob', 'conc-order-1', 'conc-txn-1', 50000, true);" >/dev/null 2>&1 &
done
wait
GP=$("${PSQL[@]}" -c "select count(*) from public.payments where invoice_id='$INV3'")
[ "$GP" = "1" ] || { echo "gateway callbacks produced $GP payments"; exit 1; }

# 5) Ten parallel issues of 1 unit from a lot of 5 → exactly 5 succeed, stock never negative.
ST=00000000-0000-4000-8000-000000001030
"${PSQL[@]}" -c "insert into auth.users (id, email) values ('$ST', 'conc.store@test.local');
  insert into public.profiles (user_id, full_name_ar) values ('$ST', 'مخزن');
  insert into public.user_roles (user_id, role_code, branch_id) values ('$ST', 'inventory_controller', '$B1');" >/dev/null
LOC=$("${PSQL[@]}" -c "insert into public.inv_locations (branch_id, code, name_ar, name_en) values ('$B1', 'CONC', 'تزامن', 'Conc') returning id;" | tail -1)
ITEM=$("${PSQL[@]}" -c "insert into public.inv_items (code, name_ar, name_en) values ('CONC-1', 'صنف', 'Item') returning id;" | tail -1)
SUP=$("${PSQL[@]}" -c "insert into public.suppliers (name_ar) values ('مورد') returning id;" | tail -1)
as_st() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$ST', false);"; }
"${PSQL[@]}" -c "$(as_st) select public.receive_goods('$LOC', '$SUP', 'C-1', '[{\"item_id\": \"$ITEM\", \"lot_no\": \"C\", \"qty\": 5, \"unit_cost\": 10}]', 'conc-grn');" >/dev/null
for i in $(seq 1 10); do
  "${PSQL[@]}" -c "$(as_st) select public.issue_stock('$LOC', '[{\"item_id\": \"$ITEM\", \"qty\": 1}]', null, 'اختبار تزامن', 'conc-iss-$i');" >/dev/null 2>&1 &
done
wait
ISS=$("${PSQL[@]}" -c "select count(*) from public.stock_issues where location_id='$LOC'")
QOH=$("${PSQL[@]}" -c "select qty_on_hand from public.inv_lots where location_id='$LOC'")
[ "$ISS" = "5" ] && [ "$QOH" = "0.000" ] || { echo "issues=$ISS on_hand=$QOH"; exit 1; }

# 6) Five sessions signed in parallel against a 2-session package → exactly 2 redemptions, never over-used.
NU=00000000-0000-4000-8000-000000001031
"${PSQL[@]}" -c "insert into auth.users (id, email) values ('$NU', 'conc.nurse@test.local');
  insert into public.profiles (user_id, full_name_ar) values ('$NU', 'تمريض');
  insert into public.user_roles (user_id, role_code, branch_id) values ('$NU', 'nurse', '$B1');" >/dev/null
as_nu() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$NU', false);"; }
LSR=00000000-0000-4000-8000-000000004002
TPL=$("${PSQL[@]}" -c "select set_config('app.package_rpc', 'on', false);
  with s as (insert into public.services (specialty_id, code, name_ar, name_en, revenue_account_id, is_package)
             values ('$DERM', 'PKG-CONC', 'باقة', 'Package', (select id from public.accounts where code = '2210'), true) returning id)
  insert into public.package_templates (code, name_ar, name_en, service_id, sessions, price, validity_days, sale_service_id)
  select 'CONC', 'باقة تزامن', 'Conc', '$LSR', 2, 1000, 30, id from s returning id;" | tail -1)
PKG=$("${PSQL[@]}" -c "$(as_fd) select id from public.sell_package('$PID', '$TPL', '$B1');" | tail -1)
PINV=$("${PSQL[@]}" -c "select invoice_id from public.patient_packages where id = '$PKG'")
"${PSQL[@]}" -c "$(as_fd) select public.record_payment('$PINV', 1000, 'card', 'conc-pkg', 'POS-P');" >/dev/null
CK='{"pregnancy":"no","isotretinoin":"no","photosensitizing":"no","recent_tan":"no","active_lesion":"no","herpes_history":"no","keloid":"no","light_epilepsy":"no","gold_therapy":"no"}'
SESS=()
for i in $(seq 1 5); do
  DEV=$("${PSQL[@]}" -c "select set_config('app.device_rpc', 'on', false);
    insert into public.devices (asset_no, branch_id, name_ar, name_en) values ('CONC-DEV-$i', '$B1', 'جهاز', 'Device') returning id;" | tail -1)
  APT=$("${PSQL[@]}" -c "insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
    values ('$B1','$PID','$DR','$DERM', tstzrange('2027-02-0$i 10:00+02','2027-02-0$i 10:15+02')) returning id;" | tail -1)
  "${PSQL[@]}" -c "update public.appointments set status = 'arrived' where id = '$APT';" >/dev/null
  SESS+=("$("${PSQL[@]}" -c "$(as_nu) select id from public.save_laser_session('$APT', '{\"device_id\":\"$DEV\",\"service_id\":\"$LSR\",\"patient_package_id\":\"$PKG\",\"fitzpatrick\":3,\"checklist\":$CK,\"areas\":[{\"area_code\":\"axilla\",\"wavelength_nm\":755,\"fluence\":18,\"spot_mm\":15,\"pulses\":100}]}');" | tail -1)")
done
for S in "${SESS[@]}"; do
  "${PSQL[@]}" -c "$(as_nu) select public.sign_laser_session('$S');" >/dev/null 2>&1 &
done
wait
RED=$("${PSQL[@]}" -c "select count(*) from public.package_redemptions where package_id = '$PKG'")
USED=$("${PSQL[@]}" -c "select units_used || '/' || value_used from public.patient_packages where id = '$PKG'")
[ "$RED" = "2" ] && [ "$USED" = "2/1000.00" ] || { echo "redemptions=$RED used=$USED"; exit 1; }

# 7) Ten parallel attempts to pay 800 from a 1,000 advance (two invoices) → exactly one succeeds, balance never negative.
"${PSQL[@]}" -c "$(as_fd) select public.record_deposit('$PID', '$B1', 1000, 'card', 'conc-dep', 'POS-D');" >/dev/null
AINV1=$("${PSQL[@]}" -c "$(as_fd) insert into public.invoices (branch_id, patient_id) values ('$B1','$PID') returning id;" | tail -1)
"${PSQL[@]}" -c "$(as_fd) insert into public.invoice_lines (invoice_id, service_id, unit_price) values ('$AINV1', '00000000-0000-4000-8000-000000004001', 800); select public.issue_invoice('$AINV1');" >/dev/null
AINV2=$("${PSQL[@]}" -c "$(as_fd) insert into public.invoices (branch_id, patient_id) values ('$B1','$PID') returning id;" | tail -1)
"${PSQL[@]}" -c "$(as_fd) insert into public.invoice_lines (invoice_id, service_id, unit_price) values ('$AINV2', '00000000-0000-4000-8000-000000004001', 800); select public.issue_invoice('$AINV2');" >/dev/null
for i in $(seq 1 10); do
  if [ $((i % 2)) -eq 0 ]; then T=$AINV1; else T=$AINV2; fi
  "${PSQL[@]}" -c "$(as_fd) select public.apply_advance('$T', 800, 'conc-apply-$i');" >/dev/null 2>&1 &
done
wait
APPLIED=$("${PSQL[@]}" -c "select coalesce(sum(amount), 0) from public.patient_deposits where patient_id = '$PID' and kind = 'applied'")
ADVBAL=$("${PSQL[@]}" -c "select app.advance_balance('$PID')")
[ "$APPLIED" = "800.00" ] && [ "$ADVBAL" = "200.00" ] || { echo "advance applied=$APPLIED balance=$ADVBAL"; exit 1; }

# 8) Whole ledger still balances.
BAL=$("${PSQL[@]}" -c "select sum(debit) - sum(credit) from public.journal_lines")
[ "$BAL" = "0.00" ] || { echo "ledger imbalance $BAL"; exit 1; }
echo "bookings=1 payments=1 split-paid=$PAID2 gateway-callbacks=1 stock-issues=$ISS/10 package-redemptions=$RED/5 advance-applied=$APPLIED ledger-balance=$BAL"
