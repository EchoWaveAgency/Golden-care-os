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
