-- Golden Care OS — 0010 Website, CMS, offers, landing pages, leads funnel, online availability
-- One database: the public website reads ONLY approved, published, non-expired records through
-- SECURITY DEFINER functions. Anonymous visitors never touch tables directly.

-- New functions must not be executable by PUBLIC (anon) by default.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Permissions and marketing role
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('lead.read',                 'crm',     'Read inquiries and leads'),
  ('lead.write',                'crm',     'Work inquiries: contact, qualify, convert, close'),
  ('content.edit',              'website', 'Edit website content drafts'),
  ('content.medical_approve',   'website', 'Medical approval of website content'),
  ('content.marketing_approve', 'website', 'Marketing approval of website content'),
  ('content.publish',           'website', 'Publish, schedule and archive approved content'),
  ('marketing.read',            'website', 'Aggregated marketing and funnel reports');

insert into public.roles (code, name_ar, name_en, is_privileged) values
  ('marketing', 'التسويق والمحتوى', 'Marketing & Content', false);

insert into public.role_permissions (role_code, permission_code) values
  ('patient_relations', 'lead.read'), ('patient_relations', 'lead.write'),
  ('front_desk', 'lead.read'), ('front_desk', 'lead.write'),
  ('operations_manager', 'lead.read'), ('operations_manager', 'marketing.read'),
  ('center_director', 'lead.read'), ('center_director', 'marketing.read'), ('center_director', 'content.publish'),
  ('medical_director', 'content.edit'), ('medical_director', 'content.medical_approve'),
  ('marketing', 'content.edit'), ('marketing', 'content.marketing_approve'), ('marketing', 'content.publish'),
  ('marketing', 'marketing.read'), ('marketing', 'lead.read'),
  ('owner', 'marketing.read');

