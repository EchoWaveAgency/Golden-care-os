-- 27 — Lead flow × call center (Golden Friday): capture from WhatsApp, campaigns, duplicates, ownership,
--      SLA / response time, follow-up, booking, archive, reports, export, care routing, permissions.
\set admin   '00000000-0000-4000-8000-000000001001'
\set fd      '00000000-0000-4000-8000-000000001002'
\set nobody  '00000000-0000-4000-8000-000000001008'
\set ag1     '00000000-0000-4000-8000-000000001201'
\set ag2     '00000000-0000-4000-8000-000000001202'
\set boss    '00000000-0000-4000-8000-000000001203'
\set mkt     '00000000-0000-4000-8000-000000001204'
\set b1      '00000000-0000-4000-8000-000000000101'

-- Setup (owner): two call-center agents, an operations manager, a marketing user.
insert into auth.users (id, email) values (:'ag1', 'ag1.27@test.local'), (:'ag2', 'ag2.27@test.local'), (:'boss', 'ops27@test.local'), (:'mkt', 'mkt27@test.local');
insert into public.profiles (user_id, full_name_ar, full_name_en) values
  (:'ag1', 'أحمد الكول سنتر', 'Ahmed CC'), (:'ag2', 'منة الكول سنتر', 'Menna CC'), (:'boss', 'مدير التشغيل', 'Ops Manager'), (:'mkt', 'التسويق', 'Marketing');
insert into public.user_roles (user_id, role_code, branch_id) values
  (:'ag1', 'call_center_agent', :'b1'), (:'ag2', 'call_center_agent', :'b1'), (:'boss', 'operations_manager', null), (:'mkt', 'marketing', null);
update public.lead_flow_settings set default_branch_id = :'b1';
-- Keep this suite independent of today's date: the Golden Friday codes run undated here (restored at the end).
update public.lead_campaigns set starts_on = null, ends_on = null where code like 'GF26-%';

-- Agents go on duty themselves.
set role authenticated;
select test.login(:'ag1'); select public.lead_set_duty(true);
select test.login(:'ag2'); select public.lead_set_duty(true);
select test.login(:'fd');
select test.expect_error($q$select public.lead_set_duty(true, '00000000-0000-4000-8000-000000001201')$q$, 'permission denied');

-- ---------- TEST 1–3, 5: WhatsApp message from a Click-to-WhatsApp ad arrives → lead with id, campaign, source, owner
reset role;
select public.svc_lead_capture(jsonb_build_object(
  'phone', '201001112233', 'name', 'Mariam Adel', 'provider_id', 'wamid.GF1',
  'text', 'مرحبا عايزة اعرف عرض GF26-LASER',
  'referral', jsonb_build_object('source_url', 'https://fb.me/abc', 'source_id', '120210000000001', 'source_type', 'ad',
                                 'headline', 'Golden Friday', 'ctwa_clid', 'ARAkLk...'),
  'received_at', (now() - interval '7 minutes')::text)) as c1 \gset
select test.assert((:'c1'::jsonb)->>'action' = 'created', 'TEST 1–2: message captured, lead created');
select id as l1, code as l1code from public.leads where id = ((:'c1'::jsonb)->>'lead_id')::uuid \gset
select test.assert(:'l1code' ~ '^GC-[2-9A-HJ-NP-Z]{6}$', 'lead id GC-XXXXXX');
select test.assert((select c.code = 'GF26-LASER' from public.leads l join public.lead_campaigns c on c.id = l.campaign_id where l.id = :'l1'), 'TEST 3: campaign detected from the code');
select test.assert((select source = 'facebook' and ad_id = '120210000000001' and ctwa_clid is not null and full_name = 'Mariam Adel'
                           and whatsapp_name = 'Mariam Adel' and cc_status = 'new' and phone = '+201001112233' from public.leads where id = :'l1'),
  'source, ad, click id, WhatsApp name, status NEW');
select test.assert((select assigned_to in (:'ag1'::uuid, :'ag2'::uuid) and assigned_at is not null from public.leads where id = :'l1'), 'TEST 5: auto-assigned to an agent on duty');
select assigned_to as owner1 from public.leads where id = :'l1' \gset
select test.assert((select created_at < now() - interval '6 minutes' from public.leads where id = :'l1'), 'received time = message time');

