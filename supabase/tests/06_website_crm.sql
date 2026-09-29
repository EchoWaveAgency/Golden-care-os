-- 06 — Website, CMS workflow, public API, leads funnel, online availability, offers
\set mkt     '00000000-0000-4000-8000-000000001101'
\set meddir  '00000000-0000-4000-8000-000000001102'
\set pr      '00000000-0000-4000-8000-000000001103'
\set chief   '00000000-0000-4000-8000-000000001006'
\set dr_u    '00000000-0000-4000-8000-000000001004'
\set dr      '00000000-0000-4000-8000-000000002004'
\set b1      '00000000-0000-4000-8000-000000000101'
\set laser   '00000000-0000-4000-8000-000000004002'

-- Setup (owner): marketing, medical director, patient-relations users; doctor schedule.
insert into auth.users (id, email) values (:'mkt', 'mkt@test.local'), (:'meddir', 'meddir@test.local'), (:'pr', 'pr@test.local');
insert into public.profiles (user_id, full_name_ar) values (:'mkt', 'تسويق'), (:'meddir', 'المدير الطبي'), (:'pr', 'علاقات المرضى');
insert into public.user_roles (user_id, role_code, branch_id) values
  (:'mkt', 'marketing', null), (:'meddir', 'medical_director', null), (:'pr', 'patient_relations', :'b1');
insert into public.doctor_schedules (doctor_id, branch_id, weekday, start_time, end_time, slot_minutes)
select :'dr', :'b1', d, '09:00', '17:00', 30 from generate_series(0, 6) d;
update public.services set public_visible = true, public_show_price = true, online_bookable = true where id = :'laser';
select id as derm from public.specialties where code = 'derm' \gset

-- Nothing is public before approval.
set role anon;
select test.assert(jsonb_array_length(public.public_specialties()) = 0, 'no public content before publication');

-- Marketing drafts a specialty page and a doctor profile.
set role authenticated;
select test.login(:'mkt');
insert into public.site_specialty_pages (specialty_id, slug, title_ar, title_en, summary_ar, summary_en)
values (:'derm', 'dermatology', 'الجلدية والليزر', 'Dermatology & Laser', 'رعاية متكاملة للبشرة', 'Complete skin care')
returning id as page \gset
insert into public.site_doctor_profiles (staff_id, slug, title_ar, title_en, bio_ar, bio_en)
values (:'dr', 'dr-sara', 'استشاري الجلدية', 'Consultant Dermatologist', 'خبرة ١٥ عامًا', '15 years of experience')
returning id as prof \gset

-- Status cannot be forced by a direct update.
select test.expect_error(format($q$update public.site_specialty_pages set status = 'published' where id = %L$q$, :'page'), 'content_transition');
-- Medical content cannot skip medical review.
select test.expect_error(format($q$select public.content_transition('site_specialty_pages', %L, 'marketing_review')$q$, :'page'), 'invalid content transition');
select public.content_transition('site_specialty_pages', :'page', 'medical_review');
-- Marketing cannot give medical approval.
select test.expect_error(format($q$select public.content_transition('site_specialty_pages', %L, 'marketing_review')$q$, :'page'), 'permission denied');

-- Medical Director: rejection needs a note; then approves.
select test.login(:'meddir');
select test.expect_error(format($q$select public.content_transition('site_specialty_pages', %L, 'draft')$q$, :'page'), 'note is required');
select public.content_transition('site_specialty_pages', :'page', 'marketing_review');
-- A clinician cannot medically approve their own edits.
update public.site_doctor_profiles set bio_ar = 'استشاري الجلدية والليزر — خبرة ١٥ عامًا' where id = :'prof';
select test.login(:'mkt');
select public.content_transition('site_doctor_profiles', :'prof', 'medical_review');
select test.login(:'meddir');
select test.expect_error(format($q$select public.content_transition('site_doctor_profiles', %L, 'marketing_review')$q$, :'prof'), 'separation of duties');

-- Marketing edits once more (becomes last editor), Medical Director approves, marketing approves & publishes.
select test.login(:'mkt');
select test.expect_error(format($q$select public.content_transition('site_doctor_profiles', %L, 'draft', 'x')$q$, :'prof'), 'permission denied');
reset role;
update public.site_doctor_profiles set updated_by = :'mkt' where id = :'prof';   -- simulate marketing as last editor
set role authenticated;
select test.login(:'meddir');
select public.content_transition('site_doctor_profiles', :'prof', 'marketing_review');
select test.login(:'mkt');
select public.content_transition('site_specialty_pages', :'page', 'approved');
select public.content_transition('site_specialty_pages', :'page', 'published');
select public.content_transition('site_doctor_profiles', :'prof', 'approved');
select public.content_transition('site_doctor_profiles', :'prof', 'published');

