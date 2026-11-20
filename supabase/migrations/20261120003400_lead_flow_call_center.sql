-- Golden Care OS — 0034 Lead flow × call center (Golden Friday)
--
-- Problem this fixes: ads produced WhatsApp conversations that never reached the call center. Messages from known
-- patients became support tickets, a phone's 4th+ message in a day was dropped, voice notes / images from unknown
-- numbers went to the care-escalation queue, and the Click-to-WhatsApp ad referral (which ad / campaign) and the
-- customer's WhatsApp name were never stored.
--
-- Rule: every lead has a source, an owner and a status. The database is the single source of truth.
--   * every WhatsApp message from an ad, carrying a campaign code, or from a number with an open lead is captured
--     (svc_lead_capture, called by the webhook BEFORE the care assistant runs) — idempotent per Meta message id;
--   * one open lead per phone + campaign (duplicates are merged; every message is kept in the lead history);
--   * leads get a public id (e.g. GF26-7A82KQ), a call-center status, an owner (auto-assigned round-robin to agents on
--     duty), a first-response SLA, follow-ups, booking details, archive instead of delete, and an activity log.
--   * call-center agents see and work only their own leads (RLS + SECURITY DEFINER RPCs).

-- ---------------------------------------------------------------------------
-- Permissions and the call-center agent role
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('lead.own',       'crm', 'Call center: see and work the leads assigned to me'),
  ('lead.assign',    'crm', 'Assign, reassign, unassign and archive leads; agents on duty'),
  ('lead.campaigns', 'crm', 'Manage campaign codes and lead-flow settings'),
  ('lead.export',    'crm', 'Export lead data (audited)'),
  ('lead.report',    'crm', 'Lead, campaign, source and agent reports')
on conflict (code) do nothing;

insert into public.roles (code, name_ar, name_en, is_privileged) values
  ('call_center_agent', 'موظف الكول سنتر', 'Call Center Agent', false)
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('call_center_agent', 'lead.own'),
  ('center_director', 'lead.write'), ('center_director', 'lead.assign'), ('center_director', 'lead.campaigns'),
  ('center_director', 'lead.export'), ('center_director', 'lead.report'),
  ('operations_manager', 'lead.write'), ('operations_manager', 'lead.assign'), ('operations_manager', 'lead.campaigns'),
  ('operations_manager', 'lead.export'), ('operations_manager', 'lead.report'),
  ('owner', 'lead.read'), ('owner', 'lead.report'),
  ('marketing', 'lead.report'),
  ('patient_relations', 'lead.report'),
  ('system_admin', 'lead.campaigns')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Settings (one row) and campaign codes
-- ---------------------------------------------------------------------------
create table public.lead_flow_settings (
  id            boolean primary key default true check (id),
  code_prefix   text not null default 'GF26' check (code_prefix ~ '^[A-Z0-9]{2,8}$'),
  sla_minutes   int  not null default 5 check (sla_minutes between 1 and 240),
  auto_assign   boolean not null default true,
  default_branch_id uuid references public.branches(id),
  updated_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now()
);
insert into public.lead_flow_settings (id) values (true);

create table public.lead_campaigns (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) between 3 and 40),
  name_ar      text not null check (length(trim(name_ar)) between 2 and 120),
  name_en      text not null check (length(trim(name_en)) between 2 and 120),
  service_label text,
  keywords     text[] not null default '{}',     -- matched (normalized) in the customer's first message when no code is present
  meta_ad_ids  text[] not null default '{}',     -- Click-to-WhatsApp ad ids that belong to this campaign
  is_active    boolean not null default true,
  starts_on    date,
  ends_on      date,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint campaign_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- The clinic's Golden Friday codes (from the campaign brief). Names and keywords are editable in the system.
insert into public.lead_campaigns (code, name_ar, name_en, service_label, keywords) values
  ('GF26-LASER',   'الجمعة الذهبية — الليزر',        'Golden Friday — Laser',    'Laser',    array['ليزر', 'laser']),
  ('GF26-DENTAL',  'الجمعة الذهبية — الأسنان',       'Golden Friday — Dental',   'Dental',   array['اسنان', 'تبييض', 'dental', 'teeth']),
  ('GF26-SKIN',    'الجمعة الذهبية — البشرة',        'Golden Friday — Skin',     'Skin',     array['بشره', 'جلديه', 'skin']),
  ('GF26-OFFER',   'الجمعة الذهبية — العرض العام',   'Golden Friday — Offer',    'Offer',    array['الجمعه الذهبيه', 'جولدن فرايداي', 'golden friday']),
  ('GF26-CHECKUP', 'الجمعة الذهبية — الفحص الشامل',  'Golden Friday — Check-up', 'Check-up', array['فحص شامل', 'تشيك اب', 'checkup', 'check-up']);

create or replace function app.lead_campaigns_normalize()
returns trigger language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  new.keywords := coalesce((select array_agg(distinct app.lead_norm(k)) from unnest(new.keywords) k where length(trim(k)) >= 3), '{}');
  new.meta_ad_ids := coalesce((select array_agg(distinct trim(a)) from unnest(new.meta_ad_ids) a where trim(a) ~ '^[0-9]{5,30}$'), '{}');
  new.updated_at := now();
  return new;
end $$;

-- Text normalization for matching: lower case, Arabic letter variants folded, tatweel removed.
create or replace function app.lead_norm(t text)
returns text language sql immutable parallel safe as $$
  select lower(translate(coalesce(t, ''), 'أإآىةـ', 'اااىه'))
$$;

create trigger trg_lead_campaigns_normalize before insert or update on public.lead_campaigns
  for each row execute function app.lead_campaigns_normalize();
update public.lead_campaigns set keywords = keywords;   -- normalize the seeded keywords
create trigger trg_audit_lead_campaigns after insert or update on public.lead_campaigns
  for each row execute function app.audit_row();
create trigger trg_lead_campaigns_no_delete before delete on public.lead_campaigns
  for each row execute function app.block_delete();
create trigger trg_audit_lead_flow_settings after update on public.lead_flow_settings
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Leads: call-center fields
-- ---------------------------------------------------------------------------
create type public.lead_cc_status as enum
  ('new', 'contacted', 'interested', 'not_interested', 'no_response', 'follow_up', 'booked', 'closed');

alter table public.leads
  add column code               text unique,
  add column cc_status          public.lead_cc_status not null default 'new',
  add column source             text check (source in ('meta', 'facebook', 'instagram', 'whatsapp', 'organic', 'manual', 'other')),
  add column campaign_id        uuid references public.lead_campaigns(id),
  add column ad_id              text,
  add column ad_name            text,
  add column adset_name         text,
  add column meta_campaign_name text,
  add column ctwa_clid          text,
  add column referral           jsonb,
  add column whatsapp_name      text,
  add column assigned_at        timestamptz,
  add column last_action        text,
  add column last_action_at     timestamptz,
  add column last_message_at    timestamptz,
  add column interested_at      timestamptz,
  add column follow_up_count    int not null default 0,
  add column next_follow_up_at  timestamptz,
  add column last_follow_up_at  timestamptz,
  add column follow_up_reason   text,
  add column booking_at         timestamptz,
  add column booking_service    text,
  add column booking_notes      text,
  add column booked_by          uuid references auth.users(id),
  add column archived_at        timestamptz,
  add column archived_by        uuid references auth.users(id),
  add column archive_reason     text;

