# Test plan

| Layer | Where | Runs in CI | Current |
|---|---|---|---|
| Unit (pure logic) | `src/lib/*.test.ts` | ✅ | 16 tests: normalization, Cairo time/DST, role navigation, error mapping, appointment workflow, i18n |
| Database (RLS, rules, ledger) | `supabase/tests/0*.sql` | ✅ | 5 suites |
| Concurrency | `supabase/tests/concurrency.sh` | ✅ | booking, idempotent payment, split payments, ledger balance |
| End-to-end (browser) | local stack + scripted journey | manual now → Playwright in CI next milestone | 27 checks passed |

## Database suites
1. **01_identity_rls** — branch scope, no-role user sees nothing, doctor needs assignment, finance gets masked directory only, no self-grant, delegation expires, anon denied.
2. **02_patients** — phone/name normalization (Arabic digits, hamza), validation, duplicates by phone and name+DOB, unique national ID, no deletes, audit with actor and changed columns, append-only audit, consent history.
3. **03_scheduling** — doctor/room overlap blocked, adjacent allowed, cancel frees slot, invalid transitions rejected (RPC and direct update), cancel reason required, queue numbers, full status history.
4. **04_billing_accounting** — totals from lines, discount bounds, issue posts Dr A/R + Dr discounts / Cr revenue per account with doctor on lines, locked after issue, cash needs session, idempotent retry, reference required, overpay blocked, cash close requires note, trial balance balances, void reverses and nets A/R, separation of duties, ledger immutable, unbalanced/header/locked-period postings rejected, no direct ledger writes.
5. **05_encounters** — only treating doctor documents/signs, other doctor blind, reception sees alert flag only, signed encounter locked, addenda immutable, audit.

## Master-spec E2E scenarios — coverage
| # | Scenario | Status |
|---|---|---|
| 1 | New patient → completed visit → paid invoice | ✅ |
| 5 | Partial payment and outstanding balance | ✅ |
| 6 | Approved discount | ◑ discount works; approval limits pending policy |
| 7 | Refund and accounting reversal | ◑ void + reversal done; refunds next milestone |
| 13 | Unauthorized access attempt | ✅ |
| 14 | Provider failure → safe retry | ◑ idempotent payment retry done; external providers Phase 3 |
| 2–4, 8–12 | WhatsApp, laser package, dental plan, settlements, purchasing, payroll, lab results, complaints | Phase 2–3 |

## Session 3 additions — prescriptions, portal, messaging
- `supabase/tests/07_portal_rx_messaging.sql`: allergy acknowledgement gate; restricted medicines; signed prescriptions immutable; only the treating doctor (or `clinical.release`) releases; OTP stored hashed, expiry, 5-attempt lockout, throttling; patient A cannot read patient B through any `portal_*` function; family `appointments` vs `full` levels, expiry and revocation; patients have no direct table access; outbox idempotency, opt-out → skipped, delivery statuses never move backwards; retry permission.
- Browser journey (portal, 35 checks): doctor prescribes → allergy gate → sign → release → patient OTP sign-in (unknown number gets a neutral answer; wrong code rejected) → overview/medical/printable Rx/invoice → book from live availability and cancel → complaint resolved by Patient Relations → outbox shows masked numbers → second patient blocked, tampered "acting for" cookie ignored → appointments-only sharing → English on mobile → sign out.
- Operations: dispatcher `POST /api/jobs/dispatch` without the secret → 401; with it → queued messages sent once (second run 0); webhook verification token checked; unsigned webhook POST refused.

## Session 4 additions — refunds, online payments, user administration
- `supabase/tests/08_refunds_payments_admin.sql`: refund reason/amount limits including pending requests; requester cannot approve; payout only after approval; cash payout needs a session; retry-safe payout; Dr 4910 / Cr cash; cash closing subtracts refunds; no direct writes; portal intents only for own/full-grant files; patients cannot confirm payments; declined/duplicate/second-charge/unknown-order callbacks; amount mismatch → review; started intents cannot be re-attached; staff cannot record "online" payments; user admin: self-changes refused, reasons required, temporary delegation expires, ended grants kept, deactivation removes all permissions, branch administrators limited, password flag not user-clearable.
- `concurrency.sh`: 10 parallel gateway callbacks for one capture → one payment.
- Unit (`gateway.test.ts`): HMAC verification and tampering, signed order id only, non-sale transactions rejected, simulator disabled against remote databases.
- Browser `e2e/m4-journey.mjs` (25 checks): admin creates account → forced password change → reception refund request → chief accountant approves → cashier pays from a session, cash closes exactly → trial balance → patient pays online (declined, then success with receipt) → finance sees capture → deactivated account cannot sign in.
- Independent code review of the money paths before release; all 10 findings fixed (see PROGRESS session 4).

