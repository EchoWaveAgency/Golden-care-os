# Accounting event matrix

All operational postings go through `app.post_journal()` using semantic account keys from `account_settings` (Finance can re-map without code changes). Every entry: balanced at commit, inside an open fiscal period, linked to `source_type` + `source_id`, never edited or deleted.

## Implemented

| Event | Trigger | Debit | Credit | Notes |
|---|---|---|---|---|
| Invoice issued | `issue_invoice()` | `ar_patients` (net total) · `discounts_allowed` (discount) | Service revenue account (gross, per service/doctor) | Revenue lines carry `doctor_id` → settlement base |
| Patient payment | `record_payment()` | Method account: `cash_on_hand` / `card_clearing` / `instapay_clearing` / `wallet_clearing` / `bank_main` | `ar_patients` | Idempotent; cash requires open session |
| Invoice voided | `void_invoice()` | Mirror of issue entry | Mirror of issue entry | Only unpaid invoices; issuer cannot void |
| Manual reversal | `reverse_journal_entry()` | Mirror | Mirror | Not allowed for invoice/payment entries (use the document) |
| Refund paid out | `pay_refund()` after `request_refund()` → `decide_refund()` | `refunds` (4910, contra revenue) | Method account (cash / card / InstaPay / wallet / bank) | Approver ≠ requester; cash needs an open session and reduces expected cash at closing; invoice `refunded_total` ≤ amount paid |
| Online payment (portal) | `svc_payment_confirm()` from the verified gateway callback | `gateway_clearing` (1150) | `ar_patients` | Idempotent per gateway transaction; amount mismatch or changed balance → *review*, nothing posted; unmatched captures → `payment_exceptions` |

## Planned (Phase 1 M2 → Phase 2)

| Event | Debit | Credit |
|---|---|---|
| Patient advance / deposit | Method account | `patient_advances` |
| Advance applied to invoice | `patient_advances` | `ar_patients` |
| Gateway settlement to bank | `bank_main` + bank charges | `gateway_clearing` |
| Package sale | Method account / A/R | Deferred package revenue |
| Package redemption | Deferred package revenue | Service revenue |
| Package expiry | Deferred package revenue | Other income (policy) |
| Wallet top-up / use | Method account → wallet liability → A/R | |
| Cash over/short at close | `cash_over_short` | `cash_on_hand` (or reverse) |
| Card settlement | Bank + bank charges | `card_clearing` |
| Supplier invoice / payment | Inventory or expense → Suppliers → Bank | |
| Inventory consumption | Consumables expense | Inventory |
| Doctor fee accrual / payment | Doctor fees expense → Doctor fees payable → Bank/Cash | |
| Payroll accrual / payment | Salaries expense → Salaries payable → Bank | |

## Controls
- Period lock (`lock_fiscal_period`) blocks any posting dated inside the period.
- Header accounts are not postable.
- Balance check is a deferred constraint trigger — an unbalanced entry cannot commit, even from SQL.
- Tested in `supabase/tests/04_billing_accounting.sql` and `concurrency.sh`.
