-- Golden Care OS — 0033 Website and marketing: medical articles and patient instructions, consented testimonials,
-- A/B variants on landing pages, a marketing funnel report, and SMS for patients who prefer it (plus optional fallback).

-- ---------------------------------------------------------------------------
-- Articles (education) and instructions (before / after a service) — same review workflow as all website content
-- ---------------------------------------------------------------------------
create table public.articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  kind          text not null default 'article' check (kind in ('article', 'instruction')),
  specialty_id  uuid references public.specialties(id),
  service_ids   uuid[] not null default '{}',
  author_doctor_id uuid references public.staff(id),
  title_ar text not null, title_en text not null,
  summary_ar text, summary_en text,
  body_ar text not null, body_en text,
  sources text,
  reading_minutes int check (reading_minutes between 1 and 60),
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (requires_medical)                                   -- medical content always passes medical review
);

-- Testimonials: the patient's words, published only with their recorded consent; the public never sees who they are.
create table public.testimonials (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id),
  display_name_ar text not null, display_name_en text,
  quote_ar      text not null check (length(quote_ar) between 10 and 600), quote_en text,
  rating        smallint check (rating between 1 and 5),
  specialty_id  uuid references public.specialties(id),
  doctor_id     uuid references public.staff(id),
  status public.content_status not null default 'draft', requires_medical boolean not null default true,
  published_data jsonb, published_at timestamptz, publish_at timestamptz,
  medical_approved_by uuid, medical_approved_at timestamptz, marketing_approved_by uuid, marketing_approved_at timestamptz,
  review_note text, version int not null default 1, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function app.testimonial_consented(p_patient uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select granted from public.patient_consents where patient_id = p_patient and kind = 'testimonial' order by captured_at desc limit 1), false)
