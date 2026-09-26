-- Golden Care OS — 0008 Row Level Security and grants
-- RLS is the enforcement layer. The UI only hides what the database already refuses.
-- No table grants to anon. Deletes are not granted on business tables.

-- Helper: doctor sees a patient only when they are (or were) scheduled to treat them.
create or replace function app.is_treating_doctor(p_patient uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1 from public.appointments a
    where a.patient_id = p_patient and a.doctor_id = app.current_staff_id()
      and a.status not in ('canceled')
  ) or exists (
    select 1 from public.encounters e
    where e.patient_id = p_patient and e.doctor_id = app.current_staff_id()
  )
$$;
grant execute on function app.is_treating_doctor(uuid) to authenticated;

create or replace function app.can_read_patient(p_patient uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('patient.read', p_branch)
      or (app.has_permission('patient.read.assigned') and app.is_treating_doctor(p_patient))
$$;
grant execute on function app.can_read_patient(uuid, uuid) to authenticated;

create or replace function app.can_read_clinical(p_patient uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('clinical.read', p_branch)
      or (app.has_permission('clinical.write.own') and app.is_treating_doctor(p_patient))
$$;
grant execute on function app.can_read_clinical(uuid, uuid) to authenticated;

-- Enable RLS everywhere in public.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Reference / configuration tables: read for any active staff member,
-- write with settings.manage.
-- ---------------------------------------------------------------------------
create or replace function app.is_active_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.user_id
    where pr.user_id = auth.uid() and pr.is_active
      and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)
  )
$$;
grant execute on function app.is_active_staff() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations','branches','specialties','departments','rooms','roles','permissions',
                           'role_permissions','appointment_types','services','price_lists','price_list_items',
                           'payment_methods','doctor_schedules','schedule_exceptions','cost_centers'] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_active_staff())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_permission(''settings.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_permission(''settings.manage'')) with check (app.has_permission(''settings.manage''))', t || '_update', t);
  end loop;
end $$;

-- Role/permission catalogue changes are user administration, not general settings.
drop policy role_permissions_insert on public.role_permissions;
drop policy role_permissions_update on public.role_permissions;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (app.has_permission('users.manage'));
grant delete on public.role_permissions to authenticated;
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (app.has_permission('users.manage'));

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
grant select, insert, update on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or app.has_permission('users.manage') or app.has_permission('staff.read'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated
  using (app.has_permission('users.manage')) with check (app.has_permission('users.manage'));
-- Users may change their own display prefs but not their active flag.
create or replace function app.profiles_self_guard()
returns trigger language plpgsql as $$
begin
  if new.user_id = auth.uid() and not app.has_permission('users.manage')
     and (new.is_active is distinct from old.is_active or new.mfa_required is distinct from old.mfa_required) then
    raise exception 'cannot change your own activation or MFA requirement' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_self_guard before update on public.profiles
  for each row execute function app.profiles_self_guard();

grant select, insert, update on public.staff to authenticated;
create policy staff_read on public.staff for select to authenticated using (app.is_active_staff());
create policy staff_write on public.staff for insert to authenticated with check (app.has_permission('users.manage'));
create policy staff_update on public.staff for update to authenticated
  using (app.has_permission('users.manage')) with check (app.has_permission('users.manage'));

grant select, insert, update on public.user_roles to authenticated;
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.has_permission('users.manage'));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (app.has_permission('users.manage') and granted_by = auth.uid() and user_id <> auth.uid());
create policy user_roles_update on public.user_roles for update to authenticated
  using (app.has_permission('users.manage') and user_id <> auth.uid())
  with check (app.has_permission('users.manage') and user_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
grant select on public.audit_events to authenticated;
create policy audit_read on public.audit_events for select to authenticated
  using (app.has_permission('audit.read', branch_id));

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------
grant select, insert, update on public.patients, public.families to authenticated;
create policy patients_read on public.patients for select to authenticated
  using (app.can_read_patient(id, branch_id));
create policy patients_insert on public.patients for insert to authenticated
  with check (app.has_permission('patient.write', branch_id));
create policy patients_update on public.patients for update to authenticated
  using (app.has_permission('patient.write', branch_id)) with check (app.has_permission('patient.write', branch_id));

create policy families_read on public.families for select to authenticated
  using (app.has_permission('patient.read', branch_id));
create policy families_write on public.families for insert to authenticated
  with check (app.has_permission('patient.write', branch_id));
create policy families_update on public.families for update to authenticated
  using (app.has_permission('patient.write', branch_id));

-- Clinical alerts: clinical staff and the treating doctor. Reception sees a count via a function.
grant select, insert, update on public.patient_alerts to authenticated;
create policy alerts_read on public.patient_alerts for select to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id and app.can_read_clinical(p.id, p.branch_id)));
create policy alerts_write on public.patient_alerts for insert to authenticated
  with check (exists (select 1 from public.patients p where p.id = patient_id
                      and (app.has_permission('clinical.write', p.branch_id)
                           or (app.has_permission('clinical.write.own') and app.is_treating_doctor(p.id)))));