-- Anonymous visitors now see exactly the published content.
set role anon;
select test.assert((public.public_specialties()->0->>'slug') = 'dermatology', 'published specialty is public');
select test.assert((public.public_specialty('dermatology')->'doctors'->0->>'slug') = 'dr-sara', 'doctor listed on specialty page');
select test.assert((public.public_specialty('dermatology')->'services'->0->>'price')::numeric = 3000, 'approved public price shown');
select test.assert(public.public_doctor('dr-sara')->>'bio_ar' like 'استشاري الجلدية والليزر%', 'doctor bio published');
select test.expect_error('select * from public.site_specialty_pages', 'permission denied');
select test.expect_error('select * from public.leads', 'permission denied');
select test.expect_error($q$select public.content_transition('offers', gen_random_uuid(), 'draft')$q$, 'permission denied');
select test.expect_error($q$select public.find_patient_duplicates('01000000000')$q$, 'permission denied');
select test.expect_error($q$select public.staff_available_slots(gen_random_uuid(), current_date)$q$, 'permission denied');

-- Editing live content restarts review but the site keeps the last published version.
set role authenticated;
select test.login(:'mkt');
update public.site_specialty_pages set title_ar = 'عنوان غير معتمد' where id = :'page';
select test.assert((select status from public.site_specialty_pages where id = :'page') = 'draft', 'edit sends content back to draft');
set role anon;
select test.assert((public.public_specialties()->0->>'title_ar') = 'الجلدية والليزر', 'site still shows the approved version');
reset role;
select test.assert((select count(*) from public.content_revisions where record_id = :'page') >= 6, 'every version and transition kept');

-- Online availability: real slots only, 2-hour lead time, 30-minute grid.
set role anon;
select slot_start as s1 from public.public_available_slots(:'dr', ((now() at time zone 'Africa/Cairo')::date + 500), 1) limit 1 \gset
select test.assert(:'s1'::timestamptz > now() + interval '2 hours', 'slot respects lead time');
select test.assert((select count(*) from public.public_available_slots(:'dr', ((now() at time zone 'Africa/Cairo')::date + 500), 1)) = 16, '09:00–17:00 at 30 min = 16 slots');

-- Visitor submits a booking request for that slot.
select public.submit_web_inquiry(jsonb_build_object(
  'kind', 'booking', 'full_name', 'منة الله سمير', 'phone', '٠١١١٢٢٢٣٣٣٣', 'doctor_slug', 'dr-sara',
  'preferred_start', :'s1', 'consent_contact', true, 'utm_source', 'facebook', 'utm_campaign', 'laser-oct',
  'page_path', '/ar/specialties/dermatology', 'lang', 'ar')) as ref1 \gset
select test.assert(:'ref1' like 'LD-____-______', 'lead reference returned');
-- Same phone again → merged, same reference, no duplicate.
select test.assert(public.submit_web_inquiry(jsonb_build_object('kind', 'callback', 'full_name', 'منة الله', 'phone', '01112223333',
  'consent_contact', true)) = :'ref1', 'repeat submission merged into open lead');
-- Validation and abuse protection.
select test.expect_error($q$select public.submit_web_inquiry('{"full_name":"x y","phone":"01000000001","consent_contact":false}')$q$, 'consent is required');
select test.expect_error($q$select public.submit_web_inquiry('{"full_name":"x y","phone":"abc","consent_contact":true}')$q$, 'invalid phone');
select test.expect_error(format($q$select public.submit_web_inquiry(jsonb_build_object('full_name','x y','phone','01000000002','consent_contact',true,
  'doctor_slug','dr-sara','preferred_start', %L))$q$, (now() + interval '1 day')::timestamptz), 'no longer available');
reset role;
insert into public.leads (branch_id, full_name, phone_raw, consent_contact, created_at)
select :'b1', 'spam', '01099990000', true, now() from generate_series(1, 5);
set role anon;
select test.expect_error($q$select public.submit_web_inquiry('{"full_name":"spam","phone":"01099990000","consent_contact":true}')$q$, 'too many requests');

