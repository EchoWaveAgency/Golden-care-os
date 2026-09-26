-- Golden Care OS — 0005 Scheduling, reception, queue, and clinical encounter foundation

create table public.doctor_schedules (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references public.staff(id),
  branch_id   uuid not null references public.branches(id),
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  slot_minutes smallint not null default 15 check (slot_minutes between 5 and 240),
  room_id     uuid references public.rooms(id),
  valid_from  date not null default current_date,
  valid_to    date,
  constraint schedule_window check (valid_to is null or valid_to >= valid_from)
);
create index on public.doctor_schedules (doctor_id, weekday);

-- Leave, holidays, Ramadan hours and one-off changes override the weekly template.
create table public.schedule_exceptions (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid references public.staff(id),        -- NULL = whole branch (holiday)
  branch_id  uuid not null references public.branches(id),
  period     tstzrange not null,
  kind       text not null check (kind in ('leave', 'holiday', 'blocked', 'extra_hours')),
  reason     text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.schedule_exceptions using gist (branch_id, period);

create table public.appointment_types (
  id           uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.specialties(id),
  code         text not null unique,
  name_ar      text not null,
  name_en      text not null,
  default_minutes smallint not null default 15,
  requires_room_kind public.room_kind,
  preparation_ar text,
  preparation_en text,
  is_active    boolean not null default true
);

create type public.appointment_status as enum (
  'requested', 'booked', 'pending_confirmation', 'confirmed', 'arrived', 'waiting',
  'in_consultation', 'procedure_in_progress', 'awaiting_payment', 'completed',
  'canceled', 'no_show'
);

create type public.booking_channel as enum ('front_desk', 'phone', 'whatsapp', 'website', 'portal', 'social', 'referral', 'walk_in');

create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('APT'),
  branch_id        uuid not null references public.branches(id),
  patient_id       uuid not null references public.patients(id),
  doctor_id        uuid not null references public.staff(id),
  specialty_id     uuid not null references public.specialties(id),
  appointment_type_id uuid references public.appointment_types(id),
  room_id          uuid references public.rooms(id),
  slot             tstzrange not null check (not isempty(slot) and upper(slot) - lower(slot) <= interval '12 hours'),
  status           public.appointment_status not null default 'booked',
  channel          public.booking_channel not null default 'front_desk',
  queue_no         int,
  arrived_at       timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  cancel_reason    text,
  delay_reason     text,
  notes_admin      text,
  idempotency_key  text unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- No double booking of a doctor or a room among active appointments.
  constraint no_doctor_overlap exclude using gist (doctor_id with =, slot with &&)
    where (status not in ('canceled', 'no_show')),
  constraint no_room_overlap exclude using gist (room_id with =, slot with &&)
    where (room_id is not null and status not in ('canceled', 'no_show'))
);
create index on public.appointments (branch_id, lower(slot));
create index on public.appointments (patient_id, lower(slot) desc);
create index on public.appointments (doctor_id, lower(slot));

create table public.appointment_status_history (
  id             bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id),
  from_status    public.appointment_status,
  to_status      public.appointment_status not null,
  reason         text,
  changed_by     uuid default auth.uid(),
  changed_at     timestamptz not null default now()
);
create index on public.appointment_status_history (appointment_id, changed_at);

create table app.queue_counters (
  branch_id uuid not null,
  day       date not null,
  value     int not null default 0,
  primary key (branch_id, day)
);

create trigger trg_appointments_updated before update on public.appointments
  for each row execute function app.touch_updated_at();
create trigger trg_audit_appointments after insert or update or delete on public.appointments
  for each row execute function app.audit_row();
create trigger trg_appointments_no_delete before delete on public.appointments
  for each row execute function app.block_delete();

-- Allowed status transitions. Everything else is rejected.
create or replace function app.appointment_transition_allowed(f public.appointment_status, t public.appointment_status)
returns boolean language sql immutable as $$
  select case f
    when 'requested'            then t in ('booked', 'pending_confirmation', 'confirmed', 'canceled')
    when 'booked'               then t in ('pending_confirmation', 'confirmed', 'arrived', 'canceled', 'no_show')
    when 'pending_confirmation' then t in ('confirmed', 'arrived', 'canceled', 'no_show')
    when 'confirmed'            then t in ('arrived', 'canceled', 'no_show')
    when 'arrived'              then t in ('waiting', 'in_consultation', 'canceled')
    when 'waiting'              then t in ('in_consultation', 'canceled')
    when 'in_consultation'      then t in ('procedure_in_progress', 'awaiting_payment', 'completed')
    when 'procedure_in_progress' then t in ('awaiting_payment', 'completed')
    when 'awaiting_payment'     then t in ('completed')
    else false
  end
$$;

