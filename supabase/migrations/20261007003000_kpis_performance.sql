-- Golden Care OS — 0030 Staff KPIs (computed from the system's own records) and performance reviews.
-- The review criteria and their weights are the clinic's; none are created here.

insert into public.permissions (code, module, description) values
  ('performance.review', 'hr', 'Write performance reviews and see staff KPIs (never your own review)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('hr_manager', 'performance.review'), ('medical_director', 'performance.review'), ('center_director', 'performance.review'), ('operations_manager', 'performance.review')
on conflict do nothing;

create table public.review_criteria (
  code        text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  name_ar     text not null,
  name_en     text not null,
  applies_to  text not null default 'all' check (applies_to in ('all', 'doctor', 'nurse', 'reception', 'finance', 'other')),
  weight      numeric(5,2) not null default 1 check (weight > 0),
  sort        int not null default 100,
  is_active   boolean not null default true,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
create trigger trg_audit_review_criteria after insert or update on public.review_criteria for each row execute function app.audit_row();

create table public.performance_reviews (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('PRV'),
  employee_id      uuid not null references public.employees(id),
  branch_id        uuid not null references public.branches(id),
  period_from      date not null,
  period_to        date not null check (period_to >= period_from),
  reviewer_id      uuid not null default auth.uid(),
  scores           jsonb not null default '{}'::jsonb,
  overall          numeric(4,2),
  kpis             jsonb,                            -- snapshot of the computed KPIs at submission
  strengths        text,
  improvements     text,
  goals            text,
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  submitted_at     timestamptz,
  employee_comment text,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_audit_performance_reviews after insert or update on public.performance_reviews for each row execute function app.audit_row();
create trigger trg_performance_reviews_no_delete before delete on public.performance_reviews for each row execute function app.block_delete();

-- KPIs for a period, per employee of the branch (doctors also get their clinical and revenue figures).
create or replace function public.staff_kpis(p_branch uuid, p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, staff_id uuid, name_ar text, name_en text, kind text, days_present int, days_absent int, late_minutes int, overtime_minutes int,
               appointments_done int, no_shows int, cancellations int, satisfaction numeric, surveys int, net_revenue numeric, new_patients int)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.has_permission('performance.review', p_branch)
          or (p_employee is not null and p_employee = app.my_employee_id())) then
    raise exception 'permission denied: performance.review' using errcode = '42501';
  end if;
  return query
  select e.id, s.id, s.full_name_ar, coalesce(s.full_name_en, s.full_name_ar), s.kind::text,
    (select count(*) from public.attendance_days d where d.employee_id = e.id and d.day between p_from and p_to and d.status in ('present', 'late'))::int,
    (select count(*) from public.attendance_days d where d.employee_id = e.id and d.day between p_from and p_to and d.status = 'absent')::int,
    (select coalesce(sum(d.late_minutes), 0) from public.attendance_days d where d.employee_id = e.id and d.day between p_from and p_to)::int,
    (select coalesce(sum(d.overtime_approved_minutes), 0) from public.attendance_days d where d.employee_id = e.id and d.day between p_from and p_to)::int,
    (select count(*) from public.appointments a where a.doctor_id = s.id and a.status = 'completed' and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to)::int,
    (select count(*) from public.appointments a where a.doctor_id = s.id and a.status = 'no_show' and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to)::int,
    (select count(*) from public.appointments a where a.doctor_id = s.id and a.status = 'canceled' and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to)::int,
    (select round(avg(v.score), 2) from public.satisfaction_surveys v join public.appointments a on a.id = v.appointment_id
       where a.doctor_id = s.id and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to),
    (select count(*) from public.satisfaction_surveys v join public.appointments a on a.id = v.appointment_id
       where a.doctor_id = s.id and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to)::int,
    (select coalesce(sum(l.line_total), 0) from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
       where l.doctor_id = s.id and i.status in ('issued', 'partially_paid', 'paid') and (i.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    (select count(distinct a.patient_id) from public.appointments a where a.doctor_id = s.id and a.status = 'completed'
       and (lower(a.slot) at time zone 'Africa/Cairo')::date between p_from and p_to
       and not exists (select 1 from public.appointments b where b.patient_id = a.patient_id and b.status = 'completed' and lower(b.slot) < lower(a.slot)))::int
  from public.employees e join public.staff s on s.id = e.staff_id
  where e.branch_id = p_branch and (p_employee is null or e.id = p_employee) and (e.status = 'active' or e.end_date >= p_from)
  order by s.full_name_ar;
end $$;

create or replace function public.save_review_criterion(p_code text, p jsonb)
returns public.review_criteria language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.review_criteria;
begin
  if not app.has_global_permission('performance.review') and not app.has_permission('hr.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into public.review_criteria (code, name_ar, name_en, applies_to, weight, sort, is_active)
  values (upper(trim(p_code)), trim(p->>'name_ar'), coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')), coalesce(nullif(p->>'applies_to', ''), 'all'),
          coalesce(nullif(p->>'weight', '')::numeric, 1), coalesce(nullif(p->>'sort', '')::int, 100), coalesce((p->>'is_active')::boolean, true))
  on conflict (code) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, applies_to = excluded.applies_to, weight = excluded.weight,
    sort = excluded.sort, is_active = excluded.is_active, updated_by = auth.uid(), updated_at = now()
  returning * into c;
  return c;
end $$;

-- Draft / update a review; submitting freezes it and snapshots the KPIs.
create or replace function public.save_performance_review(p jsonb, p_submit boolean default false)
returns public.performance_reviews language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.employees; r public.performance_reviews; k text; v numeric; v_sum numeric := 0; v_w numeric := 0; c public.review_criteria; v_kpi jsonb;
begin
  select * into e from public.employees where id = (p->>'employee_id')::uuid;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission('performance.review', e.branch_id);
  if e.id = app.my_employee_id() then raise exception 'separation of duties: you cannot review yourself' using errcode = '42501'; end if;
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(p->'scores', '{}'::jsonb)) loop
    select * into c from public.review_criteria where code = k and is_active;
    if not found then raise exception 'unknown criterion %', k using errcode = '22023'; end if;
    if v not between 1 and 5 then raise exception 'scores are from 1 to 5' using errcode = '22023'; end if;
    v_sum := v_sum + v * c.weight; v_w := v_w + c.weight;
  end loop;
  if nullif(p->>'id', '') is not null then
    select * into r from public.performance_reviews where id = (p->>'id')::uuid for update;
    if not found or r.employee_id <> e.id then raise exception 'review not found' using errcode = 'P0002'; end if;
    if r.status <> 'draft' then raise exception 'a submitted review cannot be changed' using errcode = '22023'; end if;
    if r.reviewer_id <> auth.uid() then raise exception 'only the reviewer edits the draft' using errcode = '42501'; end if;
    update public.performance_reviews set period_from = (p->>'period_from')::date, period_to = (p->>'period_to')::date, scores = coalesce(p->'scores', '{}'::jsonb),
      overall = case when v_w > 0 then round(v_sum / v_w, 2) end, strengths = nullif(trim(p->>'strengths'), ''), improvements = nullif(trim(p->>'improvements'), ''),
      goals = nullif(trim(p->>'goals'), ''), updated_at = now() where id = r.id returning * into r;
  else
    insert into public.performance_reviews (employee_id, branch_id, period_from, period_to, scores, overall, strengths, improvements, goals)
    values (e.id, e.branch_id, (p->>'period_from')::date, (p->>'period_to')::date, coalesce(p->'scores', '{}'::jsonb),
            case when v_w > 0 then round(v_sum / v_w, 2) end, nullif(trim(p->>'strengths'), ''), nullif(trim(p->>'improvements'), ''), nullif(trim(p->>'goals'), ''))
    returning * into r;
  end if;
  if p_submit then
    if v_w = 0 then raise exception 'score at least one criterion before submitting' using errcode = '22023'; end if;
    select to_jsonb(x) - 'employee_id' - 'staff_id' - 'name_ar' - 'name_en' into v_kpi from public.staff_kpis(e.branch_id, r.period_from, r.period_to, e.id) x;
    update public.performance_reviews set status = 'submitted', submitted_at = now(), kpis = v_kpi where id = r.id returning * into r;
  end if;
  return r;
end $$;

create or replace function public.acknowledge_review(p_id uuid, p_comment text)
returns public.performance_reviews language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.performance_reviews;
begin
  select * into r from public.performance_reviews where id = p_id for update;
  if not found or r.employee_id is distinct from app.my_employee_id() then raise exception 'review not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'only a submitted review can be acknowledged' using errcode = '22023'; end if;
  update public.performance_reviews set status = 'acknowledged', acknowledged_at = now(), employee_comment = nullif(trim(p_comment), '') where id = r.id returning * into r;
  return r;
end $$;

alter table public.review_criteria enable row level security;
alter table public.performance_reviews enable row level security;
create policy review_criteria_read on public.review_criteria for select to authenticated using (true);
create policy performance_reviews_read on public.performance_reviews for select to authenticated
  using ((app.has_permission('performance.review', branch_id) and employee_id is distinct from app.my_employee_id())
         or (employee_id = app.my_employee_id() and status <> 'draft'));
grant select on public.review_criteria, public.performance_reviews to authenticated;

revoke execute on function public.staff_kpis(uuid, date, date, uuid), public.save_review_criterion(text, jsonb), public.save_performance_review(jsonb, boolean),
  public.acknowledge_review(uuid, text) from public, anon;
grant execute on function public.staff_kpis(uuid, date, date, uuid), public.save_review_criterion(text, jsonb), public.save_performance_review(jsonb, boolean),
  public.acknowledge_review(uuid, text) to authenticated;
