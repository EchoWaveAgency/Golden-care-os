# Permission matrix (seeded defaults)

Deny by default. A user's effective permissions = union of active role grants (`user_roles`), each scoped to a branch (or all branches) and a validity window (used for temporary delegation). Enforced by RLS and RPC checks; the UI only mirrors it.

## Roles → permissions

| Role | العربية | Permissions |
|---|---|---|
| system_admin | مدير النظام | settings.manage, users.manage, staff.read, audit.read — **no clinical content, no posting** |
| owner | الملاك | dashboard.executive, reports.read, reports.finance, audit.read, accounting.read, billing.read, patient.directory, appointment.read, staff.read |
| center_director | مدير المركز | dashboard.executive, reports.*, settings.manage, staff.read, audit.read, billing.read, accounting.read, appointment.read, patient.read, cash.supervise, invoice.void |
| operations_manager | مدير التشغيل | dashboard.executive, reports.read, appointment.read/write, patient.read, staff.read |
| medical_director | المدير الطبي | dashboard.executive, reports.read, patient.read, clinical.read, appointment.read, staff.read |
| quality_manager | مدير الجودة | reports.read, audit.read, patient.read, clinical.read, appointment.read |
| doctor | طبيب | patient.read.assigned, clinical.write.own |
| nurse | تمريض | patient.read, clinical.read, clinical.write, appointment.read |
| medical_assistant | مساعد طبي | patient.read, appointment.read |
| front_desk | الاستقبال والخزينة | patient.read/write, appointment.read/write, billing.read/write, payment.collect, cash.session |
| patient_relations | علاقات المرضى | patient.read/write, appointment.read/write |
| chief_accountant | رئيس الحسابات | accounting.read/post/configure/close, billing.read, patient.directory, invoice.void, cash.supervise, reports.finance |
| accountant | محاسب | accounting.read, billing.read, patient.directory, reports.finance |
| cashier | أمين خزينة | billing.read, payment.collect, cash.session, patient.directory |
| financial_auditor | مراجع مالي | accounting.read, billing.read, audit.read, patient.directory, reports.finance |
| hr_manager | مدير الموارد البشرية | staff.read (HR module in Phase 2) |
| inventory_controller | مراقب المخزون | — (Phase 2) |
| security_auditor | مراجع أمن المعلومات | audit.read |
| device_officer | مسؤول الأجهزة والصيانة | device.read, device.manage, device.maintain |
| marketing | التسويق والمحتوى | content.edit, content.marketing_approve, content.publish, marketing.read, lead.read |

Added in 0010: patient_relations and front_desk get lead.read/lead.write; medical_director gets content.edit and content.medical_approve; center_director gets content.publish, marketing.read, lead.read; operations_manager gets lead.read, marketing.read; owner gets marketing.read. Anonymous visitors: only the public website functions.

Added in 0011: `clinical.release` and `prescription.restricted` → medical_director; `messages.manage` → system_admin, operations_manager; `ticket.read` → patient_relations, front_desk, quality_manager, operations_manager, center_director, medical_director; `ticket.write` → patient_relations, quality_manager. The treating doctor can always sign and release their own prescriptions and visit summaries.

Added in 0013: `refund.request` → front_desk, cashier, patient_relations; `refund.approve` → chief_accountant, center_director (never for their own requests); payout uses `payment.collect`. User administration requires `users.manage`; only holders with an all-branch grant may grant privileged or all-branch roles and activate/deactivate accounts.

Added in 0014: `contract.manage` → chief_accountant, center_director; `settlement.prepare` → accountant, chief_accountant; `settlement.approve` → chief_accountant, center_director; `settlement.pay` → chief_accountant. The database refuses the same person preparing and approving, entering the contract and approving, or approving and paying. Doctors read only their own approved statements. Any account with `mfa_required` (automatic for privileged roles) has no permission at all until the session has passed two-factor sign-in (aal2).

Added in 0015: `inventory.read` → inventory_controller, nurse, medical_assistant, medical_director, chief_accountant, accountant, operations_manager, center_director, financial_auditor; `inventory.manage`, `inventory.receive`, `inventory.count` → inventory_controller; `inventory.issue` → inventory_controller, nurse, medical_assistant, doctor, medical_director; `inventory.controlled` → medical_director; `inventory.approve` → chief_accountant, operations_manager (never for their own count). Catalog changes need an all-branch grant.

**Patients (portal)** have no role and no table grants. A signed-in patient account can call only `portal_*` functions, each of which checks `app.portal_require(patient, level)`: the patient's own file, or a live family grant (`appointments` = appointments and requests; `full` = also released visits, prescriptions and invoices). Anything else answers "not found".

## Attribute rules (ABAC) enforced in the database
- **Doctor sees a patient only while treating them** — an appointment or encounter links them (`app.is_treating_doctor`).
- **Doctor documents only their own encounters**; only the treating doctor can sign; signed encounters are locked.
- **Finance never reads patient records or clinical alerts**; it gets `patient_directory()` (MRN, name, masked phone).
- **Reception sees that an alert exists** (`patient_alert_flags()`), not its content.
- **Branch scope** on every branch-owned row.
- **Separation of duties**: nobody grants themselves a role; the issuer of an invoice cannot void it; users cannot change their own activation/MFA flags.
- **Cash** can only be received inside the cashier's own open session.

## Tested
`supabase/tests/01_identity_rls.sql`, `04_billing_accounting.sql`, `05_encounters.sql`.

Added in 0016: `purchase.read` → inventory_controller, chief_accountant, accountant, operations_manager, center_director; `purchase.request` → inventory_controller; `purchase.approve` → chief_accountant, operations_manager, center_director (never an order they created; confirms receipts without an order, never one they recorded); `supplier.pay.request` → chief_accountant, accountant; `supplier.pay.approve` → chief_accountant, center_director (never a payment they requested). The profitability report uses `reports.finance`.

