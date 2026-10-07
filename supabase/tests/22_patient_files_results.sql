-- 22 — Patient files: upload reservation, storage confirmation, clinical vs administrative access, doctor review, release to the portal, void
\set fd      '00000000-0000-4000-8000-000000001002'
\set drderm  '00000000-0000-4000-8000-000000001004'
\set drdent  '00000000-0000-4000-8000-000000001005'
\set b1      '00000000-0000-4000-8000-000000000101'
\set derm    '00000000-0000-4000-8000-000000002004'
\set pu      '00000000-0000-4000-8000-000000009031'

insert into public.patients (branch_id, first_name_ar, last_name_ar, phone_raw) values (:'b1', 'ملفات', 'المريض', '01088880081') returning id as pat \gset
insert into public.appointments (branch_id, patient_id, doctor_id, specialty_id, slot)
values (:'b1', :'pat', :'derm', (select id from public.specialties where code = 'derm'), tstzrange(now() + interval '970 days', now() + interval '970 days 20 minutes')) returning id as apt \gset
insert into auth.users (id, email) values (:'pu', 'files@portal.local');
select app.portal_link_account(:'pu', :'pat');

set role authenticated;
select test.login(:'fd');
select test.expect_error(format($q$select public.begin_patient_file(%L)$q$, jsonb_build_object('patient_id', :'pat', 'kind', 'lab_result', 'title', 'CBC', 'content_type', 'application/zip', 'size_bytes', 10)), 'only PDF and photos');
select test.expect_error(format($q$select public.begin_patient_file(%L)$q$, jsonb_build_object('patient_id', :'pat', 'kind', 'lab_result', 'title', 'CBC', 'content_type', 'application/pdf', 'size_bytes', 20000000)), 'larger than 15 MB');
select (public.begin_patient_file(jsonb_build_object('patient_id', :'pat', 'kind', 'lab_result', 'title', 'صورة دم كاملة CBC', 'content_type', 'application/pdf',
        'size_bytes', 1000, 'taken_on', current_date, 'appointment_id', :'apt')))->>'id' as lab \gset
select (public.begin_patient_file(jsonb_build_object('patient_id', :'pat', 'kind', 'id_document', 'title', 'بطاقة الرقم القومي', 'content_type', 'image/jpeg', 'size_bytes', 2000)))->>'id' as idoc \gset
select (public.begin_patient_file(jsonb_build_object('patient_id', :'pat', 'kind', 'photo', 'title', 'الوجه', 'content_type', 'image/jpeg', 'size_bytes', 3000, 'photo_stage', 'before', 'body_area', 'الوجه')))->>'id' as photo \gset
select test.assert((select count(*) = 0 from public.patient_files where patient_id = :'pat'), 'nothing listed until the bytes are stored');
reset role;
select public.svc_patient_file_stored(:'lab', 'sha-lab', 1000);
select public.svc_patient_file_stored(:'idoc', 'sha-id', 2000);
select public.svc_patient_file_stored(:'photo', 'sha-photo', 3000);
select test.assert((select storage_path like 'patients/' || :'pat' || '/%.pdf' from public.patient_files where id = :'lab'), 'stored under the patient folder');

-- Front desk: sees the ID document, not the clinical result
set role authenticated;
select test.login(:'fd');
select test.assert((select count(*) = 1 from public.patient_files where patient_id = :'pat'), 'front desk sees only the administrative document');
select test.assert((public.patient_file_access(:'idoc'))->>'content_type' = 'image/jpeg', 'front desk can open the ID document');
select test.expect_error(format($q$select public.patient_file_access(%L)$q$, :'lab'), 'file not found');

-- Treating doctor reviews and releases; another doctor cannot
select test.login(:'drdent');
select test.expect_error(format($q$select public.review_patient_file(%L, false, 'x')$q$, :'lab'), 'permission denied');
select test.login(:'drderm');
select test.assert((public.patient_file_access(:'lab'))->>'storage_path' is not null, 'treating doctor opens the result');
select test.expect_error(format($q$select public.release_patient_file(%L, null)$q$, :'lab'), 'review the result before releasing');
select test.assert((select count(*) = 1 from public.results_to_review() where id = :'lab'), 'result waits in the doctor''s review list');
select public.review_patient_file(:'lab', false, 'طبيعي') is not null as x \gset
select public.release_patient_file(:'lab', 'النتيجة طبيعية، لا يلزم أي إجراء.') is not null as x \gset
select test.expect_error(format($q$select public.release_patient_file(%L, null)$q$, :'lab'), 'already released');
select test.expect_error(format($q$select public.release_patient_file(%L, null)$q$, :'idoc'), 'only results, reports and photos');
reset role;
select test.assert((select count(*) >= 1 from public.audit_events where action = 'FILE_VIEWED' and record_id = :'lab'), 'opening a clinical file is audited');

-- Portal: released result only
set role authenticated;
select test.login(:'pu');
select test.assert((select count(*) = 1 from jsonb_array_elements((public.portal_medical(:'pat'))->'files')), 'patient sees one released file');
select test.assert((public.portal_file(:'lab'))->>'content_type' = 'application/pdf', 'patient can download it');
select test.expect_error(format($q$select public.portal_file(%L)$q$, :'photo'), 'not found');
select test.assert((select count(*) = 0 from public.patient_files), 'no table access for patients');

-- Void with a reason (uploader); it disappears from the portal
select test.login(:'fd');
select test.expect_error(format($q$select public.void_patient_file(%L, '')$q$, :'lab'), 'reason is required');
select status from public.void_patient_file(:'lab', 'رُفع لمريض آخر بالخطأ') \gset
select test.assert(:'status' = 'void', 'voided, never deleted');
select test.login(:'pu');
select test.assert((select count(*) = 0 from jsonb_array_elements((public.portal_medical(:'pat'))->'files')), 'voided file no longer in the portal');
reset role;
select test.expect_error(format($q$delete from public.patient_files where id = %L$q$, :'lab'), 'cannot be deleted');
