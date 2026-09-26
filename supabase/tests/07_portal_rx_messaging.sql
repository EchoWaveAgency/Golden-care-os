-- 07 — Prescriptions, release gate, patient portal isolation, family access, OTP, tickets, messaging
\set fd      '00000000-0000-4000-8000-000000001002'
\set dr_u    '00000000-0000-4000-8000-000000001004'
\set dr2_u   '00000000-0000-4000-8000-000000001005'
\set dr      '00000000-0000-4000-8000-000000002004'
\set b1      '00000000-0000-4000-8000-000000000101'
\set pu1     '00000000-0000-4000-8000-000000009001'
\set pu2     '00000000-0000-4000-8000-000000009002'
\set admin   '00000000-0000-4000-8000-000000001001'

-- Setup: two unrelated patients with portal accounts, a doctor schedule and a public profile.
insert into public.patients (id, branch_id, first_name_ar, last_name_ar, phone_raw)
values ('00000000-0000-4000-8000-000000008001', :'b1', 'سارة', 'نبيل', '01550000001'),
       ('00000000-0000-4000-8000-000000008002', :'b1', 'خالد', 'نبيل', '01550000002'),
       ('00000000-0000-4000-8000-000000008003', :'b1', 'ليلى', 'خالد', '01550000002');   -- child sharing father's phone
\set p1 '00000000-0000-4000-8000-000000008001'
\set p2 '00000000-0000-4000-8000-000000008002'
\set child '00000000-0000-4000-8000-000000008003'
insert into auth.users (id, email) values (:'pu1', 'p1@portal.local'), (:'pu2', 'p2@portal.local');
select app.portal_link_account(:'pu1', :'p1');
select app.portal_link_account(:'pu2', :'p2');
insert into public.drugs (id, trade_name, generic_name, strength, form, is_restricted) values
  ('00000000-0000-4000-8000-00000000d001', 'Fucidin', 'fusidic acid', '2%', 'cream', false),
  ('00000000-0000-4000-8000-00000000d002', 'Tramadol', 'tramadol', '50mg', 'capsule', true);

-- Doctor documents a visit with an allergy on file, prescribes, signs.
select id as derm from public.specialties where code = 'derm' \gset
insert into public.appointments (id, branch_id, patient_id, doctor_id, specialty_id, slot, status)
values ('00000000-0000-4000-8000-00000000a001', :'b1', :'p1', :'dr', :'derm', tstzrange(now() - interval '2 hours', now() - interval '90 minutes'), 'booked');
\set apt '00000000-0000-4000-8000-00000000a001'
set role authenticated;
select test.login(:'dr_u');
insert into public.encounters (branch_id, patient_id, doctor_id, appointment_id, specialty_id, chief_complaint, assessment)
values (:'b1', :'p1', :'dr', :'apt', :'derm', 'حبوب', 'INTERNAL: suspected rosacea, rule out steroid misuse') returning id as enc \gset
insert into public.patient_alerts (patient_id, kind, severity, label) values (:'p1', 'allergy', 'high', 'Penicillin');
insert into public.prescriptions (encounter_id, branch_id, patient_id, doctor_id, notes_for_patient)
values (:'enc', :'b1', :'p1', :'dr', 'استخدم الكريم مرتين يوميًا') returning id as rx \gset
select test.expect_error(format($q$select public.sign_prescription(%L)$q$, :'rx'), 'no items');
insert into public.prescription_items (prescription_id, drug_id, dose, frequency, duration) values (:'rx', '00000000-0000-4000-8000-00000000d001', 'طبقة رقيقة', 'مرتين يوميًا', '7 أيام');
select test.assert((select drug_name from public.prescription_items where prescription_id = :'rx') = 'Fucidin', 'catalogue name applied');
-- Restricted medicine needs authorization.
insert into public.prescription_items (prescription_id, drug_id, dose, frequency) values (:'rx', '00000000-0000-4000-8000-00000000d002', '1', 'عند اللزوم') returning id as restricted_item \gset
select test.expect_error(format($q$select public.sign_prescription(%L, true)$q$, :'rx'), 'restricted medicine');
delete from public.prescription_items where id = :'restricted_item';
-- Allergy acknowledgement is mandatory and audited.
select test.expect_error(format($q$select public.sign_prescription(%L)$q$, :'rx'), 'allergy acknowledgement required');
select test.assert((select allergy_ack from public.sign_prescription(:'rx', true)), 'signed with allergy acknowledgement');
select test.expect_error(format($q$insert into public.prescription_items (prescription_id, drug_name, dose, frequency) values (%L, 'X', '1', '1')$q$, :'rx'), 'cannot be changed');
select test.expect_error(format($q$update public.prescriptions set notes_for_patient = 'x' where id = %L$q$, :'rx'), 'cannot be changed');
-- Another doctor cannot sign or release it.
select test.login(:'dr2_u');
select test.expect_error(format($q$select public.release_to_patient('prescription', %L)$q$, :'rx'), 'permission denied');

