-- 14 — Patient care assistant: settings, journeys, contact hours, one conversation per phone, atomic steps,
--      appointment confirm/cancel, tickets, escalations, opt-out, follow-ups, failures, visibility.
\set fd      '00000000-0000-4000-8000-000000001002'
\set drderm  '00000000-0000-4000-8000-000000001004'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set chief   '00000000-0000-4000-8000-000000001006'
\set pr      '00000000-0000-4000-8000-000000001070'
\set md      '00000000-0000-4000-8000-000000001071'
\set b1      '00000000-0000-4000-8000-000000000101'
\set dent    '00000000-0000-4000-8000-000000002005'
\set derm    '00000000-0000-4000-8000-000000002004'

insert into auth.users (id, email) values (:'pr', 'pr14@test.local'), (:'md', 'md14@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'pr', 'علاقات مرضى'), (:'md', 'مدير طبي');
insert into public.user_roles (user_id, role_code, branch_id) values (:'pr', 'patient_relations', :'b1'), (:'md', 'medical_director', null);
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'سلمى', 'متابعة', '01099990021') returning id as p1 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'رافض', 'الرسائل', '01099990022') returning id as p2 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'ثالث', 'مريض', '01099990023') returning id as p3 \gset
insert into public.patient_consents (patient_id, kind, granted) values (:'p2', 'whatsapp_messages', false);
select id as dental from public.specialties where code = 'dental' \gset
select id as dermsp from public.specialties where code = 'derm' \gset

-- ---------- Settings: only care.settings; the assistant is off by default
set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.save_care_settings(%L, '{"enabled": true}')$q$, :'b1'), 'permission denied');
select test.login(:'md');
select test.expect_error(format($q$select public.save_care_settings(%L, '{"contact_from": "22:00", "contact_to": "09:00"}')$q$, :'b1'), 'check');
select public.save_care_settings(:'b1', '{"enabled": true, "contact_from": "00:00", "contact_to": "23:59", "confirm_delay_min": 0, "post_visit_delay_hours": 0, "clinic_phone": "0225555555"}') is not null as x \gset
reset role;
select test.assert((select enabled and confirm_delay_min = 0 and not voice_enabled from public.care_agent_settings where branch_id = :'b1'), 'settings saved, voice off by default');

-- ---------- Booking confirmation journeys (legacy confirmation template not sent twice)
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p1', :'dent', :'dental', tstzrange(now() + interval '3 days 41 minutes', now() + interval '3 days 71 minutes')) returning id as a1 \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p2', :'dent', :'dental', tstzrange(now() + interval '3 days 2 hours 3 minutes', now() + interval '3 days 2 hours 33 minutes')) returning id as a2 \gset
select test.assert((select count(*) = 0 from public.message_outbox where appointment_id = :'a1' and template_code = 'appointment_confirmed'),
  'assistant on: the plain confirmation template is not sent as well');
select public.svc_care_enqueue(now() + interval '1 minute') as n \gset
select test.assert((select count(*) = 1 and min(status::text) = 'scheduled' and min(channel) = 'whatsapp' and min(to_phone) = '+201099990021'
                    from public.care_journeys where appointment_id = :'a1' and kind = 'booking_confirm'), 'booking confirmation journey created');
select test.assert((select count(*) = 0 from public.care_journeys where patient_id = :'p2'), 'patient who refused WhatsApp is not contacted');
select public.svc_care_enqueue(now() + interval '2 minutes') as n2 \gset
select test.assert((select count(*) = 1 from public.care_journeys where appointment_id = :'a1'), 'enqueue is idempotent');
select id as j1 from public.care_journeys where appointment_id = :'a1' \gset

-- Contact hours: nothing is opened at 3 a.m.
set role authenticated;
select test.login(:'md');
select public.save_care_settings(:'b1', '{"contact_from": "10:00", "contact_to": "21:00"}') is not null as x \gset
reset role;
select test.assert((select count(*) = 0 from public.svc_care_claim(20, ((current_date + 1)::timestamp + time '03:00') at time zone 'Africa/Cairo')),
  'nothing claimed outside contact hours');
