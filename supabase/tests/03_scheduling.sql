-- 03 — Scheduling: no double booking, valid transitions, queue, history
\set fd '00000000-0000-4000-8000-000000001002'
\set dr '00000000-0000-4000-8000-000000002004'
\set b1 '00000000-0000-4000-8000-000000000101'
\set room '00000000-0000-4000-8000-000000003001'

set role authenticated;
select test.login(:'fd');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'مريم', 'سعيد', '01033333333') returning id as p1 \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'يوسف', 'كمال', '01044444444') returning id as p2 \gset
select id as derm from public.specialties where code = 'derm' \gset

insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, room_id, slot)
values (:'b1', :'p1', :'dr', :'derm', :'room', tstzrange('2026-11-02 12:00+02', '2026-11-02 12:30+02')) returning id as a1 \gset

-- Same doctor, overlapping time → rejected
select test.expect_error(format($q$insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
  values (%L, %L, %L, %L, tstzrange('2026-11-02 12:15+02', '2026-11-02 12:45+02'))$q$, :'b1', :'p2', :'dr', :'derm'), 'no_doctor_overlap');
-- Adjacent slot is fine
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p2', :'dr', :'derm', tstzrange('2026-11-02 12:30+02', '2026-11-02 12:45+02')) returning id as a2 \gset
-- Same room, different doctor, overlapping → rejected
select test.expect_error(format($q$insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, room_id, slot)
  values (%L, %L, '00000000-0000-4000-8000-000000002005', (select id from public.specialties where code='dental'), %L, tstzrange('2026-11-02 12:10+02', '2026-11-02 12:20+02'))$q$,
  :'b1', :'p2', :'room'), 'no_room_overlap');

-- Cannot create an appointment already "completed"
select test.expect_error(format($q$insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status)
  values (%L, %L, %L, %L, tstzrange('2026-11-03 12:00+02', '2026-11-03 12:15+02'), 'completed')$q$, :'b1', :'p1', :'dr', :'derm'), 'must start');

-- Invalid jump booked → completed rejected; cancellation needs a reason
select test.expect_error(format($q$select public.transition_appointment(%L, 'completed')$q$, :'a1'), 'invalid appointment transition');
select test.expect_error(format($q$select public.transition_appointment(%L, 'canceled')$q$, :'a2'), 'cancel reason is required');

-- Canceling frees the slot for rebooking
select public.transition_appointment(:'a2', 'canceled', 'patient asked to reschedule');
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'p2', :'dr', :'derm', tstzrange('2026-11-02 12:30+02', '2026-11-02 12:45+02'));

-- Reception flow with queue numbers per branch per day
select public.transition_appointment(:'a1', 'confirmed');
select public.transition_appointment(:'a1', 'arrived');
select test.assert((select queue_no is not null and arrived_at is not null from public.appointments where id = :'a1'), 'arrival stamps time and queue number');
select public.transition_appointment(:'a1', 'in_consultation');
select public.transition_appointment(:'a1', 'awaiting_payment');
select public.transition_appointment(:'a1', 'completed');
select test.assert((select status = 'completed' and completed_at is not null and started_at is not null from public.appointments where id = :'a1'), 'completed with timestamps');
select test.assert((select array_agg(to_status::text order by id) from public.appointment_status_history where appointment_id = :'a1')
                   = array['booked','confirmed','arrived','in_consultation','awaiting_payment','completed'], 'status history is complete');

-- Direct status edits are also validated (not only through the RPC)
select test.expect_error(format($q$update public.appointments set status = 'booked' where id = %L$q$, :'a1'), 'invalid appointment transition');
reset role;