-- ---------------------------------------------------------------------------
-- Site settings (contact details are configurable, never hard-coded)
-- ---------------------------------------------------------------------------
create table public.site_settings (
  key        text primary key check (key ~ '^[a-z0-9_.]+$'),
  value_ar   text,
  value_en   text,
  is_public  boolean not null default true,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger trg_audit_site_settings after insert or update or delete on public.site_settings
  for each row execute function app.audit_row();

insert into public.site_settings (key, value_ar, value_en) values
  ('address',        'مدينة الشروق — تاون سنتر مول — الدور الثالث', 'Madinat El Shorouk — Town Center Mall — Third Floor'),
  ('mobile',         null, null),          -- set by administrators
  ('whatsapp',       null, null),          -- E.164 digits, e.g. 2010xxxxxxxx
  ('map_url',        null, null),
  ('hours',          null, null),
  ('email',          null, null),
  ('analytics.ga4',  null, null),          -- measurement ID, loaded only after consent
  ('analytics.meta_pixel', null, null),
  ('analytics.tiktok_pixel', null, null),
  ('analytics.google_ads', null, null);

-- ---------------------------------------------------------------------------
-- Content workflow shared by all website content
-- Draft → Medical Review → Marketing Review → Approved → (Scheduled) → Published → Archived
-- Editing a non-draft item sends it back to Draft and clears approvals, while the last
-- PUBLISHED snapshot stays live until a new version is published.
-- ---------------------------------------------------------------------------
create type public.content_status as enum
  ('draft', 'medical_review', 'marketing_review', 'approved', 'scheduled', 'published', 'archived');

create table public.content_revisions (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid not null,
  version     int not null,
  status      public.content_status not null,
  data        jsonb not null,
  actor_id    uuid default auth.uid(),
  note        text,
  created_at  timestamptz not null default now()
);
create index on public.content_revisions (table_name, record_id, version desc);

-- Columns that belong to the workflow, not to the content itself.
create or replace function app.content_meta_keys()
returns text[] language sql immutable as $$
  select array['id','status','published_data','published_at','publish_at','medical_approved_by','medical_approved_at',
               'marketing_approved_by','marketing_approved_at','version','created_by','updated_by','created_at',
               'updated_at','capacity_used','requires_medical','review_note']
$$;

create or replace function app.content_payload(r jsonb)
returns jsonb language sql immutable as $$
  select r - app.content_meta_keys()
$$;

create or replace function app.content_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare changed boolean;
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.version := 1; new.published_data := null; new.published_at := null;
    new.medical_approved_by := null; new.marketing_approved_by := null;
    new.created_by := auth.uid(); new.updated_by := auth.uid();
    return new;
  end if;
  changed := app.content_payload(to_jsonb(new)) is distinct from app.content_payload(to_jsonb(old))
          or new.publish_at is distinct from old.publish_at;
  if changed then
    if coalesce(current_setting('app.content_rpc', true), '') <> 'on' and old.status <> 'draft' then
      -- Any edit to reviewed content restarts review.
      new.status := 'draft';
      new.medical_approved_by := null; new.medical_approved_at := null;
      new.marketing_approved_by := null; new.marketing_approved_at := null;
    end if;
    new.version := old.version + 1;
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif coalesce(current_setting('app.content_rpc', true), '') <> 'on' then
    -- Workflow fields change only through content_transition().
    if new.status is distinct from old.status or new.published_data is distinct from old.published_data
       or new.medical_approved_by is distinct from old.medical_approved_by
       or new.marketing_approved_by is distinct from old.marketing_approved_by then
      raise exception 'use content_transition to change content status' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function app.content_revision()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.content_revisions (table_name, record_id, version, status, data, note)
  values (tg_table_name, new.id, new.version, new.status, app.content_payload(to_jsonb(new)), new.review_note);
  return null;
end $$;

-- Helper macro: every content table gets the same workflow columns.
-- (Written out per table for clarity and so migrations stay explicit.)

create table public.site_specialty_pages (
  id            uuid primary key default gen_random_uuid(),
  specialty_id  uuid not null unique references public.specialties(id),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title_ar text not null, title_en text not null,
  summary_ar text, summary_en text,
  body_ar text, body_en text,
  preparation_ar text, preparation_en text,
  faq           jsonb not null default '[]'::jsonb,   -- [{q_ar,a_ar,q_en,a_en}]
  sort_order    int not null default 0,
  review_due_at date,                                 -- medical content re-review date
  -- workflow
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.site_doctor_profiles (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null unique references public.staff(id),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title_ar text, title_en text,
  bio_ar text, bio_en text,
  qualifications_ar text, qualifications_en text,
  languages     text[] not null default array['ar'],
  photo_url     text,
  accepts_online_booking boolean not null default true,
  sort_order    int not null default 0,
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.offers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  branch_id     uuid not null references public.branches(id),
  specialty_id  uuid references public.specialties(id),
  service_id    uuid not null references public.services(id),
  title_ar text not null, title_en text not null,
  summary_ar text, summary_en text,
  terms_ar text not null, terms_en text not null,          -- eligibility, exclusions, refund & cancellation
  disclaimer_ar text, disclaimer_en text,                  -- medical suitability
  price         numeric(14,2) not null check (price >= 0),
  regular_price numeric(14,2) check (regular_price is null or regular_price > price),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  capacity      int check (capacity is null or capacity > 0),
  capacity_used int not null default 0,
  eligible_doctor_ids uuid[] not null default '{}',
  constraint offer_window check (ends_at > starts_at),
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.landing_pages (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  campaign_name text not null,
  specialty_id  uuid references public.specialties(id),
  service_id    uuid references public.services(id),
  offer_id      uuid references public.offers(id),
  doctor_ids    uuid[] not null default '{}',
  title_ar text not null, title_en text not null,
  hero_ar text, hero_en text,
  body_ar text, body_en text,
  benefits      jsonb not null default '[]'::jsonb,       -- [{ar,en}] approved claims only
  faq           jsonb not null default '[]'::jsonb,
  cta_variant   text not null default 'book' check (cta_variant in ('book', 'callback', 'whatsapp')),
  show_countdown boolean not null default false,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  constraint lp_window check (ends_at is null or ends_at > starts_at),
  constraint countdown_needs_real_expiry check (not show_countdown or ends_at is not null),
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['site_specialty_pages','site_doctor_profiles','offers','landing_pages'] loop
    execute format('create trigger trg_%1$s_guard before insert or update on public.%1$I for each row execute function app.content_guard()', t);
    execute format('create trigger trg_%1$s_revision after insert or update on public.%1$I for each row execute function app.content_revision()', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function app.audit_row()', t);
    execute format('create trigger trg_%1$s_no_delete before delete on public.%1$I for each row execute function app.block_delete()', t);
  end loop;
end $$;

-- Workflow transitions with role checks and separation of duties.
create or replace function public.content_transition(p_table text, p_id uuid, p_to public.content_status, p_note text default null)
returns public.content_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_from public.content_status; v_requires boolean; v_editor uuid; v_publish_at timestamptz; v_final public.content_status;
begin
  if p_table not in ('site_specialty_pages', 'site_doctor_profiles', 'offers', 'landing_pages') then
    raise exception 'unknown content type %', p_table using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', p_table) into r using p_id;
  if r is null then raise exception 'content not found' using errcode = 'P0002'; end if;
  v_from := (r->>'status')::public.content_status;
  v_requires := (r->>'requires_medical')::boolean;
  v_editor := nullif(r->>'updated_by', '')::uuid;
  v_publish_at := nullif(r->>'publish_at', '')::timestamptz;

  if not (
       (v_from = 'draft'            and p_to = 'medical_review'   and v_requires)
    or (v_from = 'draft'            and p_to = 'marketing_review' and not v_requires)
    or (v_from = 'medical_review'   and p_to in ('marketing_review', 'draft'))
    or (v_from = 'marketing_review' and p_to in ('approved', 'draft'))
    or (v_from = 'approved'         and p_to in ('published', 'draft'))
    or (v_from in ('published', 'scheduled') and p_to = 'archived')
    or (v_from = 'archived'         and p_to = 'draft')
  ) then
    raise exception 'invalid content transition % -> %', v_from, p_to using errcode = '22023';
  end if;

  if v_from = 'draft' then perform app.require_permission('content.edit');
  elsif v_from = 'medical_review' then perform app.require_permission('content.medical_approve');
  elsif v_from = 'marketing_review' then perform app.require_permission('content.marketing_approve');
  elsif v_from in ('approved', 'published', 'scheduled') then perform app.require_permission('content.publish');
  else perform app.require_permission('content.edit');
  end if;

  -- A clinician cannot medically approve content they edited themselves.
  if v_from = 'medical_review' and p_to = 'marketing_review' and v_editor = auth.uid() then
    raise exception 'separation of duties: the last editor cannot medically approve this content' using errcode = '42501';
  end if;
  if p_to = 'draft' and v_from in ('medical_review', 'marketing_review') and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required when sending content back' using errcode = '22023';
  end if;

  perform set_config('app.content_rpc', 'on', true);
  v_final := p_to;
  if p_to = 'published' and v_publish_at is not null and v_publish_at > now() then v_final := 'scheduled'; end if;

  execute format($f$
    update public.%I set
      status = $2,
      review_note = coalesce($3, review_note),
      medical_approved_by   = case when $4 = 'medical_review' and $2 = 'marketing_review' then auth.uid() else medical_approved_by end,
      medical_approved_at   = case when $4 = 'medical_review' and $2 = 'marketing_review' then now() else medical_approved_at end,
      marketing_approved_by = case when $4 = 'marketing_review' and $2 = 'approved' then auth.uid() else marketing_approved_by end,
      marketing_approved_at = case when $4 = 'marketing_review' and $2 = 'approved' then now() else marketing_approved_at end,
      published_data = case when $2 in ('published', 'scheduled') then app.content_payload(to_jsonb(%I.*)) else published_data end,
      published_at   = case when $2 in ('published', 'scheduled') then coalesce(publish_at, now()) else published_at end
    where id = $1$f$, p_table, p_table)
  using p_id, v_final, p_note, v_from;

  -- Record the transition in the revision log even though content did not change.
  insert into public.content_revisions (table_name, record_id, version, status, data, note)
  values (p_table, p_id, (r->>'version')::int, v_final, app.content_payload(r), p_note);
  return v_final;
end $$;

-- Live = has a published snapshot, is not archived, and its publish time has arrived.
create or replace function app.is_live(p_status public.content_status, p_published_data jsonb, p_published_at timestamptz)
returns boolean language sql stable as $$
  select p_published_data is not null and p_status <> 'archived' and p_published_at <= now()
$$;

-- ---------------------------------------------------------------------------
-- Services exposed on the website only when explicitly allowed
-- ---------------------------------------------------------------------------
alter table public.services
  add column public_visible boolean not null default false,
  add column public_show_price boolean not null default false,
  add column online_bookable boolean not null default false;

-- Offer price and terms are frozen on the appointment at booking time.
alter table public.appointments
  add column offer_id uuid references public.offers(id),
  add column offer_price numeric(14,2),
  add column offer_terms jsonb,
  add column source_lead_id uuid;

-- ---------------------------------------------------------------------------
-- Leads / inquiries (Patient Experience & Relations)
-- ---------------------------------------------------------------------------
create type public.lead_status as enum (
  'inquiry', 'contacted', 'qualified', 'appointment_requested', 'appointment_confirmed',
  'arrived', 'visit_completed', 'follow_up_completed', 'closed'
);
create type public.lead_kind as enum ('booking', 'callback', 'inquiry');

create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default app.next_ref('LD'),
  branch_id      uuid not null references public.branches(id),
  kind           public.lead_kind not null default 'inquiry',
  channel        public.booking_channel not null default 'website',
  status         public.lead_status not null default 'inquiry',
  close_reason   text,
  full_name      text not null check (length(trim(full_name)) between 2 and 120),
  phone_raw      text not null,
  phone          text not null,
  email          text,
  lang           text not null default 'ar' check (lang in ('ar', 'en')),
  specialty_id   uuid references public.specialties(id),
  service_id     uuid references public.services(id),
  doctor_id      uuid references public.staff(id),
  offer_id       uuid references public.offers(id),
  landing_page_id uuid references public.landing_pages(id),
  preferred_slot tstzrange,
  message        text check (message is null or length(message) <= 1000),
  consent_contact boolean not null,
  consent_marketing boolean not null default false,
  consent_version text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  page_path      text,
  patient_id     uuid references public.patients(id),
  appointment_id uuid references public.appointments(id),
  assigned_to    uuid references auth.users(id),
  due_at         timestamptz,
  first_contact_at timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint consent_required check (consent_contact)
);
create index on public.leads (status, due_at);
create index on public.leads (phone, created_at desc);
alter table public.appointments add constraint appointments_source_lead_fk foreign key (source_lead_id) references public.leads(id);

create table public.lead_activities (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads(id),
  kind       text not null check (kind in ('note', 'call', 'whatsapp', 'status', 'system', 'web')),
  body       text,
  actor_id   uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.lead_activities (lead_id, created_at);

create or replace function app.leads_normalize()
returns trigger language plpgsql as $$
begin
  new.phone := app.normalize_phone(new.phone_raw);
  if new.phone is null then raise exception 'invalid phone number: %', new.phone_raw using errcode = '22023'; end if;
  if tg_op = 'INSERT' and new.due_at is null then new.due_at := now() + interval '30 minutes'; end if;  -- default SLA
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status is distinct from old.status then
      insert into public.lead_activities (lead_id, kind, body) values (new.id, 'status', old.status || ' → ' || new.status);
      if old.status = 'inquiry' and new.first_contact_at is null then new.first_contact_at := now(); end if;
      if new.status = 'closed' and coalesce(trim(new.close_reason), '') = '' then
        raise exception 'close reason is required' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_leads_normalize before insert or update on public.leads
  for each row execute function app.leads_normalize();
create trigger trg_audit_leads after insert or update on public.leads
  for each row execute function app.audit_row();
create trigger trg_leads_no_delete before delete on public.leads
  for each row execute function app.block_delete();
create trigger trg_lead_activities_immutable before update or delete on public.lead_activities
  for each row execute function app.block_delete();

-- Funnel follows the linked appointment automatically (never moves backwards).
create or replace function app.lead_follow_appointment()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.lead_status;
begin
  v := case new.status
         when 'requested' then 'appointment_requested'
         when 'booked' then 'appointment_confirmed'
         when 'pending_confirmation' then 'appointment_requested'
         when 'confirmed' then 'appointment_confirmed'
         when 'arrived' then 'arrived' when 'waiting' then 'arrived'
         when 'in_consultation' then 'arrived' when 'procedure_in_progress' then 'arrived'
         when 'awaiting_payment' then 'arrived'
         when 'completed' then 'visit_completed'
         else null end;
  if v is null then
    insert into public.lead_activities (lead_id, kind, body)
    select l.id, 'system', 'appointment ' || new.status from public.leads l where l.appointment_id = new.id;
    return null;
  end if;
  update public.leads l set status = v
  where l.appointment_id = new.id and l.status < v and l.status <> 'closed';
  return null;
end $$;
create trigger trg_appointments_lead_funnel after insert or update of status on public.appointments
  for each row execute function app.lead_follow_appointment();

-- Staff: link a lead to the patient and appointment created from it.
create or replace function public.lead_link_appointment(p_lead uuid, p_patient uuid, p_appointment uuid)
returns public.leads language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.leads; a public.appointments; o public.offers;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  perform app.require_permission('lead.write', l.branch_id);
  select * into a from public.appointments where id = p_appointment for update;
  if a.patient_id <> p_patient then raise exception 'appointment belongs to another patient' using errcode = '22023'; end if;

  -- Freeze offer terms on the appointment and consume capacity once.
  if l.offer_id is not null and a.offer_id is null then
    select * into o from public.offers where id = l.offer_id for update;
    if not app.is_live(o.status, o.published_data, o.published_at) or now() > o.ends_at
       or (o.capacity is not null and o.capacity_used >= o.capacity) then
      raise exception 'offer is no longer available' using errcode = '22023';
    end if;
    update public.appointments set offer_id = o.id, offer_price = (o.published_data->>'price')::numeric,
      offer_terms = jsonb_build_object('title_ar', o.published_data->>'title_ar', 'title_en', o.published_data->>'title_en',
                                       'terms_ar', o.published_data->>'terms_ar', 'terms_en', o.published_data->>'terms_en',
                                       'service_id', o.service_id, 'offer_version', o.version, 'frozen_at', now())
    where id = a.id;
    perform set_config('app.content_rpc', 'on', true);
    update public.offers set capacity_used = capacity_used + 1 where id = o.id;
  end if;
  update public.appointments set source_lead_id = l.id where id = a.id;

  update public.leads set patient_id = p_patient, appointment_id = p_appointment,
    status = greatest(status, case when a.status in ('requested', 'pending_confirmation') then 'appointment_requested'::public.lead_status
                                   else 'appointment_confirmed'::public.lead_status end)
  where id = l.id returning * into l;
  insert into public.lead_activities (lead_id, kind, body) values (l.id, 'system', 'linked to appointment ' || a.ref);
  return l;
end $$;

-- ---------------------------------------------------------------------------
-- Availability computed from schedules, exceptions and existing bookings
-- ---------------------------------------------------------------------------
create or replace function app.available_slots(p_doctor uuid, p_from date, p_days int, p_lead interval default interval '0')
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with days as (
    select d::date as day
    from generate_series(p_from, p_from + (least(greatest(p_days, 1), 21) - 1), interval '1 day') d
  ), sched as (
    select ds.*, days.day from public.doctor_schedules ds
    join days on extract(dow from days.day)::int = ds.weekday
    where ds.doctor_id = p_doctor and days.day >= ds.valid_from and (ds.valid_to is null or days.day <= ds.valid_to)
  ), cand as (
    select (ts at time zone 'Africa/Cairo') as st,
           ((ts + make_interval(mins => s.slot_minutes)) at time zone 'Africa/Cairo') as en,
           s.branch_id, s.room_id
    from sched s,
         generate_series(s.day + s.start_time, s.day + s.end_time - make_interval(mins => s.slot_minutes),
                         make_interval(mins => s.slot_minutes)) ts
  )
  select c.st, c.en from cand c
  where c.st > now() + p_lead
    and not exists (select 1 from public.appointments a
                    where a.doctor_id = p_doctor and a.status not in ('canceled', 'no_show')
                      and a.slot && tstzrange(c.st, c.en))
    and not exists (select 1 from public.appointments a
                    where c.room_id is not null and a.room_id = c.room_id and a.status not in ('canceled', 'no_show')
                      and a.slot && tstzrange(c.st, c.en))
    and not exists (select 1 from public.schedule_exceptions x
                    where x.branch_id = c.branch_id and (x.doctor_id is null or x.doctor_id = p_doctor)
                      and x.kind in ('leave', 'holiday', 'blocked') and x.period && tstzrange(c.st, c.en))
  order by c.st
$$;

create or replace function public.staff_available_slots(p_doctor uuid, p_from date, p_days int default 7)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('appointment.write');
  return query select * from app.available_slots(p_doctor, p_from, p_days);
end $$;

-- ---------------------------------------------------------------------------
-- PUBLIC API (anonymous website). Only approved, published, active data.
-- ---------------------------------------------------------------------------
create or replace function public.public_site()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('ar', value_ar, 'en', value_en)), '{}'::jsonb)
  from public.site_settings where is_public
$$;

create or replace function public.public_specialties()
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(p.published_data || jsonb_build_object('code', s.code) order by p.sort_order, s.sort_order), '[]'::jsonb)
  from public.site_specialty_pages p join public.specialties s on s.id = p.specialty_id
  where s.is_active and app.is_live(p.status, p.published_data, p.published_at)
$$;

create or replace function app.public_doctor_json(d public.site_doctor_profiles)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select d.published_data - 'staff_id' || jsonb_build_object(
    'id', st.id, 'name_ar', st.full_name_ar, 'name_en', coalesce(st.full_name_en, st.full_name_ar),
    'specialty', jsonb_build_object('code', sp.code, 'name_ar', sp.name_ar, 'name_en', sp.name_en,
                                    'slug', (select pg.published_data->>'slug' from public.site_specialty_pages pg
                                             where pg.specialty_id = sp.id and app.is_live(pg.status, pg.published_data, pg.published_at))))
  from public.staff st join public.specialties sp on sp.id = st.specialty_id
  where st.id = d.staff_id and st.is_active
$$;

create or replace function public.public_doctors(p_specialty_slug text default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(app.public_doctor_json(d) order by d.sort_order), '[]'::jsonb)
  from public.site_doctor_profiles d join public.staff st on st.id = d.staff_id and st.is_active
  where app.is_live(d.status, d.published_data, d.published_at)
    and (p_specialty_slug is null or exists (
      select 1 from public.site_specialty_pages pg
      where pg.specialty_id = st.specialty_id and pg.published_data->>'slug' = p_specialty_slug
        and app.is_live(pg.status, pg.published_data, pg.published_at)))
$$;

create or replace function public.public_doctor(p_slug text)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.public_doctor_json(d) from public.site_doctor_profiles d
  where d.published_data->>'slug' = p_slug and app.is_live(d.status, d.published_data, d.published_at)
$$;

create or replace function app.offer_is_active(o public.offers)
returns boolean language sql stable as $$
  select app.is_live(o.status, o.published_data, o.published_at)
     and now() >= (o.published_data->>'starts_at')::timestamptz and now() < (o.published_data->>'ends_at')::timestamptz
     and (o.capacity is null or o.capacity_used < o.capacity)
     and exists (select 1 from public.services s where s.id = o.service_id and s.is_active)
$$;

create or replace function public.public_offers(p_specialty_slug text default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(o.published_data - 'eligible_doctor_ids' order by (o.published_data->>'ends_at')), '[]'::jsonb)
  from public.offers o
  where app.offer_is_active(o)
    and (p_specialty_slug is null or exists (
      select 1 from public.site_specialty_pages pg where pg.specialty_id = o.specialty_id
        and pg.published_data->>'slug' = p_specialty_slug and app.is_live(pg.status, pg.published_data, pg.published_at)))
$$;

create or replace function public.public_specialty(p_slug text)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.published_data || jsonb_build_object(
    'code', s.code,
    'doctors', public.public_doctors(p_slug),
    'offers', public.public_offers(p_slug),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', sv.code, 'name_ar', sv.name_ar, 'name_en', sv.name_en,
               'price', case when sv.public_show_price then public.service_price(sv.id, b.id) end,
               'online_bookable', sv.online_bookable) order by sv.code)
      from public.services sv
      cross join lateral (select id from public.branches where is_active order by code limit 1) b
      where sv.specialty_id = s.id and sv.is_active and sv.public_visible), '[]'::jsonb))
  from public.site_specialty_pages p join public.specialties s on s.id = p.specialty_id
  where p.published_data->>'slug' = p_slug and app.is_live(p.status, p.published_data, p.published_at)