set role authenticated;
select test.login(:'md');
select public.save_care_settings(:'b1', '{"contact_from": "00:00", "contact_to": "23:59"}') is not null as x \gset
reset role;

-- Claim → context → lease
select (c->>'version')::int as v1, c->>'name' as cname, c->>'doctor' as cdoc, c->>'clinic_phone' as cphone
from public.svc_care_claim(20, now() + interval '3 minutes') c where c->>'id' = :'j1' \gset
select test.assert(:'cname' = 'سلمى' and :'cdoc' = 'د. كريم الأسنان' and :'cphone' = '0225555555', 'context carries first name, doctor and clinic phone only');
select test.assert((select count(*) = 0 from public.svc_care_claim(20, now() + interval '3 minutes') c where c->>'id' = :'j1'), 'a claimed journey is leased');

-- Open: one queued template message; waiting with a nudge time
select public.svc_care_apply(:'j1', :v1, jsonb_build_object('state', 'confirm', 'status', 'waiting', 'opened', true,
  'next_action_at', now() + interval '4 hours', 'messages', jsonb_build_array(jsonb_build_object('body', 'أهلًا سلمى', 'template_code', 'care_booking_confirm')))) as r \gset
select test.assert((select status = 'waiting' and opened_at is not null and lease_until is null and version = :v1 + 1 from public.care_journeys where id = :'j1'), 'opened and waiting');
select test.assert((select count(*) = 1 and min(status) = 'queued' and min(template_code) = 'care_booking_confirm' from public.care_messages where journey_id = :'j1'), 'opening message queued');
select test.expect_error(format($q$select public.svc_care_apply(%L, %s, '{}')$q$, :'j1', :v1), 'version conflict');

-- The patient replies; duplicate deliveries are ignored
select public.svc_care_inbound('201099990021', 'wamid.T1', '1', 'whatsapp') as inb \gset
select test.assert((:'inb'::jsonb)->'journey'->>'id' = :'j1', 'reply routed to the open conversation by phone');
select test.assert((public.svc_care_inbound('201099990021', 'wamid.T1', '1', 'whatsapp'))->>'duplicate' = 'true', 'duplicate webhook delivery ignored');
select public.svc_care_apply(:'j1', :v1 + 1, jsonb_build_object('state', 'done', 'status', 'completed', 'outcome', 'confirmed',
  'inbound_message_id', (:'inb'::jsonb)->>'message_id', 'intent', 'yes',
  'actions', jsonb_build_array(jsonb_build_object('type', 'confirm_appointment')),
  'messages', jsonb_build_array(jsonb_build_object('body', 'تمام اتأكد حجزك')))) is not null as x \gset
select test.assert((select status = 'confirmed' from public.appointments where id = :'a1'), 'appointment confirmed by the patient');
select test.assert((select status = 'completed' and outcome = 'confirmed' and closed_at is not null from public.care_journeys where id = :'j1'), 'journey completed');
select test.assert((select intent = 'yes' from public.care_messages where id = ((:'inb'::jsonb)->>'message_id')::uuid), 'reply intent recorded');
select test.expect_error(format($q$update public.care_messages set body = 'x' where journey_id = %L$q$, :'j1'), 'cannot be edited');

-- ---------- Cancel through the assistant: no second cancellation message
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p1', :'derm', :'dermsp', tstzrange(now() + interval '4 days 53 minutes', now() + interval '4 days 83 minutes')) returning id as a3 \gset
select public.svc_care_enqueue(now() + interval '5 minutes') as n3 \gset
select id as j3 from public.care_journeys where appointment_id = :'a3' \gset
select (c->>'version')::int as v3 from public.svc_care_claim(20, now() + interval '6 minutes') c where c->>'id' = :'j3' \gset
select public.svc_care_apply(:'j3', :v3, '{"state": "confirm", "status": "waiting", "opened": true}') is not null as x \gset
select public.svc_care_apply(:'j3', :v3 + 1, jsonb_build_object('state', 'done', 'status', 'completed', 'outcome', 'cancelled',
  'actions', jsonb_build_array(jsonb_build_object('type', 'cancel_appointment')))) is not null as x \gset