## Session 5 additions — settlements and two-factor sign-in
- `supabase/tests/09_settlements_mfa.sql`: aal1 sessions get no permission / menu / data / doctor identity when MFA is required; automatic MFA for privileged roles; admin require/reset rules; flags not writable directly; grants not rewritable; contracts (permissions, overlap, retroactive lock, automatic end); statement math (percent, fixed per unit, line discounts, proportional refund, other doctors excluded), duplicate/future refusal, drafts hidden from doctors, three maker-checker rules, journals, idempotent payment, no-contract block, cancel and redo, stale drafts, void reversal, negative carry with correct accrual, ledger balanced.
- Browser `e2e/m5-journey.mjs` (20 checks) and all earlier journeys now run with real two-factor sign-in for privileged demo users (`e2e/mfa.mjs`).

## Session 6 additions — inventory
- `supabase/tests/10_inventory.sql`: catalog scope and controlled/category guard; store policies by branch; receipt rules (expiry required, expired refused, duplicate supplier invoice, idempotency, decimals, owner of the key); journals; stock changes only through RPCs; FEFO across lots; expired lots never issued; appointment link to patient; controlled items; template suggestion; visibility by permission; alerts; frozen store during counts; count flow with maker-checker; mixed gains and losses; inventory ledger = stock value; immutable moves.
- `concurrency.sh`: 10 parallel issues of 1 unit from a lot of 5 → exactly 5 issued, stock 0.
- Browser `e2e/m6-journey.mjs` (17 checks): overview and alerts → receipt with expiry rule → FEFO issue for today's appointment → shortage refused → blind count → approval by the chief accountant (MFA) → trial balance.

## Session 7 additions — purchasing and reports
- `supabase/tests/11_purchasing_reports.sql`: order permissions, duplicate items, zero cost refused, receive only after approval, approver ≠ creator, over-receipt refused, prices from the order, idempotent receipt, partial → received, cancel rules, close short (reason required, lines kept, no later receipt), receipts against orders confirmed by the approver, direct receipt blocked from payment until confirmed by someone else, outstanding and pending limits, requester ≠ releaser, journal Dr 2100 / Cr 1110, aging, visibility by permission, profitability math (net, doctor share, consumables, margin), second invoice on the same appointment does not double consumables, no report without `reports.finance`, ledger balanced.
- Unit (`reports.test.ts`): CSV BOM, quoting, margin %, formula neutralisation.
- Browser `e2e/m7-journey.mjs` (18 checks): order → approval by the director (MFA) → partial receipt, over-receipt refused → close short → direct receipt confirmed by the director → payment requested by the accountant, released by the director → profitability report and CSV → trial balance.

## Session 8 additions — devices, laser, packages
- `supabase/tests/12_devices_laser_packages.sql`: device registration and guard, counters (no going back, unlogged use, reset lower only), work orders and status rules (breakdown, failed/passing calibration, cancel), usage summary; package catalogue and sale (net deferred balance, discount reclass, idempotent sale, invoice-line guard); laser session validation (device settings, skin type, checklist, doctor override with reason, counter continuity, pulse reconciliation, payment required), immutability, counter and redemption postings, exact values, no double billing either way, void and refund guards, device down / calibration overdue blocks, visibility (front desk, other doctors), consumable template, expiry of paid packages only, settlements with package sessions, profitability on redemption, ledger balanced.
- `concurrency.sh`: 5 sessions signed in parallel against a 2-session package → exactly 2 redemptions.
- Browser `e2e/m8-journey.mjs` (25 checks): device register and alerts → breakdown and repair → package sale with discount and payment → booking and check-in → laser session (live pulse check, mismatch refused, signed) → consumables from the template → counter and package balance → settlement (package session at net value, fixed doctor fee) → profitability → deferred balance → trial balance.

