-- Golden Care OS — 0020 Patient care assistant
-- An automated, clearly identified assistant that contacts patients on WhatsApp (or by voice call when a
-- telephony provider is connected): it confirms new bookings, reminds the day before, follows up after the
-- visit (medication, improvement, other problems, satisfaction) and reminds the patient of the follow-up
-- consultation the doctor asked for. It never gives medical advice: anything clinical is escalated to the
-- care team, and danger signs open an urgent escalation and pause the assistant.
--
-- Conversation logic runs in trusted server code (src/lib/care). The database holds the state, applies each
-- step atomically (svc_care_apply, optimistic version check) and performs the side effects: confirming or
-- cancelling the appointment, support tickets, clinical escalations, satisfaction scores and opt-outs.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('care.read',     'care', 'View the care assistant conversations, outcomes and escalations of the branch'),
  ('care.manage',   'care', 'Take over conversations, reply to patients, handle escalations'),
  ('care.settings', 'care', 'Turn the care assistant on or off and set its timings')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('patient_relations', 'care.read'), ('patient_relations', 'care.manage'),
  ('medical_director', 'care.read'), ('medical_director', 'care.manage'), ('medical_director', 'care.settings'),
  ('nurse', 'care.read'), ('quality_manager', 'care.read'),
  ('center_director', 'care.settings')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Settings per branch (off until the clinic turns it on)