create policy alerts_update on public.patient_alerts for update to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id
                 and (app.has_permission('clinical.write', p.branch_id)
                      or (app.has_permission('clinical.write.own') and app.is_treating_doctor(p.id)))));

-- Reception needs to know an alert exists (e.g. "allergy on file") without reading it.
create or replace function public.patient_alert_flags(p_patient uuid)
returns table (kind public.alert_kind, severity public.alert_severity, n bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.kind, max(a.severity), count(*)
  from public.patient_alerts a join public.patients p on p.id = a.patient_id
  where a.patient_id = p_patient and a.is_active and app.can_read_patient(p.id, p.branch_id)
  group by a.kind
$$;

grant select, insert on public.patient_consents to authenticated;
grant select on public.patient_consent_current to authenticated;
create policy consents_read on public.patient_consents for select to authenticated
  using (exists (select 1 from public.patients p where p.id = patient_id and app.can_read_patient(p.id, p.branch_id)));
create policy consents_insert on public.patient_consents for insert to authenticated
  with check (exists (select 1 from public.patients p where p.id = patient_id
                      and (app.has_permission('patient.write', p.branch_id) or app.has_permission('clinical.write.own'))));

-- Minimal identification for finance (no DOB, no national ID, masked phone).
create or replace function public.patient_directory(p_ids uuid[])
returns table (id uuid, mrn text, full_name_ar text, phone_masked text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.mrn, p.first_name_ar || ' ' || p.last_name_ar,
         left(p.phone, 6) || '*****' || right(p.phone, 2)
  from public.patients p
  where p.id = any(p_ids)
    and (app.has_permission('patient.directory', p.branch_id) or app.can_read_patient(p.id, p.branch_id))
$$;

grant execute on function public.find_patient_duplicates(text, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
grant select, insert, update on public.appointments to authenticated;
create policy appointments_read on public.appointments for select to authenticated
  using (app.has_permission('appointment.read', branch_id) or doctor_id = app.current_staff_id());
create policy appointments_insert on public.appointments for insert to authenticated
  with check (app.has_permission('appointment.write', branch_id));
create policy appointments_update on public.appointments for update to authenticated
  using (app.has_permission('appointment.write', branch_id)
         or (doctor_id = app.current_staff_id() and app.has_permission('clinical.write.own')))
  with check (app.has_permission('appointment.write', branch_id)
         or (doctor_id = app.current_staff_id() and app.has_permission('clinical.write.own')));

grant select on public.appointment_status_history to authenticated;
create policy apt_history_read on public.appointment_status_history for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));

-- ---------------------------------------------------------------------------
-- Clinical
-- ---------------------------------------------------------------------------
grant select, insert, update on public.encounters to authenticated;
create policy encounters_read on public.encounters for select to authenticated
  using (app.has_permission('clinical.read', branch_id) or doctor_id = app.current_staff_id());
create policy encounters_insert on public.encounters for insert to authenticated
  with check (doctor_id = app.current_staff_id() and app.has_permission('clinical.write.own', branch_id));
create policy encounters_update on public.encounters for update to authenticated
  using (doctor_id = app.current_staff_id() and app.has_permission('clinical.write.own', branch_id))
  with check (doctor_id = app.current_staff_id());

grant select, insert on public.encounter_addenda to authenticated;
create policy addenda_read on public.encounter_addenda for select to authenticated
  using (exists (select 1 from public.encounters e where e.id = encounter_id));
create policy addenda_insert on public.encounter_addenda for insert to authenticated
  with check (author_id = auth.uid() and exists (
    select 1 from public.encounters e where e.id = encounter_id and e.status = 'signed'
      and e.doctor_id = app.current_staff_id()));

-- ---------------------------------------------------------------------------
-- Billing (reads by permission; state changes only via RPCs)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.invoices to authenticated;
create policy invoices_read on public.invoices for select to authenticated
  using (app.has_permission('billing.read', branch_id));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_permission('billing.write', branch_id));
