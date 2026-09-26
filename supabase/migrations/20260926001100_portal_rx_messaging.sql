-- Golden Care OS — 0011 Prescriptions, release gate, patient portal, family access, tickets,
-- satisfaction surveys, and WhatsApp/SMS notification outbox.
--
-- Patients never get table access. Every portal read/write goes through SECURITY DEFINER
-- functions that (1) resolve the signed-in patient, (2) check self/family access, and
-- (3) return ONLY records explicitly released to the patient.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('clinical.release',        'clinical',  'Release visit summaries and prescriptions of any doctor to the patient portal'),
  ('prescription.restricted', 'clinical',  'Prescribe medicines on the restricted list'),
  ('messages.manage',         'messaging', 'View and retry outgoing patient messages'),
  ('ticket.read',             'crm',       'Read patient support tickets and complaints'),
  ('ticket.write',            'crm',       'Work patient support tickets and complaints');

insert into public.role_permissions (role_code, permission_code) values
  ('medical_director', 'clinical.release'), ('medical_director', 'prescription.restricted'),
  ('system_admin', 'messages.manage'), ('operations_manager', 'messages.manage'),
  ('patient_relations', 'ticket.read'), ('patient_relations', 'ticket.write'),
  ('front_desk', 'ticket.read'),
  ('quality_manager', 'ticket.read'), ('quality_manager', 'ticket.write'),
  ('operations_manager', 'ticket.read'), ('center_director', 'ticket.read'), ('medical_director', 'ticket.read');

-- ---------------------------------------------------------------------------
-- Drug catalogue and prescriptions
-- ---------------------------------------------------------------------------
create table public.drugs (
  id            uuid primary key default gen_random_uuid(),
  trade_name    text not null,
  generic_name  text,
  strength      text,
  form          text,
  is_restricted boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (trade_name, strength, form)
);
create index drugs_search on public.drugs using gin ((trade_name || ' ' || coalesce(generic_name, '')) extensions.gin_trgm_ops);
create trigger trg_audit_drugs after insert or update or delete on public.drugs for each row execute function app.audit_row();

create type public.prescription_status as enum ('draft', 'signed', 'cancelled');

create table public.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default app.next_ref('RX'),
  encounter_id    uuid not null references public.encounters(id),
  branch_id       uuid not null references public.branches(id),
  patient_id      uuid not null references public.patients(id),
  doctor_id       uuid not null references public.staff(id),
  status          public.prescription_status not null default 'draft',
  notes_for_patient text,
  allergy_ack     boolean not null default false,
  allergy_ack_at  timestamptz,
  signed_at       timestamptz,
  signed_by       uuid,
  released_at     timestamptz,
  released_by     uuid,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.prescriptions (patient_id, created_at desc);

create table public.prescription_items (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id),
  drug_id         uuid references public.drugs(id),
  drug_name       text not null check (length(trim(drug_name)) > 1),
  strength        text,
  form            text,
  dose            text not null,
  frequency       text not null,
  duration        text,
  route           text,
  instructions    text,
  sort_order      int not null default 0
);
create index on public.prescription_items (prescription_id);

-- Items only change while the prescription is a draft.
create or replace function app.rx_items_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.prescription_status;
begin
  select status into v from public.prescriptions where id = coalesce(new.prescription_id, old.prescription_id) for update;
  if v <> 'draft' then raise exception 'signed prescriptions cannot be changed' using errcode = '42501'; end if;
  if tg_op = 'INSERT' and new.drug_id is not null then
    select trade_name, coalesce(new.strength, strength), coalesce(new.form, form) into new.drug_name, new.strength, new.form
    from public.drugs where id = new.drug_id and is_active;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_rx_items_guard before insert or update or delete on public.prescription_items
  for each row execute function app.rx_items_guard();

-- After signing, only release and cancellation fields may change (through RPCs).
create or replace function app.rx_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'prescriptions cannot be deleted; cancel instead' using errcode = '42501'; end if;
  if old.status <> 'draft' and coalesce(current_setting('app.release_rpc', true), '') <> 'on' then
    raise exception 'signed prescriptions cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status <> old.status and coalesce(current_setting('app.release_rpc', true), '') <> 'on' then
    raise exception 'use sign_prescription' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_rx_guard before update or delete on public.prescriptions for each row execute function app.rx_guard();
create trigger trg_audit_rx after insert or update on public.prescriptions for each row execute function app.audit_row();
create trigger trg_audit_rx_items after insert or update or delete on public.prescription_items for each row execute function app.audit_row();

