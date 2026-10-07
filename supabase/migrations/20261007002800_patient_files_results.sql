-- Golden Care OS — 0028 Patient files: lab and radiology results, medical reports, clinical photos (before / after),
-- consent forms and ID documents. Bytes live in private object storage (Supabase Storage in production, a local
-- folder in development); the database holds the record, the access rules, the review and the release to the patient.

insert into public.permissions (code, module, description) values
  ('files.upload', 'clinical', 'Upload results, reports, photos and documents to a patient file')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('front_desk', 'files.upload'), ('nurse', 'files.upload'), ('doctor', 'files.upload'), ('medical_director', 'files.upload'), ('patient_relations', 'files.upload')
on conflict do nothing;

create table public.patient_files (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default app.next_ref('DOC'),
  patient_id      uuid not null references public.patients(id),
  branch_id       uuid not null references public.branches(id),
  kind            text not null check (kind in ('lab_result', 'radiology', 'medical_report', 'photo', 'consent_form', 'id_document', 'insurance', 'other')),
  clinical        boolean generated always as (kind in ('lab_result', 'radiology', 'medical_report', 'photo')) stored,
  title           text not null check (length(trim(title)) >= 2),
  taken_on        date,
  appointment_id  uuid references public.appointments(id),
  body_area       text,
  photo_stage     text check (photo_stage in ('before', 'after', 'progress')),
  content_type    text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes      int not null check (size_bytes > 0 and size_bytes <= 15 * 1024 * 1024),
  storage_path    text not null unique,
  sha256          text,
  status          text not null default 'pending' check (status in ('pending', 'stored', 'void')),
  uploaded_by     uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  stored_at       timestamptz,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  abnormal        boolean,
  review_note     text,
  released_at     timestamptz,
  released_by     uuid,
  release_note    text,
  voided_at       timestamptz,
  void_reason     text,
  check (kind = 'photo' or photo_stage is null)
);
create index on public.patient_files (patient_id, created_at desc);
create trigger trg_audit_patient_files after insert or update on public.patient_files for each row execute function app.audit_row();
create trigger trg_patient_files_no_delete before delete on public.patient_files for each row execute function app.block_delete();
alter table public.patient_files enable row level security;
create policy patient_files_read on public.patient_files for select to authenticated
  using (status <> 'pending' and (case when clinical then app.can_read_clinical(patient_id, branch_id) else app.can_read_patient(patient_id, branch_id) end));
grant select on public.patient_files to authenticated;

create or replace function app.can_manage_result(f public.patient_files)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('clinical.release', f.branch_id) or (app.has_permission('clinical.write.own') and app.is_treating_doctor(f.patient_id))
$$;