create index leads_cc_queue on public.leads (assigned_to, cc_status, created_at desc) where archived_at is null;
create index leads_open_phone on public.leads (phone, campaign_id) where archived_at is null and cc_status not in ('not_interested', 'closed');
create index leads_followup_due on public.leads (next_follow_up_at) where cc_status = 'follow_up' and archived_at is null;
create index leads_campaign on public.leads (campaign_id, created_at);

-- Public lead id: PREFIX-XXXXXX (no ambiguous characters).
create or replace function app.lead_new_code(p_prefix text)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; c text;
begin
  loop
    c := p_prefix || '-';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.leads where code = c);
  end loop;
  return c;
end $$;

-- Backfill existing leads.
update public.leads set
  code = app.lead_new_code('LD'),
  source = case when channel = 'whatsapp' then 'whatsapp'
                when coalesce(utm_source, '') ~* 'insta|^ig$' then 'instagram'
                when coalesce(utm_source, '') ~* 'facebook|^fb$' then 'facebook'
                when coalesce(utm_source, '') ~* 'meta' or channel = 'social' then 'meta'
                when channel in ('phone', 'front_desk', 'walk_in', 'referral') then 'manual'
                when channel = 'website' then 'organic' else 'other' end,
  cc_status = case status when 'inquiry' then 'new' when 'contacted' then 'contacted' when 'qualified' then 'interested'
                          when 'closed' then 'closed' else 'booked' end::public.lead_cc_status,
  interested_at = case when status not in ('inquiry', 'contacted', 'closed') then coalesce(first_contact_at, updated_at) end,
  booking_at = (select lower(a.slot) from public.appointments a where a.id = leads.appointment_id),
  last_action_at = case when status <> 'inquiry' then updated_at end
where code is null;
alter table public.leads alter column code set not null, alter column source set not null;

-- ---------------------------------------------------------------------------
-- Message history, WhatsApp names, agents on duty
-- ---------------------------------------------------------------------------
create table public.lead_messages (
  id                  bigint generated always as identity primary key,
  lead_id             uuid not null references public.leads(id),
  direction           text not null default 'in' check (direction in ('in', 'out')),
  kind                text not null default 'text' check (kind in ('text', 'audio', 'media', 'other')),
  body                text not null check (length(body) between 1 and 4000),
  provider_message_id text unique,
  referral            jsonb,
  status              text not null default 'received' check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error               text,
  author_id           uuid references auth.users(id),
  received_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index on public.lead_messages (lead_id, received_at);
create trigger trg_lead_messages_no_delete before delete on public.lead_messages
  for each row execute function app.block_delete();

create table public.whatsapp_contacts (
  phone      text primary key,
  name       text not null,
  updated_at timestamptz not null default now()
);

create table public.lead_agent_duty (
  user_id    uuid primary key references auth.users(id),
  on_duty    boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger trg_audit_lead_agent_duty after insert or update on public.lead_agent_duty
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.lead_settings()
returns public.lead_flow_settings language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.lead_flow_settings where id
$$;

-- Can another user hold leads in this branch? (Used to pick / validate an assignee — not a check on the caller,
-- which always goes through app.has_permission.)
create or replace function app.lead_user_can_hold(p_user uuid, p_branch uuid, p_agents_only boolean default false)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
    where ur.user_id = p_user
      and (rp.permission_code = 'lead.own' or (not p_agents_only and rp.permission_code = 'lead.write'))
      and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)
      and (ur.branch_id is null or p_branch is null or ur.branch_id = p_branch))
$$;

-- Round-robin: the on-duty agent with the fewest untouched leads, then the one who waited longest for a lead.
create or replace function app.lead_pick_agent(p_branch uuid)
returns uuid language sql stable security definer set search_path = public, app, pg_temp as $$
  select d.user_id from public.lead_agent_duty d
  where d.on_duty and app.lead_user_can_hold(d.user_id, p_branch, true)
  order by (select count(*) from public.leads x where x.assigned_to = d.user_id and x.cc_status = 'new' and x.archived_at is null),
           (select max(x.assigned_at) from public.leads x where x.assigned_to = d.user_id) nulls first,
           d.user_id
  limit 1
$$;

create or replace function app.lead_campaign_live(c public.lead_campaigns)
returns boolean language sql stable as $$
  select c.is_active and (c.starts_on is null or c.starts_on <= (now() at time zone 'Africa/Cairo')::date)
                     and (c.ends_on is null or c.ends_on >= (now() at time zone 'Africa/Cairo')::date)
$$;

-- Campaign from the message: explicit code (always — it is the truth) > ad id > keyword of a live campaign.
create or replace function app.lead_detect_campaign(p_text text, p_ad_id text default null)
returns uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare t text := app.lead_norm(p_text); v uuid;
begin
  select c.id into v from public.lead_campaigns c where position(lower(c.code) in t) > 0 order by length(c.code) desc limit 1;
  if v is not null then return v; end if;
  if nullif(p_ad_id, '') is not null then
    select c.id into v from public.lead_campaigns c where p_ad_id = any(c.meta_ad_ids) order by c.is_active desc limit 1;
    if v is not null then return v; end if;
  end if;
  select c.id into v from public.lead_campaigns c, unnest(c.keywords) k
  where app.lead_campaign_live(c) and position(k in t) > 0 order by length(k) desc, c.code limit 1;
  return v;
end $$;

-- Caller may work (update) this lead: lead.write in its branch, or the owning agent.
create or replace function app.lead_can_work(l public.leads)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('lead.write', l.branch_id)
      or (l.assigned_to = auth.uid() and app.has_permission('lead.own', l.branch_id))
$$;
create or replace function app.lead_can_read(l public.leads)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('lead.read', l.branch_id) or app.lead_can_work(l)
$$;

-- ---------------------------------------------------------------------------
-- Triggers on leads
-- ---------------------------------------------------------------------------
-- New lead: id, source, campaign, SLA due time, owner.
create or replace function app.leads_flow_defaults()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.lead_flow_settings := app.lead_settings();
begin
  new.code := app.lead_new_code(s.code_prefix);
  new.source := coalesce(new.source,
    case when new.channel = 'whatsapp' then 'whatsapp'
         when coalesce(new.utm_source, '') ~* 'insta|^ig$' then 'instagram'
         when coalesce(new.utm_source, '') ~* 'facebook|^fb$' then 'facebook'
         when coalesce(new.utm_source, '') ~* 'meta' or new.channel = 'social' then 'meta'
         when new.channel in ('phone', 'front_desk', 'walk_in', 'referral') then 'manual'
         when new.channel = 'website' then 'organic' else 'other' end);
  if new.campaign_id is null then
    new.campaign_id := app.lead_detect_campaign(concat_ws(' ', new.utm_campaign, new.utm_content, new.message), new.ad_id);
  end if;
  new.due_at := coalesce(new.due_at, new.created_at + make_interval(mins => s.sla_minutes));
  if new.due_at > new.created_at + make_interval(mins => s.sla_minutes) then new.due_at := new.created_at + make_interval(mins => s.sla_minutes); end if;
  if new.assigned_to is null and s.auto_assign then new.assigned_to := app.lead_pick_agent(new.branch_id); end if;
  if new.assigned_to is not null then new.assigned_at := coalesce(new.assigned_at, now()); end if;
  return new;