select test.assert((select status = 'canceled' and cancel_reason like '%care assistant%' from public.appointments where id = :'a3'), 'appointment cancelled with a reason');
select test.assert((select count(*) = 0 from public.message_outbox where appointment_id = :'a3' and template_code = 'appointment_cancelled'),
  'no duplicate cancellation message');

-- ---------- Tickets and escalations
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p1', :'dent', :'dental', tstzrange(now() + interval '5 days 4 hours 7 minutes', now() + interval '5 days 4 hours 37 minutes')) returning id as a4 \gset
select public.svc_care_enqueue(now() + interval '7 minutes') as n4 \gset
select id as j4 from public.care_journeys where appointment_id = :'a4' \gset
select (c->>'version')::int as v4 from public.svc_care_claim(20, now() + interval '8 minutes') c where c->>'id' = :'j4' \gset
select public.svc_care_apply(:'j4', :v4, '{"state": "confirm", "status": "waiting", "opened": true}') is not null as x \gset
select public.svc_care_inbound('01099990021', 'wamid.T4', 'مش قادر اتنفس', 'whatsapp') as inb4 \gset
select public.svc_care_apply(:'j4', :v4 + 1, jsonb_build_object('state', 'confirm', 'status', 'human', 'outcome', 'urgent',
  'actions', jsonb_build_array(
    jsonb_build_object('type', 'escalate', 'severity', 'urgent', 'category', 'clinical', 'summary', 'علامات خطر', 'patient_text', 'مش قادر اتنفس'),
    jsonb_build_object('type', 'ticket', 'kind', 'callback', 'subject', 'اتصل بالمريض', 'priority', 'high')))) as r4 \gset
select test.assert((select severity = 'urgent' and doctor_id = :'dent' and due_at <= now() + interval '16 minutes' and status = 'open'
                    from public.care_escalations where journey_id = :'j4'), 'urgent escalation to the treating doctor, due in 15 minutes');
select test.assert((select count(*) = 1 and min(channel) = 'care_assistant' and min(priority) = 'high' from public.support_tickets where patient_id = :'p1' and kind = 'callback'),
  'callback ticket for the front desk');
select test.assert(jsonb_array_length((:'r4'::jsonb)->'refs') = 2, 'references returned for both');
select id as e4 from public.care_escalations where journey_id = :'j4' \gset

-- Visibility
set role authenticated;
select test.login(:'drdent');
select test.assert((select count(*) >= 1 from public.care_journeys where doctor_id = :'dent') and (select count(*) = 1 from public.care_escalations where id = :'e4'),
  'treating doctor sees their patients'' conversations and escalations');
select test.assert((select count(*) = 0 from public.care_journeys where id = :'j3'), 'a doctor does not see another doctor''s conversation');
select test.login(:'drderm');
select test.assert((select count(*) = 0 from public.care_escalations where id = :'e4') and (select count(*) = 0 from public.care_messages where journey_id = :'j4'),
  'another doctor sees neither the escalation nor the messages');
select test.expect_error(format($q$select public.care_escalation_update(%L, 'acknowledge')$q$, :'e4'), 'permission denied');
select test.login(:'chief');
select test.assert((select count(*) = 0 from public.care_journeys) and (select count(*) = 0 from public.care_messages), 'finance sees no care conversations');
select test.login(:'fd');
select test.assert((select count(*) = 0 from public.care_journeys), 'front desk works from tickets, not conversations');
select test.expect_error($q$select public.care_kpis('00000000-0000-4000-8000-000000000101', current_date, current_date)$q$, 'permission denied');
select test.login(:'pr');
select test.assert((select count(*) >= 3 from public.care_journeys) and (select count(*) >= 3 from public.care_messages), 'patient relations sees the branch conversations');
select test.expect_error($q$select public.svc_care_enqueue()$q$, 'permission denied');
select test.login(:'drdent');
select status from public.care_escalation_update(:'e4', 'acknowledge') \gset
select test.assert(:'status' = 'acknowledged', 'doctor acknowledges');
select test.expect_error(format($q$select public.care_escalation_update(%L, 'resolve', '')$q$, :'e4'), 'resolution note is required');
select status from public.care_escalation_update(:'e4', 'resolve', 'كلمت المريض ووجهته للطوارئ') \gset
select test.assert(:'status' = 'resolved', 'doctor resolves with a note');

