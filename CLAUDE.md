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
6. Server actions use `getContext()` (user session → RLS). The service-role key is only for trusted scripts plus these audited server paths: patient OTP sign-in (`actions/portal-auth.ts`), the message dispatcher job, the WhatsApp and Paymob webhooks, portal payment start (`actions/portal-pay.ts`, after the patient's own session created the intent), and account creation / sign-in blocking (`actions/users.ts`, after the database checked `users.manage`). They use `svc_*` wrapper functions and read only what they need. Never import `lib/server/admin.ts` anywhere else.
7. All UI text is bilingual: `src/lib/i18n.ts` in the staff system, `src/lib/site/copy.ts` or inline ar/en pairs on the website and portal. Dates/times are localized strings — do not wrap them in `.num`.
8. Don't invent clinic policy (prices, doctor contracts, refund rules, tax). Build the configurable mechanism and log the question in `OPEN_QUESTIONS.md`.
9. Patients never get table grants. Portal features are `portal_*` SECURITY DEFINER functions that call `app.portal_require(patient, level)` first.

## Module map
Identity/permissions (0002) · Audit (0003) · Patients (0004) · Scheduling + encounters (0005) · Ledger (0006) · Billing + cashier (0007) · RLS/grants (0008) · Reference data (0009) · Website/CMS/leads (0010) · Prescriptions, release gate, portal API, messaging (0011) · Service-role wrappers (0012) · Refunds, online payments, user administration (0013).

## Current phase
Phase 1 core + website + patient portal (session 3). See `PROGRESS.md`.