-- Nothing is visible in the portal before release.
select test.login(:'pu1');
select test.assert(jsonb_array_length(public.portal_medical(:'p1')->'visits') = 0, 'unreleased visit hidden');
select test.assert(jsonb_array_length(public.portal_medical(:'p1')->'prescriptions') = 0, 'unreleased prescription hidden');

-- Release: encounter must be signed and needs a patient-facing summary.
select test.login(:'dr_u');
select test.expect_error(format($q$select public.release_to_patient('encounter', %L, 'ملخص')$q$, :'enc'), 'only signed');
select public.sign_encounter(:'enc');
select test.expect_error(format($q$select public.release_to_patient('encounter', %L, '')$q$, :'enc'), 'summary is required');
select public.release_to_patient('encounter', :'enc', 'التهاب بسيط بالجلد. العلاج موضعي.', 'تجنب الشمس المباشرة.');
select public.release_to_patient('prescription', :'rx');
select test.expect_error(format($q$select public.release_to_patient('prescription', %L)$q$, :'rx'), 'already released');
-- Release did not unlock the signed clinical content.
select test.expect_error(format($q$update public.encounters set assessment = 'changed' where id = %L$q$, :'enc'), 'signed encounter cannot be modified');

-- Patient sees released content only — never internal assessment.
select test.login(:'pu1');
select test.assert((public.portal_medical(:'p1')->'visits'->0->>'summary') = 'التهاب بسيط بالجلد. العلاج موضعي.', 'released summary visible');
select test.assert(position('INTERNAL' in public.portal_medical(:'p1')::text) = 0, 'internal assessment never exposed');
select test.assert((public.portal_medical(:'p1')->'prescriptions'->0->'items'->0->>'drug') = 'Fucidin', 'released prescription with items');
select test.assert((public.portal_medical(:'p1')->'allergies'->>0) = 'Penicillin', 'patient sees own allergies');
-- Patients have no table access at all.
select test.assert((select count(*) from public.patients) = 0, 'portal user cannot read patients table');
select test.assert((select count(*) from public.encounters) = 0, 'portal user cannot read encounters table');
select test.assert((select count(*) from public.prescriptions) = 0, 'portal user cannot read prescriptions table');
select test.assert((select count(*) from public.invoices) = 0, 'portal user cannot read invoices table');
select test.assert(not app.is_active_staff(), 'portal user is not staff');
select test.assert((select count(*) from public.find_patient_duplicates('01550000002')) = 0, 'staff search returns nothing to a patient');

-- Another patient cannot read this file; error does not reveal existence.
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_medical(%L)$q$, :'p1'), 'not found');
select test.expect_error(format($q$select public.portal_appointments(%L)$q$, :'p1'), 'not found');
select test.expect_error(format($q$select public.portal_finance(%L)$q$, :'p1'), 'not found');
-- Father cannot see his child's file just because they share a phone.
select test.expect_error(format($q$select public.portal_appointments(%L)$q$, :'child'), 'not found');

-- Staff grants guardian access with evidence; level controls what is visible.
reset role;
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.staff_grant_family(%L, %L, 'appointments', 'parent', null, '')$q$, :'child', :'p2'), 'evidence');
select public.staff_grant_family(:'child', :'p2', 'appointments', 'parent', now() + interval '1 year', 'Birth certificate seen at reception') as g1 \gset
select test.login(:'pu2');
select test.assert(jsonb_typeof(public.portal_appointments(:'child')) = 'array', 'guardian sees child appointments');
select test.expect_error(format($q$select public.portal_medical(%L)$q$, :'child'), 'not found');
select test.assert((public.portal_me()->'family'->0->>'relation') = 'parent', 'family listed in portal profile');
select test.login(:'fd');
select public.staff_revoke_family(:'g1');
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_appointments(%L)$q$, :'child'), 'not found');

