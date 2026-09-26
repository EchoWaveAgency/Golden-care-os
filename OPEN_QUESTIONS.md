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
