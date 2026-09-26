# Security & privacy

## Implemented
- **Authorization in the database**: RLS on every public table; `anon` has no table or function access; business writes go through permission-checked RPCs.
- **Least privilege**: finance roles never read clinical data; system admin configures but cannot read clinical content or post journals; doctors see only patients they treat.
- **Separation of duties**: no self-granting roles; invoice issuer cannot void; self-service profile cannot change activation/MFA flags.
- **Immutability**: posted journals, payments, patients (no delete), signed encounters, addenda, consents and audit events cannot be altered through normal operations — guards apply to the database owner as well.
- **Audit trail**: trigger-based, captures actor, action, table, record, changed columns and before/after data; readable only with `audit.read`.
- **Service role key**: server-side scripts only; not used in request handling. Never prefixed `NEXT_PUBLIC_`.
- **Web**: security headers (frame deny, nosniff, referrer policy, permissions policy); fonts self-hosted (no third-party requests); `robots: noindex`.
- **Input handling**: zod validation in server actions; prices resolved server-side; parameterized access through PostgREST; error messages mapped so raw database text is never shown.
- **Idempotency** on payments and bookings.

## Required before production (tracked)
1. **MFA (TOTP) enforced for privileged roles** (roles flagged `is_privileged`) — Supabase Auth MFA + AAL2 check in middleware and RLS for privileged permissions. *Next milestone.*
2. **Data residency & PDPL 151/2020**: confirm Supabase region and whether cross-border transfer of health data needs a permit (OPEN_QUESTIONS #17). Legal review required.
3. **Backups**: enable Supabase PITR; add independent encrypted off-platform logical backups; rehearse restore on staging (runbook).
4. **Session policy for shared reception PCs**: shorter session lifetime, idle sign-out.
5. **Rate limiting** on login (Supabase Auth settings) and on sensitive RPCs.
6. **Storage**: private buckets with short-lived signed URLs for clinical photos/results (Phase 2).
7. **Dependency & secret scanning** in CI.
8. **Penetration test** before go-live.

## Sensitive data inventory (current)
| Data | Table | Access |
|---|---|---|
| Demographics, phone, national ID | patients | patient.read (branch) / treating doctor |
| Allergies, conditions, pregnancy | patient_alerts | clinical.read / treating doctor |
| Clinical notes | encounters, encounter_addenda | clinical.read / treating doctor |
| Consents | patient_consents | patient readers |
| Financial | invoices, payments, journal_* | billing.read / accounting.read |
| Copies of all the above | audit_events | audit.read |
