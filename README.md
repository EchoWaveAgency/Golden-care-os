# Golden Care OS — نظام تشغيل الرعاية الصحية

**Golden Care Clinics · Madinat El Shorouk** — نرعاك لحياة أفضل

A production-grade healthcare operating system for Golden Care Clinics, built on **Next.js 14 + Supabase (PostgreSQL)**. Arabic-first (RTL) with a full English interface.

نظام تشغيل متكامل لعيادات جولدن كير، مبني على Next.js 14 وSupabase. الواجهة عربية أولًا مع نسخة إنجليزية كاملة.

---

## What works today — ما يعمل الآن (Phase 1, milestone 1)

| Area | Status |
|---|---|
| Identity, roles, branch-scoped permissions, temporary delegation | ✅ Database-enforced (RLS) |
| Role workspaces (each role sees only its own menu and data) | ✅ |
| Master patient record, Arabic name normalization, Egyptian phone normalization, duplicate detection | ✅ |
| Appointments with double-booking prevention (doctor + room), status workflow, queue numbers, history | ✅ |
| Doctor encounters: treating-doctor access, clinical alerts, sign-off lock, addenda | ✅ Foundation |
| Invoicing from the effective price list, discounts, issue, void (with separation of duties) | ✅ |
| Payments (cash, card, InstaPay, wallet, bank transfer) with idempotent retry | ✅ |
| Cashier sessions and daily cash closing with mandatory note on differences | ✅ |
| Double-entry general ledger, automatic balanced journals, period locks, trial balance | ✅ |
| Append-only audit trail written by database triggers | ✅ |
| Executive command center (live figures only) | ✅ First version |

Everything else in the master specification is planned in phases — see `PROGRESS.md`.

## Quick start

```bash
npm install
npm run db:test          # applies all migrations to a throwaway PostgreSQL 16 and runs the SQL + concurrency suites
npm test                 # unit tests
```

### Run the full app locally (no Docker)

```bash
npm run stack:local      # PostgreSQL 16 + Supabase Auth + PostgREST on http://localhost:54321, writes .env.local
npm run demo:data        # synthetic demo users and data (password printed)
npm run build && npx next start -p 3100
```

Requires PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`). On a hosted Supabase project, see `docs/DEPLOYMENT_RUNBOOK.md`.

### Demo accounts (synthetic data only)

`reception@`, `dr.derm@`, `dr.dental@`, `dr.obgyn@`, `nurse@`, `cashier@`, `accountant@`, `auditor@`, `owner@`, `director@`, `admin@`, `relations@` — all `@demo.goldencare.local`.

## Repository map

```
supabase/migrations/   schema, RLS, triggers, RPCs (source of truth)
supabase/seed.sql      organization, branch, starter chart of accounts, fiscal periods
supabase/tests/        SQL test suites + concurrency checks
src/app/(app)/         role workspaces (reception, patients, doctor, billing, cashier, accounting, audit, executive)
src/app/actions/       server actions (all writes go through the signed-in user's session → RLS applies)
src/lib/               i18n, formatting, normalization, navigation, error mapping
scripts/               db-test, local stack, demo data
docs/                  architecture, permissions, accounting events, security, tests, deployment, Arabic user guide
```

## Non-negotiables built in

- The database refuses what a role may not do — the UI only hides it.
- Posted journals, payments, patient records, signed encounters and audit events cannot be edited or deleted. Corrections are reversals, voids, or addenda.
- Every journal entry balances, sits in an open fiscal period, and references its source document.
- Prices come from the effective price list on the server, never from the browser.
- No real patient data in development, tests, or demos.