-- ---------- TEST 11: duplicates — same message again (Meta retry), another message, a message without code
select test.assert((public.svc_lead_capture(jsonb_build_object('phone', '201001112233', 'provider_id', 'wamid.GF1', 'text', 'x')))->>'action' = 'duplicate',
  'Meta retry is idempotent');
select test.assert((public.svc_lead_capture(jsonb_build_object('phone', '+20 100 111 2233', 'provider_id', 'wamid.GF2', 'text', 'السعر كام؟')))->>'lead_id' = :'l1',
  'follow-up message without code joins the open lead');
select test.assert((public.svc_lead_capture(jsonb_build_object('phone', '01001112233', 'provider_id', 'wamid.GF3', 'text', 'GF26-LASER تاني')))->>'lead_id' = :'l1',
  'same phone + same campaign + open → same lead');
select test.assert((select count(*) = 1 from public.leads where phone = '+201001112233'), 'TEST 11: no duplicate lead');
select test.assert((select count(*) = 3 from public.lead_messages where lead_id = :'l1' and direction = 'in'), 'every message kept in the lead history');
-- Same phone, different campaign → a separate lead (different interest).
select (public.svc_lead_capture(jsonb_build_object('phone', '201001112233', 'provider_id', 'wamid.GF4', 'text', 'وعايزة كمان GF26-DENTAL')))->>'lead_id' as l1b \gset
select test.assert(:'l1b' <> :'l1', 'different campaign → its own lead');
-- Nothing to attribute and no open lead → not captured here (the care assistant decides).
select test.assert((public.svc_lead_capture(jsonb_build_object('phone', '01009998877', 'provider_id', 'wamid.X1', 'text', 'تأكيد 1')))->>'action' = 'skipped',
  'plain message from an unrelated number is left to the care assistant');
-- Keyword match without a code; Instagram source; one-character names are ignored.
select (public.svc_lead_capture(jsonb_build_object('phone', '01112223344', 'name', '.', 'provider_id', 'wamid.K1', 'text', 'عايزة اسأل عن الليزر',
        'referral', jsonb_build_object('source_url', 'https://www.instagram.com/p/xyz', 'source_id', '999000111')))) ->>'lead_id' as l2 \gset
select test.assert((select c.code = 'GF26-LASER' and l.source = 'instagram' and l.full_name = 'عميل واتساب'
                    from public.leads l join public.lead_campaigns c on c.id = l.campaign_id where l.id = :'l2'), 'keyword → campaign; Instagram source; placeholder name');
select test.assert((select assigned_to <> :'owner1'::uuid from public.leads where id = :'l1b'), 'round-robin: next lead to the other agent');
select assigned_to as owner2 from public.leads where id = :'l1b' \gset

-- Concurrent first messages from one number: the advisory lock serializes capture (see concurrency.sh style); here: sequential safety.
select test.expect_error($q$select public.svc_lead_capture('{"phone": "abc", "text": "x"}')$q$, 'invalid phone');

-- ---------- TEST 4, 12: visibility — agent sees only own leads; others nothing
set role authenticated;
select test.login(:'owner1');
select test.assert((select count(*) = 1 from public.leads where id = :'l1'), 'TEST 4: owner agent sees the lead');
select test.assert((select count(*) = 0 from public.leads where id = :'l1b'), 'agent does not see another agent''s lead');
select test.assert((select count(*) >= 3 from public.lead_messages where lead_id = :'l1'), 'owner reads the conversation');
select test.assert((select count(*) = 0 from public.lead_messages where lead_id = :'l1b'), 'no conversation of other agents'' leads');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'contacted')$q$, :'l1b'), 'lead not found');
update public.leads set cc_status = 'booked', first_contact_at = created_at where id = :'l1';
select test.assert((select cc_status = 'new' and first_contact_at is null from public.leads where id = :'l1'), 'agent cannot edit the row directly (RLS: no change)');
select test.expect_error($q$select * from public.lead_dashboard(current_date, current_date)$q$, 'permission denied');
select test.expect_error($q$select * from public.lead_export(current_date, current_date)$q$, 'permission denied');
select test.expect_error($q$insert into public.lead_campaigns (code, name_ar, name_en) values ('GF26-X', 'س', 'x')$q$, 'row-level security');
select test.expect_error($q$select count(*) from public.whatsapp_contacts$q$, 'permission denied');
select test.login(:'nobody');
select test.assert((select count(*) = 0 from public.leads) and (select count(*) = 0 from public.lead_messages), 'TEST 12: no role → no lead data');
select test.expect_error(format($q$select * from public.lead_timeline(%L)$q$, :'l1'), 'lead not found');
set role anon;
select test.expect_error($q$select public.svc_lead_capture('{"phone": "01001234567", "text": "GF26-LASER"}')$q$, 'permission denied');
select test.expect_error($q$select count(*) from public.leads$q$, 'permission denied');
set role authenticated;
select test.login_aal(:'owner1', 'aal1');
-- (agents are not privileged, so password-only sessions still work for them)
select test.assert((select count(*) = 1 from public.leads where id = :'l1'), 'agent works with a normal sign-in');