create or replace function public.sign_prescription(p_id uuid, p_ack_allergies boolean default false)
returns public.prescriptions
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.prescriptions; v_allergies int; v_restricted int;
begin
  select * into r from public.prescriptions where id = p_id for update;
  if not found then raise exception 'prescription not found' using errcode = 'P0002'; end if;
  if r.doctor_id is distinct from app.current_staff_id() then
    raise exception 'only the prescribing doctor can sign' using errcode = '42501';
  end if;
  if r.status <> 'draft' then raise exception 'prescription already %', r.status using errcode = '22023'; end if;
  if not exists (select 1 from public.prescription_items where prescription_id = r.id) then
    raise exception 'prescription has no items' using errcode = '22023';
  end if;
  select count(*) into v_restricted from public.prescription_items i join public.drugs d on d.id = i.drug_id
   where i.prescription_id = r.id and d.is_restricted;
  if v_restricted > 0 and not app.has_permission('prescription.restricted', r.branch_id) then
    raise exception 'restricted medicine requires authorization' using errcode = '42501';
  end if;
  select count(*) into v_allergies from public.patient_alerts where patient_id = r.patient_id and is_active and kind = 'allergy';
  if v_allergies > 0 and not coalesce(p_ack_allergies, false) then
    raise exception 'allergy acknowledgement required' using errcode = '22023';
  end if;
  perform set_config('app.release_rpc', 'on', true);
  update public.prescriptions set status = 'signed', signed_at = now(), signed_by = auth.uid(),
    allergy_ack = v_allergies > 0, allergy_ack_at = case when v_allergies > 0 then now() end
  where id = r.id returning * into r;
  if v_allergies > 0 then
    perform app.audit_event('ALLERGY_ACKNOWLEDGED', 'prescriptions', r.id::text, r.branch_id, 'prescribed despite recorded allergy alert');
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Release gate: the patient sees only what a clinician explicitly released.
-- ---------------------------------------------------------------------------
alter table public.encounters
  add column patient_summary text,
  add column patient_instructions text,
  add column summary_released_at timestamptz,
  add column summary_released_by uuid;

create or replace function app.encounters_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'signed' then
    if new.status = 'entered_in_error' and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;
    -- Release fields may be set once through release_to_patient().
    if coalesce(current_setting('app.release_rpc', true), '') = 'on'
       and (to_jsonb(new) - array['patient_summary','patient_instructions','summary_released_at','summary_released_by','updated_at'])
         = (to_jsonb(old) - array['patient_summary','patient_instructions','summary_released_at','summary_released_by','updated_at']) then
      return new;
    end if;
    raise exception 'signed encounter cannot be modified; add an addendum' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.release_to_patient(p_kind text, p_id uuid, p_summary text default null, p_instructions text default null)
returns timestamptz
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_doctor uuid; v_branch uuid; v_status text; v_released timestamptz; v_patient uuid;
begin
  if p_kind = 'encounter' then
    select doctor_id, branch_id, status::text, summary_released_at, patient_id into v_doctor, v_branch, v_status, v_released, v_patient
      from public.encounters where id = p_id for update;
  elsif p_kind = 'prescription' then
    select doctor_id, branch_id, status::text, released_at, patient_id into v_doctor, v_branch, v_status, v_released, v_patient
      from public.prescriptions where id = p_id for update;
  else
    raise exception 'unknown release kind' using errcode = '22023';
  end if;
  if v_doctor is null then raise exception 'record not found' using errcode = 'P0002'; end if;
  if not (v_doctor = app.current_staff_id() or app.has_permission('clinical.release', v_branch)) then
    raise exception 'permission denied: release to patient' using errcode = '42501';
  end if;
  if v_status <> 'signed' then raise exception 'only signed records can be released' using errcode = '22023'; end if;
  if v_released is not null then raise exception 'already released' using errcode = '22023'; end if;
  if p_kind = 'encounter' and coalesce(trim(p_summary), '') = '' then
    raise exception 'a patient-facing summary is required' using errcode = '22023';
  end if;

  perform set_config('app.release_rpc', 'on', true);
  if p_kind = 'encounter' then
    update public.encounters set patient_summary = trim(p_summary), patient_instructions = nullif(trim(p_instructions), ''),
      summary_released_at = now(), summary_released_by = auth.uid() where id = p_id;
  else
    update public.prescriptions set released_at = now(), released_by = auth.uid() where id = p_id;
  end if;
  perform app.enqueue_message('result_released', v_patient, null, '{}'::jsonb, 'release-' || p_kind || '-' || p_id);
  return now();
end $$;

