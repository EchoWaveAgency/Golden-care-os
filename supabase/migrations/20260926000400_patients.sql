-- Golden Care OS — 0004 Master patient record
-- Demographics live here. Clinical content lives in clinical tables with stricter access.

create type public.sex as enum ('female', 'male', 'unknown');
create type public.contact_channel as enum ('whatsapp', 'call', 'sms', 'email', 'none');

create table public.families (
  id          uuid primary key default gen_random_uuid(),
  family_no   text not null unique default app.next_ref('F', false),
  branch_id   uuid not null references public.branches(id),
  label       text,
  created_at  timestamptz not null default now()
);

create table public.patients (
  id              uuid primary key default gen_random_uuid(),
  mrn             text not null unique default app.next_ref('P', false),
  branch_id       uuid not null references public.branches(id),   -- registering branch
  family_id       uuid references public.families(id),
  family_relation text,                                             -- head, spouse, child…
  first_name_ar   text not null,
  last_name_ar    text not null,
  first_name_en   text,
  last_name_en    text,
  name_search     text generated always as (
                    app.normalize_name(first_name_ar || ' ' || last_name_ar || ' ' ||
                                       coalesce(first_name_en, '') || ' ' || coalesce(last_name_en, ''))
                  ) stored,
  sex             public.sex not null default 'unknown',
  date_of_birth   date check (date_of_birth <= current_date),
  national_id     text check (national_id is null or national_id ~ '^[0-9]{14}$'),
  passport_no     text,
  nationality     char(2) default 'EG',
  phone_raw       text not null,
  phone           text not null,          -- normalized E.164, set by trigger
  phone_alt       text,
  email           text,
  preferred_channel public.contact_channel not null default 'whatsapp',
  address         text,
  emergency_name  text,
  emergency_phone text,
  referral_source text,
  notes_admin     text,                   -- non-clinical front-office notes only
  is_archived     boolean not null default false,
  merged_into     uuid references public.patients(id),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index patients_national_id_uq on public.patients (national_id) where national_id is not null and merged_into is null;
create index patients_phone_idx on public.patients (phone);
create index patients_name_trgm on public.patients using gin (name_search extensions.gin_trgm_ops);
create index patients_branch_idx on public.patients (branch_id);

create or replace function app.patients_normalize()
returns trigger language plpgsql as $$
begin
  new.phone := app.normalize_phone(new.phone_raw);
  if new.phone is null then
    raise exception 'invalid phone number: %', new.phone_raw using errcode = '22023';
  end if;
  new.phone_alt := coalesce(app.normalize_phone(new.phone_alt), new.phone_alt);
  new.emergency_phone := coalesce(app.normalize_phone(new.emergency_phone), new.emergency_phone);
  return new;
end $$;

create trigger trg_patients_normalize before insert or update of phone_raw, phone_alt, emergency_phone
  on public.patients for each row execute function app.patients_normalize();
create trigger trg_patients_updated before update on public.patients
  for each row execute function app.touch_updated_at();
create trigger trg_audit_patients after insert or update or delete on public.patients
  for each row execute function app.audit_row();

-- Patients are never physically deleted.
create or replace function app.block_delete()
returns trigger language plpgsql as $$
begin
  raise exception '% rows cannot be deleted; archive, void or reverse instead', tg_table_name
    using errcode = '42501';
end $$;
create trigger trg_patients_no_delete before delete on public.patients
  for each row execute function app.block_delete();

-- Clinical alerts: allergies, chronic conditions, contraindications, pregnancy, etc.
create type public.alert_kind as enum ('allergy', 'chronic_condition', 'medication', 'contraindication', 'pregnancy', 'other');
create type public.alert_severity as enum ('info', 'moderate', 'high');

create table public.patient_alerts (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id),
  kind        public.alert_kind not null,
  severity    public.alert_severity not null default 'moderate',
  label       text not null,
  details     text,
  is_active   boolean not null default true,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.patient_alerts (patient_id) where is_active;
create trigger trg_audit_patient_alerts after insert or update or delete on public.patient_alerts
  for each row execute function app.audit_row();
create trigger trg_patient_alerts_no_delete before delete on public.patient_alerts
  for each row execute function app.block_delete();

-- Consents (treatment, photography, communication, data sharing). Versioned by document.
create type public.consent_kind as enum ('treatment', 'clinical_photography', 'whatsapp_messages', 'marketing', 'data_sharing', 'portal_access');

create table public.patient_consents (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id),
  kind          public.consent_kind not null,
  granted       boolean not null,
  document_code text,             -- consent template code
  document_version text,
  captured_by   uuid default auth.uid(),
  captured_at   timestamptz not null default now(),
  evidence_path text              -- signed form in private storage
);
create index on public.patient_consents (patient_id, kind, captured_at desc);
create trigger trg_audit_patient_consents after insert or update or delete on public.patient_consents
  for each row execute function app.audit_row();
create trigger trg_patient_consents_no_mutation before update or delete on public.patient_consents
  for each row execute function app.block_delete();

-- Latest consent state per kind.
create view public.patient_consent_current with (security_invoker = true) as
  select distinct on (patient_id, kind) patient_id, kind, granted, captured_at, document_version
  from public.patient_consents
  order by patient_id, kind, captured_at desc;

-- Duplicate candidates for a new registration (phone, national ID, similar name + DOB).
create or replace function public.find_patient_duplicates(
  p_phone text, p_national_id text default null, p_name text default null, p_dob date default null)
returns table (patient_id uuid, mrn text, full_name text, phone text, match_reason text, score real)
language sql stable security invoker set search_path = public, app, extensions, pg_temp as $$
  with q as (select app.normalize_phone(p_phone) ph, app.normalize_name(p_name) nm)
  select p.id, p.mrn, p.first_name_ar || ' ' || p.last_name_ar, p.phone,
         case when p.national_id is not null and p.national_id = p_national_id then 'national_id'
              when p.phone = q.ph then 'phone'
              else 'name_dob' end,
         case when p.national_id is not null and p.national_id = p_national_id then 1.0
              when p.phone = q.ph then 0.9
              else similarity(p.name_search, q.nm) end::real
  from public.patients p, q
  where p.merged_into is null
    and ( (p_national_id is not null and p.national_id = p_national_id)
       or p.phone = q.ph
       or (q.nm is not null and p_dob is not null and p.date_of_birth = p_dob and similarity(p.name_search, q.nm) > 0.45))
  order by 6 desc
  limit 10
$$;