Added in 0017: `device.read` → device_officer, operations_manager, center_director, medical_director, quality_manager, nurse; `device.maintain` → device_officer, operations_manager; `device.manage` (register, configure, counter reset) → device_officer; `laser.operate` → doctor, nurse, medical_director; `laser.override` (sign despite a contraindication, with a reason) → doctor, medical_director; `package.read` → front_desk, cashier, patient_relations, nurse, doctor, chief_accountant, accountant, center_director, financial_auditor; `package.sell` → front_desk; `package.manage` (catalogue, all-branch grant) → chief_accountant, center_director; `package.expire` → chief_accountant. Laser records are readable by clinical readers of the branch, the operator and the appointment doctor only.

Added in 0018: `plan.write` (prepare plans and quotations, mark work done) → doctor, medical_director — a doctor only for patients under their care and only their own plans; `plan.accept` (acceptance, installments, deposits, billing request) → front_desk, patient_relations; `lab.read` → doctor, medical_director, front_desk, medical_assistant, nurse, operations_manager, chief_accountant, accountant (a doctor sees only their own cases); `lab.manage` → doctor, medical_assistant; `supplier.bill.record` (lab and maintenance bills, void unpaid ones) → chief_accountant, accountant, inventory_controller, device_officer. Bills are confirmed with `purchase.approve` (never by the recorder). Advance refunds reuse the refund permissions: requested with `refund.request`, approved with `refund.approve` by someone else, paid with `payment.collect`.

Added in 0020: `care.read` (conversations, outcomes, escalations of the branch) → patient_relations, medical_director, nurse, quality_manager; `care.manage` (take over, reply, close, resolve escalations) → patient_relations, medical_director; `care.settings` → medical_director, center_director. A doctor sees the conversations and escalations of their own patients (journey doctor) and sets the follow-up date on their own visits. Finance and front desk do not read conversations; the desk works from the tickets the assistant creates. Outcome figures are also open to `dashboard.executive`.

Added in 0021: `hr.read`, `hr.manage`, `attendance.manage`, `attendance.approve`, `leave.approve` → hr_manager (plus center_director / operations_manager read and leave approval); new role `payroll_officer` (privileged) → hr.read, attendance.manage, payroll.read, payroll.prepare; `payroll.settings`, `payroll.approve`, `payroll.pay` → chief_accountant; center_director → payroll.approve, payroll.pay. Payroll is prepared, approved and paid by three different people; nobody approves a run containing their own salary, their own leave, punches or loan. Every employee sees their own file, attendance, leave and approved payslips.

Added in 0022 (no new codes): package refund — request `refund.request` (front_desk, cashier, patient_relations), approve `refund.approve` (chief_accountant, center_director; never your own), pay `payment.collect`; package transfer `package.manage` (chief_accountant, center_director); supplier return — record `inventory.receive` (inventory_controller), approve `purchase.approve` (chief_accountant, operations_manager, center_director; never your own).

Added in 0023 (no new codes): e-receipt queue read `accounting.read`; settings, service tax codes and re-send `accounting.configure` (chief_accountant). The cashier sees an invoice's e-receipt id through `invoice_ereceipt()` (`billing.read`) without access to the queue. Sending is a service-role job (`svc_einvoice_*`).

Added in 0024 (no new codes): doctor contracts — withholding % and basis — `contract.manage`; withholding due and its remittance `settlement.pay` (chief_accountant); cash payout of a settlement needs the payer's own open cashier session.

Added in 0025: `purchase.approve.high` → center_director, owner — second approval for purchase orders and supplier payments above the clinic's thresholds (never their own). Purchasing settings (thresholds, VAT treatment) `accounting.configure`; VAT on a receipt, supplier credits and refunds `supplier.pay.request` / `purchase.approve` as for payments.

Added in 0026 (no new codes): clearing balances `accounting.read`, settlements `accounting.post`, loyalty settings `accounting.configure`; redeem points `payment.collect`; invite codes and referrer `patient.write`; patient loyalty card `patient.read` / `billing.read`.

Added in 0027 (no new codes): portal options per plan and acceptance `plan.accept`; patients accept and pay through `portal_*` functions only; salary increment `hr.manage`; end-of-service prepare `payroll.prepare`, approve `payroll.approve`, pay `payroll.pay` — three different people.

Added in 0028: `files.upload` → front_desk, nurse, doctor, medical_director, patient_relations. Clinical files readable by clinical readers and the treating doctor; administrative documents by `patient.read`; review and release by the treating doctor or `clinical.release`; void by the uploader or medical_director.

Added in 0029 (no new codes): dental chart — record and void findings `clinical.write` / treating doctor (`clinical.write.own`); read with the patient's clinical record.

Added in 0030: `performance.review` → hr_manager, medical_director, center_director, operations_manager (never their own review). Every employee reads and acknowledges their own submitted reviews.

Added in 0031 (no new codes): stock transfers — request `inventory.manage`, dispatch `inventory.manage` (+ `inventory.controlled` for controlled items), receive `inventory.receive` or `inventory.issue` at the destination; device on an appointment `appointment.write`; devices are readable for booking by the desk.

Added in 0033 (no new codes): articles and testimonials follow the content workflow (`content.edit` → `content.medical_approve` → `content.marketing_approve` → `content.publish`; the last editor never medically approves); A/B report and funnel `marketing.read` (also `lead.read`, `reports.finance` for the funnel); marketing can list landing pages read-only; SMS settings `messages.manage`. Patients grant / withdraw testimonial consent with `portal_set_testimonial_consent`.