-- ---------------------------------------------------------------------------
-- Patient accounts and family access
-- ---------------------------------------------------------------------------
create table public.patient_accounts (
  user_id       uuid primary key references auth.users(id),
  patient_id    uuid not null unique references public.patients(id),
  phone         text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create trigger trg_audit_patient_accounts after insert or update on public.patient_accounts for each row execute function app.audit_row();

create type public.family_access_level as enum ('appointments', 'full');

create table public.family_access_grants (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id),       -- whose file
  grantee_patient_id uuid not null references public.patients(id),       -- who may view it
  level              public.family_access_level not null default 'appointments',
  relation           text not null check (relation in ('parent', 'child', 'spouse', 'guardian', 'caregiver', 'other')),
  granted_via        text not null check (granted_via in ('patient', 'staff')),
  granted_by         uuid default auth.uid(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid,
  evidence           text,                                               -- e.g. guardianship document reference
  created_at         timestamptz not null default now(),
  constraint not_self check (patient_id <> grantee_patient_id)
);
create index on public.family_access_grants (grantee_patient_id) where revoked_at is null;
create trigger trg_audit_family after insert or update on public.family_access_grants for each row execute function app.audit_row();

create or replace function app.portal_patient()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select patient_id from public.patient_accounts where user_id = auth.uid() and is_active
$$;

-- Self always; family only through an explicit, active, unexpired grant of sufficient level.
create or replace function app.portal_can(p_patient uuid, p_level public.family_access_level)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.portal_patient() is not null and (
    p_patient = app.portal_patient()
    or exists (select 1 from public.family_access_grants g
               where g.patient_id = p_patient and g.grantee_patient_id = app.portal_patient()
                 and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
                 and (g.level = 'full' or p_level = 'appointments'))
  )
$$;

create or replace function app.portal_require(p_patient uuid, p_level public.family_access_level)
returns void language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.portal_can(p_patient, p_level) then
    raise exception 'not found' using errcode = 'P0002';   -- never reveal whether another file exists
  end if;
end $$;

-- OTP store (server-side only; hashes, throttling, lockout).
create table app.portal_otps (
  id          bigint generated always as identity primary key,
  phone       text not null,
  patient_id  uuid not null,
  code_hash   text not null,
  ip          text,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on app.portal_otps (phone, created_at desc);

create or replace function app.portal_otp_issue(p_phone text, p_ip text default null)
returns table (code text, patient_id uuid, lang text)
language plpgsql volatile security definer set search_path = public, app, extensions, pg_temp as $$
declare v_phone text := app.normalize_phone(p_phone); v_patient uuid; v_code text;
begin
  if v_phone is null then return; end if;
  if (select count(*) from app.portal_otps o where o.phone = v_phone and o.created_at > now() - interval '15 minutes') >= 3
     or (p_ip is not null and (select count(*) from app.portal_otps o where o.ip = p_ip and o.created_at > now() - interval '1 hour') >= 10) then
    raise exception 'too many requests' using errcode = '54000';
  end if;
  -- The account holder is the earliest active file registered with this number.
  select p.id into v_patient from public.patients p
   where p.phone = v_phone and p.merged_into is null and not p.is_archived order by p.created_at limit 1;
  if v_patient is null then return; end if;   -- caller shows the same neutral message either way
  v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  insert into app.portal_otps (phone, patient_id, code_hash, ip, expires_at)
  values (v_phone, v_patient, encode(digest(v_code, 'sha256'), 'hex'), p_ip, now() + interval '10 minutes');
  return query select v_code, v_patient, 'ar'::text;
end $$;

create or replace function app.portal_otp_verify(p_phone text, p_code text)
returns uuid language plpgsql volatile security definer set search_path = public, app, extensions, pg_temp as $$
declare v_phone text := app.normalize_phone(p_phone); o app.portal_otps;
begin
  select * into o from app.portal_otps
   where phone = v_phone and consumed_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then raise exception 'invalid or expired code' using errcode = '22023'; end if;
  update app.portal_otps set attempts = attempts + 1 where id = o.id;
  if o.attempts >= 5 then raise exception 'invalid or expired code' using errcode = '22023'; end if;
  if o.code_hash <> encode(digest(coalesce(p_code, ''), 'sha256'), 'hex') then
    raise exception 'invalid or expired code' using errcode = '22023';
  end if;
  update app.portal_otps set consumed_at = now() where id = o.id;
  return o.patient_id;
end $$;

create or replace function app.portal_link_account(p_user uuid, p_patient uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.patient_accounts (user_id, patient_id, phone)
  select p_user, p_patient, p.phone from public.patients p where p.id = p_patient
  on conflict (user_id) do update set last_login_at = now(), is_active = true;
  update public.patient_accounts set last_login_at = now() where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Support tickets / complaints and satisfaction surveys
-- ---------------------------------------------------------------------------
create type public.ticket_kind as enum ('inquiry', 'complaint', 'callback', 'reschedule', 'refund');
create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

create table public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default app.next_ref('TK'),
  branch_id   uuid not null references public.branches(id),
  patient_id  uuid not null references public.patients(id),
  kind        public.ticket_kind not null,
  subject     text not null check (length(trim(subject)) between 2 and 200),
  body        text check (body is null or length(body) <= 2000),
  channel     text not null default 'portal',
  status      public.ticket_status not null default 'open',
  priority    text not null default 'normal' check (priority in ('normal', 'high')),
  due_at      timestamptz not null,
  assigned_to uuid references auth.users(id),
  resolution  text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index on public.support_tickets (status, due_at);
create trigger trg_audit_tickets after insert or update on public.support_tickets for each row execute function app.audit_row();

create or replace function app.tickets_guard()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status in ('resolved', 'closed') and coalesce(trim(new.resolution), '') = '' then
    raise exception 'a resolution note is required' using errcode = '22023';
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.closed_at := now(); end if;
  return new;
end $$;
create trigger trg_tickets_guard before update on public.support_tickets for each row execute function app.tickets_guard();

create table public.satisfaction_surveys (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),
  patient_id     uuid not null references public.patients(id),
  score          smallint not null check (score between 1 and 5),
  comment        text check (comment is null or length(comment) <= 1000),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications: templates + outbox (retry, dead-letter, idempotency, delivery status)
-- ---------------------------------------------------------------------------
create table public.message_templates (
  code              text not null,
  lang              text not null check (lang in ('ar', 'en')),
  channel           text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email')),
  provider_template text,                 -- Meta-approved template name
  body              text not null,
  is_transactional  boolean not null default true,
  is_active         boolean not null default true,
  primary key (code, lang)
);
create trigger trg_audit_templates after insert or update or delete on public.message_templates for each row execute function app.audit_row();

insert into public.message_templates (code, lang, provider_template, body) values
  ('appointment_confirmed', 'ar', 'gc_appointment_confirmed', 'مرحبًا {{name}}، تم تأكيد موعدك في عيادات جولدن كير يوم {{date}} الساعة {{time}} مع {{doctor}}. رقم الحجز {{ref}}.'),
  ('appointment_confirmed', 'en', 'gc_appointment_confirmed', 'Hello {{name}}, your Golden Care Clinics appointment is confirmed for {{date}} at {{time}} with {{doctor}}. Reference {{ref}}.'),
  ('appointment_reminder',  'ar', 'gc_appointment_reminder',  'تذكير: موعدك في عيادات جولدن كير غدًا {{date}} الساعة {{time}} مع {{doctor}}. للتعديل تواصل معنا.'),
  ('appointment_reminder',  'en', 'gc_appointment_reminder',  'Reminder: your Golden Care Clinics appointment is tomorrow {{date}} at {{time}} with {{doctor}}. Contact us to change it.'),
  ('appointment_cancelled', 'ar', 'gc_appointment_cancelled', 'تم إلغاء موعدك رقم {{ref}} في عيادات جولدن كير. يسعدنا حجز موعد جديد لك.'),
  ('appointment_cancelled', 'en', 'gc_appointment_cancelled', 'Your Golden Care Clinics appointment {{ref}} has been cancelled. We would be glad to book a new one.'),
  ('result_released',       'ar', 'gc_result_released',       'مرحبًا {{name}}، يوجد تحديث جديد في حسابك على بوابة جولدن كير. يمكنك الاطلاع عليه بعد تسجيل الدخول.'),
  ('result_released',       'en', 'gc_result_released',       'Hello {{name}}, there is a new update in your Golden Care patient account. Sign in to view it.'),
  ('portal_otp',            'ar', 'gc_portal_otp',            'رمز الدخول إلى حساب جولدن كير: {{code}}. صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.'),
  ('portal_otp',            'en', 'gc_portal_otp',            'Your Golden Care sign-in code is {{code}}. Valid for 10 minutes. Do not share it.');

create table public.message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  channel             text not null default 'whatsapp',
  to_phone            text not null,
  lang                text not null default 'ar',
  template_code       text not null,
  vars                jsonb not null default '{}'::jsonb,   -- never contains secrets (OTP codes are not stored)
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead', 'skipped')),
  skip_reason         text,
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  provider            text,
  provider_message_id text unique,
  last_error          text,
  idempotency_key     text not null unique,
  patient_id          uuid references public.patients(id),
  appointment_id      uuid references public.appointments(id),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now()
);
create index on public.message_outbox (status, next_attempt_at);

-- Transactional messages are sent unless the patient has explicitly refused WhatsApp messages.
create or replace function app.enqueue_message(p_code text, p_patient uuid, p_appointment uuid, p_vars jsonb, p_key text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare p public.patients; v_id uuid; v_refused boolean; v_vars jsonb := coalesce(p_vars, '{}'::jsonb); a record;
begin
  select * into p from public.patients where id = p_patient;
  if not found then return null; end if;
  select not granted into v_refused from public.patient_consent_current where patient_id = p_patient and kind = 'whatsapp_messages';
  if p_appointment is not null then
    select ap.ref, to_char(lower(ap.slot) at time zone 'Africa/Cairo', 'YYYY-MM-DD') d, to_char(lower(ap.slot) at time zone 'Africa/Cairo', 'HH24:MI') t,
           s.full_name_ar dr_ar, coalesce(s.full_name_en, s.full_name_ar) dr_en
      into a from public.appointments ap join public.staff s on s.id = ap.doctor_id where ap.id = p_appointment;
    v_vars := v_vars || jsonb_build_object('ref', a.ref, 'date', a.d, 'time', a.t, 'doctor', a.dr_ar, 'doctor_en', a.dr_en);
  end if;
  v_vars := v_vars || jsonb_build_object('name', p.first_name_ar, 'name_en', coalesce(p.first_name_en, p.first_name_ar));
  insert into public.message_outbox (to_phone, template_code, vars, patient_id, appointment_id, idempotency_key, status, skip_reason)
  values (p.phone, p_code, v_vars, p.id, p_appointment, p_key,
          case when coalesce(v_refused, false) then 'skipped' else 'queued' end,
          case when coalesce(v_refused, false) then 'patient refused WhatsApp messages' end)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.appointment_notifications()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if new.status in ('booked', 'confirmed') and (tg_op = 'INSERT' or old.status in ('requested', 'pending_confirmation')) then
    perform app.enqueue_message('appointment_confirmed', new.patient_id, new.id, '{}'::jsonb, 'apt-confirmed-' || new.id);
  elsif tg_op = 'UPDATE' and new.status = 'canceled' and old.status <> 'canceled' then
    perform app.enqueue_message('appointment_cancelled', new.patient_id, new.id, '{}'::jsonb, 'apt-cancelled-' || new.id);
  end if;
  return null;
end $$;
create trigger trg_appointments_notify after insert or update of status on public.appointments
  for each row execute function app.appointment_notifications();

-- Reminder job: appointments starting in 20–28 hours get one reminder each.
create or replace function app.enqueue_due_reminders()
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare n int := 0; r record;
begin
  for r in select id, patient_id from public.appointments
           where status in ('booked', 'confirmed') and lower(slot) between now() + interval '20 hours' and now() + interval '28 hours' loop
    if app.enqueue_message('appointment_reminder', r.patient_id, r.id, '{}'::jsonb, 'apt-reminder-' || r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Dispatcher primitives (service role only).
create or replace function app.outbox_claim(p_limit int default 20)
returns setof public.message_outbox language sql volatile security definer set search_path = public, pg_temp as $$
  update public.message_outbox m set status = 'sending', attempts = attempts + 1, updated_at = now()
  where m.id in (select id from public.message_outbox where status = 'queued' and next_attempt_at <= now()
                 order by next_attempt_at limit p_limit for update skip locked)
  returning m.*
$$;

create or replace function app.outbox_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.message_outbox set
    status = case when p_ok then 'sent' when attempts >= 5 then 'dead' else 'queued' end,
    provider = p_provider, provider_message_id = coalesce(p_provider_id, provider_message_id),
    last_error = case when p_ok then null else left(p_error, 500) end,
    sent_at = case when p_ok then now() else sent_at end,
    next_attempt_at = case when p_ok then next_attempt_at else now() + make_interval(mins => power(2, attempts)::int) end,
    updated_at = now()
  where id = p_id;
end $$;

-- Delivery webhooks: idempotent and never move backwards.
create or replace function app.outbox_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.message_outbox set status = p_status, updated_at = now()
  where provider_message_id = p_provider_id
    and p_status in ('delivered', 'read', 'failed')
    and array_position(array['queued','sending','sent','delivered','read'], status)
        < coalesce(array_position(array['queued','sending','sent','delivered','read'], p_status), 99)
$$;

create or replace function public.retry_message(p_id uuid)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('messages.manage');
  update public.message_outbox set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
  where id = p_id and status in ('failed', 'dead');
  if not found then raise exception 'only failed messages can be retried' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PORTAL API (signed-in patients). All checks inside; no table access.
-- ---------------------------------------------------------------------------
create or replace function app.patient_card(p public.patients)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'mrn', p.mrn, 'first_name_ar', p.first_name_ar, 'last_name_ar', p.last_name_ar,
    'first_name_en', p.first_name_en, 'last_name_en', p.last_name_en)
$$;

create or replace function public.portal_me()
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare me uuid := app.portal_patient();
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'patient', (select app.patient_card(p) || jsonb_build_object('phone', p.phone, 'email', p.email, 'preferred_channel', p.preferred_channel,
                 'emergency_name', p.emergency_name, 'emergency_phone', p.emergency_phone) from public.patients p where p.id = me),
    'family', coalesce((select jsonb_agg(app.patient_card(p) || jsonb_build_object('level', g.level, 'relation', g.relation, 'expires_at', g.expires_at))
                        from public.family_access_grants g join public.patients p on p.id = g.patient_id
                        where g.grantee_patient_id = me and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb),
    'shared_with', coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'name', p.first_name_ar || ' ' || p.last_name_ar,
                              'level', g.level, 'relation', g.relation, 'expires_at', g.expires_at))
                        from public.family_access_grants g join public.patients p on p.id = g.grantee_patient_id
                        where g.patient_id = me and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb),
    'consents', coalesce((select jsonb_object_agg(kind, granted) from public.patient_consent_current where patient_id = me), '{}'::jsonb)
  );