-- ---------- TEST 6–7: agent marks Contacted → first contact time and response time
select test.login(:'owner1');
select public.lead_set_outcome(:'l1', 'contacted', '{"notes": "اتصلت وشرحت العرض"}') is not null as x \gset
select test.assert((select cc_status = 'contacted' and status = 'contacted' and first_contact_at is not null and last_action = 'contacted'
                    from public.leads where id = :'l1'), 'TEST 6: contacted; legacy funnel moved too');
select test.assert((select extract(epoch from first_contact_at - created_at) between 7 * 60 - 5 and 7 * 60 + 30 from public.leads where id = :'l1'),
  'TEST 7: response time ≈ 7 minutes (SLA breached)');
select test.assert((select count(*) = 1 from public.lead_activities where lead_id = :'l1' and kind = 'status' and body like 'NEW → CONTACTED%' and actor_id = :'owner1'),
  'activity log: who / what / before → after');
select test.assert((select count(*) = 1 from public.lead_activities where lead_id = :'l1' and kind = 'note'), 'note kept');

-- ---------- TEST 8: follow-up needs date, time and reason
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'follow_up', '{"reason": "x"}')$q$, :'l1'), 'date and time are required');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'follow_up', jsonb_build_object('at', now() + interval '1 day'))$q$, :'l1'), 'reason is required');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'follow_up', jsonb_build_object('at', now() - interval '1 day', 'reason', 'x'))$q$, :'l1'), 'in the past');
select public.lead_set_outcome(:'l1', 'follow_up', jsonb_build_object('at', now() + interval '3 hours', 'reason', 'تستشير زوجها', 'notes', 'كلمها بعد العصر')) is not null as x \gset
select test.assert((select cc_status = 'follow_up' and next_follow_up_at > now() and follow_up_reason = 'تستشير زوجها' and follow_up_count = 1
                    from public.leads where id = :'l1'), 'TEST 8: follow-up created');

-- ---------- TEST 9: booked
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'booked', jsonb_build_object('at', now() + interval '2 days'))$q$, :'l1'), 'service is required');
select public.lead_set_outcome(:'l1', 'booked', jsonb_build_object('at', now() + interval '2 days', 'service', 'Laser — full body', 'notes', 'تدفع عربون')) is not null as x \gset
select test.assert((select cc_status = 'booked' and booking_at > now() and booking_service = 'Laser — full body' and booked_by = :'owner1'
                    and next_follow_up_at is null and last_follow_up_at is null and interested_at is not null and status = 'appointment_requested'
                    from public.leads where id = :'l1'), 'TEST 9: booked with date, service, agent');
-- Customer writes again after booking → same lead (booked is still open for that campaign).
reset role;
select test.assert((public.svc_lead_capture(jsonb_build_object('phone', '01001112233', 'provider_id', 'wamid.GF5', 'text', 'الموعد الساعة كام؟ GF26-LASER')))->>'lead_id' = :'l1',
  'booked customer''s question stays on the lead');
set role authenticated;

-- Reasons for not interested / closed.
select test.login(:'owner2');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'not_interested')$q$, :'l1b'), 'reason is required');
select public.lead_set_outcome(:'l1b', 'no_response') is not null as x \gset
select test.assert((select cc_status = 'no_response' and first_contact_at is not null from public.leads where id = :'l1b'), 'no response counts as a first contact attempt');

