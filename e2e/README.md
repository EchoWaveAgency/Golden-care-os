# Browser journeys

End-to-end journeys against the local stack (`npm run stack:local && npm run demo:data`, then `npm run build && npx next start -p 3100`).
They use synthetic demo data only and must run on a freshly seeded stack (they register fixed synthetic patients).

```bash
npm i --no-save puppeteer-core @sparticuz/chromium
node e2e/staff-journey.mjs    # 27 checks: reception → doctor → billing → cashier → accounting → executive
node e2e/portal-journey.mjs   # 35 checks: prescription + allergy gate → release → patient portal → isolation → sharing
node e2e/m4-journey.mjs       # 25 checks: users & roles → refunds maker-checker → online payment
```
Screenshots are written to `E2E_OUT` (default `/tmp/`). Reseed between journeys. Planned: migrate to Playwright in CI.
