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

# 4) Whole ledger still balances.
BAL=$("${PSQL[@]}" -c "select sum(debit) - sum(credit) from public.journal_lines")
[ "$BAL" = "0.00" ] || { echo "ledger imbalance $BAL"; exit 1; }
echo "bookings=1 payments=1 split-paid=$PAID2 ledger-balance=$BAL"
