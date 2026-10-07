-- Golden Care OS — 0029 Dental chart (odontogram): per-tooth findings recorded by the dentist, append-only history;
-- the chart shows the latest finding of each tooth together with the treatment-plan work planned or done on it.

create table public.dental_chart_entries (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id),
  branch_id      uuid not null references public.branches(id),
  tooth          text not null check (tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),           -- FDI, permanent and primary
  surfaces       text check (surfaces is null or surfaces ~ '^[MODBLIFP]{1,5}$'),
  condition      text not null check (condition in ('healthy', 'caries', 'filled', 'crown', 'root_canal', 'implant', 'bridge', 'veneer',
                                                    'sealant', 'fracture', 'missing', 'extraction_needed', 'mobility')),
  note           text,
  appointment_id uuid references public.appointments(id),
  recorded_by    uuid not null default auth.uid(),
  recorded_at    timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text
);
create index on public.dental_chart_entries (patient_id, tooth, recorded_at desc);
create trigger trg_audit_dental_chart after insert or update on public.dental_chart_entries for each row execute function app.audit_row();
create trigger trg_dental_chart_no_delete before delete on public.dental_chart_entries for each row execute function app.block_delete();
alter table public.dental_chart_entries enable row level security;
create policy dental_chart_read on public.dental_chart_entries for select to authenticated using (app.can_read_clinical(patient_id, branch_id));
grant select on public.dental_chart_entries to authenticated;

create or replace function app.can_chart(p_patient uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('clinical.write', p_branch) or (app.has_permission('clinical.write.own') and app.is_treating_doctor(p_patient))
$$;

create or replace function public.record_dental_findings(p_patient uuid, p_entries jsonb, p_appointment uuid default null)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pt public.patients; e jsonb; n int := 0;
begin
  select * into pt from public.patients where id = p_patient;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if not app.can_chart(pt.id, pt.branch_id) then raise exception 'permission denied: only the treating dentist' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'choose at least one tooth' using errcode = '22023';
  end if;
  if p_appointment is not null and not exists (select 1 from public.appointments where id = p_appointment and patient_id = pt.id) then
    raise exception 'appointment belongs to another patient' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if coalesce(e->>'tooth', '') !~ '^([1-4][1-8]|[5-8][1-5])$' then raise exception 'tooth numbers use the FDI system (11–48, 51–85)' using errcode = '22023'; end if;
    insert into public.dental_chart_entries (patient_id, branch_id, tooth, surfaces, condition, note, appointment_id)
    values (pt.id, pt.branch_id, e->>'tooth', nullif(upper(trim(e->>'surfaces')), ''), e->>'condition', nullif(trim(e->>'note'), ''), p_appointment);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.void_dental_finding(p_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.dental_chart_entries;
begin
  select * into d from public.dental_chart_entries where id = p_id and voided_at is null for update;
  if not found then raise exception 'finding not found' using errcode = 'P0002'; end if;
  if not app.can_chart(d.patient_id, d.branch_id) then raise exception 'permission denied: only the treating dentist' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.dental_chart_entries set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = d.id;
end $$;

-- Current chart: latest finding per tooth plus the plan work on that tooth.
create or replace function public.dental_chart(p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare pt public.patients;
begin
  select * into pt from public.patients where id = p_patient;
  if not found or not app.can_read_clinical(pt.id, pt.branch_id) then return null; end if;
  return jsonb_build_object(
    'can_write', app.can_chart(pt.id, pt.branch_id),
    'teeth', coalesce((select jsonb_object_agg(x.tooth, jsonb_build_object('condition', x.condition, 'surfaces', x.surfaces, 'note', x.note, 'at', x.recorded_at, 'id', x.id))
                       from (select distinct on (tooth) * from public.dental_chart_entries where patient_id = pt.id and voided_at is null order by tooth, recorded_at desc) x), '{}'::jsonb),
    'plan', coalesce((select jsonb_agg(jsonb_build_object('tooth', i.tooth, 'surfaces', i.surfaces, 'status', i.status, 'service_ar', s.name_ar, 'service_en', s.name_en, 'plan', tp.ref))
                      from public.treatment_plan_items i join public.treatment_plans tp on tp.id = i.plan_id join public.services s on s.id = i.service_id
                      where tp.patient_id = pt.id and i.tooth is not null and i.status <> 'cancelled' and tp.status not in ('cancelled', 'draft')), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'tooth', d.tooth, 'condition', d.condition, 'surfaces', d.surfaces, 'note', d.note, 'at', d.recorded_at,
                           'voided', d.voided_at is not null) order by d.recorded_at desc)
                         from (select * from public.dental_chart_entries where patient_id = pt.id order by recorded_at desc limit 60) d), '[]'::jsonb));
end $$;

revoke execute on function app.can_chart(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_dental_findings(uuid, jsonb, uuid), public.void_dental_finding(uuid, text), public.dental_chart(uuid) from public, anon;
grant execute on function public.record_dental_findings(uuid, jsonb, uuid), public.void_dental_finding(uuid, text), public.dental_chart(uuid) to authenticated;
