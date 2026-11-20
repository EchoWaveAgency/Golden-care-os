-- 0037 — The lead flow is the clinic's permanent system, not a Golden Friday tool.
-- * Always-on campaigns per department receive leads all year; seasonal campaigns (dates set, e.g. Golden Friday in
--   November) take priority while they are live, then the always-on campaign of the same service takes over.
-- * New lead ids use a general prefix (GC) instead of GF26; existing ids are kept.
-- * The Golden Friday codes are limited to November 2026. An explicit code in a message still wins after the dates
--   (old ads keep working and stay attributed to the campaign that produced them).

alter table public.lead_campaigns add column always_on boolean not null default false;
alter table public.lead_campaigns add constraint campaign_always_on_undated
  check (not always_on or (starts_on is null and ends_on is null));

update public.lead_flow_settings set code_prefix = 'GC', updated_at = now() where id and code_prefix = 'GF26';
alter table public.lead_flow_settings alter column code_prefix set default 'GC';

update public.lead_campaigns set starts_on = coalesce(starts_on, '2026-11-01'), ends_on = coalesce(ends_on, '2026-11-30')
where code like 'GF26-%';

-- Always-on campaigns (names and keywords are routing settings, editable in the system — OPEN_QUESTIONS 132).
insert into public.lead_campaigns (code, name_ar, name_en, service_label, keywords, always_on, growth_department) values
  ('GC-LASER',     'الليزر — دائم',            'Laser — always on',       'Laser',      array['ليزر', 'laser'], true, 'derm'),
  ('GC-SKIN',      'الجلدية والبشرة — دائم',   'Skin — always on',        'Skin',       array['بشره', 'جلديه', 'skin'], true, 'derm'),
  ('GC-DENTAL',    'الأسنان — دائم',           'Dental — always on',      'Dental',     array['اسنان', 'تبييض', 'تقويم', 'dental', 'teeth'], true, 'dental'),
  ('GC-GYN',       'النساء والتوليد — دائم',   'Gynecology — always on',  'Gynecology', array['نساء', 'توليد', 'متابعه حمل', 'gyn'], true, 'gynecology'),
  ('GC-NUTRITION', 'التغذية العلاجية — دائم',  'Nutrition — always on',   'Nutrition',  array['تغذيه', 'رجيم', 'دايت', 'nutrition', 'diet'], true, 'nutrition'),
  ('GC-VASCULAR',  'الأوعية الدموية — دائم',   'Vascular — always on',    'Vascular',   array['دوالي', 'اوعيه', 'vascular'], true, 'vascular'),
  ('GC-GENERAL',   'استفسار عام — دائم',       'General — always on',     null,         '{}', true, null)
on conflict (code) do nothing;

-- Detection: explicit code > Meta ad id > keyword of a live campaign, seasonal before always-on, longest keyword first.
create or replace function app.lead_detect_campaign(p_text text, p_ad_id text default null)
returns uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare t text := app.lead_norm(p_text); v uuid;
begin
  select c.id into v from public.lead_campaigns c where position(lower(c.code) in t) > 0 order by length(c.code) desc limit 1;
  if v is not null then return v; end if;
  if nullif(p_ad_id, '') is not null then
    select c.id into v from public.lead_campaigns c where p_ad_id = any(c.meta_ad_ids) order by app.lead_campaign_live(c) desc, c.is_active desc limit 1;
    if v is not null then return v; end if;
  end if;
  select c.id into v from public.lead_campaigns c, unnest(c.keywords) k
  where app.lead_campaign_live(c) and position(k in t) > 0 order by c.always_on, length(k) desc, c.code limit 1;
  return v;
end $$;