$$;

create or replace function public.public_landing(p_slug text)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select l.published_data - 'doctor_ids' || jsonb_build_object(
    'offer', (select o.published_data - 'eligible_doctor_ids' from public.offers o where o.id = l.offer_id and app.offer_is_active(o)),
    'doctors', coalesce((select jsonb_agg(app.public_doctor_json(d)) from public.site_doctor_profiles d
                         where d.staff_id = any(l.doctor_ids) and app.is_live(d.status, d.published_data, d.published_at)), '[]'::jsonb),
    'specialty_slug', (select pg.published_data->>'slug' from public.site_specialty_pages pg
                       where pg.specialty_id = l.specialty_id and app.is_live(pg.status, pg.published_data, pg.published_at)))
  from public.landing_pages l
  where l.published_data->>'slug' = p_slug and app.is_live(l.status, l.published_data, l.published_at)
    and now() >= (l.published_data->>'starts_at')::timestamptz
    and (l.published_data->>'ends_at' is null or now() < (l.published_data->>'ends_at')::timestamptz)
$$;

-- Online availability: only doctors with a live profile that accepts online booking; 2-hour lead time.
create or replace function public.public_available_slots(p_doctor uuid, p_from date default null, p_days int default 7)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select s.slot_start, s.slot_end
  from app.available_slots(p_doctor, coalesce(p_from, (now() at time zone 'Africa/Cairo')::date), least(p_days, 14), interval '2 hours') s
  where exists (select 1 from public.site_doctor_profiles d join public.staff st on st.id = d.staff_id
                where d.staff_id = p_doctor and st.is_active
                  and (d.published_data->>'accepts_online_booking')::boolean
                  and app.is_live(d.status, d.published_data, d.published_at))
