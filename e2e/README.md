# Browser journeys

End-to-end journeys against the local stack (`npm run stack:local && npm run demo:data`, then `npm run build && npx next start -p 3100`).
They use synthetic demo data only and must run on a freshly seeded stack (they register fixed synthetic patients).

```bash
npm i --no-save puppeteer-core @sparticuz/chromium   # (or symlink an existing node_modules into e2e/)
node e2e/staff-journey.mjs    # 27 checks: reception → doctor → billing → cashier → accounting → executive
node e2e/portal-journey.mjs   # 35 checks: prescription + allergy gate → release → patient portal → isolation → sharing
node e2e/m4-journey.mjs       # 25 checks: users & roles → refunds maker-checker → online payment
node e2e/m6-journey.mjs       # 17 checks: stock overview → receipt → FEFO issue → blind count → approval
node e2e/m5-journey.mjs       # 20 checks: two-factor sign-in → contract → statement → approve → pay → doctor view → lost-phone reset
node e2e/m8-journey.mjs       # 25 checks: devices & repair → package sale → check-in → laser session (pulse reconciliation) → consumables → settlement → report
node e2e/m10-journey.mjs      # 25 checks: care assistant (simulator): settings → booking confirmation → follow-up date → after-visit follow-up → doctor alert → danger sign → staff takeover → outcome figures
node e2e/m9-journey.mjs       # 26 checks: dental plan from the visit → quotation → installments → advance → work billed from the advance → lab case and bill (void a wrong one) → settlement with lab share → profitability
node e2e/m7-journey.mjs       # 18 checks: purchase order → approval → partial receipt → close short → confirm direct receipt → supplier payment → profitability + CSV
node e2e/m11-journey.mjs      # 18 checks: employees → attendance import → leave → own file → payroll prepare / approve / pay → payslip
node e2e/m12-journey.mjs      # 21 checks: e-receipts on → package sale → 80mm receipt → package refund + transfer → supplier return → e-receipt queue (blocked → codes → accepted) → day sheet
```
Privileged demo users complete two-factor sign-in automatically through `e2e/mfa.mjs` (TOTP computed from the enrolled secret).
```
```
Screenshots are written to `E2E_OUT` (default `/tmp/`). Reseed between journeys. Planned: migrate to Playwright in CI.
