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

## Dental plans, advances and lab (added session 9)
71. Installment policy: maximum number of installments (system allows 1–36), minimum down payment, late fees (none implemented), and whether work may continue while an installment is overdue.
72. Advance refunds: allowed at any time? Admin fee? Who approves (implemented with the existing refund permissions: `refund.request` requests, `refund.approve` approves — never the requester — and the cashier pays)?
73. Refunding an invoice paid from the advance: return the money to the advance balance, or pay it out (current: paid out by the normal refund flow)?
74. Advances are kept per branch. Should a deposit taken in one branch be usable in another (needs inter-branch entries)?
75. Doctor's share of lab costs: percentage of the lab bill (current), fixed amounts per work type, or none? Is it agreed per doctor contract?
76. Who sees plans and lab cases (implemented: the plan's doctor, clinical readers, front desk for acceptance, finance for billing; lab cases: the case doctor, assistants, nurses, front desk, finance)?
77. Discount authority on treatment plans (current: the doctor may discount any line up to its value).
78. Quotation validity default (current 30 days) and whether expired quotations need re-pricing from the new price list (current: yes, revise and re-issue).
79. Maintenance bills: expense directly (5600, current) or capitalise major repairs?
80. Lab remakes: who pays (clinic, lab, patient)? The system records remakes and any lab bill, but no automatic charge.
81. Should the patient sign the quotation (printed signature or portal acceptance with OTP)?
82. Installment reminders: WhatsApp message timing and wording (template approval needed).

## Patient care assistant (added session 10)
83. Wording of every assistant message (`src/lib/care/scripts.ts`) — sign-off by the medical director and patient relations; then submit the five `gc_care_*` WhatsApp templates (plus `gc_care_oncall_alert`) to Meta.
84. Legal basis / consent for follow-up messages about a visit (Egypt Personal Data Protection Law 151/2020): is the treatment consent enough, or is a specific consent at registration needed? Current: contacted unless the patient refused WhatsApp messages or follow-ups.
85. The AI classifier sends the patient's free-text reply to Anthropic: approve or keep it off (current: off; rules only). If on, a data processing agreement is needed.
86. Voice calls: provider (Twilio or an Egyptian provider), caller ID, budget per minute, and whether to call only patients who prefer calls or also as a fallback. No audio is recorded (transcripts only) — confirm.
87. On-call rota for urgent escalations: which number(s), and who covers nights and Fridays.
88. Contact hours (current 10:00–21:00 Cairo) and timings (confirmation 5 minutes after booking, follow-up 20 hours after the visit, follow-up reminder 2 days before, one nudge after 4 hours).
89. Crisis line in the self-harm message: 16328 (Ministry of Health psychological support, reported 24 hours in April 2026) — the medical director to confirm the number to use.
90. Should the assistant be allowed to cancel (outside the cancellation window), or only pass requests to reception?
91. Which specialties/visits get the after-visit follow-up (current: every signed visit, at most one every 2 days per patient)?

## HR and payroll (added session 11)
92. Social insurance rates (employee / employer), minimum and maximum insurable wage, and whether insurance is pro-rated for partial months (current: full month on the declared insured wage).
93. Income tax: brackets, personal exemption and which allowances are taxable (current: every earning taxable except where switched off).
94. Daily rate divisor (current 30) and hours per day (current 8); overtime multiplier; lateness rule (current: minutes after the shift's grace × minute rate × multiplier, or none if switched off).
95. Leave entitlements per type and years of service; carry-over; sick leave pay rules.
96. Which staff are on payroll (doctors on settlements are excluded by default) and how part-timers are paid.
97. Loan policy: maximum amount and number of installments, who approves.
98. End-of-service and resignation settlements.

## Package refunds, supplier returns, e-receipts (added session 12)
99. Package refund policy: is an unused package refundable at all, within what period, and is there an admin fee (fixed, percentage, none)? Current: refundable while active; fee entered per request, approved by a second person.
100. Value of a session already used when the package was sold at a discount: current refund = sessions left × the package's per-session net price (the discount is shared across all sessions). Confirm, or should used sessions be re-priced at the full single-session price?
101. Package transfer between patients: allowed? only within the family? fee? Current: allowed by the center director / chief accountant with a reason, no fee.
102. Supplier return on a delivery already paid: does the supplier refund cash, or is it credited against the next invoice? Current (session 13): the excess becomes a supplier credit that can be used on another delivery or closed when the supplier's refund is recorded — confirm the clinic's practice with each supplier.
103. E-receipts: the clinic's tax registration number, activity code, branch code and POS serial; whether the clinic issues B2C e-receipts, B2B e-invoices, or both; the ETA item codes (EGS) to register for each service.
104. Tax treatment of each service (medical services exempt vs. taxable cosmetic services, e.g. laser hair removal): to be set by the clinic's tax accountant. Prices are currently treated as final (no VAT added).
105. Live Tax Authority connector: who holds the portal credentials and the signing token (for e-invoices), and when pre-production testing can be scheduled.

## Finance completion (added session 13)
106. Withholding tax on doctor fees: the rate for each doctor (individual vs. company, Form 41 practice) and the filing period. Current: per contract, 0 = none.
107. Doctor share basis: on invoice issue (current default) or only once collected? Per doctor or for all? Current: chosen per contract.
108. Purchasing approval thresholds: amount above which a purchase order / supplier payment needs the second approval, and who holds it (current holders: center director, owner). Current: empty = off.
109. VAT on purchases: recoverable input VAT, or a cost because the clinic's services are exempt (or a mix)? To be set by the tax accountant. Current: must be chosen before VAT can be recorded.
110. Card / gateway settlement: expected fees per provider and the reconciliation cadence (daily / weekly). Current: fees entered from each bank deposit.
111. Loyalty programme: is there one at all? Points per EGP, value of a point, minimum to redeem, expiry, which services earn, and the referral bonus. Current: off, every rate empty.
112. Online installments: maximum number a patient may choose online per plan type, and whether a late installment blocks further work. Current: set per plan by staff (default 1).
113. End-of-service: gratuity formula, tax treatment, notice-period rules and leave encashment basis. Current: leave encashment (daily rate × balance) and outstanding loans calculated; the rest entered by HR.
114. Annual increment: one percentage for all, or per grade / performance? Current: entered per run (all active employees or one).

## Clinical and operations completion (added sessions 14–15)
115. Which results must the doctor review before the patient sees them (all, or abnormal only)? Current: every result is reviewed and released explicitly.
116. Clinical photos: may they ever be shown to the patient in the portal, or used (with consent) for marketing? Current: photos can be released to the patient by the doctor; never public.
117. File retention: how long are results, photos and ID copies kept after the last visit (MoH and data-protection rules)? Current: kept; void hides but does not delete.
118. Performance reviews: criteria, weights, frequency (annual / semi-annual) and whether results affect increments. Current: none created; HR defines them.
119. Stock transfers between branches: who approves, and is a shortage on receipt charged to anyone? Current: requested and dispatched by inventory, received by the destination, shortage written off with a note.

## Website and marketing completion (added session 16)
120. Testimonial consent wording (Arabic and English) to be approved by the medical director and legal; whether written consent is also required at the desk. Current: the patient grants or withdraws it from the portal profile; staff can record it.
121. A/B testing cookie: confirm the privacy notice mentions the anonymous visitor id used only to keep the same page version (90 days).
122. SMS: provider (Twilio or an Egyptian provider), sender id, budget, and whether to enable fallback when WhatsApp fails. Current: off; only patients who chose SMS get SMS.
123. Medical articles: who may author (doctors only, or marketing with a doctor named as author), and whether sources are mandatory.
