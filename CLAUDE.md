# CLAUDE.md — working notes for Golden Care OS

## Stack
Next.js 14 (App Router, Server Components, Server Actions) · Supabase (Postgres 16, Auth, RLS) · Tailwind · zod · vitest.

## Commands
- `npm run db:test` — migrations + seed + SQL suites + concurrency checks on a throwaway Postgres 16. Must pass before any commit touching `supabase/`.
- `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
- `npm run stack:local` then `npm run demo:data` — full local stack without Docker (Auth + PostgREST + Postgres).

## Rules
1. Schema changes = new timestamped file in `supabase/migrations/`. Never edit an applied migration in a shared environment; never change schema from the dashboard.
2. RLS on every table. New table ⇒ enable RLS, add policies driven by `app.has_permission(code, branch)`, add audit trigger, add tests in `supabase/tests/`.
3. Financial/clinical/stock state changes that touch more than one table go in a `SECURITY DEFINER` RPC that checks permission first, locks rows, and posts balanced journals via `app.post_journal`.
4. Deferred constraint triggers and triggers that read RLS-protected tables must be `SECURITY DEFINER` (they run as the caller at commit).
5. No deletes of business records. Use void / reverse / archive / addendum with a reason.
6. Server actions use `getContext()` (user session → RLS). The service-role key is only for trusted scripts plus these audited server paths: patient OTP sign-in (`actions/portal-auth.ts`), the message dispatcher job, the WhatsApp and Paymob webhooks, portal payment start (`actions/portal-pay.ts`, after the patient's own session created the intent), account creation / sign-in blocking (`actions/users.ts`, after the database checked `users.manage`), and the care assistant runner (`lib/care/runner.ts`: dispatcher job, WhatsApp webhook, voice callbacks, and the local simulator actions in `actions/care.ts`, which refuse to run unless `CARE_SIMULATOR=on` with development messaging), the biometric device push (`app/iclock/cdata`, registered serial numbers only), the e-receipt connector (`lib/einvoice/connector.ts`, called by the dispatcher job), and the patient file store (`actions/files.ts` writes bytes only to the path `begin_patient_file` just reserved for the user's session; downloads in `app/os/files/[id]` and `portal/files/[id]` read only what `patient_file_access` / `portal_file` returned). They use `svc_*` wrapper functions and read only what they need. SMS sending in the dispatcher uses the same job path. Never import `lib/server/admin.ts` anywhere else.
7. All UI text is bilingual: `src/lib/i18n.ts` in the staff system, `src/lib/site/copy.ts` or inline ar/en pairs on the website and portal. Dates/times are localized strings — do not wrap them in `.num`.
8. Don't invent clinic policy (prices, doctor contracts, refund rules, tax). Build the configurable mechanism and log the question in `OPEN_QUESTIONS.md`.
9. Patients never get table grants. Portal features are `portal_*` SECURITY DEFINER functions that call `app.portal_require(patient, level)` first.
10. Any new permission check must go through `app.has_permission` / `app.current_staff_id` (both enforce two-factor sign-in). Never check `user_roles` directly in new code.

## Module map
Identity/permissions (0002) · Audit (0003) · Patients (0004) · Scheduling + encounters (0005) · Ledger (0006) · Billing + cashier (0007) · RLS/grants (0008) · Reference data (0009) · Website/CMS/leads (0010) · Prescriptions, release gate, portal API, messaging (0011) · Service-role wrappers (0012) · Refunds, online payments, user administration (0013) · Doctor settlements, two-factor enforcement (0014) · Inventory & consumables (0015) · Purchasing, supplier payments, profitability report (0016) · Devices, laser sessions, packages (0017) · Dental plans, installments, patient advances, lab cases, supplier bills (0018) · Patient care assistant (0019–0020) · HR, attendance, leave, loans, payroll (0021) · Package refunds and transfers, supplier returns (0022) · E-receipts / e-invoices queue (0023) · Doctor withholding tax, collected-basis contracts (0024) · Purchasing thresholds, purchase VAT, supplier credits (0025) · Card/gateway settlements, loyalty, referrals (0026) · Portal plans and online installments, salary increments, end-of-service (0027) · Patient files, results review and release (0028) · Dental chart (0029) · Staff KPIs and performance reviews (0030) · Stock transfers, device booking (0031) · Articles, testimonials, landing A/B, marketing funnel, SMS (0032–0033).

## Current phase
Phase 1 core + website + portal + payments + settlements + MFA + inventory + purchasing & reports + devices, laser & packages (session 8) + dental plans, advances & lab (session 9) + patient care assistant (session 10) + HR & payroll (session 11) + package refunds, supplier returns, e-receipts, printing (session 12) + finance completion (13) + patient files, dental chart, performance (14) + transfers and device booking (15) + articles, testimonials, A/B, funnel, SMS (16). See `PROGRESS.md`.

## Care assistant rules
- Safety first: `safety()` runs on the raw text before anything else; danger signs are escalated in the same database call that stores the message (`svc_care_inbound(..., p_urgent)`). Never move that later.
- The assistant never gives medical advice. Wording lives in `src/lib/care/scripts.ts` (WhatsApp openers must match the approved templates in `message_templates`).
- Conversation logic (`engine.ts`) is pure and fully unit-tested; every path change needs a test in `care.test.ts`.
