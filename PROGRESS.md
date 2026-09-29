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

## Session 4 — 2026-09-26: refunds, online payments, user administration

### Delivered
- **Refunds with maker-checker** (migration 0013): request (reason, amount within what was paid minus refunds and pending requests) → approval by a *different* person with `refund.approve` → payout by a cashier. Cash payouts need an open session and are subtracted from expected cash at closing. Journal: Dr Patient refunds (4910) / Cr the method's account. Invoice shows the refunded amount. Screens: refund card on the invoice, `/os/refunds` queue.
- **Online payment from the patient account**: "Pay now" on any invoice with a balance → payment intent (patient's own file or a full-access family grant) → gateway checkout → the invoice is marked paid only by the gateway's signed server callback (Dr gateway clearing 1150 / Cr A/R). Paymob adapter (Intention API + HMAC-verified callback) and a local simulator. Declines, duplicate callbacks, second charges, unknown orders, amount mismatches and "paid at the desk meanwhile" are all handled without double posting; unmatched captures are listed for finance.
- **Users & roles** `/os/users`: create accounts (one-time password shown once, forced change at first sign-in), grant roles per branch with optional end date (temporary delegation), end grants and deactivate accounts with a reason (nothing deleted, all audited; deactivated accounts are also blocked from signing in). Branch administrators cannot grant privileged or all-branch roles.
- Cash-session row locks added to payment and refund posting; staff can no longer record "online" payments by hand.

### Independent review
A separate reviewer audited the money and access paths before release and found 10 issues (double charge on a reused intent, capture lost if the intent expired mid-checkout, callback matched on an unsigned field, voids/refunds treated as sales, user-clearable password flag, cash-session race, unscoped branch admins, silent ban failure, half-created accounts, simulator usable outside local). All 10 are fixed and covered by tests.

### Verified
- SQL suites 8/8 + concurrency (incl. 10 parallel gateway callbacks → 1 payment) ✅; unit tests 24/24; typecheck, lint, build ✅.
- Browser: staff 27/27, portal 35/35, milestone-4 journey 25/25 ✅.

### Not built yet (honest scope)
Live Paymob sandbox test (needs the clinic's account), gateway settlement/fees entry, patient deposits/advances, credit notes that reduce revenue per doctor, MFA enforcement, HR/payroll, inventory, laser, doctor settlements.

### Next milestone (proposed)
Doctor settlements (per-doctor revenue share from invoice lines, net of refunds and discounts, monthly statement + payable), MFA for privileged roles, patient deposits for bookings.

## Session 5 — 2026-09-26: doctor settlements, two-factor sign-in

### Delivered
- **Doctor contracts** (migration 0014): effective-dated, one per doctor per day; default share of the net service value plus per-service terms (percent or fixed amount per unit). Changing terms = a new contract from a later date (the old one ends automatically); contracts used in an approved statement can never change retroactively. Screen: `/os/settlements/contracts/[doctor]`.
- **Monthly statements** `/os/settlements`: computed from issued invoice lines net of line discounts, with catch-up (nothing issued before the period end is ever skipped), proportional deductions for refunds, reversal of invoices voided after settlement, and negative balances carried into the next statement. Lines are a frozen snapshot with invoice numbers. Lines without a contract block approval.
- **Maker-checker ×3**: preparer ≠ approver, the person who entered the contract ≠ approver, approver ≠ payer. Approval posts Dr Doctor fees (5100) / Cr Doctor fees payable (2300); payment by bank transfer posts Dr 2300 / Cr bank. Drafts become "stale" when the contract changes.
- **Doctors** see their own approved statements and current contract in `/os/my-settlements` (never drafts, never other doctors).
- **Two-factor sign-in (TOTP)** enforced by the database: an account that requires it gets no permission, no data and no doctor identity from a password-only session. Required automatically for privileged roles (including existing ones); administrators can require it for anyone. Screens: enrollment with QR code / manual key and the sign-in code step at `/os/mfa`; admin reset for a lost phone (ends sessions, one-time password handed over in person, new enrollment). Break-glass script for the last administrator, audited.
- Hardening: grants can only be ended, never rewritten; activation / MFA / password flags change only through audited admin functions; the local demo seeding uses temporary factors and removes them.

### Independent review
A separate reviewer audited settlements and MFA and reported 11 issues (MFA not applied to existing privileged users, flags writable by table update, doctor-identity paths bypassing MFA, lines lost when a current month was settled early, negative balances never recovered, reset allowing anyone with the password to enroll, possible lock-out of the only administrator, SoD gaps across contract/approve/pay, stale drafts, service-function scope, demo seeding left-overs). All 11 are fixed and covered by tests.

### Verified
- SQL suites 9/9 + concurrency ✅; unit 24/24; typecheck, lint, build ✅.
- Browser (all with two-factor sign-in for privileged demo users): staff 27/27, portal 35/35, milestone-4 25/25, milestone-5 20/20 ✅.

### Not built yet (honest scope)
Withholding tax on doctor fees, collected-basis settlements, cash payouts to doctors, patient deposits, HR/payroll, inventory, laser device logs.

### Next milestone (proposed)
Inventory & consumables (stock per branch, receipts, issue to procedures, expiry/lot tracking) or HR/payroll — to be chosen by the clinic.

## Session 6 — 2026-09-29: inventory & consumables

### Delivered
- **Catalog** (migration 0015): items (category, unit, reorder level, controlled flag), stores per branch, suppliers, and consumables templates per service. The catalog is shared by all branches, so only an all-branch inventory manager can change it. Changing an item's category or controlled status needs the controlled-items authority (medical director).
- **Goods receipts** `/os/inventory/receive`: every line becomes a lot with lot number, expiry and unit cost. Expiry is mandatory for medicines, cosmetics and dental materials; expired goods are refused; the same supplier invoice cannot be received twice; retries are idempotent. Journal: Dr Inventory (1300) / Cr Suppliers payable (2100).
- **Issue to sessions** `/os/inventory/issue`: pick one of today's appointments (prefilled from the service templates) or give a purpose. Stock is taken first-expiry-first-out; expired lots are never issued; stock never goes negative (including under concurrency); controlled items need their authority. Cost is charged to the patient's session: Dr Consumables (5300) / Cr Inventory. There is a link from the encounter screen.
- **Stock counts** `/os/inventory/counts`: the store is frozen while a count is open. The counter enters quantities without seeing the system figures, differences are shown after submission, and they post only after approval by a different person. Losses and gains are posted separately (5310 ↔ 1300).
- **Overview** `/os/inventory`: stock value, usable vs expired quantities, next expiry, below-reorder and 60-day expiry alerts, and the latest movements.
- Book value is tracked per lot, so the inventory account always equals the value of stock on hand, with no rounding leaks.

### Independent review
A separate reviewer found 8 issues: a count with both gains and losses could not be posted; a branch store keeper could change shared items (including the controlled flag); nobody could issue controlled items; issues during an open count were double-counted; rounding leaked cents; idempotency keys were not tied to their owner; possible deadlocks; a submitted count could be cancelled by anyone. All are fixed and tested. Remaining limitation: users who also have stock visibility can see system quantities while counting.

### Verified
- SQL suites 10/10 plus concurrency (10 parallel issues from a lot of 5 → exactly 5), unit tests 24/24, typecheck, lint and build ✅.
- Browser journeys: inventory 17/17, settlements & MFA 20/20, staff 27/27, portal 35/35, milestone 4 25/25 ✅.

### Not built yet (honest scope)
Purchase orders and approval before buying, supplier payments and statements, transfers between branches, returns to supplier, laser device maintenance log and shot counters, and consumption reports per service/doctor (the data is recorded; the report screens are not built).

### Next milestone (proposed)
Either HR & payroll (attendance/biometric import, salaries, leave, KPIs), or purchasing & supplier payments plus the consumption and margin reports.

## Session 7 — 2026-09-29: purchasing, supplier payments, profitability report

### Delivered
- **Purchase orders** (migration 0016) `/os/purchasing`: the store keeper creates an order (items, quantities, agreed unit cost > 0), submits it, and a different person approves it (operations manager, chief accountant or center director). Receiving against the order takes items and prices from the order and refuses more than the remainder; partial receipts are tracked. An order that will not be completed can be **closed short** with a reason (lines are kept; the undelivered quantity is recorded). Orders with nothing received can be cancelled.
- **Supplier statements and payments** `/os/suppliers`: every supplier invoice with total, paid, pending and outstanding, plus aging buckets (0–30 / 31–60 / 61–90 / 90+). The accountant requests a payment (bank transfer or cheque) across one or more invoices; a different person releases it, which posts Dr Suppliers payable (2100) / Cr Bank (1110). A receipt recorded **without** a purchase order must first be confirmed by an approver who did not record it; receipts against an approved order are confirmed by the order's approval.
- **Profitability report** `/os/reports/profitability`: per service and doctor for a period — units, gross, discounts, refunds, net revenue, estimated doctor share (from the contracts), consumables cost (from stock issued to the appointment, split across all invoices of that appointment) and margin; CSV export (Excel-friendly, formula-safe).

### Independent review
A separate reviewer audited the milestone and reported 9 issues: receipts without an order could be paid with no second person involved; zero-cost order lines; partly received orders could never be finished; lock-order deadlock risk in supplier payments; the report counted refunds paid after the period (past reports changed); consumables were counted twice when an appointment had more than one invoice; refunds above an invoice's total could push revenue negative; permission evaluated per row in the report; CSV formula injection. All 9 are fixed and tested. Found while testing: a generic "separation of duties" message was shown for every maker-checker refusal (now each has its own wording), and closing an order short originally deleted lines (now kept).

### Verified
- SQL suites 11/11 plus concurrency ✅; unit 27/27; typecheck, lint, build ✅.
- Browser journeys on fresh data: purchasing 18/18, inventory 17/17, settlements & MFA 20/20, staff 27/27, portal 35/35, milestone 4 25/25 ✅.

### Not built yet (honest scope)
Returns to supplier, transfers between branches, approval thresholds by amount, supplier credit notes, VAT on purchases, HR/payroll, laser device logs, patient deposits.

### Next milestone (proposed)
HR & payroll (needs the clinic's insurance, tax and labor rules first — see OPEN_QUESTIONS 54+), or laser device logs and shot counters.
