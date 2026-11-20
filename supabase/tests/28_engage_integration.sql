-- 28 — HORUS Engage events become call-center leads (idempotent, campaign detected, Messenger source, booking request)
reset role;
select public.svc_lead_external(jsonb_build_object('event', 'booking_request', 'event_id', 'e-1', 'channel', 'messenger', 'source', 'comment',
  'campaign_code', 'GF26-LASER', 'service_code', 'LASER', 'contact', jsonb_build_object('name', 'Sara Engage', 'phone', '01123456780'),
  'transcript', jsonb_build_array(jsonb_build_object('from', 'contact', 'text', 'بكام الليزر؟'), jsonb_build_object('from', 'bot', 'text', 'من 500 جنيه')),
  'booking', jsonb_build_object('day', '2026-11-28', 'period', 'evening'))) as r1 \gset
select test.assert((:'r1'::jsonb)->>'action' = 'created' and (:'r1'::jsonb)->>'ref' like 'GC-%', 'lead created with a call-center id');
select test.assert((select l.source = 'facebook' and l.channel = 'social' and l.kind = 'booking' and c.code = 'GF26-LASER' and l.full_name = 'Sara Engage'
                    from public.leads l join public.lead_campaigns c on c.id = l.campaign_id where l.code = (:'r1'::jsonb)->>'ref'), 'source, campaign, booking kind');
select test.assert((select count(*) = 1 from public.lead_activities a join public.leads l on l.id = a.lead_id where l.code = (:'r1'::jsonb)->>'ref' and a.body like 'booking request via HORUS Engage · 2026-11-28 · evening%'), 'booking request visible to the agent');
select test.assert((select body like '%بكام الليزر%' from public.lead_messages m join public.leads l on l.id = m.lead_id where l.code = (:'r1'::jsonb)->>'ref'), 'conversation summary in the history');
select test.assert((public.svc_lead_external(jsonb_build_object('event', 'booking_request', 'event_id', 'e-1', 'contact', jsonb_build_object('phone', '01123456780'))))->>'action' = 'duplicate', 'same event twice → once');
select test.assert((public.svc_lead_external(jsonb_build_object('event', 'handoff', 'event_id', 'e-2', 'channel', 'messenger', 'handoff_reason', 'asked_human', 'campaign_code', 'GF26-LASER',
  'contact', jsonb_build_object('phone', '+20 112 345 6780'))))->>'ref' = (:'r1'::jsonb)->>'ref', 'later event joins the open lead');
select test.assert((public.svc_lead_external(jsonb_build_object('event', 'lead', 'event_id', 'e-3', 'channel', 'instagram', 'contact', jsonb_build_object('name', 'No phone'))))->>'action' = 'skipped', 'no phone yet → skipped (stays in Engage)');
select test.expect_error($q$select public.svc_lead_external('{"event": "drop_table", "event_id": "x", "contact": {"phone": "01000000000"}}')$q$, 'unknown event');
set role authenticated;
select test.expect_error($q$select public.svc_lead_external('{}')$q$, 'permission denied');
