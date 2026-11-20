-- 0036 — Growth plan targets on the Golden Friday dashboard.
-- Department patient targets per phase (from the clinic's growth plan), the funnel assumptions used to turn them into
-- lead targets, and a report that shows actual vs target for any period:
--   actual patients  = distinct patients with an attended appointment in the department's specialties (Cairo date of the slot)
--   actual leads     = call-center leads whose campaign belongs to the department (received date in Cairo, archived excluded)
--   target leads     = (phase target − today's patients) × share from new leads ÷ (booking rate × show rate), per month, prorated.
-- Targets and assumptions are editable (lead.campaigns); the measured booking rate is shown next to the assumed one so the
-- assumption can be replaced with the real call-center rate after the first week.

-- ---------------------------------------------------------------------------
-- Settings (one row): funnel assumptions and the phase calendar
-- ---------------------------------------------------------------------------
create table public.growth_settings (
  id               boolean primary key default true check (id),
  phase1_start     date,                                   -- not set until the clinic confirms it (OPEN_QUESTIONS 131)
  phase_weeks      int     not null default 13 check (phase_weeks between 1 and 52),
  booking_rate     numeric not null default 0.30 check (booking_rate > 0 and booking_rate <= 1),   -- lead → booked (assumption)
  show_rate        numeric not null default 0.70 check (show_rate > 0 and show_rate <= 1),         -- booked → attended (assumption)
  new_lead_share   numeric not null default 1.00 check (new_lead_share >= 0 and new_lead_share <= 1),
  weeks_per_month  numeric not null default 4.33 check (weeks_per_month between 4 and 5),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);
insert into public.growth_settings (id) values (true);

create table public.growth_departments (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_ar          text not null check (length(trim(name_ar)) between 2 and 120),
  name_en          text not null check (length(trim(name_en)) between 2 and 120),
  specialty_codes  text[] not null default '{}',
  baseline_month   int not null default 0 check (baseline_month >= 0),
  target_p1        int not null default 0 check (target_p1 >= 0),
  target_p2        int not null default 0 check (target_p2 >= 0),
  target_p3        int not null default 0 check (target_p3 >= 0),
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);

-- Monthly patients today and the three phase targets, from Growth_Plan_Patients_Only.pdf.
insert into public.growth_departments (code, name_ar, name_en, specialty_codes, baseline_month, target_p1, target_p2, target_p3, sort_order) values
  ('derm',      'الجلدية والبشرة',  'Dermatology & skin', array['derm'],                                            240, 240, 335, 479, 1),
  ('dental',    'الأسنان',          'Dental',             array['dental'],                                            8,  67,  94, 134, 2),
  ('gynecology','النساء والتوليد',  'Gynecology',         array['obgyn'],                                            62, 144, 201, 287, 3),
  ('nutrition', 'التغذية العلاجية', 'Nutrition',          array['nutrition'],                                        24,  51,  71, 102, 4),
  ('vascular',  'الأوعية الدموية',  'Vascular',           array['vascular'],                                          4,   9,  12,  17, 5),
  ('other',     'أقسام أخرى',       'Other departments',  array['ortho', 'gensurg', 'plastic', 'neuro', 'internal'],  7,  63,  88, 126, 6);

-- Which department a campaign's leads count toward.
alter table public.lead_campaigns add column growth_department text references public.growth_departments(code);
update public.lead_campaigns set growth_department = 'derm'   where code in ('GF26-LASER', 'GF26-SKIN');
update public.lead_campaigns set growth_department = 'dental' where code = 'GF26-DENTAL';

create trigger trg_audit_growth_settings after update on public.growth_settings
  for each row execute function app.audit_row();
create trigger trg_audit_growth_departments after insert or update on public.growth_departments
  for each row execute function app.audit_row();
create trigger trg_growth_departments_no_delete before delete on public.growth_departments
  for each row execute function app.block_delete();

-- ---------------------------------------------------------------------------
-- Edits (lead.campaigns)
-- ---------------------------------------------------------------------------
create or replace function public.growth_update_settings(p jsonb)
returns public.growth_settings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.growth_settings;
begin
  perform app.require_permission('lead.campaigns');
  update public.growth_settings set
    phase1_start    = case when p ? 'phase1_start' then nullif(p->>'phase1_start', '')::date else phase1_start end,
    phase_weeks     = coalesce(nullif(p->>'phase_weeks', '')::int, phase_weeks),
    booking_rate    = coalesce(nullif(p->>'booking_rate', '')::numeric, booking_rate),
    show_rate       = coalesce(nullif(p->>'show_rate', '')::numeric, show_rate),
    new_lead_share  = coalesce(nullif(p->>'new_lead_share', '')::numeric, new_lead_share),
    weeks_per_month = coalesce(nullif(p->>'weeks_per_month', '')::numeric, weeks_per_month),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into s;
  return s;
end $$;

create or replace function public.growth_update_department(p_code text, p jsonb)
returns public.growth_departments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.growth_departments;
begin
  perform app.require_permission('lead.campaigns');
  update public.growth_departments set
    name_ar        = coalesce(nullif(trim(p->>'name_ar'), ''), name_ar),
    name_en        = coalesce(nullif(trim(p->>'name_en'), ''), name_en),
    baseline_month = coalesce(nullif(p->>'baseline_month', '')::int, baseline_month),
    target_p1      = coalesce(nullif(p->>'target_p1', '')::int, target_p1),
    target_p2      = coalesce(nullif(p->>'target_p2', '')::int, target_p2),
    target_p3      = coalesce(nullif(p->>'target_p3', '')::int, target_p3),
    is_active      = coalesce((p->>'is_active')::boolean, is_active),
    updated_by = auth.uid(), updated_at = now()
  where code = p_code returning * into d;
  if not found then raise exception 'department not found' using errcode = 'P0002'; end if;
  return d;
end $$;

-- ---------------------------------------------------------------------------
-- Phase of a date: 1..3 from phase1_start; before the start (or no start set) → 1; after phase 3 → 3.
-- ---------------------------------------------------------------------------
create or replace function app.growth_phase(p_day date)
returns int language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when s.phase1_start is null or p_day < s.phase1_start then 1
              else least(3, 1 + ((p_day - s.phase1_start) / (s.phase_weeks * 7))) end
  from public.growth_settings s where s.id
$$;

-- ---------------------------------------------------------------------------
-- Report: actual vs target per department for a period (lead.report or lead.assign)
-- ---------------------------------------------------------------------------
create or replace function public.growth_progress(p_from date, p_to date)
returns table (code text, name_ar text, name_en text, sort_order int, phase int,
               baseline_month int, target_p1 int, target_p2 int, target_p3 int, target_month int,
               target_patients numeric, actual_patients bigint, target_leads numeric, actual_leads bigint, booked bigint)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  s public.growth_settings;
  v_days int := p_to - p_from + 1;
  v_phase int;
begin
  if not (app.has_permission('lead.report') or app.has_permission('lead.assign')) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'invalid period' using errcode = '22023'; end if;
  select * into s from public.growth_settings where id;
  v_phase := app.growth_phase(p_to);
  return query
  with d as (
    select g.*, case v_phase when 1 then g.target_p1 when 2 then g.target_p2 else g.target_p3 end as tm
    from public.growth_departments g where g.is_active
  ),
  pts as (
    select g.code, count(distinct a.patient_id) n
    from d g
    join public.specialties sp on sp.code = any (g.specialty_codes)
    join public.appointments a on a.specialty_id = sp.id
    where a.status in ('arrived', 'waiting', 'in_consultation', 'procedure_in_progress', 'awaiting_payment', 'completed')
      and lower(a.slot) >= (p_from::timestamp at time zone 'Africa/Cairo') and lower(a.slot) < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
      and (app.has_permission('lead.report', a.branch_id) or app.has_permission('lead.assign', a.branch_id))
    group by g.code
  ),
  lds as (
    select c.growth_department code, count(*) n, count(*) filter (where r.cc_status = 'booked') b
    from app.lead_report_rows(p_from, p_to) r join public.lead_campaigns c on c.id = r.campaign_id
    where c.growth_department is not null
    group by c.growth_department
  )
  select d.code, d.name_ar, d.name_en, d.sort_order, v_phase,
         d.baseline_month, d.target_p1, d.target_p2, d.target_p3, d.tm,
         round(d.tm * v_days / (s.weeks_per_month * 7), 1),
         coalesce(pts.n, 0),
         round(greatest(0, d.tm - d.baseline_month) * s.new_lead_share / (s.booking_rate * s.show_rate) * v_days / (s.weeks_per_month * 7), 1),
         coalesce(lds.n, 0), coalesce(lds.b, 0)
  from d left join pts on pts.code = d.code left join lds on lds.code = d.code
  order by d.sort_order, d.code;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants: read for lead readers/reporters; writes only through the RPCs above.
-- ---------------------------------------------------------------------------
alter table public.growth_settings enable row level security;
alter table public.growth_departments enable row level security;
revoke all on public.growth_settings, public.growth_departments from anon, authenticated;
grant select on public.growth_settings, public.growth_departments to authenticated;
create policy growth_settings_read on public.growth_settings for select to authenticated
  using (app.has_permission('lead.report') or app.has_permission('lead.assign') or app.has_permission('lead.campaigns'));
create policy growth_departments_read on public.growth_departments for select to authenticated
  using (app.has_permission('lead.report') or app.has_permission('lead.assign') or app.has_permission('lead.campaigns'));

revoke execute on function app.growth_phase(date) from public, anon, authenticated;
revoke execute on function public.growth_update_settings(jsonb), public.growth_update_department(text, jsonb),
  public.growth_progress(date, date) from public, anon;
grant execute on function public.growth_update_settings(jsonb), public.growth_update_department(text, jsonb),
  public.growth_progress(date, date) to authenticated;
