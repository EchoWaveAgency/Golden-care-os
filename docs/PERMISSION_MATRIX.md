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
| marketing | التسويق والمحتوى | content.edit, content.marketing_approve, content.publish, marketing.read, lead.read |

Added in 0010: patient_relations and front_desk get lead.read/lead.write; medical_director gets content.edit and content.medical_approve; center_director gets content.publish, marketing.read, lead.read; operations_manager gets lead.read, marketing.read; owner gets marketing.read. Anonymous visitors: only the public website functions.

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