end $$;

create or replace function public.portal_appointments(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_hours int := coalesce((select nullif(value_en, '')::int from public.site_settings where key = 'policy.cancel_hours'), 24);
begin
  perform app.portal_require(p_patient, 'appointments');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'ref', a.ref, 'start', lower(a.slot), 'end', upper(a.slot), 'status', a.status,
      'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
      'specialty_ar', sp.name_ar, 'specialty_en', sp.name_en,
      'can_cancel', a.status in ('requested', 'booked', 'pending_confirmation', 'confirmed') and lower(a.slot) > now() + make_interval(hours => v_hours),
      'can_survey', a.status = 'completed' and not exists (select 1 from public.satisfaction_surveys sv where sv.appointment_id = a.id)
    ) order by lower(a.slot) desc)
    from public.appointments a join public.staff s on s.id = a.doctor_id join public.specialties sp on sp.id = a.specialty_id
    where a.patient_id = p_patient), '[]'::jsonb);
end $$;

create or replace function public.portal_medical(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return jsonb_build_object(
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.created_at, 'summary', e.patient_summary,
                'instructions', e.patient_instructions, 'released_at', e.summary_released_at,
                'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
                'specialty_ar', sp.name_ar, 'specialty_en', sp.name_en) order by e.created_at desc)
              from public.encounters e join public.staff s on s.id = e.doctor_id join public.specialties sp on sp.id = e.specialty_id
              where e.patient_id = p_patient and e.status = 'signed' and e.summary_released_at is not null), '[]'::jsonb),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'date', r.signed_at, 'notes', r.notes_for_patient,
                'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
                'items', (select jsonb_agg(jsonb_build_object('drug', i.drug_name, 'strength', i.strength, 'form', i.form, 'dose', i.dose,
                            'frequency', i.frequency, 'duration', i.duration, 'instructions', i.instructions) order by i.sort_order)
                          from public.prescription_items i where i.prescription_id = r.id)) order by r.signed_at desc)
              from public.prescriptions r join public.staff s on s.id = r.doctor_id
              where r.patient_id = p_patient and r.status = 'signed' and r.released_at is not null), '[]'::jsonb),
    -- Allergies are shown to the patient themselves (safety); internal alert kinds are not exposed.
    'allergies', coalesce((select jsonb_agg(a.label) from public.patient_alerts a
                           where a.patient_id = p_patient and a.is_active and a.kind = 'allergy'), '[]'::jsonb)
  );
