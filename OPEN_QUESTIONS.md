# Open questions — decisions Golden Care must make

Each item has a configurable mechanism already (or planned). Placeholders are clearly labelled until answered.

## Finance (Chief Accountant)
1. **Chart of accounts** — approve or replace the starter chart in `supabase/seed.sql`; confirm account codes for revenue by specialty.
2. **Discount accounting** — currently posted gross revenue with a contra "Discounts allowed" (4900). Confirm, or post net.
3. **Cash over/short** — differences are recorded on the cashier session but not yet journalized. Confirm the account and who approves.
4. **Card terminal & InstaPay** — confirm clearing accounts and the settlement reconciliation cadence (daily/weekly).
5. **Tax / e-receipt** — confirm with the accountant whether and how ETA e-invoice / e-receipt obligations apply to Golden Care's services. Adapter is not built yet and nothing is hard-coded.
6. **Discount approval limits** — per role maximum discount (amount or %), and who approves above it.
7. **Refund policy** — who may approve, time limits, and whether refunds go to cash, card reversal, or wallet.
8. **Fiscal year** — calendar year assumed.

## Clinical (Medical Director)
9. Which specialty templates are first (dermatology/laser and dentistry recommended), and their required fields.
10. Controlled/restricted medicine list and who may prescribe/print.
11. Which clinical content is released to the patient portal, and after whose approval.
12. Should nurses see all clinical records in the branch (current default) or only assigned patients?

## Operations
13. Working hours per weekday, Friday policy, Ramadan hours, public holiday calendar.
14. Default appointment durations per service; overbooking policy (currently: none allowed).
15. Cancellation / no-show policy and reminder timing.
16. Is a receptionist allowed to also be cashier on the same shift (current default: yes, `front_desk` role)?

## Privacy & legal (external counsel)
17. Data residency: which Supabase region hosts patient data, and whether PDPL 151/2020 cross-border rules require a permit for sensitive health data. **Do not go live with real patient data before this is answered.**
18. Retention periods for medical, financial and audit records.
19. Consent document texts (treatment, clinical photography, WhatsApp messages) and versions.

## Brand
20. Patient-facing tagline: "A place where beauty meets wellness" (logo) vs "نرعاك لحياة أفضل" (service promise). Both are stored on the organization and editable.

## Website (added session 2)
21. Official mobile and WhatsApp numbers, Google Maps link and working hours (set in `/os/settings?tab=site`; nothing is shown until set).
22. Legal review of privacy, terms, appointment and communication-consent texts (`src/lib/site/legal.ts`) before launch.
23. Real specialty page content, doctor biographies and photos — approved by the Medical Director (demo content must be replaced).
24. Response-time SLA for new inquiries (default 30 minutes) and working-hours rules for it.
25. Production domain (`NEXT_PUBLIC_SITE_URL`) and analytics/pixel IDs.
26. Whether website booking requests should hold the slot until confirmed (website: they do not; portal bookings by signed-in patients do hold it as "requested").

## Portal, prescriptions and messaging (added session 3)
27. WhatsApp Business account: provider (Meta Cloud API direct or a BSP), sender number, and Meta approval of the 5 templates in `message_templates` (names `gc_*`). Until approved, messages cannot be delivered in production.
28. SMS fallback provider for patients without WhatsApp (and for sign-in codes).
29. Drug formulary: the real list the clinic prescribes from, and which items are restricted (demo list is illustrative only).
30. Who besides the treating doctor may release results (default: `clinical.release` → Medical Director).
31. Online cancellation window (default 24 h, `policy.cancel_hours`) and whether portal bookings need a deposit.
32. Family access policy: minimum age for a child's own account, default duration of guardian access, accepted evidence documents.
33. Complaint response targets (default: complaints 24 h, other requests 4 h) and escalation owner.
34. Reminder timing (default one reminder 20–28 h before) and quiet hours.