-- Staff reply within the WhatsApp window; result recorded by the sender only
select test.login(:'pr');
select public.care_staff_message(:'j4', 'أهلًا، معاك سارة من خدمة العملاء') as sm \gset
select test.assert((select status = 'human' from public.care_journeys where id = :'j4'), 'conversation stays with staff');
select test.expect_error(format($q$select public.care_staff_message(%L, 'x')$q$, :'j3'), 'outside the 24-hour');
select public.care_message_result(((:'sm'::jsonb)->>'id')::uuid, true, 'dev', 'dev-1', null) is null as x \gset
select test.login(:'md');
select test.expect_error(format($q$select public.care_message_result(%L, true, 'dev', 'dev-2', null)$q$, (:'sm'::jsonb)->>'id'), 'message not found');
select (public.care_kpis(:'b1', current_date - 1, current_date + 1))->>'confirmed' as kc \gset
select test.assert(:'kc'::int >= 1, 'outcome figures available to the medical director');
select test.login(:'pr');
select public.care_close(:'j4', 'تم التواصل') is null as x \gset
reset role;

-- ---------- One conversation per phone; after the visit; follow-up
insert into public.encounters (branch_id, patient_id, doctor_id, appointment_id, specialty_id, chief_complaint)
values (:'b1', :'p1', :'dent', :'a1', :'dental', 'ألم ضرس') returning id as enc \gset
set role authenticated;
select test.login(:'drdent');
select public.sign_encounter(:'enc') is not null as x \gset
select test.expect_error(format($q$select public.set_care_followup(%L, current_date)$q$, :'enc'), 'between tomorrow');
select test.login(:'drderm');
select test.expect_error(format($q$select public.set_care_followup(%L, current_date + 10)$q$, :'enc'), 'only the treating doctor');
select test.login(:'drdent');
select id as fu from public.set_care_followup(:'enc', current_date + 5, 'متابعة بعد الحشو') \gset
reset role;
-- A conversation already waiting on the same phone defers the next one
insert into public.care_journeys (branch_id, patient_id, kind, appointment_id, doctor_id, to_phone, status, state, opened_at, next_action_at)
values (:'b1', :'p1', 'pre_visit', :'a4', :'dent', '+201099990021', 'waiting', 'confirm', now(), now() + interval '4 hours') returning id as jw \gset
select public.svc_care_enqueue(now() + interval '10 minutes') as n5 \gset
select id as jpv from public.care_journeys where encounter_id = :'enc' and kind = 'post_visit' \gset
select test.assert((select count(*) = 0 from public.svc_care_claim(20, now() + interval '11 minutes') c where c->>'id' = :'jpv'), 'deferred while another conversation is open');
select test.assert((select scheduled_at > now() + interval '1 hour' from public.care_journeys where id = :'jpv'), 'rescheduled two hours later');
update public.care_journeys set status = 'completed', closed_at = now() where id = :'jw';
select c as pv from public.svc_care_claim(20, now() + interval '3 hours') c where c->>'id' = :'jpv' \gset
select test.assert((:'pv'::jsonb)->>'has_rx' = 'false' and (:'pv'::jsonb)->>'followup_due' = (current_date + 5)::text, 'post-visit context: no prescription, follow-up date');
select public.svc_care_apply(:'jpv', ((:'pv'::jsonb)->>'version')::int, jsonb_build_object('state', 'done', 'status', 'completed', 'outcome', 'answered', 'opened', true,
  'data', '{"improve": "better", "rating": 5}'::jsonb, 'actions', jsonb_build_array(jsonb_build_object('type', 'survey', 'score', 5)))) is not null as x \gset
select test.assert((select score = 5 from public.satisfaction_surveys where appointment_id = :'a1'), 'satisfaction recorded against the visit');