## Session 9 additions — dental plans, advances, lab
- `supabase/tests/13_dental_plans_advances_lab.sql`: plan writing rules (own patients and plans only), price list pricing, FDI and surface validation, quotation, acceptance validation (sum, dates, rows), deposits (cash session, idempotency, allocation, journal), 'advance' method guard, apply limit and key collisions, work done → billing → automatic apply, lab case visibility and transitions, bill rules (sent first, right lab/vendor, duplicates, confirmation before payment, void), settlement lab share (confirmed bills only), advance refund maker-checker and expected cash, overdue installments, cancel item trims installments, pending refund reserves balance, voided plan invoice releases items, cancel plan, profitability with lab costs, ledger balanced.
- `concurrency.sh`: 10 parallel applications of 800 against a 1,000 advance → exactly 800 applied.
- Unit (`dental.test.ts`): installment split to the piaster, month-end dates, tooth numbers.
- Browser `e2e/m9-journey.mjs` (26 checks): booking and check-in → plan from the visit → quotation → acceptance with installments → down payment → filling done and billed from the advance → lab case sent/returned → lab bill, wrong bill voided → confirmed by the director → contract with lab share → settlement → crown billed → profitability → trial balance.

## Session 10 additions — patient care assistant
- `supabase/tests/14_care_agent.sql`: settings permission and defaults; journeys created only for consenting patients; legacy template not duplicated; contact hours; claim leases; atomic steps with version conflicts; reply routing and duplicate deliveries; confirm and cancel through the assistant (no duplicate cancellation message; cancellation window → request ticket); tickets and urgent escalations (15-minute due time, treating doctor); visibility by role; escalation handling; staff reply window and opted-out patients; one conversation per phone (deferral and within a batch); after-visit context and satisfaction; follow-up reminders (lead days, already booked); opt-out by action and by message (everyone on the number); unrouted messages (lead, ticket, thanks, shared number → escalation); danger signs in the same transaction (known, unknown, paused conversations); sweep of unprocessed messages; delivery failure retries / voice fallback / call events; send failure never resets a staff conversation; internal functions not callable; on-call alert without patient details.
- `concurrency.sh`: 6 parallel job runs over 5 due conversations → each opened once; 10 parallel replies to one step → applied once.
- Unit `src/lib/care/care.test.ts` (82): normalisation, danger signs (prefixes, two-part, fever numbers) and no over-triggering, opt-out only when clearly about messages, negations, every conversation path (booking, cancel window, appointment changed, questions, misunderstandings, nudges, voice fallback, after-visit branches, follow-up reminder, voice identity and silence), scripts in both languages, crisis line.
- Browser `e2e/m10-journey.mjs` (25 checks, local simulator): settings → booking confirmation → visit with a follow-up date → after-visit follow-up (worse, complaint, low rating, follow-up booking) → doctor sees it → danger sign → urgent escalation, assistant paused, staff reply, resolved → tickets → outcome figures.

## Session 11 additions — HR and payroll
- `supabase/tests/15_hr_payroll.sql`: setup refusal until rates are set, punch import (duplicates, unknown ids, bad rows), device push, attendance statuses and minutes, manual punch approval, leave and loan separation of duties, full payslip math line by line (deductions 2,028.54, net 7,971.46, lateness 18.75, tax 559.79), balanced journals, locked month, own payslip only, doctors / desk see nothing.
- Unit `hr.test.ts` (7): export parsing, date formats, minutes text.
- Browser `e2e/m11-journey.mjs` (18 checks): employees → attendance import → leave approval → employee's own file → bonus → prepare (HR) → approve (chief accountant, accrual journal) → pay (director) → payslip → trial balance.

## Session 12 additions — package refunds, supplier returns, e-receipts, printing
- `supabase/tests/16_package_refunds_supplier_returns.sql`: refund = unused − fee, fee bounds, unpaid package refused, redemption blocked while open, separation of duties, cash needs a session, journals, expected cash, transfer (value and memo), supplier return quantities, lot and payable effects, refusals (own approval, already paid, lot moved).
- `supabase/tests/17_einvoice.sql`: off by default, blocked with reasons, only the accountant configures, claim once, retry with backoff, accepted ids, refunds as return documents for the amount paid back, voids as cancellations, cashier sees the receipt id but not the queue.
- Browser `e2e/m12-journey.mjs` (21 checks): e-receipts on → two packages sold and paid → 80 mm receipt → package refund (request, approve, pay; 4,500 − 300 = 4,200) → package transfer → supplier return (store records, chief approves, 70.00) → blocked documents → service codes → re-send → simulator accepts (including the 4,200 return) → receipt shows the e-receipt id → day sheet → trial balance.
