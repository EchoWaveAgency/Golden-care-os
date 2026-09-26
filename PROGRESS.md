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

## Session 2 — 2026-09-26: website, CMS, Patient Relations, settings

### Delivered
- Staff system moved to `/os`; public website at `/ar` and `/en` on the same database.
- Migration 0010: content workflow with medical approval and published snapshots, offers with capacity and frozen price, landing pages, leads funnel with SLA and activity timeline, live availability from schedules/exceptions/bookings, anonymous public API, new `marketing` role and 7 permissions.
- Staff: Patient Relations inbox (`/os/leads`) with one-click conversion to patient + appointment; website CMS (`/os/content`) with approval steps and version history; settings (`/os/settings`) for services, effective-dated prices, doctor schedules, leave/holidays, contact details and tracking IDs.
- Website: home, specialties (+ detail with services, prices, doctors, offers, FAQ, preparation, disclaimer), doctors, offers, booking wizard on real availability, contact/callback, about, 4 policy pages (legal review required), landing pages with UTM capture and real countdown, sitemap, robots, hreflang, JSON-LD, consent-gated analytics, WhatsApp button.
- Demo website content is created through the real approval workflow (marketing + medical director demo users).

### Verified
- SQL suites 6/6 + concurrency ✅ (new: `06_website_crm.sql`).
- Unit tests 18/18, typecheck, lint, production build ✅.
- Browser: staff journey 27/27 ✅ and website journey 17/17 ✅ (visitor books → inbox with UTM → conversion → CMS edit keeps approved version live).

### Not built yet (honest scope)
Patient portal (OTP, release gate, family access, financial account), online payments/deposits, medical articles & instruction library, devices page, testimonials, A/B tests, marketing dashboard, redirect manager, notifications (WhatsApp/SMS), and all Phase 2 modules (HR, payroll, inventory, laser, settlements).

### Next milestone (proposed)
Patient portal + release gate + notifications adapter (WhatsApp Business) + prescriptions (release source) + marketing funnel dashboard.

## Session 3 — 2026-09-26: prescriptions, patient portal, WhatsApp notifications

### Delivered
- **Prescriptions** (migration 0011): drug catalogue with restricted list, draft → signed prescriptions tied to the encounter, allergy acknowledgement enforced by the database (audited `ALLERGY_ACKNOWLEDGED`), restricted medicines need `prescription.restricted`, signed prescriptions are immutable, printable A5 sheet (staff and patient).
- **Release gate**: nothing clinical reaches the patient until the treating doctor (or `clinical.release`) releases it. Visit summaries are a separate plain-language text — internal notes, assessment and plan are never exposed.
- **Patient portal** `/ar/portal`, `/en/portal`: passwordless sign-in with a 6-digit WhatsApp code (hashed, 10-minute expiry, 5 attempts, per-phone and per-IP throttling, identical response for unknown numbers); overview, appointments (book from live availability → held as *requested* + lead for Patient Relations; cancel outside the policy window; visit rating), released visits and prescriptions (printable), invoices and receipts, requests/complaints, family sharing and my details (WhatsApp consent).
- **Family / guardian access**: grants with level (appointments only / full file), relation, expiry, evidence; granted by the patient (MRN + phone must match) or by staff (evidence required); revocable; the portal re-checks the grant on every call.
- **Isolation**: patients have no table access at all — only `portal_*` functions, which check the signed-in account and live grants and answer "not found" for anything else.
- **Notifications**: templates (ar/en) + outbox with idempotency keys, retry with exponential backoff, dead-letter after 5 attempts, delivery-status webhooks that never move backwards, opt-out respected (status *skipped*). Appointment confirmation / cancellation / reminder (20–28 h) / "new item in your account". WhatsApp Cloud API adapter + dev adapter (logs only). Dispatcher `POST /api/jobs/dispatch` (Bearer `CRON_SECRET`), webhook `/api/webhooks/whatsapp` (verify token + HMAC signature).
- **Staff screens**: prescriptions and release panels in the encounter; `/os/tickets` (deadlines, satisfaction score, resolve with a note shown to the patient); `/os/messages` (outbox with masked numbers, retry); patient file → portal account status and family access.
- Proper 404 pages for the website and the staff system.

### Verified
- SQL suites 7/7 + concurrency ✅ (new `07_portal_rx_messaging.sql`: allergy gate, restricted drugs, release gate, OTP hashing/lockout, portal isolation between patients, family levels, outbox idempotency and monotonic statuses).
- Unit tests 20/20, typecheck, lint, production build ✅.
- Browser: staff journey 27/27 ✅; portal journey 35/35 ✅ (doctor prescribes → allergy gate → sign → release → patient OTP sign-in → sees summary/Rx/invoice → books and cancels → complaint resolved by Patient Relations → second patient blocked, tampered cookie ignored → sharing appointments-only → English mobile). Dispatcher sent 10 queued messages, second run sent 0 (idempotent); webhook verification checked.

### Not built yet (honest scope)
Online payment in the portal, lab/radiology results, document uploads, SMS fallback, reminder preferences per channel, marketing funnel dashboard, native app. Phase 2 modules (HR, payroll, inventory, laser, settlements) are untouched.

### Next milestone (proposed)
Refunds & credit notes (maker-checker), online payments (Paymob/Fawry adapter, deposits for bookings), user administration + MFA for privileged roles, specialty clinical templates.