-- ---------- Ownership: admin assigns / reassigns / unassigns; agents cannot
select test.expect_error(format($q$select public.lead_assign(%L, %L)$q$, :'l1b', :'owner1'), 'permission denied');
select test.login(:'boss');
select test.assert((select count(*) >= 3 from public.leads where phone in ('+201001112233', '+201112223344')), 'operations manager sees all leads');
select test.expect_error(format($q$select public.lead_assign(%L, %L)$q$, :'l1b', :'nobody'), 'cannot hold leads');
select test.expect_error(format($q$update public.leads set first_contact_at = created_at, cc_status = 'contacted' where id = %L$q$, :'l1b'), 'lead actions');
select test.expect_error(format($q$update public.leads set assigned_to = %L where id = %L$q$, :'boss', :'l1b'), 'lead actions');
select public.lead_assign(:'l1b', :'owner1') is not null as x \gset
select test.assert((select assigned_to = :'owner1'::uuid from public.leads where id = :'l1b'), 'reassigned');
select test.login(:'owner2');
select test.assert((select count(*) = 0 from public.leads where id = :'l1b'), 'previous agent loses access after reassignment');
select test.login(:'boss');
select public.lead_assign(:'l1b', null) is not null as x \gset
select test.assert((select assigned_to is null and assigned_at is null from public.leads where id = :'l1b'), 'unassigned');
select public.lead_assign(:'l1b', :'owner2') is not null as x \gset

-- ---------- Archive instead of delete
select test.login(:'owner2');
select test.expect_error(format($q$select public.lead_archive(%L, 'test lead')$q$, :'l1b'), 'permission denied');
select test.login(:'boss');
select test.expect_error(format($q$select public.lead_archive(%L, '')$q$, :'l1b'), 'reason is required');
select test.expect_error(format($q$delete from public.leads where id = %L$q$, :'l1b'), 'permission denied');
select public.lead_archive(:'l1b', 'رقم اختبار من فريق التسويق');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'contacted')$q$, :'l1b'), 'archived');

-- ---------- Manual lead (phone call) and duplicate on manual entry
select test.login(:'owner1');
select public.lead_create_manual('{"full_name": "Hoda Samir", "phone": "01223334455", "campaign_code": "gf26-skin", "message": "اتصلت على الخط الأرضي"}') as m1 \gset
select test.assert((select source = 'manual' and assigned_to = :'owner1'::uuid and channel = 'phone' from public.leads where code = :'m1'), 'agent''s manual lead is theirs');
select test.assert(public.lead_create_manual('{"full_name": "Hoda Samir", "phone": "+201223334455", "campaign_code": "GF26-SKIN"}') = :'m1', 'manual duplicate merged');
select test.expect_error($q$select public.lead_create_manual('{"full_name": "X Y", "phone": "01223334455", "campaign_code": "NOPE"}')$q$, 'unknown campaign');

-- ---------- WhatsApp reply from the workspace (24-hour window)
select public.lead_log_reply(:'l1', 'أهلاً مريم، موعدك يوم الأحد') as r1 \gset
select test.assert((select status = 'queued' and direction = 'out' and author_id = :'owner1' from public.lead_messages where id = ((:'r1'::jsonb)->>'id')::bigint), 'reply logged before sending');
select public.lead_reply_result(((:'r1'::jsonb)->>'id')::bigint, true, 'wamid.OUT1', null);
reset role;
select public.svc_lead_message_status('wamid.OUT1', 'read');
select public.svc_lead_message_status('wamid.OUT1', 'delivered');
select test.assert((select status = 'read' from public.lead_messages where provider_message_id = 'wamid.OUT1'), 'delivery status monotonic');
set role authenticated;
select test.login(:'owner1');
select test.expect_error(format($q$select public.lead_log_reply(%L, 'hi')$q$, (select id from public.leads where code = :'m1')), '24-hour window');