$$;

-- Website form submission → lead in the Patient Relations queue.
create or replace function public.submit_web_inquiry(p jsonb)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  v_phone text := app.normalize_phone(p->>'phone');
  v_branch uuid; v_spec uuid; v_doc uuid; v_offer uuid; v_lp uuid; v_slot tstzrange; v_existing public.leads; v_ref text;
  v_start timestamptz := nullif(p->>'preferred_start', '')::timestamptz;
  v_kind public.lead_kind := coalesce(nullif(p->>'kind', ''), 'inquiry')::public.lead_kind;
begin
  if v_phone is null then raise exception 'invalid phone number' using errcode = '22023'; end if;
  if coalesce((p->>'consent_contact')::boolean, false) is not true then
    raise exception 'consent is required' using errcode = '22023';
  end if;
  if length(trim(coalesce(p->>'full_name', ''))) not between 2 and 120 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if length(coalesce(p->>'message', '')) > 1000 then raise exception 'message too long' using errcode = '22023'; end if;
  -- Abuse protection: at most 5 submissions per phone per 24h.
  if (select count(*) from public.leads where phone = v_phone and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too many requests' using errcode = '54000';
  end if;

  select id into v_branch from public.branches where is_active order by code limit 1;
  v_spec := (select pg.specialty_id from public.site_specialty_pages pg
             where pg.published_data->>'slug' = p->>'specialty_slug' and app.is_live(pg.status, pg.published_data, pg.published_at));
  v_doc := (select d.staff_id from public.site_doctor_profiles d
            where d.published_data->>'slug' = p->>'doctor_slug' and app.is_live(d.status, d.published_data, d.published_at));
  -- (SELECT INTO with no row would null the targets, so resolve each reference separately.)
  v_offer := (select o.id from public.offers o where o.published_data->>'slug' = p->>'offer_slug' and app.offer_is_active(o));
  v_lp := (select l.id from public.landing_pages l
           where l.published_data->>'slug' = p->>'landing_slug' and app.is_live(l.status, l.published_data, l.published_at));
  if v_lp is not null then
    v_offer := coalesce(v_offer, (select l.offer_id from public.landing_pages l join public.offers o on o.id = l.offer_id
                                  where l.id = v_lp and app.offer_is_active(o)));
    v_spec := coalesce(v_spec, (select specialty_id from public.landing_pages where id = v_lp));
  end if;
  if v_offer is not null then v_spec := coalesce(v_spec, (select specialty_id from public.offers where id = v_offer)); end if;
  if v_doc is not null and v_spec is null then select specialty_id into v_spec from public.staff where id = v_doc; end if;

  -- A requested time must be a real, currently available slot.
  if v_start is not null then
    if v_doc is null then raise exception 'doctor is required for a time request' using errcode = '22023'; end if;
    select tstzrange(s.slot_start, s.slot_end) into v_slot
    from public.public_available_slots(v_doc, (v_start at time zone 'Africa/Cairo')::date, 1) s where s.slot_start = v_start;
    if v_slot is null then raise exception 'selected time is no longer available' using errcode = '22023'; end if;
  end if;

  -- Merge into an open inquiry from the same phone (last 14 days) instead of duplicating.
  select * into v_existing from public.leads
   where phone = v_phone and status in ('inquiry', 'contacted', 'qualified', 'appointment_requested')
     and created_at > now() - interval '14 days'
   order by created_at desc limit 1 for update;

  if found then
    update public.leads set
      kind = case when v_kind = 'booking' then 'booking'::public.lead_kind else kind end,
      specialty_id = coalesce(v_spec, specialty_id), doctor_id = coalesce(v_doc, doctor_id),
      offer_id = coalesce(v_offer, offer_id), landing_page_id = coalesce(v_lp, landing_page_id),
      preferred_slot = coalesce(v_slot, preferred_slot),
      consent_marketing = consent_marketing or coalesce((p->>'consent_marketing')::boolean, false),
      due_at = least(coalesce(due_at, now() + interval '30 minutes'), now() + interval '30 minutes')
    where id = v_existing.id;
    insert into public.lead_activities (lead_id, kind, body)
    values (v_existing.id, 'web', concat_ws(' · ', 'repeat ' || v_kind, nullif(p->>'page_path', ''), nullif(left(p->>'message', 500), '')));
    return v_existing.ref;
  end if;

  insert into public.leads (branch_id, kind, channel, full_name, phone_raw, email, lang, specialty_id, doctor_id, offer_id,
                            landing_page_id, preferred_slot, message, consent_contact, consent_marketing, consent_version,
                            utm_source, utm_medium, utm_campaign, utm_content, utm_term, page_path, patient_id, created_by)
  values (v_branch, v_kind, case when v_lp is not null then 'social'::public.booking_channel else 'website'::public.booking_channel end,
          trim(p->>'full_name'), p->>'phone', nullif(trim(p->>'email'), ''),
          case when p->>'lang' = 'en' then 'en' else 'ar' end, v_spec, v_doc, v_offer, v_lp, v_slot,
          nullif(trim(p->>'message'), ''), true, coalesce((p->>'consent_marketing')::boolean, false), p->>'consent_version',
          left(p->>'utm_source', 100), left(p->>'utm_medium', 100), left(p->>'utm_campaign', 150),
          left(p->>'utm_content', 150), left(p->>'utm_term', 150), left(p->>'page_path', 300),
          (select id from public.patients where phone = v_phone and merged_into is null order by created_at limit 1), null)
  returning ref into v_ref;
  return v_ref;
end $$;

-- ---------------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------------
alter table public.site_settings enable row level security;
alter table public.content_revisions enable row level security;
alter table public.site_specialty_pages enable row level security;
alter table public.site_doctor_profiles enable row level security;
alter table public.offers enable row level security;
alter table public.landing_pages enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
revoke all on public.site_settings, public.content_revisions, public.site_specialty_pages, public.site_doctor_profiles,
              public.offers, public.landing_pages, public.leads, public.lead_activities from anon;

grant select, insert, update on public.site_settings to authenticated;
create policy site_settings_read on public.site_settings for select to authenticated using (app.is_active_staff());
create policy site_settings_write on public.site_settings for insert to authenticated with check (app.has_permission('settings.manage'));
create policy site_settings_update on public.site_settings for update to authenticated using (app.has_permission('settings.manage'));

do $$
declare t text;
begin
  foreach t in array array['site_specialty_pages','site_doctor_profiles','offers','landing_pages'] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format($p$create policy %1$s_read on public.%1$I for select to authenticated using (
      app.has_permission('content.edit') or app.has_permission('content.medical_approve')
      or app.has_permission('content.marketing_approve') or app.has_permission('content.publish'))$p$, t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.has_permission(''content.edit''))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (app.has_permission(''content.edit'')) with check (app.has_permission(''content.edit''))', t);
  end loop;
end $$;

grant select on public.content_revisions to authenticated;
create policy content_revisions_read on public.content_revisions for select to authenticated
  using (app.has_permission('content.edit') or app.has_permission('content.medical_approve')
         or app.has_permission('content.marketing_approve') or app.has_permission('content.publish'));

grant select, insert, update on public.leads to authenticated;
create policy leads_read on public.leads for select to authenticated using (app.has_permission('lead.read', branch_id));
create policy leads_insert on public.leads for insert to authenticated with check (app.has_permission('lead.write', branch_id));
create policy leads_update on public.leads for update to authenticated
  using (app.has_permission('lead.write', branch_id)) with check (app.has_permission('lead.write', branch_id));

grant select, insert on public.lead_activities to authenticated;
create policy lead_activities_read on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (actor_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id and app.has_permission('lead.write', l.branch_id)));

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

-- Re-grant the staff API (0008 list) and add the new staff RPCs.
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

-- Public website API: anonymous and signed-in visitors.
grant execute on function
  public.public_site(), public.public_specialties(), public.public_specialty(text), public.public_doctors(text),
  public.public_doctor(text), public.public_offers(text), public.public_landing(text),
  public.public_available_slots(uuid, date, int), public.submit_web_inquiry(jsonb)
  to anon, authenticated;

grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;
