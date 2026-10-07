-- 26 — Articles and instructions (reviewed, public, in the portal), consented testimonials, landing A/B results, marketing funnel, SMS channel and fallback
\set mkt     '00000000-0000-4000-8000-000000001101'
\set meddir  '00000000-0000-4000-8000-000000001102'
\set fd      '00000000-0000-4000-8000-000000001002'
\set admin   '00000000-0000-4000-8000-000000001001'
\set nobody  '00000000-0000-4000-8000-000000001008'
\set b1      '00000000-0000-4000-8000-000000000101'
\set laser   '00000000-0000-4000-8000-000000004002'
\set pu      '00000000-0000-4000-8000-000000009041'

-- Helper: take content through the full workflow
create or replace function pg_temp.publish(p_table text, p_id uuid) returns void language plpgsql as $$
begin
  perform test.login('00000000-0000-4000-8000-000000001101');
  perform public.content_transition(p_table, p_id, 'medical_review');
  perform test.login('00000000-0000-4000-8000-000000001102');
  perform public.content_transition(p_table, p_id, 'marketing_review');
  perform test.login('00000000-0000-4000-8000-000000001101');
  perform public.content_transition(p_table, p_id, 'approved');
  perform public.content_transition(p_table, p_id, 'published');
end $$;

-- ---------- Instruction sheet for the laser service
set role authenticated;
select test.login(:'mkt');
insert into public.articles (slug, kind, service_ids, title_ar, title_en, body_ar, reading_minutes)
values ('laser-aftercare', 'instruction', array[:'laser']::uuid[], 'تعليمات بعد جلسة الليزر', 'Laser aftercare', 'تجنب الشمس 48 ساعة واستخدم واقي الشمس.', 2) returning id as art \gset
select test.expect_error($q$insert into public.articles (slug, title_ar, title_en, body_ar, requires_medical) values ('x-x', 'x', 'x', 'x', false)$q$, 'check');
reset role;
select test.assert(public.public_article('laser-aftercare') is null, 'not public before review');
set role authenticated;
select pg_temp.publish('articles', :'art');
reset role;
set role anon;
select test.assert(public.public_article('laser-aftercare')->>'title_ar' = 'تعليمات بعد جلسة الليزر', 'public after medical and marketing review');
select test.assert((select count(*) = 1 from jsonb_array_elements(public.public_articles('instruction'))), 'listed with instructions');
reset role;

-- Portal: a patient who had the laser service sees the instruction
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'تعليمات', 'الليزر', '01088880111') returning id as pat \gset
insert into auth.users (id, email) values (:'pu', 'instr@portal.local');
select app.portal_link_account(:'pu', :'pat');
set role authenticated;
select test.login(:'fd');
insert into public.invoices (branch_id, patient_id) values (:'b1', :'pat') returning id as inv \gset
insert into public.invoice_lines (invoice_id, service_id, unit_price) values (:'inv', :'laser', 1000);
select public.issue_invoice(:'inv') is not null as x \gset
select test.login(:'pu');
select test.assert((select count(*) = 1 from jsonb_array_elements(public.portal_instructions(:'pat'))), 'patient sees the aftercare instructions for their service');

-- ---------- Testimonial: needs the patient's consent; disappears if consent is withdrawn
select test.login(:'mkt');
select test.expect_error(format($q$insert into public.testimonials (patient_id, display_name_ar, quote_ar, rating) values (%L, 'س. م.', 'تجربة ممتازة والفريق محترم جدًا', 5)$q$, :'pat'), 'row-level security');
select test.login(:'fd');
insert into public.patient_consents (patient_id, kind, granted, document_code) values (:'pat', 'testimonial', true, 'TESTIMONIAL-V1');
select test.login(:'mkt');
insert into public.testimonials (patient_id, display_name_ar, quote_ar, rating) values (:'pat', 'س. م.', 'تجربة ممتازة والفريق محترم جدًا', 5) returning id as tm \gset
select pg_temp.publish('testimonials', :'tm');
reset role;
set role anon;
select test.assert((public.public_testimonials())->0->>'quote_ar' = 'تجربة ممتازة والفريق محترم جدًا', 'testimonial published');
select test.assert(position(:'pat' in public.public_testimonials()::text) = 0, 'the patient is never identified');
reset role;
set role authenticated;
select test.login(:'fd');
insert into public.patient_consents (patient_id, kind, granted, document_code) values (:'pat', 'testimonial', false, 'TESTIMONIAL-V1');
reset role;
set role anon;
select test.assert(jsonb_array_length(public.public_testimonials()) = 0, 'withdrawn consent removes it at once');
reset role;
set role authenticated;
select test.login(:'pu');
select public.portal_set_testimonial_consent(true);
reset role;
select test.assert(jsonb_array_length(public.public_testimonials()) = 1, 'the patient re-grants consent from the portal');
set role authenticated;
select test.login(:'pu');
select public.portal_set_testimonial_consent(false);
reset role;
select test.assert(jsonb_array_length(public.public_testimonials()) = 0, 'and withdraws it from the portal');

