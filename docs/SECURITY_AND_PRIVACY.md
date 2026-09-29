# Security & privacy

## Implemented
- **Authorization in the database**: RLS on every public table; `anon` has no table or function access; business writes go through permission-checked RPCs.
- **Least privilege**: finance roles never read clinical data; system admin configures but cannot read clinical content or post journals; doctors see only patients they treat.
- **Separation of duties**: no self-granting roles; invoice issuer cannot void; self-service profile cannot change activation/MFA flags.
- **Immutability**: posted journals, payments, patients (no delete), signed encounters, addenda, consents and audit events cannot be altered through normal operations — guards apply to the database owner as well.
- **Audit trail**: trigger-based, captures actor, action, table, record, changed columns and before/after data; readable only with `audit.read`.
- **Service role key**: never prefixed `NEXT_PUBLIC_`, never sent to the browser. Used only by scripts and these audited server paths, each of which calls narrow `svc_*` functions: patient OTP sign-in, the message dispatcher, the WhatsApp and Paymob webhooks (signature verified first), starting a portal payment (after the patient's own session created the intent), and account creation / sign-in blocking (after the database confirmed `users.manage`).
- **Payments**: a payment is recorded only from the gateway's server-to-server callback with a valid HMAC; the patient's return URL never changes state. The callback is matched on the signed gateway order id. Only completed standalone sales count. Second charges and unknown orders are recorded as exceptions for finance. Staff cannot record "online" payments by hand.
- **Refunds**: maker-checker enforced in the database (the approver can never be the requester), then payout by a cashier with a journal entry.
- **Accounts**: created with a one-time password the user must replace at first sign-in; deactivation removes every permission in the database and blocks sign-in at the Auth level; grants end instead of being deleted; branch administrators cannot grant privileged or all-branch roles.
- **Simulators** (payment simulator, on-screen OTP) only work when the database URL is localhost, whatever the flags say.
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
| Laser session records | laser_sessions, laser_session_areas, laser_session_notes | clinical.read / operator / appointment doctor |
| Package balances | patient_packages, package_redemptions | package.read / laser.operate (branch) |
| Copies of all the above | audit_events | audit.read |

## Two-factor sign-in (session 5)
- TOTP (authenticator app) through Supabase Auth. The database reads the session's assurance level (`aal` claim): an account with `mfa_required` gets no permission, no data and no doctor identity until the session is `aal2`. Required automatically for privileged roles.
- Lost phone: an administrator resets it (audited); the user's sessions end, the factors are removed and a one-time password is handed over in person; the user sets a new password and enrolls again.
- Break-glass (`scripts/break-glass-mfa-reset.mjs`) recovers the last administrator from a trusted terminal with the service key; it requires an operator name and a reason and is audited. Keep at least two all-branch administrators (the users screen warns otherwise).
- Enable TOTP MFA in the Supabase project (Auth → Multi-factor) before go-live.