-- Follow-up reminder: created within the lead days; cancelled if the patient books with the doctor
update public.appointments set status = 'canceled', cancel_reason = 'اختبار' where id in (:'a1', :'a4');
select public.svc_care_enqueue(now() + interval '1 day') as n6 \gset
select test.assert((select count(*) = 0 from public.care_journeys where followup_id = :'fu'), 'not yet: due in 5 days, lead 2 days');
select public.svc_care_enqueue(now() + interval '3 days') as n7 \gset
select id as jfu from public.care_journeys where followup_id = :'fu' \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p1', :'dent', :'dental', tstzrange(now() + interval '4 days 5 hours 11 minutes', now() + interval '4 days 5 hours 41 minutes'));
select test.assert((select count(*) = 0 from public.svc_care_claim(20, now() + interval '3 days 1 minute') c where c->>'id' = :'jfu'), 'reminder not sent');
select test.assert((select status = 'cancelled' and outcome = 'already_booked' from public.care_journeys where id = :'jfu'), 'patient already booked the follow-up');

-- ---------- Opt-out stops everything planned
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p3', :'dent', :'dental', tstzrange(now() + interval '6 days 1 hour 19 minutes', now() + interval '6 days 1 hour 49 minutes')) returning id as a6 \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p3', :'derm', :'dermsp', tstzrange(now() + interval '7 days 2 hours 23 minutes', now() + interval '7 days 2 hours 53 minutes')) returning id as a7 \gset
select public.svc_care_enqueue(now() + interval '20 minutes') as n8 \gset
select id as j6 from public.care_journeys where appointment_id = :'a6' \gset
select id as j7 from public.care_journeys where appointment_id = :'a7' \gset
select version as v6 from public.care_journeys where id = :'j6' \gset
select public.svc_care_apply(:'j6', :v6, '{"state": "done", "status": "opted_out", "outcome": "opted_out", "actions": [{"type": "opt_out"}]}') is not null as x \gset
select test.assert((select not granted from public.patient_consent_current where patient_id = :'p3' and kind::text = 'care_followup'), 'refusal recorded as consent');
select test.assert((select status = 'opted_out' from public.care_journeys where id = :'j7'), 'other planned conversations closed');

-- ---------- Messages outside any conversation
select public.svc_care_inbound('01055554444', 'wamid.U1', 'عايز اعرف مواعيد الجلدية', 'whatsapp') as u1 \gset
select test.assert(((:'u1'::jsonb)->'journey') = 'null'::jsonb, 'unknown sender has no conversation');
select (public.svc_care_unrouted(((:'u1'::jsonb)->>'message_id')::uuid, false))->>'action' as ua \gset
select test.assert(:'ua' = 'lead' and (select count(*) = 1 from public.leads where phone = '+201055554444' and channel = 'whatsapp'), 'unknown sender becomes a lead');
select test.assert((select processed_at is not null from public.care_messages where id = ((:'u1'::jsonb)->>'message_id')::uuid), 'message marked processed');
select public.svc_care_inbound('01099990021', 'wamid.U2', 'ممكن صورة من الفاتورة', 'whatsapp') as u2 \gset
select (public.svc_care_unrouted(((:'u2'::jsonb)->>'message_id')::uuid, false))->>'action' as ub \gset
select test.assert(:'ub' = 'ticket', 'known patient without a conversation gets a ticket');
select public.svc_care_inbound('01099990021', 'wamid.U4', 'شكرا', 'whatsapp') as u5 \gset
select test.assert((public.svc_care_unrouted(((:'u5'::jsonb)->>'message_id')::uuid, true))->>'action' = 'none', 'a thank-you needs no ticket');
select public.svc_care_log_reply(((:'u5'::jsonb)->>'message_id')::uuid, 'العفو') as rid \gset
select test.assert((select status = 'queued' and author = 'agent' and journey_id is null from public.care_messages where id = :'rid'), 'automatic reply kept on record');