-- Patient-initiated sharing needs both MRN and phone; revocable by the owner only.
select test.login(:'pu1');
select test.expect_error($q$select public.portal_share_access('P-999999', '01550000002', 'full', 'spouse')$q$, 'no matching');
reset role;
select mrn as p2mrn from public.patients where id = :'p2' \gset
set role authenticated;
select test.login(:'pu1');
select public.portal_share_access(:'p2mrn', '01550000002', 'full', 'spouse', 30);
select test.login(:'pu2');
select test.assert((public.portal_medical(:'p1')->'visits'->0->>'summary') is not null, 'spouse with full access sees released records');
select test.login(:'pu1');
select (public.portal_me()->'shared_with'->0->>'grant_id') as share \gset
select public.portal_revoke_access(:'share');
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_medical(%L)$q$, :'p1'), 'not found');

-- Portal booking holds a real slot as REQUESTED and creates a lead; cancellation policy enforced.
reset role;
insert into public.doctor_schedules (doctor_id, branch_id, weekday, start_time, end_time, slot_minutes)
select :'dr', :'b1', d, '09:00', '17:00', 30 from generate_series(0, 6) d;
-- Re-publish the doctor's profile (archived in suite 06) as the workflow would.
select set_config('app.content_rpc', 'on', false);
update public.site_doctor_profiles set status = 'published', published_at = now() where staff_id = :'dr';
select set_config('app.content_rpc', '', false);
set role authenticated;
select test.login(:'pu1');
select slot_start as s from public.public_available_slots(:'dr', ((now() at time zone 'Africa/Cairo')::date + 3), 1) limit 1 \gset
select public.portal_book(:'p1', :'dr', :'s'::timestamptz, 'أفضل الصباح') as bref \gset
select test.assert((public.portal_appointments(:'p1')->0->>'status') = 'requested', 'portal booking is a requested appointment');
select test.expect_error(format($q$select public.portal_book(%L, %L, %L)$q$, :'p1', :'dr', :'s'), 'no longer available');
reset role;
select test.assert((select count(*) from public.leads where patient_id = :'p1' and channel = 'portal' and status = 'appointment_requested') = 1, 'lead created for Patient Relations');
select id as bapt from public.appointments where ref = :'bref' \gset
set role authenticated;
select test.login(:'pu1');
select public.portal_cancel(:'bapt', 'تغيير في المواعيد');
select test.assert((select (x->>'status') from jsonb_array_elements(public.portal_appointments(:'p1')) x where x->>'ref' = :'bref') = 'canceled', 'patient cancelled online');
-- Cannot cancel inside the policy window.
reset role;
insert into public.appointments (id, branch_id, patient_id, doctor_id, specialty_id, slot, status)
values ('00000000-0000-4000-8000-00000000a002', :'b1', :'p1', :'dr', :'derm', tstzrange(now() + interval '3 hours', now() + interval '3.5 hours'), 'booked');
set role authenticated;
select test.login(:'pu1');
select test.expect_error($q$select public.portal_cancel('00000000-0000-4000-8000-00000000a002', 'x')$q$, 'hours before');

-- Complaints and surveys.
select public.portal_open_ticket(:'p1', 'complaint', 'تأخير في الانتظار', 'انتظرت ٤٠ دقيقة') as tref \gset
reset role;
select test.assert((select priority = 'high' and due_at <= now() + interval '24 hours' from public.support_tickets where ref = :'tref'), 'complaint gets high priority and 24h SLA');
update public.appointments set status = 'arrived' where id = :'apt';
update public.appointments set status = 'in_consultation' where id = :'apt';
update public.appointments set status = 'completed' where id = :'apt';
set role authenticated;
select test.login(:'pu1');
select public.portal_survey(:'apt', 5, 'ممتاز');
select test.expect_error(format($q$select public.portal_survey(%L, 4)$q$, :'apt'), 'already submitted');
select test.login(:'pu2');
select test.expect_error(format($q$select public.portal_survey(%L, 1)$q$, :'apt'), 'not found');