create policy invoices_update on public.invoices for update to authenticated
  using (status = 'draft' and app.has_permission('billing.write', branch_id))
  with check (status = 'draft' and app.has_permission('billing.write', branch_id));
create policy invoices_delete_draft on public.invoices for delete to authenticated
  using (status = 'draft' and app.has_permission('billing.write', branch_id));

grant select, insert, update, delete on public.invoice_lines to authenticated;
create policy lines_read on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy lines_write on public.invoice_lines for insert to authenticated
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'
                      and app.has_permission('billing.write', i.branch_id)));
create policy lines_update on public.invoice_lines for update to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'
                 and app.has_permission('billing.write', i.branch_id)));
create policy lines_delete on public.invoice_lines for delete to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'
                 and app.has_permission('billing.write', i.branch_id)));

grant select on public.payments to authenticated;
create policy payments_read on public.payments for select to authenticated
  using (app.has_permission('billing.read', branch_id));

grant select on public.cashier_sessions to authenticated;
create policy cashier_sessions_read on public.cashier_sessions for select to authenticated
  using (cashier_id = auth.uid() or app.has_permission('cash.supervise', branch_id));

-- ---------------------------------------------------------------------------
-- Accounting (read-only through the API; posting only via definer functions)
-- ---------------------------------------------------------------------------
grant select on public.accounts, public.fiscal_periods, public.account_settings,
                public.journal_entries, public.journal_lines to authenticated;
create policy accounts_read on public.accounts for select to authenticated using (app.has_permission('accounting.read'));
create policy periods_read on public.fiscal_periods for select to authenticated using (app.has_permission('accounting.read'));
create policy acct_settings_read on public.account_settings for select to authenticated using (app.has_permission('accounting.read'));
create policy je_read on public.journal_entries for select to authenticated using (app.has_permission('accounting.read', branch_id));
create policy jl_read on public.journal_lines for select to authenticated
  using (exists (select 1 from public.journal_entries e where e.id = entry_id));

grant insert, update on public.accounts, public.account_settings, public.fiscal_periods to authenticated;
create policy accounts_manage on public.accounts for insert to authenticated with check (app.has_permission('accounting.configure'));
create policy accounts_manage_upd on public.accounts for update to authenticated using (app.has_permission('accounting.configure'));
create policy acct_settings_manage on public.account_settings for insert to authenticated with check (app.has_permission('accounting.configure'));
create policy acct_settings_manage_upd on public.account_settings for update to authenticated using (app.has_permission('accounting.configure'));
create policy periods_manage on public.fiscal_periods for insert to authenticated with check (app.has_permission('accounting.configure'));

-- ---------------------------------------------------------------------------
-- Function execution: public RPCs callable by signed-in users only.
-- Internal app.* posting functions are not granted to anyone.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema app from public;
grant execute on function app.has_permission(text, uuid), app.current_staff_id(), app.current_user_id(),
  app.normalize_name(text), app.normalize_phone(text), app.is_treating_doctor(uuid),
  app.can_read_patient(uuid, uuid), app.can_read_clinical(uuid, uuid), app.is_active_staff(),
  app.next_ref(text, boolean), app.touch_updated_at(), app.appointment_transition_allowed(public.appointment_status, public.appointment_status)
  to authenticated;

revoke execute on all functions in schema public from public;
grant execute on function
  public.my_permissions(), public.my_roles(), public.find_patient_duplicates(text, text, text, date),
  public.patient_alert_flags(uuid), public.patient_directory(uuid[]),
  public.transition_appointment(uuid, public.appointment_status, text), public.sign_encounter(uuid),
  public.service_price(uuid, uuid, date), public.issue_invoice(uuid),
  public.record_payment(uuid, numeric, text, text, text), public.void_invoice(uuid, text),
  public.open_cashier_session(uuid, numeric), public.close_cashier_session(uuid, numeric, text),
  public.reverse_journal_entry(uuid, text), public.trial_balance(uuid, date, date),
  public.lock_fiscal_period(uuid)
  to authenticated;