-- Patient Relations works the lead; finance cannot see it.
set role authenticated;
select test.login(:'chief');
select test.assert((select count(*) from public.leads) = 0, 'finance cannot read leads');
select test.login(:'pr');
select id as lead, utm_campaign, specialty_id is not null as has_spec from public.leads where ref = :'ref1' \gset
select test.assert(:'utm_campaign' = 'laser-oct' and :'has_spec', 'campaign and specialty recorded');
select test.assert((select count(*) from public.lead_activities where lead_id = :'lead' and kind = 'web') = 1, 'repeat contact logged on the lead');
update public.leads set status = 'contacted' where id = :'lead';
select test.assert((select first_contact_at is not null from public.leads where id = :'lead'), 'first response time captured');
select test.expect_error(format($q$update public.leads set status = 'closed' where id = %L$q$, :'lead'), 'close reason is required');

insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'منة الله', 'سمير', '01112223333') returning id as pid \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot, channel)
values (:'b1', :'pid', :'dr', :'derm', tstzrange(:'s1'::timestamptz, :'s1'::timestamptz + interval '30 minutes'), 'website') returning id as apt \gset
select test.assert((select status from public.lead_link_appointment(:'lead', :'pid', :'apt')) = 'appointment_confirmed', 'lead converted');
set role anon;
select test.assert(not exists (select 1 from public.public_available_slots(:'dr', ((now() at time zone 'Africa/Cairo')::date + 500), 1) where slot_start = :'s1'::timestamptz),
                   'booked slot disappears from the website');
set role authenticated;
select test.login(:'pr');
select public.transition_appointment(:'apt', 'arrived');
select test.assert((select status from public.leads where id = :'lead') = 'arrived', 'funnel follows arrival');

-- Offers: approved, time-boxed, capacity-limited; price frozen at booking.
select test.login(:'mkt');
insert into public.offers (slug, branch_id, specialty_id, service_id, title_ar, title_en, terms_ar, terms_en, price, regular_price, starts_at, ends_at, capacity)
values ('laser-launch', :'b1', :'derm', :'laser', 'عرض الليزر', 'Laser launch', 'لأول جلسة فقط', 'First session only', 2000, 3000,
        now() - interval '1 hour', now() + interval '10 days', 1) returning id as offer \gset
select public.content_transition('offers', :'offer', 'medical_review');
select test.login(:'meddir');
select public.content_transition('offers', :'offer', 'marketing_review');
select test.login(:'mkt');
select public.content_transition('offers', :'offer', 'approved');
select public.content_transition('offers', :'offer', 'published');
set role anon;
select test.assert((public.public_offers('dermatology')->0->>'price')::numeric = 2000, 'active offer visible with approved price');
select public.submit_web_inquiry(jsonb_build_object('full_name', 'هبة', 'phone', '01223334444', 'offer_slug', 'laser-launch', 'consent_contact', true)) as ref2 \gset
set role authenticated;
select test.login(:'pr');
select id as lead2, offer_id is not null as has_offer from public.leads where ref = :'ref2' \gset
select test.assert(:'has_offer', 'offer recorded on lead');
insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'هبة', 'رأفت', '01223334444') returning id as pid2 \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pid2', :'dr', :'derm', tstzrange(now() + interval '5 days', now() + interval '5 days 30 minutes')) returning id as apt2 \gset
select public.lead_link_appointment(:'lead2', :'pid2', :'apt2');
select test.assert((select offer_price = 2000 and offer_terms->>'terms_ar' = 'لأول جلسة فقط' from public.appointments where id = :'apt2'), 'offer price and terms frozen on appointment');
set role anon;
select test.assert(jsonb_array_length(public.public_offers()) = 0, 'offer hidden when capacity is used up');

-- Expired offers disappear automatically.
reset role;
update public.offers set capacity = null, published_data = jsonb_set(published_data, '{ends_at}', to_jsonb(now() - interval '1 minute')) where id = :'offer';
set role anon;
select test.assert(jsonb_array_length(public.public_offers()) = 0, 'expired offer hidden');

-- Archived content leaves the site.
set role authenticated;
select test.login(:'mkt');
select public.content_transition('site_doctor_profiles', :'prof', 'archived');
set role anon;
select test.assert(jsonb_array_length(public.public_doctors()) = 0, 'archived doctor profile removed from site');
select test.assert((select count(*) from public.public_available_slots(:'dr', current_date + 2, 1)) = 0, 'no online slots without a live profile');
reset role;
