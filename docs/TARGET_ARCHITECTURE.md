# Target architecture

## Shape
A **modular monolith**: one Next.js 14 application and one Supabase Postgres database, with clear module boundaries enforced in the schema (tables, RPCs, RLS policies per domain). Microservices are not justified at one branch; boundaries below are where a split could happen later if load or team size require it.

```
Browser (Arabic RTL / English LTR, PWA-ready)
   │  HTTPS, Supabase session cookie
Next.js 14 — Server Components + Server Actions (user session, never service key)
   │  PostgREST / RPC as the signed-in user
Supabase Postgres 16
   ├─ RLS on every table (app.has_permission(code, branch))
   ├─ SECURITY DEFINER RPCs for multi-table business operations
   ├─ Triggers: audit (append-only), immutability guards, normalization, totals
   └─ Deferred constraint: every journal entry balances at commit
Supabase Auth (email+password; MFA for privileged roles — next milestone)
Supabase Storage (private buckets, signed URLs — clinical photos/results, next milestones)
Background jobs: pg_cron / pgmq or Edge Functions for reminders, webhooks, retries (Phase 3)
```

## Modules (bounded contexts)
| Module | Tables / RPCs | Status |
|---|---|---|
| Identity & access | profiles, staff, roles, permissions, role_permissions, user_roles, `my_permissions()` | ✅ |
| Audit | audit_events, `app.audit_row()` | ✅ |
| Patient | patients, families, patient_alerts, patient_consents, `find_patient_duplicates()`, `patient_directory()` | ✅ |
| Scheduling & reception | doctor_schedules, schedule_exceptions, appointment_types, appointments, appointment_status_history, `transition_appointment()` | ✅ core |
| Clinical | encounters, encounter_addenda, `sign_encounter()` | ✅ foundation |
| Billing | services, price_lists, price_list_items, invoices, invoice_lines, payments, payment_methods, cashier_sessions, `issue_invoice()`, `record_payment()`, `void_invoice()` | ✅ core |
| Accounting | accounts, cost_centers, fiscal_periods, account_settings, journal_entries, journal_lines, `app.post_journal()`, `trial_balance()` | ✅ core |
| Doctor settlements | — (invoice lines and revenue journal lines already carry `doctor_id`) | Phase 2 |
| HR, attendance, payroll, KPI | — | Phase 2 |
| Inventory, procurement, assets, laser | — | Phase 2 |
| CRM, WhatsApp, portal, payments gateway, labs | — | Phase 3 |
| AI (human-approved drafts only) | — | Phase 4 |

## Key decisions
1. **Enforcement in the database.** RLS + definer RPCs mean a bug in a screen cannot leak or corrupt data; the API is safe to expose to a future mobile app or portal.
2. **Accounting by events.** Operational RPCs post journals through one primitive with semantic account keys (`account_settings`), so Finance re-maps accounts without code changes.
3. **Immutability.** Posted journals, payments, signed encounters, consents and audit are insert-only; guards apply even to the database owner.
4. **Idempotency.** Payments and bookings accept an idempotency key; retries after network failure return the original result.
5. **Egypt context.** EGP, Africa/Cairo (DST-safe conversion), Arabic name normalization, E.164 phones, InstaPay as reference-based payment.

## Scaling notes
Indexes exist for branch/day schedules, patient search (trigram), and ledger lookups. At multi-branch scale, add read replicas for reporting and move reporting queries to materialized views refreshed by cron.