-- Step 1 (user session): check access, reserve the record and its storage path. Step 2 (server): store the bytes.
create or replace function public.begin_patient_file(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pt public.patients; f public.patient_files; v_id uuid := gen_random_uuid(); v_ext text;
begin
  select * into pt from public.patients where id = (p->>'patient_id')::uuid;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  perform app.require_permission('files.upload', pt.branch_id);
  v_ext := case p->>'content_type' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' end;
  if v_ext is null then raise exception 'only PDF and photos (JPG, PNG, WEBP, HEIC) can be uploaded' using errcode = '22023'; end if;
  if (p->>'size_bytes')::int > 15 * 1024 * 1024 then raise exception 'the file is larger than 15 MB' using errcode = '22023'; end if;
  if nullif(p->>'appointment_id', '') is not null and not exists (select 1 from public.appointments where id = (p->>'appointment_id')::uuid and patient_id = pt.id) then
    raise exception 'appointment belongs to another patient' using errcode = '22023';
  end if;
  insert into public.patient_files (id, patient_id, branch_id, kind, title, taken_on, appointment_id, body_area, photo_stage, content_type, size_bytes, storage_path)
  values (v_id, pt.id, pt.branch_id, p->>'kind', trim(p->>'title'), nullif(p->>'taken_on', '')::date, nullif(p->>'appointment_id', '')::uuid,
          nullif(trim(p->>'body_area'), ''), nullif(p->>'photo_stage', ''), p->>'content_type', (p->>'size_bytes')::int,
          'patients/' || pt.id || '/' || v_id || '.' || v_ext)
  returning * into f;
  return jsonb_build_object('id', f.id, 'storage_path', f.storage_path);
end $$;

create or replace function public.svc_patient_file_stored(p_id uuid, p_sha256 text, p_size int)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  update public.patient_files set status = 'stored', stored_at = now(), sha256 = p_sha256, size_bytes = p_size where id = p_id and status = 'pending';
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
end $$;

-- Reading a file: returns where it is only if the caller may see it; clinical files leave an audit trail.
create or replace function public.patient_file_access(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare f public.patient_files;
begin
  select * into f from public.patient_files where id = p_id and status = 'stored';
  if not found or not (case when f.clinical then app.can_read_clinical(f.patient_id, f.branch_id) else app.can_read_patient(f.patient_id, f.branch_id) end) then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if f.clinical then perform app.audit_event('FILE_VIEWED', 'patient_files', f.id::text, f.branch_id, f.kind || ' ' || f.ref); end if;
  return jsonb_build_object('storage_path', f.storage_path, 'content_type', f.content_type, 'name', f.ref || '-' || f.title);
end $$;

create or replace function public.review_patient_file(p_id uuid, p_abnormal boolean, p_note text)
returns public.patient_files language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare f public.patient_files;
begin
  select * into f from public.patient_files where id = p_id and status = 'stored' for update;
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
  if f.kind not in ('lab_result', 'radiology', 'medical_report') then raise exception 'only results and reports are reviewed' using errcode = '22023'; end if;
  if not app.can_manage_result(f) then raise exception 'permission denied: only the treating doctor or the medical director' using errcode = '42501'; end if;
  update public.patient_files set reviewed_by = auth.uid(), reviewed_at = now(), abnormal = coalesce(p_abnormal, false), review_note = nullif(trim(p_note), '')
  where id = f.id returning * into f;
  return f;
end $$;

-- Release gate: the doctor decides what the patient sees (results only after review).
create or replace function public.release_patient_file(p_id uuid, p_note text)
returns public.patient_files language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare f public.patient_files;
begin
  select * into f from public.patient_files where id = p_id and status = 'stored' for update;
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
  if not app.can_manage_result(f) then raise exception 'permission denied: only the treating doctor or the medical director' using errcode = '42501'; end if;
  if f.released_at is not null then raise exception 'already released' using errcode = '22023'; end if;
  if f.kind in ('lab_result', 'radiology', 'medical_report') and f.reviewed_at is null then raise exception 'review the result before releasing it' using errcode = '22023'; end if;
  if f.kind not in ('lab_result', 'radiology', 'medical_report', 'photo') then raise exception 'only results, reports and photos are released' using errcode = '22023'; end if;
  update public.patient_files set released_at = now(), released_by = auth.uid(), release_note = nullif(trim(p_note), '') where id = f.id returning * into f;
  return f;
end $$;

create or replace function public.void_patient_file(p_id uuid, p_reason text)
returns public.patient_files language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare f public.patient_files;
begin
  select * into f from public.patient_files where id = p_id and status = 'stored' for update;
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
  if not (f.uploaded_by = auth.uid() or app.has_permission('clinical.release', f.branch_id)) then
    raise exception 'permission denied: only the uploader or the medical director' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.patient_files set status = 'void', voided_at = now(), void_reason = trim(p_reason), released_at = null where id = f.id returning * into f;
  return f;
end $$;

-- Portal: released files only.
create or replace function public.portal_file(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare f public.patient_files;
begin
  select * into f from public.patient_files where id = p_id and status = 'stored' and released_at is not null;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform app.portal_require(f.patient_id, 'full');
  return jsonb_build_object('storage_path', f.storage_path, 'content_type', f.content_type, 'name', f.ref);
end $$;

create or replace function public.portal_medical(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.portal_require(p_patient, 'full');
  return jsonb_build_object(
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.created_at, 'summary', e.patient_summary,
                'instructions', e.patient_instructions, 'released_at', e.summary_released_at,
                'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
                'specialty_ar', sp.name_ar, 'specialty_en', sp.name_en) order by e.created_at desc)
              from public.encounters e join public.staff s on s.id = e.doctor_id join public.specialties sp on sp.id = e.specialty_id
              where e.patient_id = p_patient and e.status = 'signed' and e.summary_released_at is not null), '[]'::jsonb),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'date', r.signed_at, 'notes', r.notes_for_patient,
                'doctor_ar', s.full_name_ar, 'doctor_en', coalesce(s.full_name_en, s.full_name_ar),
                'items', (select jsonb_agg(jsonb_build_object('drug', i.drug_name, 'strength', i.strength, 'form', i.form, 'dose', i.dose,
                            'frequency', i.frequency, 'duration', i.duration, 'instructions', i.instructions) order by i.sort_order)
                          from public.prescription_items i where i.prescription_id = r.id)) order by r.signed_at desc)
              from public.prescriptions r join public.staff s on s.id = r.doctor_id
              where r.patient_id = p_patient and r.status = 'signed' and r.released_at is not null), '[]'::jsonb),
    'allergies', coalesce((select jsonb_agg(a.label) from public.patient_alerts a
                           where a.patient_id = p_patient and a.is_active and a.kind = 'allergy'), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ref', f.ref, 'kind', f.kind, 'title', f.title, 'taken_on', f.taken_on,
                'photo_stage', f.photo_stage, 'body_area', f.body_area, 'note', f.release_note, 'released_at', f.released_at, 'content_type', f.content_type) order by f.released_at desc)
              from public.patient_files f where f.patient_id = p_patient and f.status = 'stored' and f.released_at is not null), '[]'::jsonb)
  );
end $$;

-- Results waiting for the doctor's review (for the doctor's workspace).
create or replace function public.results_to_review()
returns setof public.patient_files language sql stable security definer set search_path = public, app, pg_temp as $$
  select f.* from public.patient_files f
  where f.status = 'stored' and f.reviewed_at is null and f.kind in ('lab_result', 'radiology', 'medical_report') and app.can_manage_result(f)
  order by f.created_at
$$;

revoke execute on function app.can_manage_result(public.patient_files) from public, anon, authenticated;
revoke execute on function public.svc_patient_file_stored(uuid, text, int) from public, anon, authenticated;
grant execute on function public.svc_patient_file_stored(uuid, text, int) to service_role;
revoke execute on function public.begin_patient_file(jsonb), public.patient_file_access(uuid), public.review_patient_file(uuid, boolean, text),
  public.release_patient_file(uuid, text), public.void_patient_file(uuid, text), public.portal_file(uuid), public.results_to_review() from public, anon;
grant execute on function public.begin_patient_file(jsonb), public.patient_file_access(uuid), public.review_patient_file(uuid, boolean, text),
  public.release_patient_file(uuid, text), public.void_patient_file(uuid, text), public.portal_file(uuid), public.results_to_review() to authenticated;
