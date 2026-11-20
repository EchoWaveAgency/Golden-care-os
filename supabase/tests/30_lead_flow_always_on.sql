-- 30 — Always-on campaigns: leads all year; a live seasonal campaign takes priority; explicit codes always win.
\set boss '00000000-0000-4000-8000-000000001203'
reset role;
select test.assert((select code_prefix = 'GC' from public.lead_flow_settings), 'general lead id prefix');
select test.assert((select count(*) = 7 from public.lead_campaigns where always_on and code like 'GC-%'), 'always-on campaigns seeded');
select test.assert((select ends_on = '2026-11-30' from public.lead_campaigns where code = 'GF26-LASER'), 'Golden Friday limited to November');

-- Season over → the always-on campaign of the same service receives the lead.
update public.lead_campaigns set starts_on = '2026-11-01', ends_on = (now() at time zone 'Africa/Cairo')::date - 1 where code like 'GF26-%';
select test.assert((select code = 'GC-LASER' from public.lead_campaigns where id = app.lead_detect_campaign('عايزة اسأل عن الليزر')), 'after the season: always-on laser');
select test.assert((select code = 'GC-NUTRITION' from public.lead_campaigns where id = app.lead_detect_campaign('محتاجة رجيم')), 'nutrition keyword');
select test.assert((select code = 'GF26-LASER' from public.lead_campaigns where id = app.lead_detect_campaign('GF26-LASER عايزة العرض')), 'explicit old code still attributed');
select test.assert(app.lead_detect_campaign('السلام عليكم') is null, 'no keyword → no campaign');

-- Season live → the seasonal campaign wins over the always-on one.
update public.lead_campaigns set ends_on = (now() at time zone 'Africa/Cairo')::date + 1 where code like 'GF26-%';
select test.assert((select code = 'GF26-LASER' from public.lead_campaigns where id = app.lead_detect_campaign('عايزة اسأل عن الليزر')), 'live season wins');
select test.assert((select code = 'GC-GYN' from public.lead_campaigns where id = app.lead_detect_campaign('عايزة حجز متابعه حمل')), 'no seasonal campaign for the service → always-on');

-- A captured lead gets a GC id and the always-on campaign.
update public.lead_campaigns set ends_on = (now() at time zone 'Africa/Cairo')::date - 1 where code like 'GF26-%';
select public.svc_lead_capture(jsonb_build_object('phone', '201055500030', 'name', 'Always On', 'provider_id', 'wamid.AO1', 'text', 'بكام تبييض الاسنان؟')) as ao \gset
select test.assert((select l.code ~ '^GC-' and c.code = 'GC-DENTAL' from public.leads l join public.lead_campaigns c on c.id = l.campaign_id
                    where l.id = ((:'ao'::jsonb)->>'lead_id')::uuid), 'lead id and always-on campaign');

select test.expect_error($q$update public.lead_campaigns set ends_on = '2027-01-01' where code = 'GC-LASER'$q$, 'campaign_always_on_undated');
update public.lead_campaigns set starts_on = '2026-11-01', ends_on = '2026-11-30' where code like 'GF26-%';