-- ---------- Landing page A/B: views and leads per variant
set role authenticated;
select test.login(:'mkt');
insert into public.landing_pages (slug, campaign_name, title_ar, title_en, variants)
values ('summer-laser', 'Summer laser', 'ليزر الصيف', 'Summer laser', '[{"code": "B", "weight": 50, "title_ar": "ودّعي الشعر الزائد", "title_en": "Say goodbye"}]') returning id as lp \gset
select pg_temp.publish('landing_pages', :'lp');
reset role;
set role anon;
select public.public_landing_event('summer-laser', 'A', 'view', 'visitor-aaaaaaaaaaaa');
select public.public_landing_event('summer-laser', 'A', 'view', 'visitor-aaaaaaaaaaaa');
select public.public_landing_event('summer-laser', 'A', 'view', 'visitor-bbbbbbbbbbbb');
select public.public_landing_event('summer-laser', 'B', 'view', 'visitor-cccccccccccc');
select public.public_landing_event('summer-laser', 'B', 'lead', 'visitor-cccccccccccc');
select public.public_landing_event('summer-laser', 'Z', 'bogus', 'x');
reset role;
set role authenticated;
select test.login(:'mkt');
select test.assert((select views = 2 and leads = 0 from public.landing_ab_report(:'lp') where variant = 'A'), 'variant A: 2 unique views');
select test.assert((select views = 1 and leads = 1 and conversion = 100.0 from public.landing_ab_report(:'lp') where variant = 'B'), 'variant B: 1 view, 1 lead');
select test.assert((select count(*) >= 1 from public.marketing_funnel(current_date - 30, current_date)), 'funnel report has rows');
select test.login(:'nobody');
select test.expect_error($q$select * from public.marketing_funnel(current_date - 30, current_date)$q$, 'permission denied');
reset role;

-- ---------- SMS: patient preferring SMS; WhatsApp failures fall back to SMS only when the clinic allows
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw, preferred_channel) values (:'b1', 'رسائل', 'نصية', '01088880112', 'sms') returning id as ps \gset
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'رسائل', 'واتساب', '01088880113') returning id as pw \gset
select app.enqueue_message('appointment_reminder', :'ps', null, '{}'::jsonb, 'sms-pref-1') as m1 \gset
select test.assert((select channel = 'sms' and status = 'queued' from public.message_outbox where id = :'m1'), 'patient who prefers SMS gets SMS');
select app.enqueue_message('appointment_reminder', :'pw', null, '{}'::jsonb, 'wa-fail-1') as m2 \gset
update public.message_outbox set attempts = 5 where id = :'m2';
select app.outbox_result(:'m2', false, 'whatsapp', null, 'not on WhatsApp');
select test.assert((select status = 'dead' from public.message_outbox where id = :'m2') and not exists (select 1 from public.message_outbox where idempotency_key = 'wa-fail-1:sms'), 'fallback off: no SMS');
set role authenticated;
select test.login(:'mkt');
select test.expect_error($q$select public.save_messaging_settings(true)$q$, 'permission denied');
select test.login(:'admin');
select public.save_messaging_settings(true) is not null as x \gset
reset role;
select app.enqueue_message('appointment_reminder', :'pw', null, '{}'::jsonb, 'wa-fail-2') as m3 \gset
update public.message_outbox set attempts = 5 where id = :'m3';
select app.outbox_result(:'m3', false, 'whatsapp', null, 'not on WhatsApp');
select test.assert((select channel = 'sms' and status = 'queued' from public.message_outbox where idempotency_key = 'wa-fail-2:sms'), 'fallback on: one SMS queued');
update public.messaging_settings set sms_fallback = false;