-- ---------------------------------------------------------------------------
create table public.care_agent_settings (
  branch_id              uuid primary key references public.branches(id),
  enabled                boolean not null default false,
  booking_confirm        boolean not null default true,
  pre_visit              boolean not null default true,
  post_visit             boolean not null default true,
  followup               boolean not null default true,
  voice_enabled          boolean not null default false,
  voice_fallback         boolean not null default true,   -- call when WhatsApp gets no answer
  contact_from           time not null default '10:00',
  contact_to             time not null default '21:00',
  confirm_delay_min      int not null default 5   check (confirm_delay_min between 0 and 1440),
  confirm_min_lead_hours int not null default 3   check (confirm_min_lead_hours between 0 and 72),
  post_visit_delay_hours int not null default 20  check (post_visit_delay_hours between 0 and 168),
  followup_lead_days     int not null default 2   check (followup_lead_days between 0 and 30),
  nudge_after_hours      int not null default 4   check (nudge_after_hours between 1 and 48),
  max_nudges             int not null default 1   check (max_nudges between 0 and 3),
  clinic_phone           text check (clinic_phone is null or length(clinic_phone) <= 30),
  oncall_phone           text check (oncall_phone is null or length(oncall_phone) <= 30),  -- staff number alerted on urgent/high escalations (no patient details)
  updated_by             uuid default auth.uid(),
  updated_at             timestamptz not null default now(),
  check (contact_from < contact_to)
);
create trigger trg_audit_care_settings after insert or update on public.care_agent_settings for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Follow-up consultation requested by the doctor
-- ---------------------------------------------------------------------------
create table public.care_followup_requests (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null unique references public.encounters(id),
  patient_id   uuid not null references public.patients(id),
  branch_id    uuid not null references public.branches(id),
  doctor_id    uuid not null references public.staff(id),
  due_on       date not null,
  note         text check (note is null or length(note) <= 300),
  status       text not null default 'open' check (status in ('open', 'cancelled')),
  cancel_reason text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.care_followup_requests (status, due_on);
create trigger trg_audit_care_followups after insert or update on public.care_followup_requests for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Journeys, messages, escalations
-- ---------------------------------------------------------------------------
create type public.care_kind as enum ('booking_confirm', 'pre_visit', 'post_visit', 'followup');
create type public.care_status as enum ('scheduled', 'waiting', 'human', 'completed', 'no_response', 'cancelled', 'failed', 'opted_out');

create table public.care_journeys (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default app.next_ref('CJ'),
  branch_id      uuid not null references public.branches(id),
  patient_id     uuid not null references public.patients(id),
  kind           public.care_kind not null,
  appointment_id uuid references public.appointments(id),
  encounter_id   uuid references public.encounters(id),
  followup_id    uuid references public.care_followup_requests(id),
  doctor_id      uuid references public.staff(id),
  to_phone       text not null,
  channel        text not null default 'whatsapp' check (channel in ('whatsapp', 'voice')),
  lang           text not null default 'ar' check (lang in ('ar', 'en')),
  status         public.care_status not null default 'scheduled',
  state          text not null default 'start',
  data           jsonb not null default '{}'::jsonb,
  outcome        text,
  scheduled_at   timestamptz not null default now(),
  next_action_at timestamptz,
  lease_until    timestamptz,
  nudges         int not null default 0,
  attempts       int not null default 0,
  last_error     text,
  call_sid       text,
  version        int not null default 0,
  opened_at      timestamptz,
  last_inbound_at timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index care_journeys_appt_uq on public.care_journeys (kind, appointment_id)
  where appointment_id is not null and kind in ('booking_confirm', 'pre_visit') and status <> 'cancelled';
create unique index care_journeys_enc_uq on public.care_journeys (encounter_id) where kind = 'post_visit';
create unique index care_journeys_fu_uq on public.care_journeys (followup_id) where kind = 'followup' and status <> 'cancelled';
create index on public.care_journeys (status, scheduled_at);
create index on public.care_journeys (to_phone, status);
create index on public.care_journeys (patient_id, created_at desc);
create trigger trg_audit_care_journeys after insert or update on public.care_journeys for each row execute function app.audit_row();

create table public.care_messages (
  id                  uuid primary key default gen_random_uuid(),
  journey_id          uuid references public.care_journeys(id),
  patient_id          uuid references public.patients(id),
  branch_id           uuid not null references public.branches(id),
  phone               text not null,
  direction           text not null check (direction in ('in', 'out')),
  channel             text not null check (channel in ('whatsapp', 'voice')),
  author              text not null check (author in ('agent', 'staff', 'patient')),
  staff_user          uuid references auth.users(id),
  body                text not null check (length(body) between 1 and 4000),
  template_code       text,
  intent              text,
  status              text not null default 'logged'
                      check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received', 'logged')),
  provider            text,
  provider_message_id text unique,
  error               text,
  media_id            text,                 -- provider media reference for voice notes / images (fetched by staff tools)
  processed_at        timestamptz,          -- inbound only: when the assistant (or a person) took it in hand
  created_at          timestamptz not null default now()
);
create index on public.care_messages (journey_id, created_at);
create index care_messages_unprocessed on public.care_messages (created_at) where direction = 'in' and processed_at is null;
create index on public.care_messages (phone, created_at desc);

create table public.care_escalations (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default app.next_ref('CE'),
  branch_id       uuid not null references public.branches(id),
  patient_id      uuid references public.patients(id),          -- null when the number matches no patient or several
  phone           text,
  journey_id      uuid references public.care_journeys(id),
  doctor_id       uuid references public.staff(id),
  severity        text not null check (severity in ('urgent', 'high', 'normal', 'low')),
  category        text not null check (category in ('clinical', 'medication', 'complaint', 'booking', 'other')),
  summary         text not null check (length(summary) between 2 and 300),
  patient_text    text check (patient_text is null or length(patient_text) <= 2000),
  status          text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  due_at          timestamptz not null,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz,
  resolution      text,
  created_at      timestamptz not null default now(),
  check (patient_id is not null or phone is not null)
);
create index on public.care_escalations (status, severity, due_at);
create trigger trg_audit_care_escalations after insert or update on public.care_escalations for each row execute function app.audit_row();

-- Messages are a record of what was said: text never changes; only delivery fields move.
create or replace function app.care_messages_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'care messages cannot be deleted' using errcode = '42501'; end if;
  if new.body is distinct from old.body or new.direction is distinct from old.direction or new.phone is distinct from old.phone
     or new.author is distinct from old.author or new.journey_id is distinct from old.journey_id then
    raise exception 'care messages cannot be edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_care_messages_guard before update or delete on public.care_messages for each row execute function app.care_messages_guard();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.care_refused(p_patient uuid)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  return exists (select 1 from public.patient_consent_current c
                 where c.patient_id = p_patient and c.kind::text in ('whatsapp_messages', 'care_followup') and not c.granted)
      or exists (select 1 from public.patients p where p.id = p_patient and (p.preferred_channel = 'none' or p.merged_into is not null or p.is_archived));
end $$;

create or replace function app.care_on(p_branch uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((select enabled and case p_kind when 'booking_confirm' then booking_confirm when 'pre_visit' then pre_visit
                                                   when 'post_visit' then post_visit when 'followup' then followup else false end
                   from public.care_agent_settings where branch_id = p_branch), false)
$$;

-- Patients reachable on a number (main or alternative phone). Several = a shared family phone.
create or replace function app.care_patients_on(p_phone text)
returns uuid[] language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(id order by created_at), '{}') from public.patients
  where (phone = p_phone or phone_alt = p_phone) and merged_into is null and not is_archived
$$;

create or replace function app.care_in_hours(p_branch uuid, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((select (p_now at time zone 'Africa/Cairo')::time between contact_from and contact_to
                   from public.care_agent_settings where branch_id = p_branch), false)
$$;

create or replace function app.cancel_hours()
returns int language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((select nullif(value_en, '')::int from public.site_settings where key = 'policy.cancel_hours'), 24)
$$;

-- The doctor most recently treating the patient (for escalations raised outside a conversation).
create or replace function app.care_recent_doctor(p_patient uuid)
returns uuid language sql stable security definer set search_path = public, app, pg_temp as $$
  select doctor_id from public.encounters where patient_id = p_patient and created_at > now() - interval '60 days'
  order by created_at desc limit 1
$$;

create or replace function app.can_read_care(p_branch uuid, p_doctor uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('care.read', p_branch)
      or (p_doctor is not null and p_doctor = app.current_staff_id())
$$;

create or replace function app.care_due_minutes(p_severity text)
returns interval language sql immutable as $$
  select case p_severity when 'urgent' then interval '15 minutes' when 'high' then interval '2 hours'
                         when 'normal' then interval '24 hours' else interval '72 hours' end
$$;

-- Everything the conversation logic needs about one journey (minimum necessary: first name, doctor, times).
create or replace function app.care_context(p_journey uuid)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'id', j.id, 'ref', j.ref, 'kind', j.kind, 'channel', j.channel, 'lang', j.lang, 'status', j.status, 'state', j.state,
    'data', j.data, 'version', j.version, 'nudges', j.nudges, 'attempts', j.attempts, 'phone', j.to_phone,
    'patient_id', j.patient_id, 'branch_id', j.branch_id,
    'name', p.first_name_ar, 'name_en', coalesce(p.first_name_en, p.first_name_ar),
    'doctor', d.full_name_ar, 'doctor_en', coalesce(d.full_name_en, d.full_name_ar),
    'date', to_char(lower(a.slot) at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
    'time', to_char(lower(a.slot) at time zone 'Africa/Cairo', 'HH24:MI'),
    'appointment_status', a.status,
    'has_rx', exists (select 1 from public.prescriptions rx where rx.encounter_id = j.encounter_id and rx.status = 'signed'),
    'followup_due', coalesce(f.due_on, (select f2.due_on from public.care_followup_requests f2
                                         where f2.encounter_id = j.encounter_id and f2.status = 'open')),
    'clinic_phone', s.clinic_phone, 'voice_enabled', coalesce(s.voice_enabled, false), 'voice_fallback', coalesce(s.voice_fallback, false),
    'nudge_after_hours', coalesce(s.nudge_after_hours, 4), 'max_nudges', coalesce(s.max_nudges, 1),
    'last_inbound_at', j.last_inbound_at,
    'in_hours', app.care_in_hours(j.branch_id),
    'appointment_day', to_char(lower(a.slot) at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
    'cancel_allowed', coalesce(lower(a.slot) > now() + make_interval(hours => app.cancel_hours()), false))
  from public.care_journeys j
  join public.patients p on p.id = j.patient_id
  left join public.staff d on d.id = j.doctor_id
  left join public.appointments a on a.id = j.appointment_id
  left join public.care_followup_requests f on f.id = j.followup_id
  left join public.care_agent_settings s on s.branch_id = j.branch_id
  where j.id = p_journey
$$;

-- ---------------------------------------------------------------------------
-- Staff RPCs
-- ---------------------------------------------------------------------------
create or replace function public.save_care_settings(p_branch uuid, p jsonb)
returns public.care_agent_settings language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.care_agent_settings;
begin
  perform app.require_permission('care.settings', p_branch);
  insert into public.care_agent_settings (branch_id) values (p_branch) on conflict (branch_id) do nothing;
  update public.care_agent_settings set
    enabled                = coalesce((p->>'enabled')::boolean, enabled),
    booking_confirm        = coalesce((p->>'booking_confirm')::boolean, booking_confirm),
    pre_visit              = coalesce((p->>'pre_visit')::boolean, pre_visit),
    post_visit             = coalesce((p->>'post_visit')::boolean, post_visit),
    followup               = coalesce((p->>'followup')::boolean, followup),
    voice_enabled          = coalesce((p->>'voice_enabled')::boolean, voice_enabled),
    voice_fallback         = coalesce((p->>'voice_fallback')::boolean, voice_fallback),
    contact_from           = coalesce(nullif(p->>'contact_from', '')::time, contact_from),
    contact_to             = coalesce(nullif(p->>'contact_to', '')::time, contact_to),
    confirm_delay_min      = coalesce(nullif(p->>'confirm_delay_min', '')::int, confirm_delay_min),
    confirm_min_lead_hours = coalesce(nullif(p->>'confirm_min_lead_hours', '')::int, confirm_min_lead_hours),
    post_visit_delay_hours = coalesce(nullif(p->>'post_visit_delay_hours', '')::int, post_visit_delay_hours),
    followup_lead_days     = coalesce(nullif(p->>'followup_lead_days', '')::int, followup_lead_days),
    nudge_after_hours      = coalesce(nullif(p->>'nudge_after_hours', '')::int, nudge_after_hours),
    max_nudges             = coalesce(nullif(p->>'max_nudges', '')::int, max_nudges),
    clinic_phone           = case when p ? 'clinic_phone' then nullif(trim(p->>'clinic_phone'), '') else clinic_phone end,
    oncall_phone           = case when p ? 'oncall_phone' then coalesce(app.normalize_phone(nullif(trim(p->>'oncall_phone'), '')), nullif(trim(p->>'oncall_phone'), '')) else oncall_phone end,
    updated_by = auth.uid(), updated_at = now()
  where branch_id = p_branch returning * into r;
  return r;
end $$;

-- The doctor asks for a follow-up consultation (after signing is fine: it is not part of the signed note).
create or replace function public.set_care_followup(p_encounter uuid, p_due_on date, p_note text default null)
returns public.care_followup_requests language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.encounters; r public.care_followup_requests;
begin
  select * into e from public.encounters where id = p_encounter;
  if not found then raise exception 'encounter not found' using errcode = 'P0002'; end if;
  if e.doctor_id is distinct from app.current_staff_id() and not app.has_permission('care.manage', e.branch_id) then
    raise exception 'permission denied: only the treating doctor sets the follow-up' using errcode = '42501';
  end if;
  if e.status = 'entered_in_error' then raise exception 'encounter was entered in error' using errcode = '22023'; end if;
  if p_due_on is null or p_due_on <= (now() at time zone 'Africa/Cairo')::date or p_due_on > (now() at time zone 'Africa/Cairo')::date + 365 then
    raise exception 'follow-up date must be between tomorrow and one year ahead' using errcode = '22023';
  end if;
  insert into public.care_followup_requests (encounter_id, patient_id, branch_id, doctor_id, due_on, note)
  values (e.id, e.patient_id, e.branch_id, e.doctor_id, p_due_on, nullif(trim(p_note), ''))
  on conflict (encounter_id) do update set due_on = excluded.due_on, note = excluded.note, status = 'open', cancel_reason = null, updated_at = now()
  returning * into r;
  -- A reminder not yet sent is re-planned for the new date.
  update public.care_journeys set status = 'cancelled', outcome = 'date_changed', closed_at = now(), updated_at = now(), version = version + 1
  where followup_id = r.id and status = 'scheduled';
  return r;
end $$;

create or replace function public.cancel_care_followup(p_encounter uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.care_followup_requests;
begin
  select * into r from public.care_followup_requests where encounter_id = p_encounter for update;
  if not found then raise exception 'follow-up not found' using errcode = 'P0002'; end if;
  if r.doctor_id is distinct from app.current_staff_id() and not app.has_permission('care.manage', r.branch_id) then
    raise exception 'permission denied: only the treating doctor sets the follow-up' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.care_followup_requests set status = 'cancelled', cancel_reason = trim(p_reason), updated_at = now() where id = r.id;
  update public.care_journeys set status = 'cancelled', outcome = 'followup_cancelled', closed_at = now(), updated_at = now(), version = version + 1
  where followup_id = r.id and status in ('scheduled', 'waiting');
end $$;

create or replace function app.care_lock_for_staff(p_journey uuid)
returns public.care_journeys language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys;
begin
  select * into j from public.care_journeys where id = p_journey for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if not app.has_permission('care.manage', j.branch_id) then raise exception 'permission denied: care.manage' using errcode = '42501'; end if;
  return j;
end $$;

-- Staff take over: the assistant stops answering this conversation.
create or replace function public.care_take_over(p_journey uuid)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys;
begin
  j := app.care_lock_for_staff(p_journey);
  if j.status not in ('scheduled', 'waiting', 'human') then raise exception 'conversation is already closed' using errcode = '22023'; end if;
  update public.care_journeys set status = 'human', lease_until = null, next_action_at = null, updated_at = now(), version = version + 1 where id = j.id;
end $$;

create or replace function public.care_resume(p_journey uuid)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys;
begin
  j := app.care_lock_for_staff(p_journey);
  if j.status <> 'human' then raise exception 'only a conversation handled by staff can be handed back' using errcode = '22023'; end if;
  update public.care_journeys set status = case when j.opened_at is null then 'scheduled' else 'waiting' end::public.care_status,
    next_action_at = case when j.opened_at is null then null else now() + interval '4 hours' end, updated_at = now(), version = version + 1
  where id = j.id;
end $$;

create or replace function public.care_close(p_journey uuid, p_note text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys;
begin
  j := app.care_lock_for_staff(p_journey);
  if j.status not in ('scheduled', 'waiting', 'human') then raise exception 'conversation is already closed' using errcode = '22023'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a note is required to close' using errcode = '22023'; end if;
  update public.care_journeys set status = 'completed', outcome = coalesce(outcome, 'closed_by_staff'),
    data = data || jsonb_build_object('staff_note', left(trim(p_note), 500)), closed_at = now(), lease_until = null, next_action_at = null,
    updated_at = now(), version = version + 1
  where id = j.id;
end $$;

-- A staff reply inside WhatsApp's 24-hour customer-service window. The server sends it, then records the result.
create or replace function public.care_staff_message(p_journey uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys; v_id uuid;
begin
  j := app.care_lock_for_staff(p_journey);
  if coalesce(trim(p_body), '') = '' then raise exception 'message text is required' using errcode = '22023'; end if;
  if j.channel <> 'whatsapp' then raise exception 'this conversation is a phone call; call the patient instead' using errcode = '22023'; end if;
  if exists (select 1 from public.patient_consent_current c where c.patient_id = j.patient_id and c.kind = 'whatsapp_messages' and not c.granted) then
    raise exception 'the patient refused WhatsApp messages; call instead' using errcode = '22023';
  end if;
  if j.last_inbound_at is null or j.last_inbound_at < now() - interval '24 hours' then
    raise exception 'outside the 24-hour WhatsApp window; call the patient instead' using errcode = '22023';
  end if;
  insert into public.care_messages (journey_id, patient_id, branch_id, phone, direction, channel, author, staff_user, body, status)
  values (j.id, j.patient_id, j.branch_id, j.to_phone, 'out', 'whatsapp', 'staff', auth.uid(), left(trim(p_body), 4000), 'queued')
  returning id into v_id;
  if j.status in ('scheduled', 'waiting') then
    update public.care_journeys set status = 'human', next_action_at = null, lease_until = null, updated_at = now(), version = version + 1 where id = j.id;
  end if;
  return jsonb_build_object('id', v_id, 'phone', j.to_phone, 'lang', j.lang);
end $$;

create or replace function public.care_message_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  update public.care_messages set status = case when p_ok then 'sent' else 'failed' end, provider = p_provider,
    provider_message_id = coalesce(p_provider_id, provider_message_id), error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and staff_user = auth.uid() and status = 'queued';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.care_escalation_update(p_id uuid, p_action text, p_note text default null)
returns public.care_escalations language plpgsql security definer set search_path = public, app, pg_temp as $$
declare e public.care_escalations;
begin
  select * into e from public.care_escalations where id = p_id for update;
  if not found then raise exception 'escalation not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('care.manage', e.branch_id) or (e.doctor_id is not null and e.doctor_id = app.current_staff_id())) then
    raise exception 'permission denied: care.manage' using errcode = '42501';
  end if;
  if e.status = 'resolved' then raise exception 'escalation is already resolved' using errcode = '22023'; end if;
  if p_action = 'acknowledge' then
    if e.status <> 'open' then raise exception 'escalation is already acknowledged' using errcode = '22023'; end if;
    update public.care_escalations set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now() where id = e.id returning * into e;
  elsif p_action = 'resolve' then
    if coalesce(trim(p_note), '') = '' then raise exception 'a resolution note is required' using errcode = '22023'; end if;
    update public.care_escalations set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = left(trim(p_note), 1000),
      acknowledged_by = coalesce(acknowledged_by, auth.uid()), acknowledged_at = coalesce(acknowledged_at, now())
    where id = e.id returning * into e;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  return e;
end $$;

-- Outcome figures for a branch and period (no patient-level data).
create or replace function public.care_kpis(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v jsonb;
begin
  if not (app.has_permission('care.read', p_branch) or app.has_permission('care.settings', p_branch) or app.has_permission('dashboard.executive', p_branch)) then
    raise exception 'permission denied: care.read' using errcode = '42501';
  end if;
  with j as (
    select * from public.care_journeys
    where branch_id = p_branch and opened_at is not null
      and (opened_at at time zone 'Africa/Cairo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'opened', (select count(*) from j),
    'replied', (select count(*) from j where last_inbound_at is not null),
    'booking_total', (select count(*) from j where kind in ('booking_confirm', 'pre_visit')),
    'confirmed', (select count(*) from j where outcome = 'confirmed'),
    'cancelled', (select count(*) from j where outcome = 'cancelled'),
    'reschedule', (select count(*) from j where outcome = 'reschedule_requested'),
    'post_visit', (select count(*) from j where kind = 'post_visit'),
    'meds_answered', (select count(*) from j where kind = 'post_visit' and data ? 'meds'),
    'meds_yes', (select count(*) from j where kind = 'post_visit' and data->>'meds' = 'yes'),
    'better', (select count(*) from j where data->>'improve' = 'better'),
    'same', (select count(*) from j where data->>'improve' = 'same'),
    'worse', (select count(*) from j where data->>'improve' = 'worse'),
    'avg_rating', (select round(avg((data->>'rating')::numeric), 2) from j where data ? 'rating'),
    'followup_total', (select count(*) from j where kind = 'followup'),
    'followup_booking', (select count(*) from j where kind = 'followup' and outcome = 'booking_requested'),
    'no_response', (select count(*) from j where status = 'no_response'),
    'opted_out', (select count(*) from j where status = 'opted_out'),
    'escalations', (select count(*) from public.care_escalations e where e.branch_id = p_branch
                     and (e.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'urgent', (select count(*) from public.care_escalations e where e.branch_id = p_branch and e.severity = 'urgent'
                and (e.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'late_escalations', (select count(*) from public.care_escalations e where e.branch_id = p_branch
                          and (e.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
                          and coalesce(e.acknowledged_at, now()) > e.due_at)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Service primitives (server code with the service key only)
-- ---------------------------------------------------------------------------

-- Creates the journeys that are due. Idempotent: unique indexes stop duplicates.
create or replace function app.care_enqueue(p_now timestamptz default now())
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s record; n int := 0; c int; v_today date := (p_now at time zone 'Africa/Cairo')::date;
begin
  for s in select * from public.care_agent_settings where enabled loop
    if s.booking_confirm then
      insert into public.care_journeys (branch_id, patient_id, kind, appointment_id, doctor_id, to_phone, channel, scheduled_at)
      select a.branch_id, a.patient_id, 'booking_confirm', a.id, a.doctor_id, p.phone,
             case when p.preferred_channel = 'call' and s.voice_enabled then 'voice' else 'whatsapp' end, p_now
      from public.appointments a join public.patients p on p.id = a.patient_id
      where a.branch_id = s.branch_id and a.status in ('booked', 'pending_confirmation')
        and a.created_at <= p_now - make_interval(mins => s.confirm_delay_min) and a.created_at > p_now - interval '2 days'
        and lower(a.slot) > p_now + make_interval(hours => s.confirm_min_lead_hours)
        and not app.care_refused(a.patient_id)
        and not exists (select 1 from public.care_journeys j where j.appointment_id = a.id and j.kind = 'booking_confirm')
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    end if;
    if s.pre_visit then
      insert into public.care_journeys (branch_id, patient_id, kind, appointment_id, doctor_id, to_phone, channel, scheduled_at)
      select a.branch_id, a.patient_id, 'pre_visit', a.id, a.doctor_id, p.phone,
             case when p.preferred_channel = 'call' and s.voice_enabled then 'voice' else 'whatsapp' end, p_now
      from public.appointments a join public.patients p on p.id = a.patient_id
      where a.branch_id = s.branch_id and a.status in ('booked', 'pending_confirmation', 'confirmed')
        and lower(a.slot) between p_now + interval '20 hours' and p_now + interval '28 hours'
        and not app.care_refused(a.patient_id)
        and not exists (select 1 from public.care_journeys j where j.appointment_id = a.id and j.kind = 'pre_visit')
        and not exists (select 1 from public.care_journeys j where j.appointment_id = a.id and j.kind = 'booking_confirm'
                        and j.created_at > p_now - interval '12 hours')
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    end if;
    if s.post_visit then
      insert into public.care_journeys (branch_id, patient_id, kind, appointment_id, encounter_id, doctor_id, to_phone, channel, scheduled_at)
      select e.branch_id, e.patient_id, 'post_visit', e.appointment_id, e.id, e.doctor_id, p.phone,
             case when p.preferred_channel = 'call' and s.voice_enabled then 'voice' else 'whatsapp' end, p_now
      from public.encounters e join public.patients p on p.id = e.patient_id
      where e.branch_id = s.branch_id and e.status = 'signed'
        and e.signed_at <= p_now - make_interval(hours => s.post_visit_delay_hours) and e.signed_at > p_now - interval '3 days'
        and not app.care_refused(e.patient_id)
        and not exists (select 1 from public.care_journeys j where j.encounter_id = e.id and j.kind = 'post_visit')
        and not exists (select 1 from public.care_journeys j where j.patient_id = e.patient_id and j.kind = 'post_visit'
                        and j.created_at > p_now - interval '2 days')
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    end if;
    if s.followup then
      insert into public.care_journeys (branch_id, patient_id, kind, encounter_id, followup_id, doctor_id, to_phone, channel, scheduled_at)
      select f.branch_id, f.patient_id, 'followup', f.encounter_id, f.id, f.doctor_id, p.phone,
             case when p.preferred_channel = 'call' and s.voice_enabled then 'voice' else 'whatsapp' end, p_now
      from public.care_followup_requests f join public.patients p on p.id = f.patient_id
      where f.branch_id = s.branch_id and f.status = 'open'
        and f.due_on - s.followup_lead_days <= v_today and f.due_on >= v_today
        and not app.care_refused(f.patient_id)
        and not exists (select 1 from public.care_journeys j where j.followup_id = f.id and j.status <> 'cancelled')
        and not exists (select 1 from public.appointments a where a.patient_id = f.patient_id and a.doctor_id = f.doctor_id
                        and a.status not in ('canceled', 'no_show') and lower(a.slot) >= p_now)
      on conflict do nothing;
      get diagnostics c = row_count; n := n + c;
    end if;
  end loop;
  return n;
end $$;

-- Why an unopened journey is no longer needed (null = still needed).
create or replace function app.care_not_needed(j public.care_journeys, p_now timestamptz)
returns text language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare a public.appointments; f public.care_followup_requests;
begin
  if app.care_refused(j.patient_id) then return 'opted_out'; end if;
  if j.kind in ('booking_confirm', 'pre_visit') then
    select * into a from public.appointments where id = j.appointment_id;
    if a.status not in ('booked', 'pending_confirmation', 'confirmed') then return 'appointment_changed'; end if;
    if lower(a.slot) <= p_now + interval '1 hour' then return 'too_late'; end if;
    -- A "tomorrow" reminder must not go out on the day itself.
    if j.kind = 'pre_visit' and (lower(a.slot) at time zone 'Africa/Cairo')::date <= (p_now at time zone 'Africa/Cairo')::date then return 'too_late'; end if;
    if j.kind = 'booking_confirm' and a.status = 'confirmed' and j.status = 'scheduled' then return 'already_confirmed'; end if;
  elsif j.kind = 'followup' then
    select * into f from public.care_followup_requests where id = j.followup_id;
    if f.status <> 'open' then return 'followup_cancelled'; end if;
    if f.due_on < (p_now at time zone 'Africa/Cairo')::date then return 'expired'; end if;
    if exists (select 1 from public.appointments x where x.patient_id = j.patient_id and x.doctor_id = f.doctor_id
               and x.status not in ('canceled', 'no_show') and lower(x.slot) >= p_now) then return 'already_booked'; end if;
  end if;
  return null;
end $$;

-- Claims journeys to open or to nudge, inside the branch's contact hours. One open conversation per phone.
-- Claims journeys to open or to nudge, inside the branch's contact hours. One conversation per phone at a time:
-- a phone with a conversation waiting, with staff, leased by another run, or already picked in this batch is skipped.
create or replace function app.care_claim(p_limit int default 20, p_now timestamptz default now())
returns setof jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys; v_why text; v_phones text[] := '{}'; v_phone text;
begin
  for j in
    select cj.* from public.care_journeys cj join public.care_agent_settings s on s.branch_id = cj.branch_id
    where s.enabled and (cj.lease_until is null or cj.lease_until < p_now)
      and ((cj.status = 'scheduled' and cj.scheduled_at <= p_now) or (cj.status = 'waiting' and cj.next_action_at <= p_now))
      and (p_now at time zone 'Africa/Cairo')::time between s.contact_from and s.contact_to
    order by coalesce(cj.next_action_at, cj.scheduled_at)
    limit p_limit
    for update of cj skip locked
  loop
    v_why := app.care_not_needed(j, p_now);
    if v_why is not null and not (j.status = 'waiting' and v_why = 'already_confirmed') then
      update public.care_journeys set status = 'cancelled', outcome = v_why, closed_at = p_now, next_action_at = null, lease_until = null,
        updated_at = now(), version = version + 1 where id = j.id;
      -- The plain confirmation still goes out when the assistant could not do it in time.
      if j.kind = 'booking_confirm' and v_why = 'too_late' and j.status = 'scheduled' then
        perform app.enqueue_message('appointment_confirmed', j.patient_id, j.appointment_id, '{}'::jsonb, 'apt-confirmed-' || j.appointment_id);
      end if;
      continue;
    end if;
    if j.status = 'scheduled' then
      v_phone := coalesce((select phone from public.patients where id = j.patient_id), j.to_phone);   -- the number may have changed
      if v_phone = any(v_phones) or exists (select 1 from public.care_journeys o where o.to_phone = v_phone and o.id <> j.id
             and (o.status in ('waiting', 'human') or o.lease_until > p_now)) then
        update public.care_journeys set scheduled_at = p_now + interval '2 hours', updated_at = now() where id = j.id;
        continue;
      end if;
      update public.care_journeys set to_phone = v_phone where id = j.id and to_phone <> v_phone;
      v_phones := v_phones || v_phone;
    end if;
    update public.care_journeys set lease_until = p_now + interval '2 minutes' where id = j.id;
    return next app.care_context(j.id);
  end loop;
end $$;

-- Applies one conversation step atomically. p: {state, status, data, outcome, next_action_at, scheduled_at, opened,
-- nudged, channel, inbound_message_id, intent, messages:[{body, template_code}], actions:[...]}
-- Applies one conversation step atomically. p: {state, status, data, outcome, next_action_at, scheduled_at, opened,
-- nudged, channel, inbound_message_id, intent, messages:[{body, template_code}], actions:[...]}
create or replace function app.care_apply(p_journey uuid, p_version int, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys; a public.appointments; m jsonb; act jsonb; v_ids jsonb := '[]'::jsonb; v_id uuid;
        v_status public.care_status; v_channel text; v_refs jsonb := '[]'::jsonb; v_ref text;
begin
  select * into j from public.care_journeys where id = p_journey for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if j.version <> p_version then raise exception 'version conflict' using errcode = '40001'; end if;
  v_status := coalesce(nullif(p->>'status', ''), j.status::text)::public.care_status;
  v_channel := coalesce(nullif(p->>'channel', ''), j.channel);
  perform set_config('app.care_rpc', 'on', true);

  for act in select * from jsonb_array_elements(coalesce(p->'actions', '[]'::jsonb)) loop
    case act->>'type'
    when 'confirm_appointment' then
      select * into a from public.appointments where id = j.appointment_id for update;
      if found and a.status in ('booked', 'pending_confirmation') then
        update public.appointments set status = 'confirmed' where id = a.id;
      end if;
    when 'cancel_appointment' then
      select * into a from public.appointments where id = j.appointment_id for update;
      if found and a.status in ('booked', 'pending_confirmation', 'confirmed') then
        if lower(a.slot) > now() + make_interval(hours => app.cancel_hours()) then
          update public.appointments set status = 'canceled', cancel_reason = 'ألغاه المريض عبر مساعد جولدن كير / cancelled by the patient via the care assistant'
          where id = a.id;
        else
          -- Inside the cancellation window: a person decides (same rule as online cancellation).
          insert into public.support_tickets (branch_id, patient_id, kind, subject, channel, priority, due_at)
          values (j.branch_id, j.patient_id, 'reschedule', 'طلب إلغاء داخل مهلة الإلغاء / Cancellation request inside the cancellation window',
                  'care_assistant', 'high', now() + interval '2 hours')
          returning ref into v_ref;
          v_refs := v_refs || to_jsonb(v_ref);
        end if;
      end if;
    when 'ticket' then
      if (select count(*) from public.support_tickets t where t.patient_id = j.patient_id and t.created_at > now() - interval '24 hours'
          and t.channel = 'care_assistant') < 6 then
        insert into public.support_tickets (branch_id, patient_id, kind, subject, body, channel, priority, due_at)
        values (j.branch_id, j.patient_id, (act->>'kind')::public.ticket_kind, left(act->>'subject', 200), left(nullif(act->>'body', ''), 2000),
                'care_assistant', coalesce(nullif(act->>'priority', ''), 'normal'),
                now() + case when act->>'priority' = 'high' then interval '2 hours' else interval '4 hours' end)
        returning ref into v_ref;
        v_refs := v_refs || to_jsonb(v_ref);
      end if;
    when 'escalate' then
      insert into public.care_escalations (branch_id, patient_id, phone, journey_id, doctor_id, severity, category, summary, patient_text, due_at)
      values (j.branch_id, j.patient_id, j.to_phone, j.id, j.doctor_id, act->>'severity', act->>'category', left(act->>'summary', 300),
              left(nullif(act->>'patient_text', ''), 2000), now() + app.care_due_minutes(act->>'severity'))
      returning ref into v_ref;
      v_refs := v_refs || to_jsonb(v_ref);
      if act->>'severity' = 'urgent' then
        update public.care_journeys set status = 'human', next_action_at = null, lease_until = null, updated_at = now(), version = version + 1
        where patient_id = j.patient_id and id <> j.id and status in ('scheduled', 'waiting');
      end if;
    when 'survey' then
      if j.appointment_id is not null and (act->>'score')::int between 1 and 5 then
        insert into public.satisfaction_surveys (appointment_id, patient_id, score, comment)
        values (j.appointment_id, j.patient_id, (act->>'score')::int, left(nullif(act->>'comment', ''), 1000))
        on conflict (appointment_id) do nothing;
      end if;
    when 'opt_out' then
      perform app.care_opt_out_patients(array[j.patient_id] || app.care_patients_on(j.to_phone), j.id);
    else
      raise exception 'unknown care action %', act->>'type' using errcode = '22023';
    end case;
  end loop;

  if p ? 'inbound_message_id' then
    update public.care_messages set intent = left(p->>'intent', 40), processed_at = coalesce(processed_at, now())
    where id = (p->>'inbound_message_id')::uuid and journey_id = j.id;
  end if;

  for m in select * from jsonb_array_elements(coalesce(p->'messages', '[]'::jsonb)) loop
    insert into public.care_messages (journey_id, patient_id, branch_id, phone, direction, channel, author, body, template_code, status)
    values (j.id, j.patient_id, j.branch_id, j.to_phone, 'out', v_channel, 'agent', left(m->>'body', 4000), nullif(m->>'template_code', ''),
            case when v_channel = 'voice' then 'logged' else 'queued' end)
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  update public.care_journeys set
    state = coalesce(nullif(p->>'state', ''), state),
    status = v_status,
    channel = v_channel,
    data = case when p ? 'data' then p->'data' else data end,
    outcome = coalesce(nullif(p->>'outcome', ''), outcome),
    next_action_at = case when v_status = 'waiting' then nullif(p->>'next_action_at', '')::timestamptz else null end,
    scheduled_at = coalesce(nullif(p->>'scheduled_at', '')::timestamptz, scheduled_at),
    opened_at = case when coalesce((p->>'opened')::boolean, false) then coalesce(opened_at, now()) else opened_at end,
    nudges = nudges + case when coalesce((p->>'nudged')::boolean, false) then 1 else 0 end,
    closed_at = case when v_status in ('completed', 'no_response', 'cancelled', 'failed', 'opted_out') then coalesce(closed_at, now()) else null end,
    lease_until = null, version = version + 1, updated_at = now()
  where id = j.id;
  return jsonb_build_object('message_ids', v_ids, 'refs', v_refs, 'version', j.version + 1);
end $$;

-- Opt-out: recorded for every patient on the number (the number's owner said stop), all their planned and open
-- conversations closed. Transactional confirmations/reminders still follow the WhatsApp consent.
create or replace function app.care_opt_out_patients(p_patients uuid[], p_except uuid default null)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v uuid; n int := 0;
begin
  foreach v in array coalesce((select array_agg(distinct x) from unnest(p_patients) x where x is not null), '{}') loop
    if not exists (select 1 from public.patient_consent_current c where c.patient_id = v and c.kind::text = 'care_followup' and not c.granted) then
      insert into public.patient_consents (patient_id, kind, granted, document_code, captured_by)
      values (v, 'care_followup', false, 'care_assistant_opt_out', null);
      n := n + 1;
    end if;
    update public.care_journeys set status = 'opted_out', outcome = 'opted_out', closed_at = now(), next_action_at = null, lease_until = null,
      updated_at = now(), version = version + 1
    where patient_id = v and status in ('scheduled', 'waiting', 'human') and id is distinct from p_except;
  end loop;
  return n;
end $$;

-- An incoming patient message (WhatsApp text/button or a voice-call turn). Duplicate deliveries are ignored.
-- An incoming patient message (WhatsApp text/button/media or a voice-call turn). Duplicate deliveries are ignored.
-- Danger signs (detected by the caller before anything else) are escalated here, in the same transaction that stores
-- the message, so they cannot be lost: the escalation goes to the treating doctor and the care team, and every open
-- or planned conversation of that patient is paused for a person to take over.
create or replace function app.care_inbound(p_phone text, p_provider_id text, p_text text, p_channel text, p_journey uuid default null,
                                            p_urgent boolean default false, p_media_id text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_phone text := coalesce(app.normalize_phone(p_phone), p_phone); j public.care_journeys; v_pats uuid[]; v_pat uuid; v_branch uuid;
        v_id uuid; v_recent boolean; v_ref text; v_doctor uuid;
begin
  if p_provider_id is not null and exists (select 1 from public.care_messages where provider_message_id = p_provider_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  if p_journey is not null then
    select * into j from public.care_journeys where id = p_journey for update;
  else
    select * into j from public.care_journeys where to_phone = v_phone and status in ('waiting', 'human')
    order by opened_at desc nulls last limit 1 for update;
  end if;
  v_pats := app.care_patients_on(v_phone);
  if j.id is not null then
    v_pat := j.patient_id; v_branch := j.branch_id; v_doctor := j.doctor_id;
    update public.care_journeys set last_inbound_at = now(), updated_at = now() where id = j.id;
  else
    if cardinality(v_pats) = 1 then v_pat := v_pats[1]; end if;   -- a shared number is never attributed automatically
    select coalesce((select branch_id from public.patients where id = v_pat),
                    (select branch_id from public.patients where id = v_pats[1]),
                    (select id from public.branches where is_active order by created_at limit 1)) into v_branch;
    v_doctor := case when v_pat is null then null else app.care_recent_doctor(v_pat) end;
    v_recent := exists (select 1 from public.care_journeys where to_phone = v_phone and closed_at > now() - interval '30 minutes');
  end if;
  insert into public.care_messages (journey_id, patient_id, branch_id, phone, direction, channel, author, body, status, provider, provider_message_id, media_id)
  values (j.id, v_pat, v_branch, v_phone, 'in', p_channel, 'patient', left(coalesce(nullif(trim(p_text), ''), '…'), 4000), 'received',
          case when p_provider_id is null then null else p_channel end, p_provider_id, p_media_id)
  returning id into v_id;

  if p_urgent then
    insert into public.care_escalations (branch_id, patient_id, phone, journey_id, doctor_id, severity, category, summary, patient_text, due_at)
    values (v_branch, v_pat, v_phone, j.id, v_doctor, 'urgent', 'clinical',
            case when v_pat is null and cardinality(v_pats) > 1 then 'علامات خطر من رقم مشترك بين أكثر من مريض — حدد المريض واتصل فورًا / Danger signs from a shared number — identify the patient and call now'
                 when v_pat is null then 'علامات خطر من رقم غير مسجل — اتصل فورًا / Danger signs from an unregistered number — call now'
                 else 'علامات خطر في رسالة المريض — اتصل فورًا / Danger signs in the patient''s message — call now' end,
            left(p_text, 2000), now() + app.care_due_minutes('urgent'))
    returning ref into v_ref;
    update public.care_journeys set status = 'human', next_action_at = null, lease_until = null, outcome = coalesce(outcome, 'urgent'),
      updated_at = now(), version = version + 1
    where status in ('scheduled', 'waiting') and (id = j.id or patient_id = any(case when v_pat is null then v_pats else array[v_pat] end));
    update public.care_messages set processed_at = now(), intent = 'urgent' where id = v_id;
  end if;

  return jsonb_build_object('message_id', v_id, 'patient_id', v_pat, 'patients', cardinality(v_pats), 'branch_id', v_branch, 'phone', v_phone,
                            'recently_closed', coalesce(v_recent, false), 'urgent_ref', v_ref, 'in_hours', app.care_in_hours(v_branch),
                            'journey', case when j.id is null then null else app.care_context(j.id) end);
end $$;

-- Marks an inbound message as taken in hand (staff conversation, media ticket, ...).
create or replace function app.care_mark_processed(p_message uuid)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.care_messages set processed_at = coalesce(processed_at, now()) where id = p_message and direction = 'in'
$$;

-- Something a person must look at (voice note, image, a message the assistant could not process): a callback
-- ticket for a known patient, otherwise an escalation carrying the phone number.
create or replace function app.care_handoff_message(p_message uuid, p_subject text)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; v_ref text;
begin
  select * into m from public.care_messages where id = p_message and direction = 'in';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  if m.processed_at is not null then return jsonb_build_object('action', 'none'); end if;
  if m.patient_id is not null then
    insert into public.support_tickets (branch_id, patient_id, kind, subject, body, channel, priority, due_at)
    values (m.branch_id, m.patient_id, 'callback', left(p_subject, 200), left(m.body, 2000), 'care_assistant', 'high', now() + interval '2 hours')
    returning ref into v_ref;
  else
    insert into public.care_escalations (branch_id, phone, journey_id, severity, category, summary, patient_text, due_at)
    values (m.branch_id, m.phone, m.journey_id, 'high', 'other', left(p_subject, 300), left(m.body, 2000), now() + app.care_due_minutes('high'))
    returning ref into v_ref;
  end if;
  update public.care_messages set processed_at = now() where id = m.id;
  return jsonb_build_object('action', case when m.patient_id is null then 'escalation' else 'ticket' end, 'ref', v_ref);
end $$;

-- Safety net: inbound messages nobody processed (a crash between storing and answering) go to a person.
create or replace function app.care_sweep(p_now timestamptz default now())
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select id from public.care_messages where direction = 'in' and processed_at is null and created_at < p_now - interval '2 minutes'
           order by created_at limit 50 for update skip locked loop
    perform app.care_handoff_message(r.id, 'رسالة من المريض لم يعالجها المساعد — يرجى الرد / Patient message the assistant did not process — please reply');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Opt-out sent outside a conversation (or while staff handle it): applied to everyone on the number.
create or replace function app.care_opt_out_message(p_message uuid)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; n int;
begin
  select * into m from public.care_messages where id = p_message and direction = 'in';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  n := app.care_opt_out_patients(app.care_patients_on(m.phone) || coalesce(m.patient_id, null::uuid));
  update public.care_messages set processed_at = now(), intent = 'opt_out' where id = m.id;
  return n;
end $$;

-- A message that belongs to no open conversation: thanks are ignored; danger signs from a known patient become
-- an urgent escalation; anything else becomes a ticket (known patient) or a lead in the patient relations inbox.
-- A message that belongs to no open conversation: thanks are ignored; anything else becomes a ticket (one known
-- patient), an escalation (a number shared by several patients — someone must check who wrote), or a lead.
-- Danger signs never reach here: they were escalated when the message was stored.
create or replace function app.care_unrouted(p_message uuid, p_thanks boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; v_ref text; v_n int;
begin
  select * into m from public.care_messages where id = p_message and direction = 'in' and journey_id is null;
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  if m.processed_at is not null then return jsonb_build_object('action', 'none'); end if;
  update public.care_messages set processed_at = now() where id = m.id;
  if p_thanks then return jsonb_build_object('action', 'none'); end if;
  if m.patient_id is not null then
    if (select count(*) from public.support_tickets where patient_id = m.patient_id and channel = 'whatsapp' and created_at > now() - interval '24 hours') >= 5 then
      return jsonb_build_object('action', 'none');
    end if;
    insert into public.support_tickets (branch_id, patient_id, kind, subject, body, channel, priority, due_at)
    values (m.branch_id, m.patient_id, 'inquiry', 'رسالة واتساب من المريض / WhatsApp message', left(m.body, 2000), 'whatsapp', 'normal', now() + interval '4 hours')
    returning ref into v_ref;
    return jsonb_build_object('action', 'ticket', 'ref', v_ref);
  end if;
  v_n := cardinality(app.care_patients_on(m.phone));
  if v_n > 1 then
    insert into public.care_escalations (branch_id, phone, severity, category, summary, patient_text, due_at)
    values (m.branch_id, m.phone, 'normal', 'other', 'رسالة من رقم مشترك بين أكثر من مريض — حدد المريض / Message from a shared number — identify the patient',
            left(m.body, 2000), now() + app.care_due_minutes('normal'))
    returning ref into v_ref;
    return jsonb_build_object('action', 'escalation', 'ref', v_ref);
  end if;
  if (select count(*) from public.leads where phone = m.phone and created_at > now() - interval '24 hours') >= 3 then
    return jsonb_build_object('action', 'none');
  end if;
  insert into public.leads (branch_id, kind, channel, full_name, phone_raw, message, consent_contact, due_at)
  values (m.branch_id, 'inquiry', 'whatsapp', 'عميل واتساب', m.phone, left(m.body, 1000), true, now() + interval '2 hours')
  returning ref into v_ref;
  return jsonb_build_object('action', 'lead', 'ref', v_ref);
end $$;

-- The assistant's automatic reply to a message outside any conversation (kept on record like every other message).
create or replace function app.care_log_reply(p_in_message uuid, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; v_id uuid;
begin
  select * into m from public.care_messages where id = p_in_message and direction = 'in';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  insert into public.care_messages (journey_id, patient_id, branch_id, phone, direction, channel, author, body, status)
  values (m.journey_id, m.patient_id, m.branch_id, m.phone, 'out', m.channel, 'agent', left(p_body, 4000), 'queued')
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.care_message_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.care_messages set status = case when p_ok then 'sent' else 'failed' end, provider = p_provider,
    provider_message_id = coalesce(p_provider_id, provider_message_id), error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and status = 'queued'
$$;

create or replace function app.care_message_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.care_messages set status = p_status
  where provider_message_id = p_provider_id and direction = 'out' and p_status in ('delivered', 'read', 'failed')
    and array_position(array['queued','sent','delivered','read'], status) < coalesce(array_position(array['queued','sent','delivered','read'], p_status), 99)
$$;

-- The opening message (or call) could not go out: retry with backoff, then try a call, then hand to a person.
-- The opening message (or call) could not go out: retry with backoff, then try a call, then hand to a person.
-- Only for conversations that have not started (never touches one staff are handling or the patient answered).
create or replace function app.care_send_failed(p_journey uuid, p_error text)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys; s public.care_agent_settings;
begin
  select * into j from public.care_journeys where id = p_journey for update;
  if not found or j.status not in ('scheduled', 'waiting') or j.last_inbound_at is not null then return 'ignored'; end if;
  select * into s from public.care_agent_settings where branch_id = j.branch_id;
  if j.attempts < 2 then
    update public.care_journeys set attempts = attempts + 1, status = 'scheduled', state = 'start', opened_at = null,
      scheduled_at = now() + make_interval(mins => 15 * power(2, j.attempts)::int), last_error = left(p_error, 500), lease_until = null,
      next_action_at = null, updated_at = now(), version = version + 1 where id = j.id;
    return 'retry';
  end if;
  if j.channel = 'whatsapp' and coalesce(s.voice_enabled, false) and coalesce(s.voice_fallback, false) then
    update public.care_journeys set attempts = 0, channel = 'voice', status = 'scheduled', state = 'start', opened_at = null,
      scheduled_at = now(), last_error = left(p_error, 500), lease_until = null, next_action_at = null, updated_at = now(), version = version + 1
    where id = j.id;
    return 'voice';
  end if;
  update public.care_journeys set status = 'failed', outcome = 'unreachable', last_error = left(p_error, 500), closed_at = now(),
    lease_until = null, next_action_at = null, updated_at = now(), version = version + 1 where id = j.id;
  insert into public.support_tickets (branch_id, patient_id, kind, subject, body, channel, priority, due_at)
  values (j.branch_id, j.patient_id, 'callback', 'تعذر وصول المساعد للمريض — يرجى الاتصال / Assistant could not reach the patient — please call',
          'رحلة ' || j.ref || ' (' || j.kind || ')', 'care_assistant', 'normal', now() + interval '4 hours');
  -- Booking confirmations / reminders fall back to the plain template message.
  if j.kind = 'booking_confirm' then
    perform app.enqueue_message('appointment_confirmed', j.patient_id, j.appointment_id, '{}'::jsonb, 'apt-confirmed-' || j.appointment_id);
  elsif j.kind = 'pre_visit' then
    perform app.enqueue_message('appointment_reminder', j.patient_id, j.appointment_id, '{}'::jsonb, 'apt-reminder-' || j.appointment_id);
  end if;
  return 'failed';
end $$;

-- Voice call progress from the telephony provider.
create or replace function app.care_call_event(p_journey uuid, p_call_sid text, p_status text)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare j public.care_journeys;
begin
  select * into j from public.care_journeys where id = p_journey for update;
  if not found or j.channel <> 'voice' then return null; end if;
  if p_status = 'initiated' then
    update public.care_journeys set call_sid = p_call_sid, updated_at = now() where id = j.id;
    return 'ok';
  end if;
  if p_call_sid is not null and j.call_sid is not null and p_call_sid <> j.call_sid then return 'stale'; end if;
  if p_status in ('no-answer', 'busy', 'failed', 'canceled') and j.status in ('scheduled', 'waiting') and j.last_inbound_at is null then
    return app.care_send_failed(j.id, 'call ' || p_status);
  end if;
  if p_status = 'completed' and j.status = 'waiting' then
    update public.care_journeys set status = case when j.last_inbound_at is null then 'no_response' else 'completed' end::public.care_status,
      outcome = coalesce(outcome, 'call_ended'), closed_at = now(), lease_until = null, next_action_at = null, updated_at = now(), version = version + 1
    where id = j.id;
    return 'closed';
  end if;
  return 'ignored';
end $$;

-- Legacy notifications: when the assistant handles confirmations / reminders for a branch, the plain template
-- messages are not sent as well, and the assistant's own cancellations do not trigger a second message.
-- Legacy notifications: the plain confirmation is skipped only when the assistant will confirm this booking itself
-- (branch on, patient not refused, far enough ahead); the assistant's own cancellations send no second message.
create or replace function app.appointment_notifications()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_lead int;
begin
  if new.status in ('booked', 'confirmed') and (tg_op = 'INSERT' or old.status in ('requested', 'pending_confirmation')) then
    select confirm_min_lead_hours into v_lead from public.care_agent_settings where branch_id = new.branch_id;
    if not (app.care_on(new.branch_id, 'booking_confirm') and not app.care_refused(new.patient_id) and new.status <> 'confirmed'
            and lower(new.slot) > now() + make_interval(hours => coalesce(v_lead, 3))) then
      perform app.enqueue_message('appointment_confirmed', new.patient_id, new.id, '{}'::jsonb, 'apt-confirmed-' || new.id);
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'canceled' and old.status <> 'canceled' then
    if coalesce(current_setting('app.care_rpc', true), '') <> 'on' then
      perform app.enqueue_message('appointment_cancelled', new.patient_id, new.id, '{}'::jsonb, 'apt-cancelled-' || new.id);
    end if;
  end if;
  return null;
end $$;

create or replace function app.enqueue_due_reminders()
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare n int := 0; r record;
begin
  for r in select id, patient_id, branch_id from public.appointments
           where status in ('booked', 'confirmed') and lower(slot) between now() + interval '20 hours' and now() + interval '28 hours' loop
    continue when app.care_on(r.branch_id, 'pre_visit') and not app.care_refused(r.patient_id);   -- the assistant reminds
    if app.enqueue_message('appointment_reminder', r.patient_id, r.id, '{}'::jsonb, 'apt-reminder-' || r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Urgent / high escalations alert the on-call number (reference only, no patient details).
create or replace function app.care_escalation_alert()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_phone text;
begin
  if new.severity in ('urgent', 'high') then
    select oncall_phone into v_phone from public.care_agent_settings where branch_id = new.branch_id and enabled;
    if v_phone is not null then
      insert into public.message_outbox (to_phone, template_code, vars, idempotency_key)
      values (v_phone, 'care_oncall_alert', jsonb_build_object('ref', new.ref,
              'severity', case new.severity when 'urgent' then 'عاجل' else 'مهم' end, 'severity_en', new.severity), 'care-oncall-' || new.id)
      on conflict (idempotency_key) do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger trg_care_escalation_alert after insert on public.care_escalations for each row execute function app.care_escalation_alert();

-- Opening templates (WhatsApp business-initiated messages must be approved templates).
insert into public.message_templates (code, lang, provider_template, body) values
  ('care_booking_confirm', 'ar', 'gc_care_booking_confirm', 'أهلًا {{name}} 👋 معاك مساعد جولدن كير الآلي. حجزك مع {{doctor}} يوم {{date}} الساعة {{time}}. تحب تأكد الحضور؟ ابعت 1 للتأكيد، 2 لتغيير الموعد، 3 للإلغاء.'),
  ('care_booking_confirm', 'en', 'gc_care_booking_confirm', 'Hello {{name}} 👋 this is the Golden Care automated assistant. Your appointment with {{doctor}} is on {{date}} at {{time}}. Reply 1 to confirm, 2 to change it, 3 to cancel.'),
  ('care_pre_visit',       'ar', 'gc_care_pre_visit',       'أهلًا {{name}} 🌿 بنفكرك بموعدك بكرة {{date}} الساعة {{time}} مع {{doctor}} في عيادات جولدن كير. ابعت 1 لو جاي، 2 لو محتاج تغيّر الموعد، 3 للإلغاء.'),
  ('care_pre_visit',       'en', 'gc_care_pre_visit',       'Hello {{name}} 🌿 a reminder of your appointment tomorrow {{date}} at {{time}} with {{doctor}} at Golden Care Clinics. Reply 1 if you are coming, 2 to change it, 3 to cancel.'),
  ('care_post_visit',      'ar', 'gc_care_post_visit',      'أهلًا {{name}} 🌷 معاك مساعد جولدن كير الآلي. بنطمن على حضرتك بعد زيارتك مع {{doctor}}. عندك دقيقة لـ ٣ أسئلة سريعة؟ ابعت 1 أيوه، 2 مش دلوقتي.'),
  ('care_post_visit',      'en', 'gc_care_post_visit',      'Hello {{name}} 🌷 this is the Golden Care automated assistant, checking on you after your visit with {{doctor}}. Do you have a minute for 3 quick questions? Reply 1 yes, 2 not now.'),
  ('care_followup',        'ar', 'gc_care_followup',        'أهلًا {{name}} 👋 {{doctor}} طلب متابعة لحضرتك يوم {{due}}. تحب نحجزلك الموعد؟ ابعت 1 أيوه، 2 حجزت بالفعل، 3 مش محتاج.'),
  ('care_followup',        'en', 'gc_care_followup',        'Hello {{name}} 👋 {{doctor}} asked for a follow-up visit on {{due}}. Shall we book it for you? Reply 1 yes, 2 already booked, 3 not needed.'),
  ('care_nudge',           'ar', 'gc_care_nudge',           'أهلًا {{name}}، لسه مستنيين ردك على رسالتنا السابقة من عيادات جولدن كير 🙏 ردك بيساعدنا نخدمك أحسن.'),
  ('care_nudge',           'en', 'gc_care_nudge',           'Hello {{name}}, we are still waiting for your reply to our previous Golden Care message 🙏 it helps us look after you.'),
  ('care_oncall_alert',    'ar', 'gc_care_oncall_alert',    'تنبيه {{severity}} من مساعد المتابعة: {{ref}}. افتح نظام جولدن كير ← مساعد المتابعة.'),
  ('care_oncall_alert',    'en', 'gc_care_oncall_alert',    'Care assistant {{severity}} alert: {{ref}}. Open Golden Care OS → Care assistant.')
on conflict (code, lang) do nothing;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.care_agent_settings enable row level security;
alter table public.care_followup_requests enable row level security;
alter table public.care_journeys enable row level security;
alter table public.care_messages enable row level security;
alter table public.care_escalations enable row level security;

create policy care_settings_read on public.care_agent_settings for select to authenticated
  using (app.has_permission('care.read', branch_id) or app.has_permission('care.settings', branch_id));
create policy care_followups_read on public.care_followup_requests for select to authenticated
  using (app.can_read_care(branch_id, doctor_id) or app.can_read_clinical(patient_id, branch_id));
create policy care_journeys_read on public.care_journeys for select to authenticated
  using (app.can_read_care(branch_id, doctor_id));
create policy care_messages_read on public.care_messages for select to authenticated
  using (case when journey_id is null then app.has_permission('care.read', branch_id)
              else exists (select 1 from public.care_journeys j where j.id = journey_id and app.can_read_care(j.branch_id, j.doctor_id)) end);
create policy care_escalations_read on public.care_escalations for select to authenticated
  using (app.can_read_care(branch_id, doctor_id));

grant select on public.care_agent_settings, public.care_followup_requests, public.care_journeys, public.care_messages,
  public.care_escalations to authenticated;

create or replace function public.svc_care_enqueue(p_now timestamptz default now())
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_enqueue(p_now) $$;
create or replace function public.svc_care_claim(p_limit int default 20, p_now timestamptz default now())
returns setof jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select * from app.care_claim(p_limit, p_now) $$;
create or replace function public.svc_care_context(p_journey uuid)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$ select app.care_context(p_journey) $$;
create or replace function public.svc_care_apply(p_journey uuid, p_version int, p jsonb)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_apply(p_journey, p_version, p) $$;
create or replace function public.svc_care_inbound(p_phone text, p_provider_id text, p_text text, p_channel text, p_journey uuid default null,
                                                   p_urgent boolean default false, p_media_id text default null)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$
  select app.care_inbound(p_phone, p_provider_id, p_text, p_channel, p_journey, p_urgent, p_media_id) $$;
create or replace function public.svc_care_unrouted(p_message uuid, p_thanks boolean)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_unrouted(p_message, p_thanks) $$;
create or replace function public.svc_care_mark_processed(p_message uuid)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_mark_processed(p_message) $$;
create or replace function public.svc_care_handoff_message(p_message uuid, p_subject text)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_handoff_message(p_message, p_subject) $$;
create or replace function public.svc_care_sweep(p_now timestamptz default now())
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_sweep(p_now) $$;
create or replace function public.svc_care_opt_out_message(p_message uuid)
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_opt_out_message(p_message) $$;
create or replace function public.svc_care_log_reply(p_in_message uuid, p_body text)
returns uuid language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_log_reply(p_in_message, p_body) $$;
create or replace function public.svc_care_message_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_message_result(p_id, p_ok, p_provider, p_provider_id, p_error) $$;
create or replace function public.svc_care_message_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_message_status(p_provider_id, p_status) $$;
create or replace function public.svc_care_send_failed(p_journey uuid, p_error text)
returns text language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_send_failed(p_journey, p_error) $$;
create or replace function public.svc_care_call_event(p_journey uuid, p_call_sid text, p_status text)
returns text language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.care_call_event(p_journey, p_call_sid, p_status) $$;

revoke execute on function public.svc_care_enqueue(timestamptz), public.svc_care_claim(int, timestamptz), public.svc_care_context(uuid),
  public.svc_care_apply(uuid, int, jsonb), public.svc_care_inbound(text, text, text, text, uuid, boolean, text), public.svc_care_unrouted(uuid, boolean), public.svc_care_log_reply(uuid, text),
  public.svc_care_mark_processed(uuid), public.svc_care_handoff_message(uuid, text), public.svc_care_sweep(timestamptz), public.svc_care_opt_out_message(uuid),
  public.svc_care_message_result(uuid, boolean, text, text, text), public.svc_care_message_status(text, text),
  public.svc_care_send_failed(uuid, text), public.svc_care_call_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.svc_care_enqueue(timestamptz), public.svc_care_claim(int, timestamptz), public.svc_care_context(uuid),
  public.svc_care_apply(uuid, int, jsonb), public.svc_care_inbound(text, text, text, text, uuid, boolean, text), public.svc_care_unrouted(uuid, boolean), public.svc_care_log_reply(uuid, text),
  public.svc_care_mark_processed(uuid), public.svc_care_handoff_message(uuid, text), public.svc_care_sweep(timestamptz), public.svc_care_opt_out_message(uuid),
  public.svc_care_message_result(uuid, boolean, text, text, text), public.svc_care_message_status(text, text),
  public.svc_care_send_failed(uuid, text), public.svc_care_call_event(uuid, text, text)
  to service_role;

revoke execute on function public.save_care_settings(uuid, jsonb), public.set_care_followup(uuid, date, text), public.cancel_care_followup(uuid, text),
  public.care_take_over(uuid), public.care_resume(uuid), public.care_close(uuid, text), public.care_staff_message(uuid, text),
  public.care_message_result(uuid, boolean, text, text, text), public.care_escalation_update(uuid, text, text), public.care_kpis(uuid, date, date)
  from public, anon;
grant execute on function public.save_care_settings(uuid, jsonb), public.set_care_followup(uuid, date, text), public.cancel_care_followup(uuid, text),
  public.care_take_over(uuid), public.care_resume(uuid), public.care_close(uuid, text), public.care_staff_message(uuid, text),
  public.care_message_result(uuid, boolean, text, text, text), public.care_escalation_update(uuid, text, text), public.care_kpis(uuid, date, date)
  to authenticated;

-- Internal care primitives run only inside the definer wrappers above.
revoke execute on function app.care_patients_on(text), app.care_in_hours(uuid, timestamptz), app.care_recent_doctor(uuid), app.care_refused(uuid),
  app.care_on(uuid, text), app.care_due_minutes(text), app.care_context(uuid), app.care_lock_for_staff(uuid), app.care_enqueue(timestamptz),
  app.care_not_needed(public.care_journeys, timestamptz), app.care_claim(int, timestamptz), app.care_apply(uuid, int, jsonb),
  app.care_opt_out_patients(uuid[], uuid), app.care_inbound(text, text, text, text, uuid, boolean, text), app.care_mark_processed(uuid),
  app.care_handoff_message(uuid, text), app.care_sweep(timestamptz), app.care_opt_out_message(uuid), app.care_unrouted(uuid, boolean),
  app.care_log_reply(uuid, text), app.care_message_result(uuid, boolean, text, text, text), app.care_message_status(text, text),
  app.care_send_failed(uuid, text), app.care_call_event(uuid, text, text), app.care_escalation_alert(), app.cancel_hours()
  from public, anon, authenticated;
grant execute on function app.can_read_care(uuid, uuid) to authenticated;