$$;
grant execute on function app.testimonial_consented(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['articles', 'testimonials'] loop
    execute format('create trigger trg_%1$s_guard before insert or update on public.%1$I for each row execute function app.content_guard()', t);
    execute format('create trigger trg_%1$s_revision after insert or update on public.%1$I for each row execute function app.content_revision()', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function app.audit_row()', t);
    execute format('create trigger trg_%1$s_no_delete before delete on public.%1$I for each row execute function app.block_delete()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy articles_read on public.articles for select to authenticated using (app.has_permission('content.edit') or app.has_permission('content.medical_approve') or app.has_permission('content.marketing_approve') or app.has_permission('content.publish'));
create policy articles_insert on public.articles for insert to authenticated with check (app.has_permission('content.edit'));
create policy articles_update on public.articles for update to authenticated using (app.has_permission('content.edit')) with check (app.has_permission('content.edit'));
create policy testimonials_read on public.testimonials for select to authenticated using (app.has_permission('content.edit') or app.has_permission('content.medical_approve') or app.has_permission('content.marketing_approve') or app.has_permission('content.publish'));
create policy testimonials_insert on public.testimonials for insert to authenticated with check (app.has_permission('content.edit') and app.testimonial_consented(patient_id));
create policy testimonials_update on public.testimonials for update to authenticated using (app.has_permission('content.edit')) with check (app.has_permission('content.edit'));
grant select, insert, update on public.articles, public.testimonials to authenticated;


create or replace function public.content_transition(p_table text, p_id uuid, p_to public.content_status, p_note text default null)
returns public.content_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_from public.content_status; v_requires boolean; v_editor uuid; v_publish_at timestamptz; v_final public.content_status;
begin
  if p_table not in ('site_specialty_pages', 'site_doctor_profiles', 'offers', 'landing_pages', 'articles', 'testimonials') then
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

  if p_table = 'testimonials' and p_to in ('medical_review', 'marketing_review', 'approved', 'published')
     and not app.testimonial_consented((r->>'patient_id')::uuid) then
    raise exception 'the patient has not consented to publishing this testimonial' using errcode = '22023';
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

-- Public read (live content only; testimonials only while consent stands; the patient's identity is never exposed).
create or replace function public.public_articles(p_kind text default 'article', p_specialty_slug text default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', a.published_data->>'slug', 'title_ar', a.published_data->>'title_ar', 'title_en', a.published_data->>'title_en',
      'summary_ar', a.published_data->>'summary_ar', 'summary_en', a.published_data->>'summary_en', 'reading_minutes', a.published_data->'reading_minutes',
      'published_at', a.published_at) order by a.published_at desc), '[]'::jsonb)
  from public.articles a
  where app.is_live(a.status, a.published_data, a.published_at) and a.published_data->>'kind' = p_kind
    and (p_specialty_slug is null or a.specialty_id = (select pg.specialty_id from public.site_specialty_pages pg where pg.published_data->>'slug' = p_specialty_slug))
$$;

create or replace function public.public_article(p_slug text)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.published_data - 'service_ids' - 'author_doctor_id' || jsonb_build_object('published_at', a.published_at,
    'author', (select app.public_doctor_json(d) from public.site_doctor_profiles d where d.staff_id = a.author_doctor_id and app.is_live(d.status, d.published_data, d.published_at)))
  from public.articles a where a.published_data->>'slug' = p_slug and app.is_live(a.status, a.published_data, a.published_at)
$$;

create or replace function public.public_testimonials(p_specialty_slug text default null, p_limit int default 6)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('name_ar', t.published_data->>'display_name_ar', 'name_en', coalesce(t.published_data->>'display_name_en', t.published_data->>'display_name_ar'),
      'quote_ar', t.published_data->>'quote_ar', 'quote_en', coalesce(t.published_data->>'quote_en', t.published_data->>'quote_ar'), 'rating', t.published_data->'rating') x
    from public.testimonials t
    where app.is_live(t.status, t.published_data, t.published_at) and app.testimonial_consented(t.patient_id)
      and (p_specialty_slug is null or t.specialty_id = (select pg.specialty_id from public.site_specialty_pages pg where pg.published_data->>'slug' = p_specialty_slug))
    order by t.published_at desc limit least(coalesce(p_limit, 6), 20)) s
$$;

-- Portal: instructions for services the patient had in the last year (preparation and aftercare).
create or replace function public.portal_instructions(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return coalesce((select jsonb_agg(jsonb_build_object('slug', a.published_data->>'slug', 'title_ar', a.published_data->>'title_ar', 'title_en', a.published_data->>'title_en',
      'summary_ar', a.published_data->>'summary_ar', 'summary_en', a.published_data->>'summary_en') order by a.published_at desc)
    from public.articles a
    where app.is_live(a.status, a.published_data, a.published_at) and a.published_data->>'kind' = 'instruction'
      and exists (select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
                  where i.patient_id = p_patient and i.status <> 'void' and i.created_at > now() - interval '1 year' and l.service_id = any(a.service_ids))), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- A/B variants on landing pages (part of the reviewed page content) and their results
-- ---------------------------------------------------------------------------
alter table public.landing_pages add column if not exists variants jsonb not null default '[]'::jsonb;   -- [{code, weight, title_ar, title_en, hero_ar, hero_en, cta_variant}]

create table public.landing_events (
  landing_id  uuid not null references public.landing_pages(id),
  variant     text not null check (variant ~ '^[A-Z]$'),
  kind        text not null check (kind in ('view', 'lead')),
  visitor     text not null check (length(visitor) between 16 and 64),       -- random first-party id, never linked to a person
  created_at  timestamptz not null default now(),
  primary key (landing_id, variant, kind, visitor)
);
alter table public.landing_events enable row level security;
create policy landing_events_read on public.landing_events for select to authenticated using (app.has_permission('marketing.read') or app.has_permission('content.publish'));
grant select on public.landing_events to authenticated;

create or replace function public.public_landing_event(p_slug text, p_variant text, p_kind text, p_visitor text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.landing_pages l where l.published_data->>'slug' = p_slug and app.is_live(l.status, l.published_data, l.published_at);
  if v_id is null or p_kind not in ('view', 'lead') or coalesce(p_variant, '') !~ '^[A-Z]$' or length(coalesce(p_visitor, '')) not between 16 and 64 then return; end if;
  insert into public.landing_events (landing_id, variant, kind, visitor) values (v_id, p_variant, p_kind, p_visitor) on conflict do nothing;
end $$;

create or replace function public.landing_ab_report(p_landing uuid)
returns table (variant text, views bigint, leads bigint, conversion numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select e.variant, count(*) filter (where kind = 'view'), count(*) filter (where kind = 'lead'),
         round(100.0 * count(*) filter (where kind = 'lead') / nullif(count(*) filter (where kind = 'view'), 0), 1)
  from public.landing_events e
  where e.landing_id = p_landing and (app.has_permission('marketing.read') or app.has_permission('content.publish'))
  group by e.variant order by e.variant
$$;

-- ---------------------------------------------------------------------------
-- Marketing funnel: leads by source → contacted → booked → came → revenue
-- ---------------------------------------------------------------------------
create or replace function public.marketing_funnel(p_from date, p_to date)
returns table (source text, campaign text, leads bigint, contacted bigint, booked bigint, arrived bigint, revenue numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.has_permission('marketing.read') or app.has_permission('lead.read') or app.has_permission('reports.finance')) then
    raise exception 'permission denied: marketing.read' using errcode = '42501';
  end if;
  return query
  select coalesce(nullif(l.utm_source, ''), l.channel::text), coalesce(nullif(l.utm_campaign, ''), '—'),
    count(*), count(*) filter (where l.first_contact_at is not null or l.status <> 'inquiry'),
    count(*) filter (where l.appointment_id is not null),
    count(*) filter (where a.status in ('arrived', 'waiting', 'in_consultation', 'procedure_in_progress', 'awaiting_payment', 'completed')),
    coalesce(sum((select sum(i.total) from public.invoices i where i.appointment_id = l.appointment_id and i.status in ('issued', 'partially_paid', 'paid'))), 0)
  from public.leads l left join public.appointments a on a.id = l.appointment_id
  where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
  group by 1, 2 order by count(*) desc;
end $$;

-- ---------------------------------------------------------------------------
-- SMS: patients who prefer SMS get their messages by SMS; optional fallback when WhatsApp fails for good.
-- ---------------------------------------------------------------------------
create table public.messaging_settings (
  organization_id uuid primary key references public.organizations(id),
  sms_fallback    boolean not null default false,       -- SMS costs money per message: the clinic decides
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);
alter table public.messaging_settings enable row level security;
create policy messaging_settings_read on public.messaging_settings for select to authenticated using (app.has_permission('messages.manage'));
grant select on public.messaging_settings to authenticated;

create or replace function public.save_messaging_settings(p_sms_fallback boolean)
returns public.messaging_settings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := (select organization_id from public.branches order by created_at limit 1); s public.messaging_settings;
begin
  perform app.require_permission('messages.manage');
  insert into public.messaging_settings (organization_id, sms_fallback) values (v_org, coalesce(p_sms_fallback, false))
  on conflict (organization_id) do update set sms_fallback = excluded.sms_fallback, updated_by = auth.uid(), updated_at = now()
  returning * into s;
  return s;
end $$;

alter table public.message_outbox drop constraint if exists message_outbox_channel_check;
alter table public.message_outbox add constraint message_outbox_channel_check check (channel in ('whatsapp', 'sms'));

create or replace function app.enqueue_message(p_code text, p_patient uuid, p_appointment uuid, p_vars jsonb, p_key text)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare p public.patients; v_id uuid; v_refused boolean; v_vars jsonb := coalesce(p_vars, '{}'::jsonb); a record; v_channel text;
begin
  select * into p from public.patients where id = p_patient;
  if not found then return null; end if;
  v_channel := case when p.preferred_channel = 'sms' then 'sms' else 'whatsapp' end;
  select not granted into v_refused from public.patient_consent_current where patient_id = p_patient and kind = 'whatsapp_messages';
  if v_channel = 'sms' then v_refused := false; end if;              -- the WhatsApp refusal is about WhatsApp
  if p_appointment is not null then
    select ap.ref, to_char(lower(ap.slot) at time zone 'Africa/Cairo', 'YYYY-MM-DD') d, to_char(lower(ap.slot) at time zone 'Africa/Cairo', 'HH24:MI') t,
           s.full_name_ar dr_ar, coalesce(s.full_name_en, s.full_name_ar) dr_en
      into a from public.appointments ap join public.staff s on s.id = ap.doctor_id where ap.id = p_appointment;
    v_vars := v_vars || jsonb_build_object('ref', a.ref, 'date', a.d, 'time', a.t, 'doctor', a.dr_ar, 'doctor_en', a.dr_en);
  end if;
  v_vars := v_vars || jsonb_build_object('name', p.first_name_ar, 'name_en', coalesce(p.first_name_en, p.first_name_ar));
  insert into public.message_outbox (channel, to_phone, template_code, vars, patient_id, appointment_id, idempotency_key, status, skip_reason)
  values (v_channel, p.phone, p_code, v_vars, p.id, p_appointment, p_key,
          case when coalesce(v_refused, false) then 'skipped' else 'queued' end,
          case when coalesce(v_refused, false) then 'patient refused WhatsApp messages' end)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.outbox_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare m public.message_outbox;
begin
  update public.message_outbox set
    status = case when p_ok then 'sent' when attempts >= 5 then 'dead' else 'queued' end,
    provider = p_provider, provider_message_id = coalesce(p_provider_id, provider_message_id),
    last_error = case when p_ok then null else left(p_error, 500) end,
    sent_at = case when p_ok then now() else sent_at end,
    next_attempt_at = case when p_ok then next_attempt_at else now() + make_interval(mins => power(2, attempts)::int) end,
    updated_at = now()
  where id = p_id returning * into m;
  -- WhatsApp gave up: try once by SMS when the clinic switched the fallback on (never for sign-in codes).
  if m.status = 'dead' and m.channel = 'whatsapp' and m.template_code <> 'portal_otp'
     and coalesce((select sms_fallback from public.messaging_settings limit 1), false) then
    insert into public.message_outbox (channel, to_phone, lang, template_code, vars, patient_id, appointment_id, idempotency_key)
    values ('sms', m.to_phone, m.lang, m.template_code, m.vars, m.patient_id, m.appointment_id, m.idempotency_key || ':sms')
    on conflict (idempotency_key) do nothing;
  end if;
end $$;

revoke execute on function public.public_landing_event(text, text, text, text), public.public_articles(text, text), public.public_article(text), public.public_testimonials(text, int) from public;
grant execute on function public.public_landing_event(text, text, text, text), public.public_articles(text, text), public.public_article(text), public.public_testimonials(text, int) to anon, authenticated;
revoke execute on function public.portal_instructions(uuid), public.landing_ab_report(uuid), public.marketing_funnel(date, date), public.save_messaging_settings(boolean) from public, anon;
grant execute on function public.portal_instructions(uuid), public.landing_ab_report(uuid), public.marketing_funnel(date, date), public.save_messaging_settings(boolean) to authenticated;

-- Content editors identify the patient of a testimonial by file number, and only if the patient consented.
create or replace function public.testimonial_patient_lookup(p_mrn text)
returns uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v uuid;
begin
  perform app.require_permission('content.edit');
  select id into v from public.patients where mrn = upper(trim(p_mrn));
  if v is null or not app.testimonial_consented(v) then raise exception 'no patient with that file number has consented to a testimonial' using errcode = '22023'; end if;
  return v;
end $$;
revoke execute on function public.testimonial_patient_lookup(text) from public, anon;
grant execute on function public.testimonial_patient_lookup(text) to authenticated;

-- Marketing can see which landing pages exist (for the A/B report); editing still needs content.edit.
create policy landing_pages_read_marketing on public.landing_pages for select to authenticated using (app.has_permission('marketing.read'));

-- The patient grants or withdraws testimonial consent from their own account. Withdrawal takes a published
-- testimonial off the website immediately (public_testimonials re-checks consent on every read).
create or replace function public.portal_set_testimonial_consent(p_granted boolean)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare me uuid := app.portal_patient();
begin
  if me is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_granted is distinct from app.testimonial_consented(me) then
    insert into public.patient_consents (patient_id, kind, granted, document_code, document_version)
    values (me, 'testimonial', p_granted, 'portal', 'portal-testimonial-2026-10');
  end if;
end $$;
revoke all on function public.portal_set_testimonial_consent(boolean) from public;
grant execute on function public.portal_set_testimonial_consent(boolean) to authenticated;