-- Guard direct status edits: status can only change through a valid transition.
create or replace function app.appointments_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('requested', 'booked', 'pending_confirmation', 'confirmed') then
      raise exception 'new appointments must start as requested/booked/confirmed' using errcode = '22023';
    end if;
    insert into public.appointment_status_history(appointment_id, from_status, to_status)
      values (new.id, null, new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    if not app.appointment_transition_allowed(old.status, new.status) then
      raise exception 'invalid appointment transition % -> %', old.status, new.status using errcode = '22023';
    end if;
    if new.status = 'canceled' and coalesce(trim(new.cancel_reason), '') = '' then
      raise exception 'cancel reason is required' using errcode = '22023';
    end if;
    insert into public.appointment_status_history(appointment_id, from_status, to_status, reason)
      values (new.id, old.status, new.status, coalesce(new.cancel_reason, new.delay_reason));
  end if;
  return new;
end $$;

create trigger trg_appointments_guard_ins after insert on public.appointments
  for each row execute function app.appointments_guard();
create trigger trg_appointments_guard_upd before update on public.appointments
  for each row execute function app.appointments_guard();

-- Reception action: move an appointment to a new status with timestamps and queue number.
create or replace function public.transition_appointment(p_id uuid, p_to public.appointment_status, p_reason text default null)
returns public.appointments
language plpgsql security invoker set search_path = public, app, pg_temp as $$
declare a public.appointments;
        q int;
        v_day date;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'appointment not found or not accessible' using errcode = 'P0002'; end if;

  if p_to = 'arrived' then
    v_day := (lower(a.slot) at time zone 'Africa/Cairo')::date;
    insert into app.queue_counters(branch_id, day, value) values (a.branch_id, v_day, 1)
      on conflict (branch_id, day) do update set value = app.queue_counters.value + 1
      returning value into q;
  end if;

  update public.appointments set
    status        = p_to,
    queue_no      = coalesce(q, queue_no),
    arrived_at    = case when p_to = 'arrived' then now() else arrived_at end,
    started_at    = case when p_to = 'in_consultation' and started_at is null then now() else started_at end,
    completed_at  = case when p_to = 'completed' then now() else completed_at end,
    cancel_reason = case when p_to = 'canceled' then p_reason else cancel_reason end,
    delay_reason  = case when p_to not in ('canceled') and p_reason is not null then p_reason else delay_reason end
  where id = p_id
  returning * into a;
  return a;
end $$;
grant usage on schema app to authenticated;
-- queue counter is written through the invoker function; allow it explicitly.
grant select, insert, update on app.queue_counters to authenticated;

-- ---------------------------------------------------------------------------
-- Clinical encounter foundation (specialty templates arrive in Phase 2)
-- ---------------------------------------------------------------------------

create type public.encounter_status as enum ('draft', 'signed', 'entered_in_error');

create table public.encounters (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default app.next_ref('ENC'),
  branch_id      uuid not null references public.branches(id),
  patient_id     uuid not null references public.patients(id),
  doctor_id      uuid not null references public.staff(id),
  appointment_id uuid unique references public.appointments(id),
  specialty_id   uuid not null references public.specialties(id),
  template_code  text,
  template_version int,
  chief_complaint text,
  data           jsonb not null default '{}'::jsonb,   -- structured template content
  assessment     text,
  plan           text,
  status         public.encounter_status not null default 'draft',
  signed_at      timestamptz,
  signed_by      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.encounters (patient_id, created_at desc);

create table public.encounter_addenda (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  body         text not null check (length(trim(body)) > 0),
  author_id    uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);

-- Signed encounters are immutable; corrections go through addenda.
create or replace function app.encounters_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'signed' then
    if new.status = 'entered_in_error' and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;
    raise exception 'signed encounter cannot be modified; add an addendum' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_encounters_guard before update on public.encounters
  for each row execute function app.encounters_guard();
create trigger trg_encounters_updated before update on public.encounters
  for each row execute function app.touch_updated_at();
create trigger trg_encounters_no_delete before delete on public.encounters
  for each row execute function app.block_delete();
create trigger trg_audit_encounters after insert or update or delete on public.encounters
  for each row execute function app.audit_row();
create trigger trg_addenda_immutable before update or delete on public.encounter_addenda
  for each row execute function app.block_delete();
create trigger trg_audit_addenda after insert on public.encounter_addenda
  for each row execute function app.audit_row();

create or replace function public.sign_encounter(p_id uuid)
returns public.encounters
language plpgsql security invoker set search_path = public, app, pg_temp as $$
declare e public.encounters;
begin
  select * into e from public.encounters where id = p_id for update;
  if not found then raise exception 'encounter not found or not accessible' using errcode = 'P0002'; end if;
  if e.doctor_id is distinct from app.current_staff_id() then
    raise exception 'only the treating doctor can sign this encounter' using errcode = '42501';
  end if;
  if e.status <> 'draft' then raise exception 'encounter already %', e.status using errcode = '22023'; end if;
  update public.encounters set status = 'signed', signed_at = now(), signed_by = auth.uid()
    where id = p_id returning * into e;
  return e;
end $$;
