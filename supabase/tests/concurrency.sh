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

# 6) Whole ledger still balances.
BAL=$("${PSQL[@]}" -c "select sum(debit) - sum(credit) from public.journal_lines")
[ "$BAL" = "0.00" ] || { echo "ledger imbalance $BAL"; exit 1; }
echo "bookings=1 payments=1 split-paid=$PAID2 gateway-callbacks=1 stock-issues=$ISS/10 ledger-balance=$BAL"