end $$;
create trigger trg_leads_flow_defaults before insert on public.leads
  for each row execute function app.leads_flow_defaults();

-- Direct inserts by staff (website form RPCs run as the owner) cannot pre-set flow state. Runs before the defaults.
create or replace function app.leads_a_insert_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.cc_status := 'new'; new.first_contact_at := null; new.archived_at := null; new.archived_by := null; new.interested_at := null;
    new.booking_at := null; new.booked_by := null; new.follow_up_count := 0; new.next_follow_up_at := null; new.created_at := now();
    new.last_action := null; new.last_action_at := null; new.code := null;
  end if;
  return new;
end $$;
create trigger trg_leads_a_insert_guard before insert on public.leads
  for each row execute function app.leads_a_insert_guard();

-- Flow state changes only through the RPCs below (they run as the owner): response times, ownership and outcomes
-- cannot be edited by a direct table update.
create or replace function app.leads_a_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and
     (new.code, new.cc_status, new.source, new.campaign_id, new.assigned_to, new.assigned_at, new.first_contact_at, new.interested_at,
      new.follow_up_count, new.next_follow_up_at, new.last_follow_up_at, new.booking_at, new.booked_by, new.archived_at, new.archived_by,
      new.archive_reason, new.last_action, new.last_action_at, new.created_at, new.ad_id, new.referral)
     is distinct from
     (old.code, old.cc_status, old.source, old.campaign_id, old.assigned_to, old.assigned_at, old.first_contact_at, old.interested_at,
      old.follow_up_count, old.next_follow_up_at, old.last_follow_up_at, old.booking_at, old.booked_by, old.archived_at, old.archived_by,
      old.archive_reason, old.last_action, old.last_action_at, old.created_at, old.ad_id, old.referral) then
    raise exception 'lead flow fields change only through the lead actions' using errcode = '42501';
  end if;
  if old.archived_at is not null and current_user = 'authenticated' then
    raise exception 'lead is archived' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_leads_a_guard before update on public.leads
  for each row execute function app.leads_a_guard();

-- Keep the call-center status in step with the clinic funnel (appointment linked, legacy status changes).
create or replace function app.leads_b_sync()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if new.appointment_id is not null and new.appointment_id is distinct from old.appointment_id and new.cc_status <> 'booked' then
    new.cc_status := 'booked';
    new.booking_at := coalesce((select lower(a.slot) from public.appointments a where a.id = new.appointment_id), new.booking_at);
    new.booked_by := coalesce(new.booked_by, auth.uid());
    new.interested_at := coalesce(new.interested_at, now());
    new.first_contact_at := coalesce(new.first_contact_at, now());
    new.last_action := 'booked'; new.last_action_at := now(); new.next_follow_up_at := null;
  end if;
  if new.status = 'closed' and old.status <> 'closed' and new.cc_status not in ('closed', 'not_interested') then
    new.cc_status := 'closed'; new.last_action := 'closed'; new.last_action_at := now(); new.next_follow_up_at := null;
  end if;
  if old.status = 'inquiry' and new.status not in ('inquiry', 'closed') and new.cc_status = 'new' then
    new.cc_status := 'contacted'; new.last_action := 'contacted'; new.last_action_at := now();
  end if;
  return new;
end $$;
create trigger trg_leads_b_sync before update on public.leads
  for each row execute function app.leads_b_sync();

