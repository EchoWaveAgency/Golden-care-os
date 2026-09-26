# Progress

## Session 1 — 2026-09-26: greenfield foundation (Phase 0 + Phase 1 milestone 1)

No existing Golden Care OS code was available, so the system was started from scratch on the known target stack (Next.js 14 + Supabase).

### Delivered
- 9 migrations: foundation, identity/permissions, audit, patients, scheduling + encounters, double-entry ledger, billing + cashier, RLS/grants, reference data (10 specialties, 26 permissions, 18 roles, 5 payment methods).
- Starter chart of accounts, account-key mapping and monthly fiscal periods (`supabase/seed.sql`) — **for accountant review**.
- Arabic-first web app with role workspaces: reception, patients (search/register/profile), booking, doctor clinic + encounter, invoices, cashier, accounting (trial balance, journal), audit trail, command center.
- Docker-free local stack (Postgres + Supabase Auth + PostgREST) and synthetic demo data script.

### Verified (how)
| Check | Result |
|---|---|
| All migrations apply on clean PostgreSQL 16 | ✅ `npm run db:test` |
| SQL suites: RLS scope, patients, scheduling, billing/ledger, encounters | ✅ 5/5 |
| Concurrency: 10 parallel same-slot bookings → 1; 10 parallel retries of one payment → 1 payment/1 journal; 10 parallel split payments → never overpaid; ledger nets to zero | ✅ |
| Unit tests (normalization, Cairo time/DST, nav per role, error mapping, workflow) | ✅ 16/16 |
| Typecheck, lint, production build | ✅ |
| Browser end-to-end journey against local stack (register → duplicate warning → book → check-in → doctor encounter + allergy + sign → reception sees allergy flag only → invoice with discount → cash refused without session → cash + InstaPay → cash close with difference note → trial balance balanced → accountant blocked from patient file → owner dashboard → English LTR) | ✅ 27/27 |

### Fixed during verification
- Deferred ledger checks ran as the caller and could not see lines under RLS → made `SECURITY DEFINER`.
- Concurrent payment retries could race past the idempotency check → invoice row is locked before the key is checked.
- `service_role` could not execute `app.*` helpers used by defaults/triggers → granted.
- Draft-invoice and payment forms kept stale values after a server update → forms remount on state change.
- Active menu item did not follow navigation → client-side nav highlighting.

## Next milestone (proposed — needs approval)
**Phase 1 milestone 2 — complete the production core**
1. Staff & user administration screens (invite user, assign role/branch/validity, deactivate) with MFA enforcement for privileged roles.
2. Settings screens: services, price lists (effective dating), rooms, doctor schedules and exceptions (Ramadan hours, leave).
3. Slot finder from doctor schedules; reschedule; waiting list; appointment reminders queue (provider adapter stub).
4. Refunds and credit notes (maker-checker), patient advances/deposits, receipt printing (80 mm + A4).
5. Specialty template engine (Medical Director configurable) + prescriptions with allergy acknowledgement.
6. Manual journal entries with maker-checker; period close screen; A/R aging.
7. Playwright E2E suite in CI; backup/restore runbook rehearsal on staging.

Acceptance: each item has RLS tests, audit coverage, bilingual UI, and an E2E scenario.

## Roadmap addition — 2026-09-26: website, landing pages, patient portal
Scope added from master prompt v3 section 20 (`docs/specs/WEBSITE_PORTAL_SPEC.md`). Placement:
- **Phase 3a** — public website on the same database (approved-only catalog views), CMS with medical review workflow, leads funnel into Patient Relations, landing-page engine, consent-gated analytics.
- **Phase 3b** — online booking from real availability (schedules + rooms + devices), offers with price/terms snapshot.
- **Phase 3c** — patient portal (separate patient auth context, release gate, family access grants, OTP adapter, financial account, online payments).
Prerequisites from Phase 1 M2: settings screens (services/prices/schedules), refunds & credit notes, specialty templates + prescriptions (release source).
