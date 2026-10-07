# Deployment runbook

## Environments
| Env | Supabase project | Data | Deploy |
|---|---|---|---|
| Local | `npm run stack:local` | synthetic (`npm run demo:data`) | — |
| Staging | separate project | synthetic only | automatic from `main` after CI |
| Production | separate project | real | manual approval, tagged release |

Never point staging or local at production. Never run `demo-data.mjs` against production (the script refuses when `GC_ENV=production`).

## First-time setup (hosted Supabase)
1. Create the project in the region approved by legal (OPEN_QUESTIONS #17).
2. Auth settings: disable public sign-ups; set site URL; enable TOTP MFA; set password policy and rate limits.
3. Apply schema: `supabase link --project-ref <ref>` then `supabase db push` (applies `supabase/migrations/*`).
4. Apply base configuration: run `supabase/seed.sql` once (organization, branch, starter chart of accounts — after the accountant approves it).
5. Create the first administrator in Auth, insert their `profiles` row and a `system_admin` grant via SQL editor (one-time bootstrap; every later grant is done in the app and audited).
6. Vercel project env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production and Preview use their own projects). The service-role key is not needed by the web app.
7. Enable PITR and schedule an independent encrypted `pg_dump` to off-platform storage.

## Security settings before go-live
- Supabase → Authentication → Multi-factor: enable TOTP (enroll + verify).
- Set `PAYMENTS_MODE=paymob` with the Paymob keys; never set `PAYMENTS_MODE=dev` or `PORTAL_DEV_SHOW_OTP` (they are also ignored unless the database URL is localhost).
- Create at least two all-branch system administrators; each enrolls an authenticator at first sign-in.
- Store the break-glass procedure (`scripts/break-glass-mfa-reset.mjs`) with the owner; it needs the service key and must be run with two people present.

## Care assistant (session 10)
- WhatsApp: subscribe the app webhook to **messages** (not only statuses) at `/api/webhooks/whatsapp`; submit templates `gc_care_booking_confirm`, `gc_care_pre_visit`, `gc_care_post_visit`, `gc_care_followup`, `gc_care_nudge`, `gc_care_oncall_alert` with the wording in `message_templates`.
- Voice (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PUBLIC_BASE_URL` (the public https URL Twilio calls back), `CARE_VOICE_SECRET` (random), optional `TWILIO_VOICE`, `TWILIO_LANGUAGE` (default ar-EG).
- AI understanding (optional, needs approval): `ANTHROPIC_API_KEY` + `CARE_LLM=on`, optional `CARE_LLM_MODEL`.
- `CARE_CRISIS_LINE` (default 16328) once confirmed by the medical director.
- The dispatcher job (`/api/jobs/dispatch`, every 5 minutes) also runs the assistant.
- Never set `CARE_SIMULATOR` in production.

## HR, payroll, e-receipts (sessions 11–12)
- Biometric devices (ZKTeco ADMS push): point each device at `https://<host>/iclock/cdata`, register its serial number in Payroll → Settings → Devices, and optionally restrict by IP. Devices without a registered serial are ignored.
- Payroll does not run until the chief accountant has entered the insurance rates, overtime / lateness rules and tax brackets (OPEN_QUESTIONS 92–98). The demo values from `scripts/demo-hr.mjs` are placeholders — never copy them to production.
- E-receipts stay off until Accounting → E-invoicing settings are filled and switched on. The live Tax Authority connector is not built yet: it needs `ETA_CLIENT_ID` / `ETA_CLIENT_SECRET` (server env only) and certification on the pre-production portal. Until then, leave `EINVOICE_MODE` unset (documents wait in the queue). Never set `EINVOICE_MODE=dev` in production.
- Receipt printers: install the 80 mm printer on the desk PC as a system printer, set paper 80 mm × receipt, margins none, and print from "80mm receipt" on the invoice.

## Release checklist
- [ ] CI green: typecheck, lint, unit, `db:test` (SQL + concurrency), build
- [ ] Migration reviewed; rollback plan written (forward-fix migration preferred; restore-from-PITR for data incidents)
- [ ] Staging deployed and smoke-tested with each role
- [ ] Release notes + migration notes
- [ ] Approval recorded

## Restore rehearsal (quarterly)
1. Restore latest backup into a scratch project.
2. Run `select sum(debit) - sum(credit) from journal_lines;` → must be 0.
3. Sign in as each demo role; confirm access boundaries.
4. Record time-to-restore against the agreed RTO/RPO.