-- Danger signs are escalated in the same transaction that stores the message, and pause the patient's conversations
insert into public.care_journeys (branch_id, patient_id, kind, doctor_id, to_phone, status, scheduled_at)
values (:'b1', :'p1', 'followup', :'dent', '+201099990021', 'scheduled', now() + interval '1 day') returning id as jpause \gset
select public.svc_care_inbound('01099990021', 'wamid.U3', 'ابني بينزف من بقه', 'whatsapp', null, true) as u3 \gset
select test.assert((:'u3'::jsonb)->>'urgent_ref' like 'CE-%', 'urgent escalation created with the message');
select test.assert((select severity = 'urgent' and patient_id = :'p1' and doctor_id = :'dent' from public.care_escalations where ref = (:'u3'::jsonb)->>'urgent_ref'),
  'escalation goes to the patient''s recent doctor');
select test.assert((select status = 'human' from public.care_journeys where id = :'jpause'), 'the patient''s planned conversations are paused');
select public.svc_care_inbound('01077778888', 'wamid.U6', 'مش قادر اتنفس', 'whatsapp', null, true) as u6 \gset
select test.assert((select patient_id is null and phone = '+201077778888' and severity = 'urgent' from public.care_escalations where ref = (:'u6'::jsonb)->>'urgent_ref'),
  'danger signs from an unknown number are an urgent escalation, not a lead');

-- A phone shared by two patients: never attributed automatically; one conversation per phone even within one batch
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'أم', 'مشتركة', '01066660000') returning id as pm \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'ابن', 'مشترك', '01066660000') returning id as pk \gset
select public.svc_care_inbound('01066660000', 'wamid.S1', 'عايز احجز', 'whatsapp') as s1 \gset
select test.assert(((:'s1'::jsonb)->>'patient_id') is null and ((:'s1'::jsonb)->>'patients')::int = 2, 'shared number not attributed to either patient');
select test.assert((public.svc_care_unrouted(((:'s1'::jsonb)->>'message_id')::uuid, false))->>'action' = 'escalation', 'a person identifies who wrote');
insert into public.care_journeys (branch_id, patient_id, kind, to_phone, scheduled_at)
values (:'b1', :'pm', 'followup', '+201066660000', now() - interval '1 minute'), (:'b1', :'pk', 'followup', '+201066660000', now() - interval '1 minute');
select test.assert((select count(*) = 1 from public.svc_care_claim(20) c where c->>'phone' = '+201066660000'), 'only one conversation opened per phone in a batch');

-- Opt-out by message: everyone on the number, open conversations closed
select public.svc_care_inbound('01066660000', 'wamid.S2', 'مش عايز رسايل', 'whatsapp') as s2 \gset
select test.assert(public.svc_care_opt_out_message(((:'s2'::jsonb)->>'message_id')::uuid) = 2, 'refusal recorded for both patients on the number');
select test.assert((select count(*) = 0 from public.care_journeys where to_phone = '+201066660000' and status in ('scheduled', 'waiting', 'human')), 'their conversations closed');

-- Safety net: a stored message nobody processed goes to a person
insert into public.care_messages (patient_id, branch_id, phone, direction, channel, author, body, status, created_at)
values (:'p1', :'b1', '+201099990021', 'in', 'whatsapp', 'patient', 'رسالة ضاعت', 'received', now() - interval '5 minutes') returning id as lost \gset
select public.svc_care_sweep() as swept \gset
select test.assert(:'swept' >= 1 and (select processed_at is not null from public.care_messages where id = :'lost'), 'unprocessed message handed to a person');
select test.assert((select count(*) = 1 from public.support_tickets where body = 'رسالة ضاعت' and kind = 'callback'), 'callback ticket created');

