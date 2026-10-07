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
| Doctor settlement approved | `approve_settlement()` | `doctor_fees` (5100) | `doctor_fees_payable` (2300) | Per doctor (`doctor_id`); amount excludes balances carried from earlier statements; negative statements post the reverse |
| Doctor settlement paid | `pay_settlement()` | `doctor_fees_payable` (2300) | `bank_main` | Bank transfer with reference; payer ≠ approver |
| Goods received | `receive_goods()` | `inventory` (1300) | `suppliers_payable` (2100) | Lot value = qty × unit cost; idempotent; one receipt per supplier invoice |
| Supplier payment released | `decide_supplier_payment()` | `suppliers_payable` (2100) | `bank_main` (1110) | Requested by one person, released by another; only confirmed receipts; never above what is outstanding |
| Package sold | `sell_package()` → `issue_invoice()` | `ar_patients` (net) · `discounts_allowed` (discount) | `package_deferred` (2210, gross) | Then a reclass Dr 2210 / Cr 4900 for the discount, so the deferred balance is the net price |
| Package session redeemed | `sign_laser_session()` | `package_deferred` (2210) | Service revenue (e.g. 4110), with doctor | Equal share per session, last one takes the remainder; invoice must be fully paid |
| Package expired | `expire_packages()` | `package_deferred` (2210) | `package_breakage` (4130) | Paid packages only; policy to be confirmed by finance |
| Advance / installment received | `record_deposit()` | Method account (cash 1100 / bank 1110) | `patient_advances` (2200) | Allocated to installments in order; cash needs an open cashier session; idempotent |
| Advance applied to an invoice | `apply_advance()` (also automatic in `bill_plan_items()`) | `patient_advances` (2200) | `ar_patients` (1200) | Internal payment method 'advance'; never above the available balance (pending refunds reserved) |
| Advance refunded | `pay_deposit_refund()` | `patient_advances` (2200) | Method account | Requested → approved by someone else → paid |
| Plan work billed | `bill_plan_items()` → `issue_invoice()` | `ar_patients` (1200) | Service revenue (e.g. 4120 dental), with doctor | Only items marked done; revenue recognised when work is done |
| Lab bill / maintenance bill | `record_supplier_bill()` | `lab_costs` (5500) / `maintenance_expense` (5600) | `suppliers_payable` (2100) | Payable only after confirmation by another approver |
| Supplier bill voided | `void_supplier_bill()` | Reversal of the bill journal | | Unpaid bills only; settled doctor share reversed in the next settlement |
| Package refund paid | `pay_package_refund()` after `request_package_refund()` → `decide_package_refund()` | `package_deferred` (2210, unused value) | Method account (refund) · `package_breakage` (4130, fee kept) | Approver ≠ requester; cash needs an open session and reduces expected cash; redemptions blocked while open |
| Package transferred | `transfer_package()` | `package_deferred` (2210, memo: receiving patient) | `package_deferred` (2210, memo: original patient) | Remaining sessions and value move; reason required |
| Supplier return approved | `decide_supplier_return()` after `request_supplier_return()` | `suppliers_payable` (2100) | `inventory` (1300) at lot cost | Approver ≠ store keeper; refused if the delivery's unpaid balance is below the return |
| Payroll approved / paid | `approve_payroll()` / `pay_payroll()` | Salaries expense (5200), employer insurance (5210) → then `salaries_payable` (2400) | `salaries_payable`, insurance / tax payable (2410 / 2420), employee advances (1160) → then bank | Preparer, approver and payer are three different people |
| Employee loan paid out | `disburse_loan()` | `employee_advances` (1160) | Bank / cash | Requested → approved → paid by three people |
| Payroll approved (accrual) | `approve_payroll()` | Salaries expense (5200) for earnings; employer insurance (5210) | Salaries payable (2400) net; insurance payable (2410); payroll tax payable (2420); employee advances (1160) for loan installments; attendance deductions reduce 5200 | Dated the last day of the month |
| Payroll paid | `pay_payroll()` | Salaries payable (2400) | Bank / cash | Payer ≠ preparer ≠ approver |
| Insurance / tax paid | `pay_payroll_liability()` | 2410 / 2420 | Bank | With reference |
| Consumables issued | `issue_stock()` | `consumables_expense` (5300), with patient | `inventory` (1300) | FEFO lot costs; an emptied lot takes its exact remaining value |
| Stock count approved | `approve_count()` | `inventory_adjustments` (5310) for losses / `inventory` for gains | `inventory` for losses / `inventory_adjustments` for gains | Approver ≠ counter; the store is frozen while counting |
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
| Supplier payment | Suppliers payable | Bank |
| Payroll accrual / payment | Salaries expense → Salaries payable → Bank | |

## Controls
- Period lock (`lock_fiscal_period`) blocks any posting dated inside the period.
- Header accounts are not postable.
- Balance check is a deferred constraint trigger — an unbalanced entry cannot commit, even from SQL.
- Tested in `supabase/tests/04_billing_accounting.sql` and `concurrency.sh`.
