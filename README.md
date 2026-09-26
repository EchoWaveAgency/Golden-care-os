# Golden Care OS — نظام تشغيل الرعاية الصحية

**Golden Care Clinics · Madinat El Shorouk** — نرعاك لحياة أفضل

A production-grade healthcare operating system for Golden Care Clinics, built on **Next.js 14 + Supabase (PostgreSQL)**. Arabic-first (RTL) with a full English interface.

نظام تشغيل متكامل لعيادات جولدن كير، مبني على Next.js 14 وSupabase. الواجهة عربية أولًا مع نسخة إنجليزية كاملة.

---

## What works today — ما يعمل الآن

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
| **Public website** `/ar` `/en` — specialties, doctors, offers, booking from live availability, landing pages, SEO | ✅ |
| **Website CMS** with Draft → Medical Review → Marketing Review → Published, versions, scheduling | ✅ |
| **Patient Relations inbox** — website/campaign requests with UTM, SLA, one-click conversion to appointment | ✅ |
| Settings — services, effective-dated prices, doctor schedules, leave/holidays, contact details | ✅ |
| Patient portal, online payments, HR/payroll, inventory, laser, settlements | ⏳ next milestones |

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

Website: http://localhost:3100/ar · Staff system: http://localhost:3100/os

Requires PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`). On a hosted Supabase project, see `docs/DEPLOYMENT_RUNBOOK.md`.

### Demo accounts (synthetic data only)

`reception@`, `relations@`, `marketing@`, `meddir@`, `dr.derm@`, `dr.dental@`, `dr.obgyn@`, `nurse@`, `cashier@`, `accountant@`, `auditor@`, `owner@`, `director@`, `admin@` — all `@demo.goldencare.local`.

## Repository map

```
supabase/migrations/   schema, RLS, triggers, RPCs (source of truth)
supabase/seed.sql      organization, branch, starter chart of accounts, fiscal periods
supabase/tests/        SQL test suites + concurrency checks
src/app/os/(shell)/    staff workspaces (reception, leads, patients, doctor, billing, cashier, accounting, content, settings, audit, executive)
src/app/(site)/[lang]/ public website (ar/en): home, specialties, doctors, offers, book, contact, landing pages, policies
src/app/actions/       server actions (all writes go through the signed-in user's session → RLS applies)
src/lib/               i18n, formatting, normalization, navigation, error mapping
scripts/               db-test, local stack, demo data
docs/                  architecture, permissions, accounting events, security, tests, deployment, Arabic user guide
docs/website/          website architecture, sitemap, CMS model, landing pages, analytics, SEO, security, UAT
```

## Non-negotiables built in

- The database refuses what a role may not do — the UI only hides it.
- Posted journals, payments, patient records, signed encounters and audit events cannot be edited or deleted. Corrections are reversals, voids, or addenda.
- Every journal entry balances, sits in an open fiscal period, and references its source document.
- Prices come from the effective price list on the server, never from the browser.
- No real patient data in development, tests, or demos.