-- ---------- TEST 10: dashboard and reports (operations manager, marketing)
select test.login(:'mkt');
select id as laser from public.lead_campaigns where code = 'GF26-LASER' \gset
select test.assert((public.lead_dashboard('2020-01-01', '2020-01-02')->>'total')::int = 0, 'empty period → total 0');
select public.lead_dashboard(current_date - 1, current_date, :'laser') as d \gset
reset role;
select count(*) as e_total, count(*) filter (where cc_status = 'booked') as e_booked, count(*) filter (where first_contact_at is not null) as e_contacted,
       count(*) filter (where first_contact_at - created_at <= interval '5 minutes') as e_met,
       round(avg(extract(epoch from first_contact_at - created_at)) filter (where first_contact_at is not null)) as e_avg
from public.leads where campaign_id = :'laser' and archived_at is null and created_at > now() - interval '1 day' \gset
set role authenticated;
select test.assert((:'d'::jsonb->>'total')::int = :e_total and (:'d'::jsonb->'by_status'->>'booked')::int = :e_booked and :e_total >= 2,
  'TEST 10: dashboard counts match the database (archived excluded)');
select test.assert((:'d'::jsonb->>'contacted')::int = :e_contacted and (:'d'::jsonb->>'sla_met')::int = :e_met
                   and (:'d'::jsonb->>'avg_response_seconds')::numeric = :e_avg, 'response time and SLA in the dashboard');
select test.assert((select leads = :e_total and booked = :e_booked from public.lead_campaign_report(current_date - 1, current_date) where code = 'GF26-LASER'), 'campaign report (archived excluded)');
select test.assert((select count(*) >= 1 from public.lead_source_report(current_date - 1, current_date) where source = 'facebook' and ad_id = '120210000000001'), 'source / ad report');
select test.assert((select booked = 1 from public.lead_agent_report(current_date - 1, current_date) where user_id = :'owner1'), 'agent report');
select test.assert((select sum(leads) = :e_total and sum(booked) = :e_booked from public.lead_daily_report(current_date - 1, current_date, :'laser')), 'daily report');
select test.expect_error($q$select * from public.lead_export(current_date, current_date)$q$, 'permission denied');
select test.expect_error($q$select public.lead_update_settings('{"sla_minutes": 10}')$q$, 'permission denied');
select test.expect_error(format($q$select public.lead_set_outcome(%L, 'contacted')$q$, :'l1'), 'another agent');
select test.login(:'boss');
select test.assert((select count(*) = 4 and bool_or(archived) from public.lead_export(current_date - 1, current_date) where phone in ('+201001112233', '+201112223344', '+201223334455')), 'export includes archived (flagged)');
reset role;
select test.assert((select count(*) >= 1 from public.audit_events where action = 'EXPORT' and table_name = 'leads' and actor_id = :'boss'), 'export audited');
set role authenticated;
select test.login(:'boss');
select test.assert((select count(*) >= 5 from public.lead_timeline(:'l1')), 'timeline: messages + activities');
select public.lead_update_settings('{"sla_minutes": 7}') is not null as x \gset
select test.assert((select sla_minutes = 7 from public.lead_flow_settings), 'settings saved');
insert into public.lead_campaigns (code, name_ar, name_en, keywords) values ('gf26-hair', 'الشعر', 'Hair', array['فرد الشعر', 'ab']);
select test.assert((select code = 'GF26-HAIR' and keywords = array['فرد الشعر'] from public.lead_campaigns where code = 'GF26-HAIR'), 'codes upper-cased; short keywords dropped');
select test.expect_error($q$delete from public.lead_campaigns where code = 'GF26-HAIR'$q$, 'permission denied');

-- ---------- Care assistant routing: no message is dropped or hidden from the call center
reset role;
-- Unknown sender, no ad: first message → lead (auto-reply), 2nd–5th → same lead (no new leads, no repeated auto-reply)
select public.svc_care_inbound('01055500001', 'wamid.C1', 'السلام عليكم', 'whatsapp') as k1 \gset
select test.assert((public.svc_care_unrouted(((:'k1'::jsonb)->>'message_id')::uuid, false))->>'action' = 'lead', 'unknown sender → lead');
select public.svc_care_inbound('01055500001', 'wamid.C2', 'حد يرد', 'whatsapp') as k2 \gset
select test.assert((public.svc_care_unrouted(((:'k2'::jsonb)->>'message_id')::uuid, false))->>'action' = 'lead_attached', 'repeat → attached');
select public.svc_care_inbound('01055500001', 'wamid.C3', 'ألو', 'whatsapp') as k3 \gset
select public.svc_care_unrouted(((:'k3'::jsonb)->>'message_id')::uuid, false);
select public.svc_care_inbound('01055500001', 'wamid.C4', 'ألو؟', 'whatsapp') as k4 \gset
select public.svc_care_unrouted(((:'k4'::jsonb)->>'message_id')::uuid, false);
select test.assert((select count(*) = 1 from public.leads where phone = '+201055500001')
               and (select count(*) = 4 from public.lead_messages m join public.leads l on l.id = m.lead_id where l.phone = '+201055500001'),
  '4 messages from one number: one lead, 4 messages (old path dropped the 4th)');