end $$;

create or replace function public.portal_finance(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return jsonb_build_object(
    'balance', coalesce((select sum(balance) from public.invoices where patient_id = p_patient and status in ('issued', 'partially_paid')), 0),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'issued_at', i.issued_at, 'status', i.status,
                  'total', i.total, 'paid', i.amount_paid, 'balance', i.balance, 'discount', i.discount_total,
                  'lines', (select jsonb_agg(jsonb_build_object('service_ar', sv.name_ar, 'service_en', sv.name_en, 'qty', l.quantity, 'net', l.line_total))
                            from public.invoice_lines l join public.services sv on sv.id = l.service_id where l.invoice_id = i.id),
                  'receipts', (select jsonb_agg(jsonb_build_object('receipt_no', p.receipt_no, 'amount', p.amount, 'method', p.method, 'at', p.received_at))
                               from public.payments p where p.invoice_id = i.id and p.status = 'posted')) order by i.issued_at desc)
              from public.invoices i where i.patient_id = p_patient and i.status <> 'draft'), '[]'::jsonb));
end $$;

-- Portal booking: a real free slot becomes a REQUESTED appointment (holds the time) and a lead
-- for Patient Relations to confirm.
create or replace function public.portal_book(p_patient uuid, p_doctor uuid, p_start timestamptz, p_note text default null)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_slot record; v_doc record; v_ref text; v_apt uuid; v_lead uuid;
begin
  perform app.portal_require(p_patient, 'appointments');
  select s.slot_start, s.slot_end into v_slot
    from public.public_available_slots(p_doctor, (p_start at time zone 'Africa/Cairo')::date, 1) s where s.slot_start = p_start;
  if v_slot is null then raise exception 'selected time is no longer available' using errcode = '22023'; end if;
  select branch_id, specialty_id into v_doc from public.staff where id = p_doctor;
  if (select count(*) from public.appointments where patient_id = p_patient and status = 'requested' and lower(slot) > now()) >= 3 then
    raise exception 'too many pending requests' using errcode = '54000';
  end if;
  insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, status, channel, notes_admin)
  values (v_doc.branch_id, p_patient, p_doctor, v_doc.specialty_id, tstzrange(v_slot.slot_start, v_slot.slot_end), 'requested', 'portal', left(p_note, 500))
  returning id, ref into v_apt, v_ref;
  insert into public.leads (branch_id, kind, channel, status, full_name, phone_raw, specialty_id, doctor_id, preferred_slot, message,
                            consent_contact, patient_id, appointment_id, created_by)
  select v_doc.branch_id, 'booking', 'portal', 'appointment_requested', p.first_name_ar || ' ' || p.last_name_ar, p.phone,
         v_doc.specialty_id, p_doctor, tstzrange(v_slot.slot_start, v_slot.slot_end), left(p_note, 1000), true, p.id, v_apt, null
  from public.patients p where p.id = p_patient returning id into v_lead;
  update public.appointments set source_lead_id = v_lead where id = v_apt;
  return v_ref;