## Refunds, payments, users (added session 4)
35. Refund policy: who may request, approval limits (e.g. above an amount needs the Center Director), time limits, and whether refunds reduce the doctor's share. The system enforces request → approval by another person → payout; the rules on top are the clinic's to set.
36. Payment gateway: Paymob account (secret/public keys, integration id, HMAC secret) or another provider (Fawry, Kashier). The Paymob adapter follows the published Intention API and callback HMAC and must be tested end-to-end in the Paymob sandbox before going live.
37. Who resolves "captured but unmatched" online payments and within what time (default: chief accountant, next working day).
38. Gateway fees and settlement: how often Paymob settles to the bank and which account records fees (planned entry: Dr bank + bank charges / Cr gateway clearing).
39. Multi-factor sign-in for privileged roles (the `mfa_required` flag exists; enforcement is the next security item).

## Doctor settlements and sign-in security (added session 5)
40. Each doctor's contract terms (share %, fixed fees per service, effective dates) — to be entered from the signed contracts.
41. Settlement basis: invoiced (implemented) or collected cash; month cut-off; payment day.
42. Withholding tax on doctors' professional fees and how it is shown on the statement (not implemented — needs the accountant's rule).
43. Whether discounts reduce the doctor's base (implemented: line discounts do) and whether refunds are shared (implemented: proportional deduction).
44. Payout method (implemented: bank transfer with reference; cash payouts not enabled).
45. Negative statements (implemented: carried to the next statement) — or recovered another way?
46. Which roles besides the privileged ones should require two-factor sign-in (e.g. cashiers, doctors).
47. Who may run the break-glass procedure and where the record is kept.

## Inventory (added session 6)
48. The real item list, units, reorder levels and which items are controlled.
49. Who may issue controlled items (implemented: the medical director only) and whether a second signature is required.
50. Standard consumables per service (the templates), to be confirmed by the medical director.
51. Count frequency (monthly? weekly for controlled items?) and who approves differences (implemented: chief accountant or operations manager).
52. Purchasing: are purchase orders and approvals needed before receiving, and how are suppliers paid (terms, cheques/transfers)?
53. Whether consumable cost is added to the patient invoice for any service, or only tracked as cost.

## Purchasing (added session 7)
54. Is a purchase order required for every purchase, or are direct receipts (confirmed afterwards) acceptable for small amounts? Above what amount?
55. Approval thresholds: does a large order need the center director (or two approvals) instead of the operations manager?
56. Supplier payment terms (30/60 days?), preferred method (transfer/cheque), and who signs cheques.
57. Accepted risk (current design): the store keeper who created an order may also receive it; control relies on the approver of the order and the stock count. Should receiving require a second person?
58. VAT on supplier invoices: are purchases recorded gross (current) or should input VAT be separated?
59. Doctor share in the profitability report is an estimate from the contracts; confirm whether the report should show only approved settlements instead.

## Devices, laser and packages (added session 8)
60. The real device list (asset numbers, serials, agents, warranty) and the approved settings per device — to be signed off by the medical director.
61. The final pre-treatment contraindication checklist and which items block treatment (defaults are loaded; medical director to confirm).
62. Who may operate the laser (implemented: doctors, nurses, medical director) and who may override a contraindication (doctors, medical director).
63. Counter resets after a part change: should a second person approve them?
64. Maintenance costs: record them against the agent in suppliers payable, or keep them as memo only (current)?
65. Package refunds and transfers: policy (unused value, admin fee, who approves). Currently a paid package cannot be refunded in the system.
66. May sessions start before the package is fully paid (current: no)?
67. Discount authority for packages (who may give what percentage).
68. Expired packages: recognise the unused balance as revenue (current, account 4130), extend, or refund?
69. A package used in another branch: current posting releases the deferred balance in the branch where the session happens; confirm, or post an inter-branch entry.
70. Doctor fee on package sessions: current base is the net value per session and the contract rate for the service; confirm.