-- A known patient who clicked an ad: the webhook captured the lead, the care path keeps it there (no ticket).
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'كريم', 'مريض قديم', '01077700021') returning id as kp \gset
select public.svc_lead_capture(jsonb_build_object('phone', '01077700021', 'provider_id', 'wamid.P1', 'text', 'GF26-DENTAL عايز احجز',
       'referral', jsonb_build_object('source_id', '120210000000009'))) is not null as x \gset
select public.svc_care_inbound('01077700021', 'wamid.P1', 'GF26-DENTAL عايز احجز', 'whatsapp') as kpm \gset
select test.assert((public.svc_care_unrouted(((:'kpm'::jsonb)->>'message_id')::uuid, false))->>'action' = 'lead', 'patient from an ad → lead, not a ticket');
select test.assert((select patient_id = :'kp' from public.leads where phone = '+201077700021'), 'existing patient linked to the lead');
select test.assert((select count(*) = 0 from public.support_tickets where patient_id = :'kp'), 'no ticket for the ad message');
-- Voice note from an unknown number → lead (call center listens and calls back), not the escalation queue.
select public.svc_care_inbound('01055500002', 'wamid.V1', '[رسالة صوتية / voice note]', 'whatsapp', null, false, 'media-1') as kv \gset
select test.assert((public.svc_care_handoff_message(((:'kv'::jsonb)->>'message_id')::uuid, 'voice note'))->>'action' = 'lead', 'voice note → lead');
select test.assert((select kind = 'media' from public.lead_messages where provider_message_id = 'wamid.V1'), 'voice note in the lead history');

-- Appointment booked from the lead (existing convert flow) → call-center status BOOKED
select id as l3 from public.leads where phone = '+201055500001' \gset
select id as anyapt from public.appointments order by created_at limit 1 \gset
update public.leads set appointment_id = :'anyapt' where id = :'l3';
select test.assert((select cc_status = 'booked' and booking_at is not null from public.leads where id = :'l3'), 'linked appointment → BOOKED');

-- Ad names from the Marketing API attach the campaign when the message had no code.
select public.svc_lead_capture(jsonb_build_object('phone', '01066600011', 'provider_id', 'wamid.A1', 'text', 'Hello',
       'referral', jsonb_build_object('source_id', '120210000000077'))) is not null as x \gset
select test.assert((select campaign_id is null from public.leads where ad_id = '120210000000077'), 'no campaign yet');
select test.assert(public.svc_lead_set_ad_names('120210000000077', 'Reel 3', 'Women 25-45 Shorouk', 'GF26-CHECKUP | Golden Friday') = 1, 'ad names stored');
select test.assert((select c.code = 'GF26-CHECKUP' and l.adset_name = 'Women 25-45 Shorouk' from public.leads l join public.lead_campaigns c on c.id = l.campaign_id
                    where l.ad_id = '120210000000077'), 'campaign attributed from the Meta campaign name');

-- No agent on duty → lead stays unassigned (visible as such on the control page).
update public.lead_agent_duty set on_duty = false;
select public.svc_lead_capture(jsonb_build_object('phone', '01066600012', 'provider_id', 'wamid.A2', 'text', 'GF26-OFFER')) is not null as x \gset
select test.assert((select assigned_to is null from public.leads where phone = '+201066600012'), 'nobody on duty → unassigned');
reset role;
update public.lead_campaigns set starts_on = '2026-11-01', ends_on = '2026-11-30' where code in ('GF26-LASER', 'GF26-DENTAL', 'GF26-SKIN', 'GF26-OFFER', 'GF26-CHECKUP');