-- Staff cannot resolve a ticket without a resolution note.
select test.login(:'admin');
select test.assert((select count(*) from public.support_tickets) = 0, 'system admin without ticket permission sees no tickets');
reset role;
select test.expect_error(format($q$update public.support_tickets set status = 'resolved' where ref = %L$q$, :'tref'), 'resolution note');

-- OTP: hashed, single-use, throttled, neutral for unknown numbers.
select test.assert((select count(*) from app.portal_otp_issue('01999999999')) = 0, 'unknown number issues nothing');
select code as otp from app.portal_otp_issue('01550000001', '10.0.0.1') \gset
select test.assert((select count(*) from app.portal_otps where code_hash = :'otp') = 0, 'code stored only as hash');
select test.expect_error($q$select app.portal_otp_verify('01550000001', '000000x')$q$, 'invalid or expired');
select test.assert(app.portal_otp_verify('01550000001', :'otp') = :'p1'::uuid, 'correct code verifies to account holder');
select test.expect_error(format($q$select app.portal_otp_verify('01550000001', %L)$q$, :'otp'), 'invalid or expired');
select app.portal_otp_issue('01550000001');
select app.portal_otp_issue('01550000001');
select test.expect_error($q$select app.portal_otp_issue('01550000001')$q$, 'too many requests');
set role authenticated;
select test.expect_error($q$select app.portal_otp_issue('01550000001')$q$, 'permission denied');
set role anon;
select test.expect_error($q$select app.portal_otp_verify('01550000001', '123456')$q$, 'permission denied');
select test.expect_error($q$select public.portal_me()$q$, 'permission denied');

-- Messaging: confirmations/cancellations queued once, reminders once, opt-out respected, retries back off.
reset role;
select test.assert((select count(*) from public.message_outbox where template_code = 'appointment_confirmed' and appointment_id = :'apt') = 1, 'confirmation queued on booking');
select test.assert((select count(*) from public.message_outbox where template_code = 'appointment_cancelled' and appointment_id = :'bapt') = 1, 'cancellation message queued');
select test.assert((select count(*) from public.message_outbox where template_code = 'result_released' and patient_id = :'p1') = 2, 'release notifications queued');
select test.assert((select vars->>'doctor' from public.message_outbox where appointment_id = :'apt' limit 1) is not null, 'message vars rendered from records');
insert into public.appointments (id, branch_id, patient_id, doctor_id, specialty_id, slot, status)
values ('00000000-0000-4000-8000-00000000a003', :'b1', :'p1', :'dr', :'derm', tstzrange(now() + interval '24 hours', now() + interval '24.5 hours'), 'booked');
select test.assert(app.enqueue_due_reminders() >= 1, 'reminder queued');
select test.assert(app.enqueue_due_reminders() = 0, 'reminder not duplicated');
insert into public.patient_consents (patient_id, kind, granted) values (:'p2', 'whatsapp_messages', false);
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status)
values (:'b1', :'p2', :'dr', :'derm', tstzrange(now() + interval '6 days', now() + interval '6 days 30 minutes'), 'booked');
select test.assert((select status from public.message_outbox where patient_id = :'p2' order by created_at desc limit 1) = 'skipped', 'opt-out respected');

select id as m1 from app.outbox_claim(1) \gset
select test.assert((select status from public.message_outbox where id = :'m1') = 'sending', 'claimed for sending');
select app.outbox_result(:'m1', false, 'whatsapp', null, 'timeout');
select test.assert((select status = 'queued' and next_attempt_at > now() from public.message_outbox where id = :'m1'), 'failure backs off');
update public.message_outbox set next_attempt_at = now(), attempts = 5 where id = :'m1';
select app.outbox_claim(50);
select app.outbox_result(:'m1', false, 'whatsapp', null, 'timeout');
select test.assert((select status from public.message_outbox where id = :'m1') = 'dead', 'dead-lettered after max attempts');
update public.message_outbox set status = 'queued', attempts = 0, next_attempt_at = now() where id = :'m1';
select app.outbox_claim(50);
select app.outbox_result(:'m1', true, 'whatsapp', 'wamid.TEST1', null);
select app.outbox_status('wamid.TEST1', 'read');
select app.outbox_status('wamid.TEST1', 'delivered');   -- late webhook must not move backwards
select test.assert((select status from public.message_outbox where id = :'m1') = 'read', 'delivery status monotonic');