-- Cancellation inside the clinic's cancellation window becomes a request, not a cancellation
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p1', :'derm', :'dermsp', tstzrange(now() + interval '5 hours 13 minutes', now() + interval '5 hours 43 minutes')) returning id as a8 \gset
insert into public.care_journeys (branch_id, patient_id, kind, appointment_id, doctor_id, to_phone, status, state, opened_at)
values (:'b1', :'p1', 'pre_visit', :'a8', :'derm', '+201099990021', 'waiting', 'cancel_check', now()) returning id as j8 \gset
select test.assert((public.svc_care_context(:'j8'))->>'cancel_allowed' = 'false', 'context says cancellation is no longer allowed');
select public.svc_care_apply(:'j8', 0, '{"state": "done", "status": "completed", "outcome": "cancel_requested", "actions": [{"type": "cancel_appointment"}]}') as r8 \gset
select test.assert((select status <> 'canceled' from public.appointments where id = :'a8') and jsonb_array_length((:'r8'::jsonb)->'refs') = 1, 'appointment kept; request ticket created');

-- A conversation staff are handling is never reset by a late delivery failure
select test.assert(public.svc_care_send_failed(:'j4', 'late failure') = 'ignored', 'send failure ignored once staff took over');

-- Internal primitives are not callable by signed-in users
set role authenticated;
select test.login(:'pr');
select test.expect_error(format($q$select app.care_context(%L)$q$, :'j1'), 'permission denied');
select test.expect_error($q$select app.care_enqueue()$q$, 'permission denied');
reset role;

-- ---------- Delivery failures: retry, retry, then staff (or a call when voice is on)
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p2', :'derm', :'dermsp', tstzrange(now() + interval '8 days 37 minutes', now() + interval '8 days 67 minutes'));
insert into public.care_journeys (branch_id, patient_id, kind, doctor_id, to_phone, status, state, opened_at)
values (:'b1', :'p1', 'followup', :'dent', '+201099990021', 'waiting', 'followup_q', now()) returning id as jf \gset
select public.svc_care_send_failed(:'jf', 'HTTP 500') as f1 \gset
select public.svc_care_send_failed(:'jf', 'HTTP 500') as f2 \gset
select test.assert(:'f1' = 'retry' and :'f2' = 'retry', 'two retries with backoff');
select test.assert((select status = 'scheduled' and scheduled_at > now() + interval '20 minutes' from public.care_journeys where id = :'jf'), 'next try later');
select test.assert(public.svc_care_send_failed(:'jf', 'HTTP 500') = 'failed', 'then failed');
select test.assert((select count(*) = 1 from public.support_tickets where body like '%' || (select ref from public.care_journeys where id = :'jf') || '%'), 'a person is asked to call');
set role authenticated;
select test.login(:'md');
select public.save_care_settings(:'b1', '{"voice_enabled": true}') is not null as x \gset
reset role;
insert into public.care_journeys (branch_id, patient_id, kind, doctor_id, to_phone, status, state, attempts)
values (:'b1', :'p1', 'followup', :'dent', '+201099990021', 'scheduled', 'start', 2) returning id as jv \gset
select public.svc_care_send_failed(:'jv', 'not on WhatsApp') as fb \gset
select test.assert(:'fb' = 'voice' and (select channel = 'voice' and status = 'scheduled' from public.care_journeys where id = :'jv'), 'WhatsApp failure falls back to a call');
select test.assert(public.svc_care_call_event(:'jv', 'CA1', 'initiated') = 'ok', 'call recorded');
select test.assert(public.svc_care_call_event(:'jv', 'CA-other', 'no-answer') = 'stale', 'events from another call ignored');
select test.assert(public.svc_care_call_event(:'jv', 'CA1', 'no-answer') = 'retry', 'no answer → try again later');

select test.assert((select count(*) = 0 from public.care_journeys where status = 'waiting' and next_action_at is null), 'every waiting conversation has a next action time');

-- Urgent escalations alert the on-call number (reference only)
set role authenticated;
select test.login(:'md');
select public.save_care_settings(:'b1', '{"oncall_phone": "01011112222"}') is not null as x \gset
reset role;
select public.svc_care_inbound('01099990021', 'wamid.OC', 'فقدت الوعي الصبح', 'whatsapp', null, true) as oc \gset
select test.assert((select count(*) = 1 and min(to_phone) = '+201011112222' and min(vars->>'ref') = (:'oc'::jsonb)->>'urgent_ref' and bool_and(patient_id is null)
                    from public.message_outbox where template_code = 'care_oncall_alert'), 'on-call number alerted without patient details');
