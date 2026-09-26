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