end $$;

create or replace function public.portal_cancel(p_appointment uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare a public.appointments; v_hours int := coalesce((select nullif(value_en, '')::int from public.site_settings where key = 'policy.cancel_hours'), 24);
begin
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(a.patient_id, 'appointments');
  if a.status not in ('requested', 'booked', 'pending_confirmation', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled online' using errcode = '22023';
  end if;
  if lower(a.slot) <= now() + make_interval(hours => v_hours) then
    raise exception 'online cancellation closes % hours before the appointment', v_hours using errcode = '22023';
  end if;
  update public.appointments set status = 'canceled', cancel_reason = 'patient portal: ' || coalesce(nullif(trim(p_reason), ''), 'no reason given')
  where id = a.id;
end $$;

create or replace function public.portal_open_ticket(p_patient uuid, p_kind public.ticket_kind, p_subject text, p_body text default null)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_ref text;
begin
  perform app.portal_require(p_patient, 'appointments');
  if (select count(*) from public.support_tickets where patient_id = p_patient and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too many requests' using errcode = '54000';
  end if;
  insert into public.support_tickets (branch_id, patient_id, kind, subject, body, priority, due_at)
  select p.branch_id, p.id, p_kind, trim(p_subject), nullif(trim(p_body), ''),
         case when p_kind = 'complaint' then 'high' else 'normal' end,
         now() + case when p_kind = 'complaint' then interval '24 hours' else interval '4 hours' end
  from public.patients p where p.id = p_patient
  returning ref into v_ref;
  return v_ref;
end $$;

create or replace function public.portal_tickets(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'appointments');
  return coalesce((select jsonb_agg(jsonb_build_object('ref', t.ref, 'kind', t.kind, 'subject', t.subject, 'status', t.status,
                     'created_at', t.created_at, 'resolution', case when t.status in ('resolved', 'closed') then t.resolution end)
                   order by t.created_at desc) from public.support_tickets t where t.patient_id = p_patient), '[]'::jsonb);
end $$;

create or replace function public.portal_survey(p_appointment uuid, p_score int, p_comment text default null)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(a.patient_id, 'appointments');
  if a.status <> 'completed' then raise exception 'survey is available after the visit' using errcode = '22023'; end if;
  insert into public.satisfaction_surveys (appointment_id, patient_id, score, comment) values (a.id, a.patient_id, p_score, nullif(trim(p_comment), ''));
exception when unique_violation then
  raise exception 'survey already submitted' using errcode = '22023';
end $$;

create or replace function public.portal_update_profile(p_email text, p_emergency_name text, p_emergency_phone text, p_whatsapp boolean)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare me uuid := app.portal_patient();
begin
  if me is null then raise exception 'not found' using errcode = 'P0002'; end if;
  update public.patients set email = nullif(trim(p_email), ''), emergency_name = nullif(trim(p_emergency_name), ''),
    emergency_phone = nullif(trim(p_emergency_phone), '') where id = me;
  if p_whatsapp is not null and p_whatsapp is distinct from (select granted from public.patient_consent_current where patient_id = me and kind = 'whatsapp_messages') then
    insert into public.patient_consents (patient_id, kind, granted, document_code, document_version)
    values (me, 'whatsapp_messages', p_whatsapp, 'portal', 'portal-2026-09');
  end if;
end $$;

-- An adult patient shares THEIR file with another existing patient (both MRN and phone must match).
create or replace function public.portal_share_access(p_grantee_mrn text, p_grantee_phone text, p_level public.family_access_level,
                                                      p_relation text, p_days int default 365)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare me uuid := app.portal_patient(); v_grantee uuid;
begin
  if me is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select id into v_grantee from public.patients where mrn = upper(trim(p_grantee_mrn)) and phone = app.normalize_phone(p_grantee_phone) and merged_into is null;
  if v_grantee is null or v_grantee = me then raise exception 'no matching patient file' using errcode = '22023'; end if;
  insert into public.family_access_grants (patient_id, grantee_patient_id, level, relation, granted_via, expires_at)
  values (me, v_grantee, p_level, p_relation, 'patient', now() + make_interval(days => least(greatest(p_days, 1), 730)));
end $$;

create or replace function public.portal_revoke_access(p_grant uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  update public.family_access_grants set revoked_at = now(), revoked_by = auth.uid()
  where id = p_grant and patient_id = app.portal_patient() and revoked_at is null;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;

-- Staff: guardian / caregiver access (e.g. parent for a child), with evidence and expiry.
create or replace function public.staff_grant_family(p_patient uuid, p_grantee uuid, p_level public.family_access_level, p_relation text,
                                                     p_expires timestamptz, p_evidence text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_branch uuid; v_id uuid;
begin
  select branch_id into v_branch from public.patients where id = p_patient;
  perform app.require_permission('patient.write', v_branch);
  if coalesce(trim(p_evidence), '') = '' then raise exception 'evidence of relationship is required' using errcode = '22023'; end if;
  insert into public.family_access_grants (patient_id, grantee_patient_id, level, relation, granted_via, expires_at, evidence)
  values (p_patient, p_grantee, p_level, p_relation, 'staff', p_expires, trim(p_evidence)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.staff_revoke_family(p_grant uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_branch uuid;
begin
  select p.branch_id into v_branch from public.family_access_grants g join public.patients p on p.id = g.patient_id where g.id = p_grant;
  perform app.require_permission('patient.write', v_branch);
  update public.family_access_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant and revoked_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants for new tables (staff only; patients use the portal API)
-- ---------------------------------------------------------------------------
alter table public.drugs enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;
alter table public.patient_accounts enable row level security;
alter table public.family_access_grants enable row level security;
alter table public.support_tickets enable row level security;
alter table public.satisfaction_surveys enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_outbox enable row level security;
revoke all on public.drugs, public.prescriptions, public.prescription_items, public.patient_accounts, public.family_access_grants,
              public.support_tickets, public.satisfaction_surveys, public.message_templates, public.message_outbox from anon;

grant select, insert, update on public.drugs to authenticated;
create policy drugs_read on public.drugs for select to authenticated using (app.is_active_staff());
create policy drugs_write on public.drugs for insert to authenticated with check (app.has_permission('settings.manage') or app.has_permission('clinical.release'));
create policy drugs_update on public.drugs for update to authenticated using (app.has_permission('settings.manage') or app.has_permission('clinical.release'));

grant select, insert, update on public.prescriptions to authenticated;
create policy rx_read on public.prescriptions for select to authenticated
  using (app.has_permission('clinical.read', branch_id) or doctor_id = app.current_staff_id());
create policy rx_insert on public.prescriptions for insert to authenticated
  with check (doctor_id = app.current_staff_id() and app.has_permission('clinical.write.own', branch_id)
              and exists (select 1 from public.encounters e where e.id = encounter_id and e.doctor_id = app.current_staff_id() and e.patient_id = prescriptions.patient_id));
create policy rx_update on public.prescriptions for update to authenticated
  using (doctor_id = app.current_staff_id()) with check (doctor_id = app.current_staff_id());

grant select, insert, update, delete on public.prescription_items to authenticated;
create policy rx_items_read on public.prescription_items for select to authenticated
  using (exists (select 1 from public.prescriptions r where r.id = prescription_id));
create policy rx_items_write on public.prescription_items for insert to authenticated
  with check (exists (select 1 from public.prescriptions r where r.id = prescription_id and r.doctor_id = app.current_staff_id()));
create policy rx_items_update on public.prescription_items for update to authenticated
  using (exists (select 1 from public.prescriptions r where r.id = prescription_id and r.doctor_id = app.current_staff_id()));
create policy rx_items_delete on public.prescription_items for delete to authenticated
  using (exists (select 1 from public.prescriptions r where r.id = prescription_id and r.doctor_id = app.current_staff_id()));

grant select on public.patient_accounts, public.family_access_grants to authenticated;
create policy accounts_read on public.patient_accounts for select to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id and app.has_permission('patient.read', p.branch_id)));
create policy family_read on public.family_access_grants for select to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id and app.has_permission('patient.read', p.branch_id)));

grant select, update on public.support_tickets to authenticated;
create policy tickets_read on public.support_tickets for select to authenticated using (app.has_permission('ticket.read', branch_id));
create policy tickets_update on public.support_tickets for update to authenticated
  using (app.has_permission('ticket.write', branch_id)) with check (app.has_permission('ticket.write', branch_id));

grant select on public.satisfaction_surveys to authenticated;
create policy surveys_read on public.satisfaction_surveys for select to authenticated
  using (app.has_permission('ticket.read') or app.has_permission('reports.read'));

grant select, update on public.message_templates to authenticated;
create policy templates_read on public.message_templates for select to authenticated using (app.has_permission('messages.manage'));
create policy templates_update on public.message_templates for update to authenticated using (app.has_permission('messages.manage'));

grant select on public.message_outbox to authenticated;
create policy outbox_read on public.message_outbox for select to authenticated using (app.has_permission('messages.manage'));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.sign_prescription(uuid, boolean), public.release_to_patient(text, uuid, text, text), public.retry_message(uuid),
  public.staff_grant_family(uuid, uuid, public.family_access_level, text, timestamptz, text), public.staff_revoke_family(uuid),
  public.portal_me(), public.portal_appointments(uuid), public.portal_medical(uuid), public.portal_finance(uuid),
  public.portal_book(uuid, uuid, timestamptz, text), public.portal_cancel(uuid, text),
  public.portal_open_ticket(uuid, public.ticket_kind, text, text), public.portal_tickets(uuid), public.portal_survey(uuid, int, text),
  public.portal_update_profile(text, text, text, boolean),
  public.portal_share_access(text, text, public.family_access_level, text, int), public.portal_revoke_access(uuid)
  to authenticated;

-- Re-grant everything granted earlier (revoke-all above resets the explicit list).
grant execute on function
  public.my_permissions(), public.my_roles(), public.find_patient_duplicates(text, text, text, date),
  public.patient_alert_flags(uuid), public.patient_directory(uuid[]),
  public.transition_appointment(uuid, public.appointment_status, text), public.sign_encounter(uuid),
  public.service_price(uuid, uuid, date), public.issue_invoice(uuid),
  public.record_payment(uuid, numeric, text, text, text), public.void_invoice(uuid, text),
  public.open_cashier_session(uuid, numeric), public.close_cashier_session(uuid, numeric, text),
  public.reverse_journal_entry(uuid, text), public.trial_balance(uuid, date, date), public.lock_fiscal_period(uuid),
  public.content_transition(text, uuid, public.content_status, text), public.lead_link_appointment(uuid, uuid, uuid),
  public.staff_available_slots(uuid, date, int)
  to authenticated;
grant execute on function app.has_permission(text, uuid), app.current_staff_id(), app.current_user_id(),
  app.normalize_name(text), app.normalize_phone(text), app.is_treating_doctor(uuid),
  app.can_read_patient(uuid, uuid), app.can_read_clinical(uuid, uuid), app.is_active_staff(),
  app.next_ref(text, boolean), app.touch_updated_at(), app.appointment_transition_allowed(public.appointment_status, public.appointment_status),
  app.is_live(public.content_status, jsonb, timestamptz), app.content_payload(jsonb), app.content_meta_keys()
  to authenticated;
grant execute on function
  public.public_site(), public.public_specialties(), public.public_specialty(text), public.public_doctors(text),
  public.public_doctor(text), public.public_offers(text), public.public_landing(text),
  public.public_available_slots(uuid, date, int), public.submit_web_inquiry(jsonb)
  to anon, authenticated;

grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;
grant select, insert, update on app.portal_otps to service_role;