-- ---------------------------------------------------------------------------
-- Capture (WhatsApp webhook, care assistant) — service role only
-- ---------------------------------------------------------------------------
-- p: phone, name, text, provider_id, kind (text|audio|media|other), referral (Meta CTWA object), received_at, force.
-- Without an ad referral, a campaign code / keyword, or an open lead on the number, nothing is created unless force.
create or replace function app.lead_capture(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  v_phone text := app.normalize_phone(p->>'phone');
  v_pid   text := nullif(left(p->>'provider_id', 200), '');
  v_text  text := left(coalesce(nullif(trim(p->>'text'), ''), '[رسالة بدون نص / message without text]'), 4000);
  v_ref   jsonb := case when jsonb_typeof(p->'referral') = 'object' then p->'referral' end;
  v_ad    text := nullif(left(v_ref->>'source_id', 64), '');
  v_name  text := nullif(left(regexp_replace(trim(coalesce(p->>'name', '')), '\s+', ' ', 'g'), 120), '');
  v_kind  text := case when p->>'kind' in ('text', 'audio', 'media', 'other') then p->>'kind' else 'text' end;
  v_at    timestamptz := least(coalesce(nullif(p->>'received_at', '')::timestamptz, now()), now());
  v_force boolean := coalesce((p->>'force')::boolean, false);
  v_camp uuid; v_source text; l public.leads; v_existing uuid; s public.lead_flow_settings := app.lead_settings();
begin
  if v_phone is null then raise exception 'invalid phone number' using errcode = '22023'; end if;
  if v_name is not null and length(v_name) < 2 then v_name := null; end if;

  perform pg_advisory_xact_lock(hashtext('lead-capture:' || v_phone));
  if v_pid is not null then
    select lead_id into v_existing from public.lead_messages where provider_message_id = v_pid;
    if found then
      select * into l from public.leads where id = v_existing;
      return jsonb_build_object('action', 'duplicate', 'lead_id', l.id, 'code', l.code,
        'first', (select count(*) = 1 from public.lead_messages where lead_id = l.id and direction = 'in'));
    end if;
  end if;
  if v_name is not null then
    insert into public.whatsapp_contacts (phone, name) values (v_phone, v_name)
    on conflict (phone) do update set name = excluded.name, updated_at = now();
  else
    v_name := (select name from public.whatsapp_contacts where phone = v_phone);
  end if;

  v_camp := app.lead_detect_campaign(v_text, v_ad);
  select * into l from public.leads x
  where x.phone = v_phone and x.archived_at is null and x.cc_status not in ('not_interested', 'closed')
    and (v_camp is null or x.campaign_id is null or x.campaign_id = v_camp)
  order by (x.campaign_id is not distinct from v_camp) desc, x.created_at desc
  limit 1 for update;

  if not found then
    if v_ref is null and v_camp is null and not v_force then return jsonb_build_object('action', 'skipped'); end if;
    v_source := case when v_ref is null then 'whatsapp'
                     when coalesce(v_ref->>'source_url', '') ~* 'instagram' then 'instagram'
                     when coalesce(v_ref->>'source_url', '') ~* 'facebook|fb\.(me|com|watch)' then 'facebook'
                     else 'meta' end;
    insert into public.leads (branch_id, kind, channel, full_name, phone_raw, message, consent_contact, source, campaign_id,
                              ad_id, ctwa_clid, referral, whatsapp_name, last_message_at, created_at, patient_id)
    values (coalesce(s.default_branch_id, (select id from public.branches where is_active order by code limit 1)),
            'inquiry', 'whatsapp', coalesce(v_name, 'عميل واتساب'), v_phone, left(v_text, 1000), true, v_source, v_camp,
            v_ad, nullif(left(v_ref->>'ctwa_clid', 300), ''), v_ref, v_name, v_at, v_at,
            (select id from public.patients where phone = v_phone and merged_into is null order by created_at limit 1))
    returning * into l;
    insert into public.lead_activities (lead_id, kind, body, actor_id)
    values (l.id, 'system', concat_ws(' · ', 'lead captured from WhatsApp', l.source,
                                      (select code from public.lead_campaigns where id = v_camp), case when v_ad is not null then 'ad ' || v_ad end), null);
    insert into public.lead_messages (lead_id, direction, kind, body, provider_message_id, referral, received_at)
    values (l.id, 'in', v_kind, v_text, v_pid, v_ref, v_at);
    return jsonb_build_object('action', 'created', 'lead_id', l.id, 'code', l.code, 'first', true);
  end if;

  update public.leads set
    campaign_id = coalesce(campaign_id, v_camp),
    ad_id = coalesce(ad_id, v_ad), referral = coalesce(referral, v_ref),
    ctwa_clid = coalesce(ctwa_clid, nullif(left(v_ref->>'ctwa_clid', 300), '')),
    source = case when source = 'whatsapp' and v_ref is not null then
                    case when coalesce(v_ref->>'source_url', '') ~* 'instagram' then 'instagram'
                         when coalesce(v_ref->>'source_url', '') ~* 'facebook|fb\.(me|com|watch)' then 'facebook' else 'meta' end
                  else source end,
    whatsapp_name = coalesce(v_name, whatsapp_name),
    full_name = case when full_name = 'عميل واتساب' and v_name is not null then v_name else full_name end,
    last_message_at = greatest(coalesce(last_message_at, v_at), v_at)
  where id = l.id;
  insert into public.lead_messages (lead_id, direction, kind, body, provider_message_id, referral, received_at)
  values (l.id, 'in', v_kind, v_text, v_pid, v_ref, v_at);
  return jsonb_build_object('action', 'attached', 'lead_id', l.id, 'code', l.code, 'first', false);
end $$;

-- Delivery status of a reply sent from the lead workspace (monotonic).
create or replace function app.lead_message_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.lead_messages set status = p_status
  where provider_message_id = p_provider_id and direction = 'out' and p_status in ('delivered', 'read', 'failed')
    and (case status when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end)
      < (case p_status when 'delivered' then 2 when 'read' then 3 else 4 end)
$$;

-- Meta Marketing API enrichment: ad / ad set / campaign names for captured ad ids.
create or replace function app.lead_ads_pending(p_limit int)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select ad_id from public.leads where ad_id is not null and ad_name is null and created_at > now() - interval '60 days'
  group by ad_id order by max(created_at) desc limit greatest(1, least(p_limit, 50))
$$;
create or replace function app.lead_set_ad_names(p_ad_id text, p_ad text, p_adset text, p_campaign text)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare n int;
begin
  update public.leads set ad_name = left(coalesce(p_ad, ad_name, '—'), 300), adset_name = left(coalesce(p_adset, adset_name), 300),
    meta_campaign_name = left(coalesce(p_campaign, meta_campaign_name), 300),
    campaign_id = coalesce(campaign_id, app.lead_detect_campaign(concat_ws(' ', p_campaign, p_adset, p_ad), p_ad_id))
  where ad_id = p_ad_id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.svc_lead_capture(p jsonb)
returns jsonb language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.lead_capture(p) $$;
create or replace function public.svc_lead_message_status(p_provider_id text, p_status text)
returns void language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.lead_message_status(p_provider_id, p_status) $$;
create or replace function public.svc_lead_ads_pending(p_limit int default 20)
returns setof text language sql stable security definer set search_path = public, app, pg_temp as $$ select app.lead_ads_pending(p_limit) $$;
create or replace function public.svc_lead_set_ad_names(p_ad_id text, p_ad text, p_adset text, p_campaign text)
returns int language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.lead_set_ad_names(p_ad_id, p_ad, p_adset, p_campaign) $$;

-- ---------------------------------------------------------------------------
-- Care assistant routing: messages reach the call center
-- ---------------------------------------------------------------------------
-- A message that belongs to no open conversation:
--   * an open lead on the number (or a campaign code / keyword) takes it — 'lead' for a new lead, 'lead_attached' otherwise;
--   * thanks are ignored; one known patient → ticket; a number shared by several patients → escalation;
--   * anyone else → a lead (one open lead per number: repeat messages join its history; nothing is dropped).
-- Danger signs never reach here: they were escalated when the message was stored.
create or replace function app.care_unrouted(p_message uuid, p_thanks boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; v_ref text; v_n int; v_lead jsonb;
begin
  select * into m from public.care_messages where id = p_message and direction = 'in' and journey_id is null;
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  if m.processed_at is not null then return jsonb_build_object('action', 'none'); end if;
  update public.care_messages set processed_at = now() where id = m.id;
  v_lead := app.lead_capture(jsonb_build_object('phone', m.phone, 'provider_id', m.provider_message_id, 'text', m.body,
                                                'received_at', m.created_at, 'kind', case when m.media_id is not null then 'media' else 'text' end));
  if v_lead->>'action' <> 'skipped' then
    return jsonb_build_object('action', case when (v_lead->>'first')::boolean then 'lead' else 'lead_attached' end, 'ref', v_lead->>'code');
  end if;
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
  v_lead := app.lead_capture(jsonb_build_object('phone', m.phone, 'provider_id', m.provider_message_id, 'text', m.body,
                                                'received_at', m.created_at, 'force', true));
  return jsonb_build_object('action', case when (v_lead->>'first')::boolean then 'lead' else 'lead_attached' end, 'ref', v_lead->>'code');
end $$;

-- Voice notes / images: a known patient → callback ticket (as before); an unknown, unshared number → its lead
-- (call center listens and calls back); a shared number → escalation.
create or replace function app.care_handoff_message(p_message uuid, p_subject text)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare m public.care_messages; v_ref text; v_lead jsonb;
begin
  select * into m from public.care_messages where id = p_message and direction = 'in';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  if m.processed_at is not null then return jsonb_build_object('action', 'none'); end if;
  if m.patient_id is not null then
    insert into public.support_tickets (branch_id, patient_id, kind, subject, body, channel, priority, due_at)
    values (m.branch_id, m.patient_id, 'callback', left(p_subject, 200), left(m.body, 2000), 'care_assistant', 'high', now() + interval '2 hours')
    returning ref into v_ref;
  elsif m.journey_id is null and cardinality(app.care_patients_on(m.phone)) <= 1 then
    v_lead := app.lead_capture(jsonb_build_object('phone', m.phone, 'provider_id', m.provider_message_id,
              'text', m.body, 'received_at', m.created_at, 'kind', 'media', 'force', true));
    update public.care_messages set processed_at = now() where id = m.id;
    insert into public.lead_activities (lead_id, kind, body, actor_id) values ((v_lead->>'lead_id')::uuid, 'system', left(p_subject, 300), null);
    return jsonb_build_object('action', 'lead', 'ref', v_lead->>'code');
  else
    insert into public.care_escalations (branch_id, phone, journey_id, severity, category, summary, patient_text, due_at)
    values (m.branch_id, m.phone, m.journey_id, 'high', 'other', left(p_subject, 300), left(m.body, 2000), now() + app.care_due_minutes('high'))
    returning ref into v_ref;
  end if;
  update public.care_messages set processed_at = now() where id = m.id;
  return jsonb_build_object('action', case when m.patient_id is null then 'escalation' else 'ticket' end, 'ref', v_ref);
end $$;

-- ---------------------------------------------------------------------------
-- Call-center actions (staff session; permission checked inside)
-- ---------------------------------------------------------------------------
-- p: at (follow-up or booking time, ISO), reason, notes, service.
create or replace function public.lead_set_outcome(p_lead uuid, p_status text, p jsonb default '{}')
returns public.leads language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  l public.leads; v_new public.lead_cc_status; v_at timestamptz; v_reason text := nullif(trim(p->>'reason'), '');
  v_notes text := nullif(trim(p->>'notes'), ''); v_service text := nullif(trim(p->>'service'), '');
  v_base public.lead_status; v_legacy public.lead_status; v_old public.lead_cc_status;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found or not app.lead_can_read(l) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  v_old := l.cc_status;
  if not app.lead_can_work(l) then raise exception 'permission denied: lead belongs to another agent' using errcode = '42501'; end if;
  if l.archived_at is not null then raise exception 'lead is archived' using errcode = '22023'; end if;
  if p_status not in ('contacted', 'interested', 'not_interested', 'no_response', 'follow_up', 'booked', 'closed') then
    raise exception 'invalid lead status: %', p_status using errcode = '22023';
  end if;
  v_new := p_status::public.lead_cc_status;
  begin v_at := nullif(p->>'at', '')::timestamptz; exception when others then raise exception 'invalid date or time' using errcode = '22023'; end;
  if length(coalesce(v_notes, '')) > 2000 or length(coalesce(v_reason, '')) > 500 or length(coalesce(v_service, '')) > 200 then
    raise exception 'text too long' using errcode = '22023';
  end if;
  if v_new = 'follow_up' then
    if v_at is null then raise exception 'follow-up date and time are required' using errcode = '22023'; end if;
    if v_at < now() - interval '5 minutes' then raise exception 'follow-up time is in the past' using errcode = '22023'; end if;
    if v_reason is null then raise exception 'follow-up reason is required' using errcode = '22023'; end if;
  elsif v_new = 'booked' then
    if v_at is null then raise exception 'booking date and time are required' using errcode = '22023'; end if;
    if v_service is null then raise exception 'booked service is required' using errcode = '22023'; end if;
  elsif v_new in ('not_interested', 'closed') and v_reason is null then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  v_base := case when l.status = 'closed' then 'inquiry'::public.lead_status else l.status end;
  v_legacy := case v_new
    when 'interested' then greatest(v_base, 'qualified')
    when 'booked' then greatest(v_base, 'appointment_requested')
    when 'not_interested' then 'closed' when 'closed' then 'closed'
    else greatest(v_base, 'contacted') end;

  update public.leads set
    cc_status = v_new, status = v_legacy,
    close_reason = case when v_legacy = 'closed' then coalesce(v_reason, close_reason) else close_reason end,
    first_contact_at = coalesce(first_contact_at, now()),
    interested_at = case when v_new in ('interested', 'booked') then coalesce(interested_at, now()) else interested_at end,
    last_follow_up_at = case when next_follow_up_at is not null and next_follow_up_at <= now() + interval '1 hour' then now() else last_follow_up_at end,
    next_follow_up_at = case when v_new = 'follow_up' then v_at else null end,
    follow_up_reason = case when v_new = 'follow_up' then v_reason else follow_up_reason end,
    follow_up_count = follow_up_count + case when v_new = 'follow_up' then 1 else 0 end,
    booking_at = case when v_new = 'booked' then v_at else booking_at end,
    booking_service = case when v_new = 'booked' then v_service else booking_service end,
    booking_notes = case when v_new = 'booked' then v_notes else booking_notes end,
    booked_by = case when v_new = 'booked' then auth.uid() else booked_by end,
    last_action = v_new::text, last_action_at = now()
  where id = l.id returning * into l;

  insert into public.lead_activities (lead_id, kind, body) values
    (l.id, 'status', concat_ws(' · ', upper(v_old::text) || ' → ' || upper(v_new::text),
       case when v_new = 'follow_up' then 'follow-up ' || to_char(v_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') end,
       case when v_new = 'booked' then 'booking ' || to_char(v_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || ' · ' || v_service end,
       v_reason));
  if v_notes is not null then insert into public.lead_activities (lead_id, kind, body) values (l.id, 'note', v_notes); end if;
  return l;
end $$;

create or replace function public.lead_add_note(p_lead uuid, p_body text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare l public.leads; v text := nullif(trim(p_body), '');
begin
  select * into l from public.leads where id = p_lead for update;
  if not found or not app.lead_can_read(l) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not app.lead_can_work(l) then raise exception 'permission denied: lead belongs to another agent' using errcode = '42501'; end if;
  if v is null or length(v) > 2000 then raise exception 'write the note (up to 2000 characters)' using errcode = '22023'; end if;
  insert into public.lead_activities (lead_id, kind, body) values (l.id, 'note', v);
  update public.leads set last_action = 'note', last_action_at = now() where id = l.id;
end $$;

-- Assign / reassign / unassign (p_user null). lead.assign; anyone with lead.write may take an unowned lead themselves.
create or replace function public.lead_assign(p_lead uuid, p_user uuid)
returns public.leads language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare l public.leads; v_name text;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found or not app.lead_can_read(l) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('lead.assign', l.branch_id)
          or (p_user = auth.uid() and l.assigned_to is null and app.has_permission('lead.write', l.branch_id))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if l.archived_at is not null then raise exception 'lead is archived' using errcode = '22023'; end if;
  if p_user is not null and not app.lead_user_can_hold(p_user, l.branch_id) then
    raise exception 'this user cannot hold leads in this branch' using errcode = '22023';
  end if;
  if p_user is not distinct from l.assigned_to then return l; end if;
  v_name := coalesce((select coalesce(full_name_ar, full_name_en) from public.profiles where user_id = p_user), 'unassigned');
  update public.leads set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end where id = l.id returning * into l;
  insert into public.lead_activities (lead_id, kind, body)
  values (l.id, 'system', case when p_user is null then 'unassigned' else 'assigned to ' || v_name end);
  return l;
end $$;

create or replace function public.lead_archive(p_lead uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  perform app.require_permission('lead.assign', l.branch_id);
  if l.archived_at is not null then raise exception 'lead is already archived' using errcode = '22023'; end if;
  if length(coalesce(trim(p_reason), '')) < 3 then raise exception 'archive reason is required' using errcode = '22023'; end if;
  update public.leads set archived_at = now(), archived_by = auth.uid(), archive_reason = left(trim(p_reason), 500), next_follow_up_at = null
  where id = l.id;
  insert into public.lead_activities (lead_id, kind, body) values (l.id, 'system', 'archived · ' || left(trim(p_reason), 500));
end $$;

-- Agent on / off duty (self, or anyone by lead.assign).
create or replace function public.lead_set_duty(p_on boolean, p_user uuid default null)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v uuid := coalesce(p_user, auth.uid());
begin
  if v is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if v = auth.uid() then
    if not (app.has_permission('lead.own') or app.has_permission('lead.write')) then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    perform app.require_permission('lead.assign');
    if not app.lead_user_can_hold(v, null) then raise exception 'this user cannot hold leads' using errcode = '22023'; end if;
  end if;
  insert into public.lead_agent_duty (user_id, on_duty, updated_by, updated_at) values (v, p_on, auth.uid(), now())
  on conflict (user_id) do update set on_duty = excluded.on_duty, updated_by = auth.uid(), updated_at = now();
end $$;

-- Manual lead (phone call, walk-in). Same duplicate rule; an agent's manual lead is theirs.
-- p: full_name, phone, campaign_code, source, message
create or replace function public.lead_create_manual(p jsonb)
returns text language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  v_phone text := app.normalize_phone(p->>'phone'); v_camp uuid; l public.leads; v_branch uuid; s public.lead_flow_settings := app.lead_settings();
  v_source text := coalesce(nullif(p->>'source', ''), 'manual'); v_name text := trim(coalesce(p->>'full_name', ''));
begin
  v_branch := coalesce(s.default_branch_id, (select id from public.branches where is_active order by code limit 1));
  if not (app.has_permission('lead.write', v_branch) or app.has_permission('lead.own', v_branch)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_phone is null then raise exception 'invalid phone number' using errcode = '22023'; end if;
  if length(v_name) not between 2 and 120 then raise exception 'name is required' using errcode = '22023'; end if;
  if v_source not in ('meta', 'facebook', 'instagram', 'whatsapp', 'organic', 'manual', 'other') then raise exception 'invalid source' using errcode = '22023'; end if;
  if nullif(p->>'campaign_code', '') is not null then
    select id into v_camp from public.lead_campaigns where code = upper(trim(p->>'campaign_code'));
    if v_camp is null then raise exception 'unknown campaign code' using errcode = '22023'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('lead-capture:' || v_phone));
  select * into l from public.leads x
  where x.phone = v_phone and x.archived_at is null and x.cc_status not in ('not_interested', 'closed')
    and (v_camp is null or x.campaign_id is null or x.campaign_id = v_camp)
  order by (x.campaign_id is not distinct from v_camp) desc, x.created_at desc limit 1 for update;
  if found then
    insert into public.lead_activities (lead_id, kind, body)
    values (l.id, 'call', concat_ws(' · ', 'repeat contact (manual entry)', nullif(left(trim(p->>'message'), 500), '')));
    if l.campaign_id is null and v_camp is not null then update public.leads set campaign_id = v_camp where id = l.id; end if;
    return l.code;
  end if;
  insert into public.leads (branch_id, kind, channel, full_name, phone_raw, message, consent_contact, source, campaign_id, assigned_to, patient_id)
  values (v_branch, 'callback', case when v_source in ('whatsapp') then 'whatsapp' else 'phone' end::public.booking_channel, v_name, v_phone,
          nullif(left(trim(p->>'message'), 1000), ''), true, v_source, v_camp,
          case when not app.has_permission('lead.write', v_branch) then auth.uid() end,
          (select id from public.patients where phone = v_phone and merged_into is null order by created_at limit 1))
  returning * into l;
  insert into public.lead_activities (lead_id, kind, body) values (l.id, 'system', 'lead entered manually');
  return l.code;
end $$;

-- WhatsApp reply from the lead workspace: logged first (counts as first contact), then sent by the app with the
-- WhatsApp token, then the result recorded. Free-form text only inside Meta's 24-hour window (the app checks).
create or replace function public.lead_log_reply(p_lead uuid, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare l public.leads; v_id bigint; v text := nullif(trim(p_body), ''); v_last timestamptz;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found or not app.lead_can_read(l) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not app.lead_can_work(l) then raise exception 'permission denied: lead belongs to another agent' using errcode = '42501'; end if;
  if l.archived_at is not null then raise exception 'lead is archived' using errcode = '22023'; end if;
  if v is null or length(v) > 4000 then raise exception 'write the message' using errcode = '22023'; end if;
  v_last := (select max(received_at) from public.lead_messages where lead_id = l.id and direction = 'in');
  if v_last is null or v_last < now() - interval '24 hours' then
    raise exception 'whatsapp 24-hour window closed: call the customer or send an approved template' using errcode = '22023';
  end if;
  insert into public.lead_messages (lead_id, direction, kind, body, status, author_id) values (l.id, 'out', 'text', v, 'queued', auth.uid())
  returning id into v_id;
  update public.leads set first_contact_at = coalesce(first_contact_at, now()),
    cc_status = case when cc_status = 'new' then 'contacted' else cc_status end,
    status = case when status = 'inquiry' then 'contacted' else status end,
    last_action = 'whatsapp_reply', last_action_at = now()
  where id = l.id;
  return jsonb_build_object('id', v_id, 'phone', l.phone);
end $$;

create or replace function public.lead_reply_result(p_id bigint, p_ok boolean, p_provider_id text, p_error text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.lead_messages set status = case when p_ok then 'sent' else 'failed' end,
    provider_message_id = coalesce(nullif(p_provider_id, ''), provider_message_id), error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and direction = 'out' and author_id = auth.uid() and status = 'queued';
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.lead_update_settings(p jsonb)
returns public.lead_flow_settings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.lead_flow_settings;
begin
  perform app.require_permission('lead.campaigns');
  update public.lead_flow_settings set
    code_prefix = coalesce(nullif(upper(trim(p->>'code_prefix')), ''), code_prefix),
    sla_minutes = coalesce(nullif(p->>'sla_minutes', '')::int, sla_minutes),
    auto_assign = coalesce((p->>'auto_assign')::boolean, auto_assign),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into s;
  return s;
end $$;

-- Conversation history: customer messages, replies, assistant replies on the number, activities — one timeline.
create or replace function public.lead_timeline(p_lead uuid)
returns table (at timestamptz, kind text, direction text, body text, actor text, status text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if not found or not app.lead_can_read(l) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return query
  select m.received_at, 'message:' || m.kind, m.direction, m.body,
         case when m.direction = 'out' then (select coalesce(pr.full_name_ar, pr.full_name_en) from public.profiles pr where pr.user_id = m.author_id) end,
         m.status
  from public.lead_messages m where m.lead_id = l.id
  union all
  select c.created_at, 'assistant', 'out', c.body, 'المساعد / assistant', c.status
  from public.care_messages c
  where c.phone = l.phone and c.direction = 'out' and c.author = 'agent' and c.journey_id is null and c.created_at >= l.created_at - interval '1 minute'
  union all
  select a.created_at, 'activity:' || a.kind, null, a.body,
         (select coalesce(pr.full_name_ar, pr.full_name_en) from public.profiles pr where pr.user_id = a.actor_id), null
  from public.lead_activities a where a.lead_id = l.id
  order by 1 desc, 2;
end $$;

-- People who can hold leads, with duty state and current load (for assignment).
create or replace function public.lead_agents()
returns table (user_id uuid, full_name text, is_agent boolean, on_duty boolean, open_leads bigint, new_leads bigint)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.has_permission('lead.assign') or app.has_permission('lead.report')) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  select u.user_id, coalesce(pr.full_name_ar, pr.full_name_en, '—'), app.lead_user_can_hold(u.user_id, null, true),
         coalesce(d.on_duty, false),
         (select count(*) from public.leads x where x.assigned_to = u.user_id and x.archived_at is null and x.cc_status not in ('not_interested', 'closed', 'booked')),
         (select count(*) from public.leads x where x.assigned_to = u.user_id and x.archived_at is null and x.cc_status = 'new')
  from (select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
        where rp.permission_code in ('lead.own', 'lead.write') and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)) u
  join public.profiles pr on pr.user_id = u.user_id and pr.is_active
  left join public.lead_agent_duty d on d.user_id = u.user_id
  order by 3 desc, 2;
end $$;

-- ---------------------------------------------------------------------------
-- Reports (lead.report or lead.assign). Period = received date in Cairo. Archived leads excluded.
-- ---------------------------------------------------------------------------
create or replace function app.lead_report_rows(p_from date, p_to date, p_campaign uuid default null)
returns setof public.leads language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.has_permission('lead.report') or app.has_permission('lead.assign')) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'invalid period' using errcode = '22023'; end if;
  return query select l.* from public.leads l
  where l.created_at >= (p_from::timestamp at time zone 'Africa/Cairo') and l.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    and l.archived_at is null and (p_campaign is null or l.campaign_id = p_campaign)
    and (app.has_permission('lead.report', l.branch_id) or app.has_permission('lead.assign', l.branch_id));
end $$;

create or replace function public.lead_dashboard(p_from date, p_to date, p_campaign uuid default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with s as (select make_interval(mins => sla_minutes) sla, sla_minutes from public.lead_flow_settings where id),
  r as (select * from app.lead_report_rows(p_from, p_to, p_campaign))
  select jsonb_build_object(
    'total', count(r.id),
    'by_status', jsonb_build_object(
      'new', count(*) filter (where r.cc_status = 'new'), 'contacted', count(*) filter (where r.cc_status = 'contacted'),
      'interested', count(*) filter (where r.cc_status = 'interested'), 'follow_up', count(*) filter (where r.cc_status = 'follow_up'),
      'booked', count(*) filter (where r.cc_status = 'booked'), 'no_response', count(*) filter (where r.cc_status = 'no_response'),
      'not_interested', count(*) filter (where r.cc_status = 'not_interested'), 'closed', count(*) filter (where r.cc_status = 'closed')),
    'contacted', count(*) filter (where r.first_contact_at is not null),
    'interested', count(*) filter (where r.interested_at is not null),
    'booked', count(*) filter (where r.cc_status = 'booked'),
    'no_response', count(*) filter (where r.cc_status = 'no_response'),
    'avg_response_seconds', round(avg(extract(epoch from r.first_contact_at - r.created_at)) filter (where r.first_contact_at is not null)),
    'sla_met', count(*) filter (where r.first_contact_at is not null and r.first_contact_at - r.created_at <= s.sla),
    'sla_counted', count(*) filter (where r.first_contact_at is not null or now() - r.created_at > s.sla),
    'overdue_now', count(*) filter (where r.first_contact_at is null and r.cc_status = 'new' and now() - r.created_at > s.sla),
    'unassigned', count(*) filter (where r.assigned_to is null and r.cc_status not in ('not_interested', 'closed', 'booked')),
    'followups_due', count(*) filter (where r.cc_status = 'follow_up' and r.next_follow_up_at <= now()),
    'sla_minutes', s.sla_minutes)
  from s left join r on true
  group by s.sla, s.sla_minutes
$$;

create or replace function public.lead_campaign_report(p_from date, p_to date)
returns table (campaign_id uuid, code text, name_ar text, name_en text, leads bigint, contacted bigint, interested bigint,
               follow_ups bigint, booked bigint, no_response bigint, avg_response_seconds numeric, sla_met bigint, sla_counted bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with s as (select make_interval(mins => sla_minutes) sla from public.lead_flow_settings where id),
  r as (select * from app.lead_report_rows(p_from, p_to))
  select c.id, coalesce(c.code, '—'), coalesce(c.name_ar, 'بدون كود حملة'), coalesce(c.name_en, 'No campaign code'), count(*),
         count(*) filter (where r.first_contact_at is not null), count(*) filter (where r.interested_at is not null),
         count(*) filter (where r.follow_up_count > 0), count(*) filter (where r.cc_status = 'booked'), count(*) filter (where r.cc_status = 'no_response'),
         round(avg(extract(epoch from r.first_contact_at - r.created_at)) filter (where r.first_contact_at is not null)),
         count(*) filter (where r.first_contact_at is not null and r.first_contact_at - r.created_at <= s.sla),
         count(*) filter (where r.first_contact_at is not null or now() - r.created_at > s.sla)
  from r cross join s left join public.lead_campaigns c on c.id = r.campaign_id
  group by c.id, c.code, c.name_ar, c.name_en order by count(*) desc
$$;

create or replace function public.lead_source_report(p_from date, p_to date)
returns table (source text, ad_id text, ad_name text, adset_name text, meta_campaign_name text, leads bigint, contacted bigint, booked bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select r.source, r.ad_id, max(r.ad_name), max(r.adset_name), max(r.meta_campaign_name), count(*),
         count(*) filter (where r.first_contact_at is not null), count(*) filter (where r.cc_status = 'booked')
  from app.lead_report_rows(p_from, p_to) r group by r.source, r.ad_id order by count(*) desc limit 200
$$;

create or replace function public.lead_agent_report(p_from date, p_to date)
returns table (user_id uuid, full_name text, assigned bigint, contacted bigint, interested bigint, follow_ups bigint, booked bigint,
               no_response bigint, open_new bigint, avg_response_seconds numeric, sla_met bigint, sla_counted bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with s as (select make_interval(mins => sla_minutes) sla from public.lead_flow_settings where id),
  r as (select * from app.lead_report_rows(p_from, p_to))
  select r.assigned_to, coalesce((select coalesce(pr.full_name_ar, pr.full_name_en) from public.profiles pr where pr.user_id = r.assigned_to), 'بدون مسؤول / Unassigned'),
         count(*), count(*) filter (where r.first_contact_at is not null), count(*) filter (where r.interested_at is not null),
         count(*) filter (where r.follow_up_count > 0), count(*) filter (where r.cc_status = 'booked'), count(*) filter (where r.cc_status = 'no_response'),
         count(*) filter (where r.cc_status = 'new'),
         round(avg(extract(epoch from r.first_contact_at - r.created_at)) filter (where r.first_contact_at is not null)),
         count(*) filter (where r.first_contact_at is not null and r.first_contact_at - r.created_at <= s.sla),
         count(*) filter (where r.first_contact_at is not null or now() - r.created_at > s.sla)
  from r cross join s group by r.assigned_to order by count(*) desc
$$;

create or replace function public.lead_daily_report(p_from date, p_to date, p_campaign uuid default null)
returns table (day date, leads bigint, still_new bigint, contacted bigint, interested bigint, follow_ups bigint, booked bigint,
               no_response bigint, avg_response_seconds numeric, sla_met bigint, sla_counted bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with s as (select make_interval(mins => sla_minutes) sla from public.lead_flow_settings where id),
  r as (select * from app.lead_report_rows(p_from, p_to, p_campaign))
  select d::date, count(r.id), count(r.id) filter (where r.cc_status = 'new'), count(r.id) filter (where r.first_contact_at is not null),
         count(r.id) filter (where r.interested_at is not null), count(r.id) filter (where r.follow_up_count > 0),
         count(r.id) filter (where r.cc_status = 'booked'), count(r.id) filter (where r.cc_status = 'no_response'),
         round(avg(extract(epoch from r.first_contact_at - r.created_at)) filter (where r.first_contact_at is not null)),
         count(r.id) filter (where r.first_contact_at is not null and r.first_contact_at - r.created_at <= s.sla),
         count(r.id) filter (where r.first_contact_at is not null or now() - r.created_at > s.sla)
  from generate_series(p_from, p_to, interval '1 day') d cross join s
  left join r on (r.created_at at time zone 'Africa/Cairo')::date = d::date
  group by d order by d desc
$$;

-- Export (lead.export, audited).
create or replace function public.lead_export(p_from date, p_to date)
returns table (lead_id text, received_at timestamptz, name text, phone text, whatsapp_name text, campaign_code text, source text,
               ad_id text, ad_name text, adset_name text, meta_campaign text, utm_source text, utm_medium text, utm_campaign text,
               message text, agent text, status text, first_contact_at timestamptz, response_minutes numeric,
               last_follow_up_at timestamptz, next_follow_up_at timestamptz, follow_up_reason text, booking_at timestamptz,
               booking_service text, booking_notes text, last_note text, archived boolean, updated_at timestamptz)
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_permission('lead.export');
  if p_to < p_from or p_to - p_from > 400 then raise exception 'invalid period' using errcode = '22023'; end if;
  perform app.audit_event('EXPORT', 'leads', p_from || '..' || p_to, null, 'lead export', null);
  return query
  select l.code, l.created_at, l.full_name, l.phone, l.whatsapp_name, c.code, l.source, l.ad_id, l.ad_name, l.adset_name, l.meta_campaign_name,
         l.utm_source, l.utm_medium, l.utm_campaign, l.message,
         (select coalesce(pr.full_name_ar, pr.full_name_en) from public.profiles pr where pr.user_id = l.assigned_to),
         l.cc_status::text, l.first_contact_at, round(extract(epoch from l.first_contact_at - l.created_at) / 60.0, 1),
         l.last_follow_up_at, l.next_follow_up_at, l.follow_up_reason, l.booking_at, l.booking_service, l.booking_notes,
         (select a.body from public.lead_activities a where a.lead_id = l.id and a.kind = 'note' order by a.created_at desc limit 1),
         l.archived_at is not null, l.updated_at
  from public.leads l left join public.lead_campaigns c on c.id = l.campaign_id
  where l.created_at >= (p_from::timestamp at time zone 'Africa/Cairo') and l.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    and app.has_permission('lead.export', l.branch_id)
  order by l.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
-- Agents read exactly the leads assigned to them (other readers keep lead.read).
create policy leads_read_own on public.leads for select to authenticated
  using (assigned_to = auth.uid() and app.has_permission('lead.own', branch_id));

alter table public.lead_campaigns enable row level security;
alter table public.lead_flow_settings enable row level security;
alter table public.lead_messages enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.lead_agent_duty enable row level security;
revoke all on public.lead_campaigns, public.lead_flow_settings, public.lead_messages, public.whatsapp_contacts, public.lead_agent_duty from anon;
revoke all on public.whatsapp_contacts from authenticated;

grant select, insert, update on public.lead_campaigns to authenticated;
create policy lead_campaigns_read on public.lead_campaigns for select to authenticated
  using (app.has_permission('lead.read') or app.has_permission('lead.own') or app.has_permission('lead.report') or app.has_permission('lead.campaigns'));
create policy lead_campaigns_insert on public.lead_campaigns for insert to authenticated with check (app.has_permission('lead.campaigns'));
create policy lead_campaigns_update on public.lead_campaigns for update to authenticated
  using (app.has_permission('lead.campaigns')) with check (app.has_permission('lead.campaigns'));

grant select on public.lead_flow_settings to authenticated;
create policy lead_flow_settings_read on public.lead_flow_settings for select to authenticated
  using (app.has_permission('lead.read') or app.has_permission('lead.own') or app.has_permission('lead.report') or app.has_permission('lead.campaigns'));

grant select on public.lead_messages to authenticated;
create policy lead_messages_read on public.lead_messages for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

grant select on public.lead_agent_duty to authenticated;
create policy lead_agent_duty_read on public.lead_agent_duty for select to authenticated
  using (user_id = auth.uid() or app.has_permission('lead.assign') or app.has_permission('lead.report'));

revoke execute on function public.svc_lead_capture(jsonb), public.svc_lead_message_status(text, text), public.svc_lead_ads_pending(int),
  public.svc_lead_set_ad_names(text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_lead_capture(jsonb), public.svc_lead_message_status(text, text), public.svc_lead_ads_pending(int),
  public.svc_lead_set_ad_names(text, text, text, text) to service_role;

revoke execute on function app.lead_capture(jsonb), app.lead_message_status(text, text), app.lead_ads_pending(int),
  app.lead_set_ad_names(text, text, text, text), app.lead_new_code(text), app.lead_pick_agent(uuid),
  app.lead_user_can_hold(uuid, uuid, boolean), app.lead_report_rows(date, date, uuid) from public, anon, authenticated;

revoke execute on function public.lead_set_outcome(uuid, text, jsonb), public.lead_add_note(uuid, text), public.lead_assign(uuid, uuid),
  public.lead_archive(uuid, text), public.lead_set_duty(boolean, uuid), public.lead_create_manual(jsonb), public.lead_log_reply(uuid, text),
  public.lead_reply_result(bigint, boolean, text, text), public.lead_update_settings(jsonb), public.lead_timeline(uuid), public.lead_agents(),
  public.lead_dashboard(date, date, uuid), public.lead_campaign_report(date, date), public.lead_source_report(date, date),
  public.lead_agent_report(date, date), public.lead_daily_report(date, date, uuid), public.lead_export(date, date) from public, anon;
grant execute on function public.lead_set_outcome(uuid, text, jsonb), public.lead_add_note(uuid, text), public.lead_assign(uuid, uuid),
  public.lead_archive(uuid, text), public.lead_set_duty(boolean, uuid), public.lead_create_manual(jsonb), public.lead_log_reply(uuid, text),
  public.lead_reply_result(bigint, boolean, text, text), public.lead_update_settings(jsonb), public.lead_timeline(uuid), public.lead_agents(),
  public.lead_dashboard(date, date, uuid), public.lead_campaign_report(date, date), public.lead_source_report(date, date),
  public.lead_agent_report(date, date), public.lead_daily_report(date, date, uuid), public.lead_export(date, date) to authenticated;
grant execute on function app.lead_can_work(public.leads), app.lead_can_read(public.leads), app.lead_norm(text),
  app.lead_campaign_live(public.lead_campaigns), app.lead_detect_campaign(text, text), app.lead_settings() to authenticated;
