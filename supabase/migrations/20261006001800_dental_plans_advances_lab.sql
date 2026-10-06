-- Golden Care OS — 0018 Patient advances, dental treatment plans & installments, lab cases, supplier bills
-- Money received before treatment is a liability (patient advances, 2200) until work is done and invoiced;
-- installments are advances tied to a plan; completed plan items are invoiced normally and the advance is
-- applied. Lab work and maintenance are supplier bills (expense / suppliers payable) paid through the
-- existing supplier payment flow, and a doctor's contract may carry a share of lab costs.

-- ---------------------------------------------------------------------------
-- Accounts, settings, permissions
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, v.code, v.ar, v.en, 'expense', true from public.organizations o
cross join (values ('5500', 'تكاليف معامل الأسنان', 'Dental laboratory costs'), ('5600', 'صيانة وإصلاح الأجهزة', 'Device maintenance and repair')) v(code, ar, en)
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('lab_costs', '5500'), ('maintenance_expense', '5600')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.permissions (code, module, description) values
  ('plan.write',           'dental',    'Prepare treatment plans and mark work done (doctors: their own plans)'),
  ('plan.accept',          'dental',    'Record the patient''s acceptance and installment schedule; cancel plans'),
  ('lab.read',             'dental',    'View dental laboratory cases'),
  ('lab.manage',           'dental',    'Create lab cases and update their status'),
  ('supplier.bill.record', 'purchasing','Record supplier bills for lab work and maintenance (posts to suppliers payable)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('doctor', 'plan.write'), ('doctor', 'lab.read'), ('doctor', 'lab.manage'),
  ('medical_director', 'plan.write'), ('medical_director', 'lab.read'),
  ('front_desk', 'plan.accept'), ('front_desk', 'lab.read'), ('patient_relations', 'plan.accept'),
  ('medical_assistant', 'lab.read'), ('medical_assistant', 'lab.manage'), ('nurse', 'lab.read'),
  ('operations_manager', 'lab.read'),
  ('chief_accountant', 'supplier.bill.record'), ('chief_accountant', 'lab.read'),
  ('accountant', 'supplier.bill.record'), ('accountant', 'lab.read'),
  ('inventory_controller', 'supplier.bill.record'), ('device_officer', 'supplier.bill.record')
on conflict do nothing;

-- Internal method: paying an invoice from the patient's advance balance (never chosen at the till).
insert into public.payment_methods (code, name_ar, name_en, account_key, requires_reference, requires_cash_session)
values ('advance', 'من الرصيد المقدم', 'From advance balance', 'patient_advances', false, false)
on conflict (code) do nothing;

create or replace function app.advance_method_guard()
returns trigger language plpgsql as $$
begin
  if new.method = 'advance' and coalesce(current_setting('app.advance_rpc', true), '') <> 'on' then
    raise exception 'the advance balance is applied with its own button, not as a payment method' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_payments_advance_guard before insert on public.payments for each row execute function app.advance_method_guard();
create or replace function app.refund_method_guard()
returns trigger language plpgsql as $$
begin
  if new.method in ('advance', 'online') then
    raise exception 'refunds are paid in cash, card, transfer or wallet, not into the advance balance' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_refunds_method_guard before insert on public.refunds for each row execute function app.refund_method_guard();

-- ---------------------------------------------------------------------------
-- Treatment plans (created before advances so deposits can reference them)
-- ---------------------------------------------------------------------------
create table public.treatment_plans (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique default app.next_ref('TP'),
  branch_id         uuid not null references public.branches(id),
  patient_id        uuid not null references public.patients(id),
  doctor_id         uuid not null references public.staff(id),
  title             text not null check (length(trim(title)) >= 2),
  notes             text,                                         -- shown on the quotation
  status            text not null default 'draft' check (status in ('draft', 'proposed', 'accepted', 'in_progress', 'completed', 'cancelled')),
  quote_no          text unique,
  proposed_at       timestamptz,
  valid_until       date,
  subtotal          numeric(14,2) not null default 0,
  discount_total    numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  accepted_at       timestamptz,
  accepted_by       uuid,
  acceptance_method text check (acceptance_method in ('signed_paper', 'in_person', 'portal')),
  acceptance_note   text,
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  cancel_reason     text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.treatment_plans (patient_id, created_at desc);
create table public.treatment_plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.treatment_plans(id),
  seq             int not null,
  service_id      uuid not null references public.services(id),
  tooth           text check (tooth is null or tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),     -- FDI notation
  surfaces        text check (surfaces is null or surfaces ~ '^[MODBLIFP]{1,5}$'),
  quantity        numeric(10,2) not null default 1 check (quantity > 0),
  unit_price      numeric(14,2) not null check (unit_price >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),
  line_total      numeric(14,2) generated always as (round(quantity * unit_price, 2) - discount) stored,
  lab_required    boolean not null default false,
  notes           text,
  status          text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  done_at         timestamptz,
  done_by         uuid,
  appointment_id  uuid references public.appointments(id),
  invoice_id      uuid references public.invoices(id),
  invoice_line_id uuid references public.invoice_lines(id),
  cancel_reason   text,
  constraint item_discount_within check (discount <= round(quantity * unit_price, 2)),
  unique (plan_id, seq)
);
create table public.plan_installments (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.treatment_plans(id),
  seq         int not null,
  due_on      date not null,
  amount      numeric(14,2) not null check (amount >= 0),          -- 0 when a cancelled item removed it
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  constraint installment_paid_within check (paid_amount <= amount),
  unique (plan_id, seq)
);
create trigger trg_audit_treatment_plans after insert or update on public.treatment_plans for each row execute function app.audit_row();
create trigger trg_audit_plan_items after insert or update or delete on public.treatment_plan_items for each row execute function app.audit_row();
create trigger trg_audit_installments after insert or update on public.plan_installments for each row execute function app.audit_row();
create trigger trg_plans_no_delete before delete on public.treatment_plans for each row execute function app.block_delete();
create trigger trg_installments_no_delete before delete on public.plan_installments for each row execute function app.block_delete();

create or replace function app.plan_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.plan_rpc', true), '') <> 'on' then
    raise exception 'treatment plans change only through the plan screen' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_plans_guard before insert or update on public.treatment_plans for each row execute function app.plan_guard();
create trigger trg_plan_items_guard before insert or update or delete on public.treatment_plan_items for each row execute function app.plan_guard();
create trigger trg_installments_guard before insert or update on public.plan_installments for each row execute function app.plan_guard();

-- Who may write a plan: a doctor for their own plans; clinical leads (plan.write + clinical.read) for any.
create or replace function app.can_write_plan(p_doctor uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('plan.write', p_branch)
     and (p_doctor = app.current_staff_id() or app.has_permission('clinical.read', p_branch))
$$;

create or replace function app.plan_totals(p_plan uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.treatment_plans p set
    subtotal = coalesce((select sum(round(quantity * unit_price, 2)) from public.treatment_plan_items where plan_id = p.id and status <> 'cancelled'), 0),
    discount_total = coalesce((select sum(discount) from public.treatment_plan_items where plan_id = p.id and status <> 'cancelled'), 0),
    total = coalesce((select sum(line_total) from public.treatment_plan_items where plan_id = p.id and status <> 'cancelled'), 0),
    updated_at = now()
  where p.id = p_plan
$$;

create or replace function public.save_treatment_plan(p jsonb)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; v_id uuid := nullif(p->>'id', '')::uuid; v_branch uuid; v_patient uuid; v_doctor uuid;
        it jsonb; sv public.services; v_price numeric; v_seq int := 0; v_qty numeric; v_disc numeric;
begin
  if v_id is not null then
    select * into tp from public.treatment_plans where id = v_id for update;
    if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
    if tp.status <> 'draft' then raise exception 'only a draft plan can be edited; revise it first' using errcode = '22023'; end if;
    v_branch := tp.branch_id; v_patient := tp.patient_id; v_doctor := tp.doctor_id;
  else
    v_branch := (p->>'branch_id')::uuid; v_patient := (p->>'patient_id')::uuid;
    v_doctor := coalesce(nullif(p->>'doctor_id', '')::uuid, app.current_staff_id());
    if not exists (select 1 from public.patients where id = v_patient) then raise exception 'patient not found' using errcode = 'P0002'; end if;
    if not app.can_read_patient(v_patient, v_branch) then raise exception 'permission denied: this patient is not under your care' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.staff where id = v_doctor and kind = 'doctor') then raise exception 'choose the treating doctor' using errcode = '22023'; end if;
  if not app.can_write_plan(v_doctor, v_branch) then
    raise exception 'permission denied: you can prepare only your own treatment plans' using errcode = '42501';
  end if;
  if coalesce(length(trim(p->>'title')), 0) < 2 then raise exception 'plan title is required' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  if v_id is null then
    insert into public.treatment_plans (branch_id, patient_id, doctor_id, title, notes)
    values (v_branch, v_patient, v_doctor, trim(p->>'title'), nullif(trim(p->>'notes'), '')) returning * into tp;
  else
    update public.treatment_plans set title = trim(p->>'title'), notes = nullif(trim(p->>'notes'), '') where id = tp.id;
    delete from public.treatment_plan_items where plan_id = tp.id;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select * into sv from public.services where id = (it->>'service_id')::uuid and is_active and not is_package;
    if not found then raise exception 'choose a service for every line' using errcode = '22023'; end if;
    v_price := public.service_price(sv.id, v_branch, app.cairo_today());
    if v_price is null then raise exception 'service % has no price in this branch', sv.code using errcode = '22023'; end if;
    v_qty := coalesce(nullif(it->>'quantity', '')::numeric, 1);
    v_disc := round(coalesce(nullif(it->>'discount', '')::numeric, 0), 2);
    if v_qty <= 0 or v_qty <> round(v_qty, 2) then raise exception 'quantity must be positive' using errcode = '22023'; end if;
    if v_disc < 0 or v_disc > round(v_qty * v_price, 2) then raise exception 'the discount exceeds the line value' using errcode = '22023'; end if;
    if nullif(trim(it->>'tooth'), '') is not null and trim(it->>'tooth') !~ '^([1-4][1-8]|[5-8][1-5])$' then
      raise exception 'tooth must be an FDI number (11–48, 51–85)' using errcode = '22023';
    end if;
    if nullif(trim(it->>'surfaces'), '') is not null and upper(trim(it->>'surfaces')) !~ '^[MODBLIFP]{1,5}$' then
      raise exception 'surfaces are up to 5 letters from M O D B L I F P' using errcode = '22023';
    end if;
    v_seq := v_seq + 1;
    insert into public.treatment_plan_items (plan_id, seq, service_id, tooth, surfaces, quantity, unit_price, discount, lab_required, notes)
    values (tp.id, v_seq, sv.id, nullif(trim(it->>'tooth'), ''), nullif(upper(trim(it->>'surfaces')), ''), v_qty, v_price, v_disc,
            coalesce((it->>'lab_required')::boolean, false), nullif(trim(it->>'notes'), ''));
  end loop;
  perform app.plan_totals(tp.id);
  select * into tp from public.treatment_plans where id = tp.id;
  return tp;
end $$;

create or replace function public.propose_plan(p_plan uuid, p_valid_days int default 30)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  if not app.can_write_plan(tp.doctor_id, tp.branch_id) then raise exception 'permission denied: you can prepare only your own treatment plans' using errcode = '42501'; end if;
  if tp.status <> 'draft' then raise exception 'only a draft plan can be proposed' using errcode = '22023'; end if;
  if not exists (select 1 from public.treatment_plan_items where plan_id = tp.id) then raise exception 'add at least one treatment line' using errcode = '22023'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 180 then raise exception 'quotation validity must be 1 to 180 days' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  perform app.plan_totals(tp.id);
  update public.treatment_plans set status = 'proposed', quote_no = app.next_ref('QT'), proposed_at = now(), valid_until = app.cairo_today() + p_valid_days
  where id = tp.id returning * into tp;
  return tp;
end $$;

create or replace function public.revise_plan(p_plan uuid)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  if not app.can_write_plan(tp.doctor_id, tp.branch_id) then raise exception 'permission denied: you can prepare only your own treatment plans' using errcode = '42501'; end if;
  if tp.status <> 'proposed' then raise exception 'only a proposed plan can be revised' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  update public.treatment_plans set status = 'draft' where id = tp.id returning * into tp;
  return tp;
end $$;

-- Acceptance fixes the price and the installment schedule (the schedule must add up to the plan total).
create or replace function public.accept_plan(p_plan uuid, p_method text, p_installments jsonb, p_note text default null)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; i jsonb; v_seq int := 0; v_prev date; v_sum numeric := 0; v_amt numeric; v_due date;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  perform app.require_permission('plan.accept', tp.branch_id);
  if tp.status <> 'proposed' then raise exception 'only a proposed plan can be accepted' using errcode = '22023'; end if;
  if tp.valid_until < app.cairo_today() then raise exception 'the quotation expired on %; revise and propose it again', tp.valid_until using errcode = '22023'; end if;
  if p_method not in ('signed_paper', 'in_person', 'portal') then raise exception 'record how the patient accepted' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) > 36 then
    raise exception 'installment schedule must have 1 to 36 rows' using errcode = '22023';
  end if;
  if tp.total > 0 and jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) = 0 then
    raise exception 'installment schedule must have 1 to 36 rows' using errcode = '22023';
  end if;
  perform set_config('app.plan_rpc', 'on', true);
  for i in select * from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
    v_amt := (i->>'amount')::numeric; v_due := (i->>'due_on')::date;
    if v_amt is null or v_amt <= 0 or v_amt <> round(v_amt, 2) then raise exception 'each installment needs a positive amount' using errcode = '22023'; end if;
    if v_due is null or v_due < app.cairo_today() or (v_prev is not null and v_due < v_prev) then
      raise exception 'installment dates must start today or later and run in order' using errcode = '22023';
    end if;
    v_seq := v_seq + 1; v_prev := v_due; v_sum := v_sum + v_amt;
    insert into public.plan_installments (plan_id, seq, due_on, amount) values (tp.id, v_seq, v_due, v_amt);
  end loop;
  if v_sum <> tp.total then raise exception 'installments add up to % but the plan total is %', v_sum, tp.total using errcode = '22023'; end if;
  update public.treatment_plans set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), acceptance_method = p_method,
    acceptance_note = nullif(trim(p_note), '')
  where id = tp.id returning * into tp;
  return tp;
end $$;

create or replace function public.cancel_plan(p_plan uuid, p_reason text)
returns public.treatment_plans language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('plan.accept', tp.branch_id) or app.can_write_plan(tp.doctor_id, tp.branch_id)) then
    raise exception 'permission denied: plan.accept' using errcode = '42501';
  end if;
  if tp.status in ('completed', 'cancelled') then raise exception 'plan is already %', tp.status using errcode = '22023'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  -- Work already done stays (and is billed); money paid stays in the patient's advance balance (refundable).
  update public.treatment_plan_items set status = 'cancelled', cancel_reason = 'plan cancelled: ' || trim(p_reason) where plan_id = tp.id and status = 'planned';
  update public.treatment_plans set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
  where id = tp.id returning * into tp;
  return tp;
end $$;

create or replace function app.plan_progress(p_plan uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.treatment_plans p set
    status = case when not exists (select 1 from public.treatment_plan_items where plan_id = p.id and status = 'planned') then 'completed' else 'in_progress' end,
    updated_at = now()
  where p.id = p_plan and p.status in ('accepted', 'in_progress')
$$;

create or replace function public.complete_plan_item(p_item uuid, p_appointment uuid default null, p_note text default null)
returns public.treatment_plan_items language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare it public.treatment_plan_items; tp public.treatment_plans;
begin
  -- Lock order everywhere: plan, then its items.
  select * into tp from public.treatment_plans where id = (select plan_id from public.treatment_plan_items where id = p_item) for update;
  select * into it from public.treatment_plan_items where id = p_item for update;
  if not found then raise exception 'plan item not found' using errcode = 'P0002'; end if;
  if not app.can_write_plan(tp.doctor_id, tp.branch_id) then raise exception 'permission denied: you can prepare only your own treatment plans' using errcode = '42501'; end if;
  if tp.status not in ('accepted', 'in_progress') then raise exception 'the plan must be accepted before work is recorded' using errcode = '22023'; end if;
  if it.status <> 'planned' then raise exception 'this item is already %', it.status using errcode = '22023'; end if;
  if p_appointment is not null and not exists (select 1 from public.appointments where id = p_appointment and patient_id = tp.patient_id) then
    raise exception 'appointment belongs to another patient' using errcode = '22023';
  end if;
  perform set_config('app.plan_rpc', 'on', true);
  update public.treatment_plan_items set status = 'done', done_at = now(), done_by = auth.uid(), appointment_id = p_appointment,
    notes = coalesce(nullif(trim(p_note), ''), notes)
  where id = it.id returning * into it;
  perform app.plan_progress(tp.id);
  return it;
end $$;

-- After the plan total drops, take the difference off the latest unpaid installments (never below what was paid).
create or replace function app.plan_trim_installments(p_plan uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_excess numeric; ins record; v_cut numeric;
begin
  select coalesce(sum(amount), 0) - (select total from public.treatment_plans where id = p_plan) into v_excess from public.plan_installments where plan_id = p_plan;
  for ins in select * from public.plan_installments where plan_id = p_plan order by seq desc for update loop
    exit when v_excess <= 0;
    v_cut := least(v_excess, ins.amount - ins.paid_amount);
    if v_cut > 0 then
      update public.plan_installments set amount = amount - v_cut where id = ins.id;
      v_excess := v_excess - v_cut;
    end if;
  end loop;
end $$;

create or replace function public.cancel_plan_item(p_item uuid, p_reason text)
returns public.treatment_plan_items language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare it public.treatment_plan_items; tp public.treatment_plans;
begin
  select * into tp from public.treatment_plans where id = (select plan_id from public.treatment_plan_items where id = p_item) for update;
  select * into it from public.treatment_plan_items where id = p_item for update;
  if not found then raise exception 'plan item not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('plan.accept', tp.branch_id) or app.can_write_plan(tp.doctor_id, tp.branch_id)) then
    raise exception 'permission denied: plan.accept' using errcode = '42501';
  end if;
  if tp.status not in ('accepted', 'in_progress') then raise exception 'the plan must be accepted before work is recorded' using errcode = '22023'; end if;
  if it.status <> 'planned' then raise exception 'this item is already %', it.status using errcode = '22023'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.plan_rpc', 'on', true);
  update public.treatment_plan_items set status = 'cancelled', cancel_reason = trim(p_reason) where id = it.id returning * into it;
  perform app.plan_totals(tp.id);
  perform app.plan_trim_installments(tp.id);
  perform app.plan_progress(tp.id);
  return it;
end $$;

-- ---------------------------------------------------------------------------
-- Patient advances (deposits): ledger, apply to invoices, refunds with maker-checker
-- ---------------------------------------------------------------------------
create table public.deposit_refunds (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default app.next_ref('DRF'),
  patient_id         uuid not null references public.patients(id),
  branch_id          uuid not null references public.branches(id),
  amount             numeric(14,2) not null check (amount > 0),
  method             text not null references public.payment_methods(code),
  reason             text not null check (length(trim(reason)) >= 3),
  status             public.refund_status not null default 'requested',
  requested_by       uuid not null default auth.uid(),
  requested_at       timestamptz not null default now(),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  paid_by            uuid,
  paid_at            timestamptz,
  reference          text,
  cashier_session_id uuid references public.cashier_sessions(id),
  journal_entry_id   uuid references public.journal_entries(id)
);
create index on public.deposit_refunds (status, requested_at);
create trigger trg_audit_deposit_refunds after insert or update on public.deposit_refunds for each row execute function app.audit_row();
create trigger trg_deposit_refunds_no_delete before delete on public.deposit_refunds for each row execute function app.block_delete();

create table public.patient_deposits (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default app.next_ref('DEP'),
  patient_id         uuid not null references public.patients(id),
  branch_id          uuid not null references public.branches(id),
  kind               text not null check (kind in ('deposit', 'applied', 'refund')),
  amount             numeric(14,2) not null check (amount > 0),
  method             text not null references public.payment_methods(code),
  reference          text,
  plan_id            uuid references public.treatment_plans(id),
  payment_id         uuid references public.payments(id),
  invoice_id         uuid references public.invoices(id),
  deposit_refund_id  uuid references public.deposit_refunds(id),
  cashier_session_id uuid references public.cashier_sessions(id),
  idempotency_key    text unique,
  journal_entry_id   uuid not null references public.journal_entries(id),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);
create index on public.patient_deposits (patient_id, created_at desc);
create index on public.patient_deposits (cashier_session_id);
create trigger trg_audit_patient_deposits after insert on public.patient_deposits for each row execute function app.audit_row();
create trigger trg_patient_deposits_immutable before update or delete on public.patient_deposits for each row execute function app.block_delete();

create or replace function app.advance_balance(p_patient uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case kind when 'deposit' then amount else -amount end), 0) from public.patient_deposits where patient_id = p_patient
$$;
create or replace function app.advance_available(p_patient uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select app.advance_balance(p_patient)
       - coalesce((select sum(amount) from public.deposit_refunds where patient_id = p_patient and status in ('requested', 'approved')), 0)
$$;

-- Receive an advance (optionally against a plan: it pays the plan's installments in date order).
create or replace function public.record_deposit(p_patient uuid, p_branch uuid, p_amount numeric, p_method text,
                                                 p_idempotency_key text, p_reference text default null, p_plan uuid default null)
returns public.patient_deposits language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.patient_deposits; m public.payment_methods; v_session uuid; v_org uuid; v_je uuid; tp public.treatment_plans;
        ins record; v_left numeric; v_pay numeric;
begin
  if coalesce(trim(p_idempotency_key), '') = '' or p_idempotency_key like 'apply:%' then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  perform app.require_permission('payment.collect', p_branch);
  perform 1 from public.patients where id = p_patient for update;          -- one balance change per patient at a time
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  select * into d from public.patient_deposits where idempotency_key = p_idempotency_key;
  if found then
    if d.created_by is distinct from auth.uid() or d.patient_id <> p_patient or d.amount <> round(p_amount, 2) or d.method <> p_method then
      raise exception 'idempotency key reused with different payment details' using errcode = '22023';
    end if;
    return d;
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  select * into m from public.payment_methods where code = p_method and is_active and code not in ('advance', 'online');
  if not found then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'payment method % requires a reference number', p_method using errcode = '22023';
  end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions where cashier_id = auth.uid() and branch_id = p_branch and status = 'open' for update;
    if v_session is null then raise exception 'open a cashier session before receiving cash' using errcode = '22023'; end if;
  end if;
  if p_plan is not null then
    select * into tp from public.treatment_plans where id = p_plan;
    if not found or tp.patient_id <> p_patient then raise exception 'plan belongs to another patient' using errcode = '22023'; end if;
    if tp.status not in ('accepted', 'in_progress', 'completed') then raise exception 'payments are taken only on accepted plans' using errcode = '22023'; end if;
  end if;
  v_org := app.org_of_branch(p_branch);
  v_je := app.post_journal(v_org, p_branch, app.cairo_today(), 'Patient advance (' || p_method || ')', 'patient_deposit', p_patient,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'debit', round(p_amount, 2), 'patient_id', p_patient, 'memo', coalesce(p_reference, p_method)),
      jsonb_build_object('account_id', app.account_for(v_org, 'patient_advances'), 'credit', round(p_amount, 2), 'patient_id', p_patient)));
  insert into public.patient_deposits (patient_id, branch_id, kind, amount, method, reference, plan_id, cashier_session_id, idempotency_key, journal_entry_id)
  values (p_patient, p_branch, 'deposit', round(p_amount, 2), p_method, nullif(trim(p_reference), ''), p_plan, v_session, p_idempotency_key, v_je)
  returning * into d;
  if p_plan is not null then
    perform set_config('app.plan_rpc', 'on', true);
    v_left := d.amount;
    for ins in select * from public.plan_installments where plan_id = p_plan and paid_amount < amount order by seq for update loop
      exit when v_left <= 0;
      v_pay := least(v_left, ins.amount - ins.paid_amount);
      update public.plan_installments set paid_amount = paid_amount + v_pay where id = ins.id;
      v_left := v_left - v_pay;
    end loop;
  end if;
  return d;
end $$;

-- Pay an invoice from the advance balance: an ordinary payment with method 'advance' (Dr 2200 / Cr receivable).
create or replace function public.apply_advance(p_invoice uuid, p_amount numeric, p_idempotency_key text)
returns public.payments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; p public.payments; d public.patient_deposits; v_avail numeric;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', i.branch_id);
  perform 1 from public.patients where id = i.patient_id for update;
  select * into d from public.patient_deposits where idempotency_key = 'apply:' || p_idempotency_key;
  if found then
    if d.kind <> 'applied' or d.created_by is distinct from auth.uid() or d.invoice_id is distinct from p_invoice or d.amount <> round(p_amount, 2) then
      raise exception 'idempotency key reused with different payment details' using errcode = '22023';
    end if;
    select * into p from public.payments where id = d.payment_id;
    return p;
  end if;
  v_avail := app.advance_available(i.patient_id);
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if round(p_amount, 2) > v_avail then raise exception 'amount exceeds the advance balance (%)', v_avail using errcode = '22023'; end if;
  perform set_config('app.advance_rpc', 'on', true);
  p := public.record_payment(p_invoice, round(p_amount, 2), 'advance', 'adv:' || p_idempotency_key, null);
  perform set_config('app.advance_rpc', '', true);
  insert into public.patient_deposits (patient_id, branch_id, kind, amount, method, payment_id, invoice_id, idempotency_key, journal_entry_id)
  values (i.patient_id, i.branch_id, 'applied', p.amount, 'advance', p.id, i.id, 'apply:' || p_idempotency_key, p.journal_entry_id);
  return p;
end $$;

create or replace function public.request_deposit_refund(p_patient uuid, p_branch uuid, p_amount numeric, p_method text, p_reason text)
returns public.deposit_refunds language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.deposit_refunds; v_avail numeric;
begin
  perform app.require_permission('refund.request', p_branch);
  perform 1 from public.patients where id = p_patient for update;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'refund reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.payment_methods where code = p_method and is_active and code not in ('advance', 'online')) then
    raise exception 'unknown payment method %', p_method using errcode = '22023';
  end if;
  v_avail := app.advance_available(p_patient);
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if round(p_amount, 2) > v_avail then raise exception 'amount exceeds the advance balance (%)', v_avail using errcode = '22023'; end if;
  insert into public.deposit_refunds (patient_id, branch_id, amount, method, reason) values (p_patient, p_branch, round(p_amount, 2), p_method, trim(p_reason))
  returning * into r;
  return r;
end $$;

create or replace function public.decide_deposit_refund(p_refund uuid, p_approve boolean, p_note text default null)
returns public.deposit_refunds language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.deposit_refunds;
begin
  select * into r from public.deposit_refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('refund.approve', r.branch_id);
  if r.status <> 'requested' then raise exception 'refund already %', r.status using errcode = '22023'; end if;
  if r.requested_by = auth.uid() then raise exception 'separation of duties: you cannot approve your own refund request' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
  update public.deposit_refunds set status = case when p_approve then 'approved'::public.refund_status else 'rejected'::public.refund_status end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.pay_deposit_refund(p_refund uuid, p_reference text default null)
returns public.deposit_refunds language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.deposit_refunds; m public.payment_methods; v_session uuid; v_org uuid; v_je uuid; v_other numeric;
begin
  select * into r from public.deposit_refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', r.branch_id);
  if r.status = 'paid' then return r; end if;
  if r.status <> 'approved' then raise exception 'refund must be approved before payment' using errcode = '22023'; end if;
  perform 1 from public.patients where id = r.patient_id for update;
  select coalesce(sum(amount), 0) into v_other from public.deposit_refunds where patient_id = r.patient_id and status in ('requested', 'approved') and id <> r.id;
  if app.advance_balance(r.patient_id) - v_other < r.amount then
    raise exception 'amount exceeds the advance balance (%)', app.advance_balance(r.patient_id) - v_other using errcode = '22023';
  end if;
  select * into m from public.payment_methods where code = r.method;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'payment method % requires a reference number', r.method using errcode = '22023';
  end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions where cashier_id = auth.uid() and branch_id = r.branch_id and status = 'open' for update;
    if v_session is null then raise exception 'open a cashier session before paying cash' using errcode = '22023'; end if;
  end if;
  v_org := app.org_of_branch(r.branch_id);
  v_je := app.post_journal(v_org, r.branch_id, app.cairo_today(), 'Advance refund ' || r.ref || ' (' || r.method || ')', 'deposit_refund', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'patient_advances'), 'debit', r.amount, 'patient_id', r.patient_id, 'memo', r.reason),
      jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'credit', r.amount, 'patient_id', r.patient_id, 'memo', coalesce(p_reference, r.method))));
  insert into public.patient_deposits (patient_id, branch_id, kind, amount, method, reference, deposit_refund_id, cashier_session_id, journal_entry_id)
  values (r.patient_id, r.branch_id, 'refund', r.amount, r.method, nullif(trim(p_reference), ''), r.id, v_session, v_je);
  update public.deposit_refunds set status = 'paid', paid_by = auth.uid(), paid_at = now(), reference = nullif(trim(p_reference), ''),
    cashier_session_id = v_session, journal_entry_id = v_je
  where id = r.id returning * into r;
  return r;
end $$;

-- Cash closing now also counts cash advances received and cash advance refunds paid in the session.
create or replace function public.close_cashier_session(p_session uuid, p_counted numeric, p_note text default null)
returns public.cashier_sessions
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.cashier_sessions; v_expected numeric;
begin
  select * into s from public.cashier_sessions where id = p_session for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if s.cashier_id <> auth.uid() and not app.has_permission('cash.supervise', s.branch_id) then
    raise exception 'permission denied: close another cashier''s session' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'session already closed' using errcode = '22023'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'counted cash is required' using errcode = '22023'; end if;

  v_expected := app.session_expected_cash(s.id);

  if round(p_counted, 2) <> v_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required when counted cash differs from expected (%)', v_expected using errcode = '22023';
  end if;
  update public.cashier_sessions set status = 'closed', closed_at = now(), expected_cash = v_expected,
         counted_cash = round(p_counted, 2), difference = round(p_counted, 2) - v_expected, close_note = p_note
  where id = s.id returning * into s;
  return s;
end $$;

create or replace function app.session_expected_cash(p_session uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select s.opening_float
    + coalesce((select sum(amount) from public.payments where cashier_session_id = s.id and status = 'posted'), 0)
    - coalesce((select sum(amount) from public.refunds where cashier_session_id = s.id and status = 'paid'), 0)
    + coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'deposit'), 0)
    - coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'refund'), 0)
  from public.cashier_sessions s where s.id = p_session
$$;

-- Bill the completed, unbilled items of a plan as an ordinary invoice (revenue when the work is done), then
-- pay it from the patient's advance balance when the caller can collect payments.
create or replace function public.bill_plan_items(p_plan uuid, p_appointment uuid default null)
returns public.invoices language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare tp public.treatment_plans; inv public.invoices; it record; v_line uuid; v_avail numeric; v_n int := 0;
begin
  select * into tp from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'treatment plan not found' using errcode = 'P0002'; end if;
  perform app.require_permission('billing.write', tp.branch_id);
  if p_appointment is not null and not exists (select 1 from public.appointments where id = p_appointment and patient_id = tp.patient_id) then
    raise exception 'appointment belongs to another patient' using errcode = '22023';
  end if;
  insert into public.invoices (branch_id, patient_id, appointment_id) values (tp.branch_id, tp.patient_id, p_appointment) returning * into inv;
  perform set_config('app.plan_rpc', 'on', true);
  for it in select i.*, s.code from public.treatment_plan_items i join public.services s on s.id = i.service_id
            where i.plan_id = tp.id and i.status = 'done' and i.invoice_id is null order by i.seq for update of i loop
    insert into public.invoice_lines (invoice_id, service_id, doctor_id, description, quantity, unit_price, discount)
    values (inv.id, it.service_id, tp.doctor_id,
            concat_ws(' · ', tp.ref, case when it.tooth is not null then 'سن ' || it.tooth end, it.surfaces), it.quantity, it.unit_price, it.discount)
    returning id into v_line;
    update public.treatment_plan_items set invoice_id = inv.id, invoice_line_id = v_line where id = it.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'no completed items to bill' using errcode = '22023'; end if;
  inv := public.issue_invoice(inv.id);
  if inv.total > 0 and app.has_permission('payment.collect', tp.branch_id) then
    v_avail := app.advance_available(tp.patient_id);
    if v_avail > 0 then
      perform public.apply_advance(inv.id, least(v_avail, inv.total), 'plan-bill:' || inv.id::text);
      select * into inv from public.invoices where id = inv.id;
    end if;
  end if;
  return inv;
end $$;

-- Voiding a plan invoice releases its items so the work can be billed again correctly.
create or replace function app.plan_invoice_void()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    perform set_config('app.plan_rpc', 'on', true);
    update public.treatment_plan_items set invoice_id = null, invoice_line_id = null where invoice_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_invoices_plan_void after update on public.invoices for each row execute function app.plan_invoice_void();

-- Installments that are due and not fully paid (front desk follow-up list).
create or replace function public.overdue_installments(p_branch uuid default null)
returns table (plan_id uuid, plan_ref text, patient_id uuid, seq int, due_on date, amount numeric, paid_amount numeric, days_late int)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.ref, p.patient_id, i.seq, i.due_on, i.amount, i.paid_amount, app.cairo_today() - i.due_on
  from public.plan_installments i join public.treatment_plans p on p.id = i.plan_id
  where i.paid_amount < i.amount and i.due_on < app.cairo_today() and p.status in ('accepted', 'in_progress', 'completed')
    and (p_branch is null or p.branch_id = p_branch)
    and (app.has_permission('plan.accept', p.branch_id) or app.has_permission('billing.read', p.branch_id))
  order by i.due_on
$$;

-- ---------------------------------------------------------------------------
-- Dental laboratory cases
-- ---------------------------------------------------------------------------
alter table public.suppliers add column is_lab boolean not null default false;

create table public.lab_cases (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default app.next_ref('LAB'),
  branch_id     uuid not null references public.branches(id),
  patient_id    uuid not null references public.patients(id),
  plan_id       uuid references public.treatment_plans(id),
  plan_item_id  uuid references public.treatment_plan_items(id),
  doctor_id     uuid not null references public.staff(id),
  service_id    uuid not null references public.services(id),        -- the treatment the lab work belongs to (cost attribution)
  lab_id        uuid not null references public.suppliers(id),
  work_type     text not null check (length(trim(work_type)) >= 2),
  teeth         text,
  shade         text,
  instructions  text,
  due_on        date,
  status        text not null default 'ordered' check (status in ('ordered', 'sent', 'in_lab', 'returned', 'remake', 'delivered', 'cancelled')),
  remakes       int not null default 0,
  cost          numeric(14,2) not null default 0,
  delivered_at  timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.lab_cases (status, due_on);
create table public.lab_case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.lab_cases(id),
  status     text not null,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger trg_audit_lab_cases after insert or update on public.lab_cases for each row execute function app.audit_row();
create trigger trg_lab_cases_no_delete before delete on public.lab_cases for each row execute function app.block_delete();
create trigger trg_lab_events_immutable before update or delete on public.lab_case_events for each row execute function app.block_delete();
create or replace function app.lab_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.lab_rpc', true), '') <> 'on' then
    raise exception 'lab cases change only through the lab screen' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_lab_cases_guard before insert or update on public.lab_cases for each row execute function app.lab_guard();

create or replace function public.create_lab_case(p jsonb)
returns public.lab_cases language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.lab_cases; it public.treatment_plan_items; tp public.treatment_plans; v_branch uuid := nullif(p->>'branch_id', '')::uuid;
        v_patient uuid := nullif(p->>'patient_id', '')::uuid; v_doctor uuid := nullif(p->>'doctor_id', '')::uuid; v_due date := nullif(p->>'due_on', '')::date;
begin
  if nullif(p->>'plan_item_id', '') is not null then
    select * into it from public.treatment_plan_items where id = (p->>'plan_item_id')::uuid;
    if not found then raise exception 'plan item not found' using errcode = 'P0002'; end if;
    select * into tp from public.treatment_plans where id = it.plan_id;
    if tp.status not in ('accepted', 'in_progress') then raise exception 'the plan must be accepted before work is recorded' using errcode = '22023'; end if;
    v_branch := tp.branch_id; v_patient := tp.patient_id; v_doctor := tp.doctor_id;      -- a plan's lab work always belongs to the plan's doctor
  end if;
  perform app.require_permission('lab.manage', v_branch);
  if not exists (select 1 from public.patients where id = v_patient) then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if not app.can_read_patient(v_patient, v_branch) then raise exception 'permission denied: this patient is not under your care' using errcode = '42501'; end if;
  -- A doctor records lab work only under their own name; assistants name the treating doctor.
  if exists (select 1 from public.staff where id = app.current_staff_id() and kind = 'doctor') and it.id is null then
    v_doctor := app.current_staff_id();
  end if;
  if it.id is not null and exists (select 1 from public.staff where id = app.current_staff_id() and kind = 'doctor')
     and tp.doctor_id <> app.current_staff_id() and not app.has_permission('clinical.read', v_branch) then
    raise exception 'permission denied: you can prepare only your own treatment plans' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff where id = v_doctor and kind = 'doctor') then raise exception 'choose the treating doctor' using errcode = '22023'; end if;
  if not exists (select 1 from public.suppliers where id = nullif(p->>'lab_id', '')::uuid and is_lab and is_active) then raise exception 'choose a dental laboratory' using errcode = '22023'; end if;
  if coalesce(it.service_id, nullif(p->>'service_id', '')::uuid) is null
     or not exists (select 1 from public.services where id = coalesce(it.service_id, nullif(p->>'service_id', '')::uuid) and not is_package) then
    raise exception 'choose the treatment service' using errcode = '22023';
  end if;
  if coalesce(length(trim(p->>'work_type')), 0) < 2 then raise exception 'describe the lab work' using errcode = '22023'; end if;
  if v_due is not null and v_due < app.cairo_today() then raise exception 'the due date cannot be in the past' using errcode = '22023'; end if;
  perform set_config('app.lab_rpc', 'on', true);
  insert into public.lab_cases (branch_id, patient_id, plan_id, plan_item_id, doctor_id, service_id, lab_id, work_type, teeth, shade, instructions, due_on)
  values (v_branch, v_patient, tp.id, it.id, v_doctor, coalesce(it.service_id, nullif(p->>'service_id', '')::uuid), (p->>'lab_id')::uuid, trim(p->>'work_type'),
          coalesce(nullif(trim(p->>'teeth'), ''), it.tooth), nullif(trim(p->>'shade'), ''), nullif(trim(p->>'instructions'), ''), v_due)
  returning * into c;
  insert into public.lab_case_events (case_id, status, note) values (c.id, 'ordered', nullif(trim(p->>'instructions'), ''));
  return c;
end $$;

create or replace function public.lab_case_set_status(p_case uuid, p_status text, p_note text default null)
returns public.lab_cases language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.lab_cases; v_ok boolean;
begin
  select * into c from public.lab_cases where id = p_case for update;
  if not found then raise exception 'lab case not found' using errcode = 'P0002'; end if;
  perform app.require_permission('lab.manage', c.branch_id);
  v_ok := (c.status, p_status) in (('ordered', 'sent'), ('ordered', 'cancelled'), ('sent', 'in_lab'), ('sent', 'returned'), ('sent', 'cancelled'),
                                    ('in_lab', 'returned'), ('in_lab', 'cancelled'), ('returned', 'delivered'), ('returned', 'remake'),
                                    ('remake', 'sent'), ('remake', 'cancelled'));
  if not v_ok then raise exception 'a lab case cannot move from % to %', c.status, p_status using errcode = '22023'; end if;
  if p_status in ('remake', 'cancelled') and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.lab_rpc', 'on', true);
  update public.lab_cases set status = p_status, remakes = remakes + case when p_status = 'remake' then 1 else 0 end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end, updated_at = now()
  where id = c.id returning * into c;
  insert into public.lab_case_events (case_id, status, note) values (c.id, p_status, nullif(trim(p_note), ''));
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Supplier bills (lab work, maintenance) payable through the supplier payment flow
-- ---------------------------------------------------------------------------
create table public.supplier_bills (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique default app.next_ref('BILL'),
  supplier_id          uuid not null references public.suppliers(id),
  branch_id            uuid not null references public.branches(id),
  bill_no              text not null check (length(trim(bill_no)) >= 1),
  bill_date            date not null,
  kind                 text not null check (kind in ('lab', 'maintenance')),
  amount               numeric(14,2) not null check (amount > 0),
  amount_paid          numeric(14,2) not null default 0,
  description          text,
  lab_case_id          uuid references public.lab_cases(id),
  maintenance_order_id uuid references public.maintenance_orders(id),
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  confirmed_by         uuid,
  confirmed_at         timestamptz,
  journal_entry_id     uuid not null references public.journal_entries(id),
  voided_at            timestamptz,
  voided_by            uuid,
  void_reason          text,
  constraint bill_paid_within check (amount_paid >= 0 and amount_paid <= amount),
  constraint bill_link check ((kind = 'lab' and lab_case_id is not null) or (kind = 'maintenance' and maintenance_order_id is not null)),
  unique (supplier_id, bill_no)
);
create trigger trg_audit_supplier_bills after insert or update on public.supplier_bills for each row execute function app.audit_row();
create trigger trg_supplier_bills_no_delete before delete on public.supplier_bills for each row execute function app.block_delete();

create or replace function public.record_supplier_bill(p jsonb)
returns public.supplier_bills language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare b public.supplier_bills; c public.lab_cases; w public.maintenance_orders; v_branch uuid; v_amt numeric := (p->>'amount')::numeric;
        v_date date := coalesce(nullif(p->>'bill_date', '')::date, app.cairo_today()); v_org uuid; v_je uuid; v_patient uuid; v_doctor uuid;
        v_id uuid := gen_random_uuid();
begin
  if p->>'kind' = 'lab' then
    select * into c from public.lab_cases where id = nullif(p->>'lab_case_id', '')::uuid for update;
    if not found then raise exception 'lab case not found' using errcode = 'P0002'; end if;
    if c.lab_id <> (p->>'supplier_id')::uuid then raise exception 'the bill must come from the case''s laboratory' using errcode = '22023'; end if;
    if c.status = 'cancelled' then raise exception 'lab case is cancelled' using errcode = '22023'; end if;
    if c.status = 'ordered' then raise exception 'the case has not been sent to the lab yet' using errcode = '22023'; end if;
    v_branch := c.branch_id; v_patient := c.patient_id; v_doctor := c.doctor_id;
  elsif p->>'kind' = 'maintenance' then
    select * into w from public.maintenance_orders where id = nullif(p->>'maintenance_order_id', '')::uuid;
    if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
    if w.status <> 'closed' then raise exception 'close the work order before recording its bill' using errcode = '22023'; end if;
    if w.vendor_id is not null and w.vendor_id <> (p->>'supplier_id')::uuid then raise exception 'the bill must come from the work order''s vendor' using errcode = '22023'; end if;
    v_branch := w.branch_id;
  else
    raise exception 'bill kind must be lab or maintenance' using errcode = '22023';
  end if;
  perform app.require_permission('supplier.bill.record', v_branch);
  if not exists (select 1 from public.suppliers where id = (p->>'supplier_id')::uuid and is_active) then raise exception 'supplier not found' using errcode = 'P0002'; end if;
  if coalesce(trim(p->>'bill_no'), '') = '' then raise exception 'supplier invoice number is required' using errcode = '22023'; end if;
  if v_amt is null or v_amt <= 0 or v_amt <> round(v_amt, 2) then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if v_date > app.cairo_today() then raise exception 'the bill date cannot be in the future' using errcode = '22023'; end if;
  v_org := app.org_of_branch(v_branch);
  v_je := app.post_journal(v_org, v_branch, v_date, 'Supplier bill ' || trim(p->>'bill_no') || ' (' || (p->>'kind') || ')', 'supplier_bill', v_id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, case when p->>'kind' = 'lab' then 'lab_costs' else 'maintenance_expense' end),
                         'debit', v_amt, 'patient_id', v_patient, 'doctor_id', v_doctor, 'memo', coalesce(c.ref, w.ref)),
      jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'credit', v_amt)));
  insert into public.supplier_bills (id, supplier_id, branch_id, bill_no, bill_date, kind, amount, description, lab_case_id, maintenance_order_id, journal_entry_id)
  values (v_id, (p->>'supplier_id')::uuid, v_branch, trim(p->>'bill_no'), v_date, p->>'kind', v_amt, nullif(trim(p->>'description'), ''), c.id, w.id, v_je)
  returning * into b;
  if c.id is not null then
    perform set_config('app.lab_rpc', 'on', true);
    update public.lab_cases set cost = cost + v_amt, updated_at = now() where id = c.id;
  end if;
  return b;
exception when unique_violation then
  raise exception 'this supplier invoice number is already recorded' using errcode = '23505';
end $$;

create or replace function public.confirm_supplier_bill(p_bill uuid)
returns public.supplier_bills language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare b public.supplier_bills;
begin
  select * into b from public.supplier_bills where id = p_bill for update;
  if not found then raise exception 'bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.approve', b.branch_id);
  if b.voided_at is not null then raise exception 'bill % is void', b.bill_no using errcode = '22023'; end if;
  if b.confirmed_at is not null then return b; end if;
  if b.created_by = auth.uid() then raise exception 'separation of duties: you cannot confirm a bill you recorded' using errcode = '42501'; end if;
  update public.supplier_bills set confirmed_by = auth.uid(), confirmed_at = now() where id = b.id returning * into b;
  return b;
end $$;

-- A wrong bill is voided (never deleted): unpaid only, reason required, the journal is reversed.
create or replace function public.void_supplier_bill(p_bill uuid, p_reason text)
returns public.supplier_bills language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare b public.supplier_bills;
begin
  select * into b from public.supplier_bills where id = p_bill for update;
  if not found then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('supplier.bill.record', b.branch_id) or app.has_permission('purchase.approve', b.branch_id)) then
    raise exception 'permission denied: supplier.bill.record' using errcode = '42501';
  end if;
  if b.voided_at is not null then raise exception 'bill is already void' using errcode = '22023'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  if b.amount_paid > 0 or exists (select 1 from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
                                   where a.bill_id = b.id and p.status = 'requested') then
    raise exception 'only unpaid bills with no pending payment can be voided' using errcode = '22023';
  end if;
  perform app.reverse_journal(b.journal_entry_id, p_reason, 'supplier_bill_void', b.id);
  update public.supplier_bills set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = b.id returning * into b;
  if b.lab_case_id is not null then
    perform set_config('app.lab_rpc', 'on', true);
    update public.lab_cases set cost = cost - b.amount, updated_at = now() where id = b.lab_case_id;
  end if;
  return b;
end $$;

-- Payment allocations now point at a goods receipt OR a supplier bill.
alter table public.supplier_payment_allocations drop constraint supplier_payment_allocations_pkey;
alter table public.supplier_payment_allocations alter column receipt_id drop not null;
alter table public.supplier_payment_allocations add column bill_id uuid references public.supplier_bills(id);
alter table public.supplier_payment_allocations add column id uuid not null default gen_random_uuid() primary key;
alter table public.supplier_payment_allocations add constraint allocation_one_document check (num_nonnulls(receipt_id, bill_id) = 1);
create unique index allocation_receipt_once on public.supplier_payment_allocations (payment_id, receipt_id) where receipt_id is not null;
create unique index allocation_bill_once on public.supplier_payment_allocations (payment_id, bill_id) where bill_id is not null;

create or replace function public.request_supplier_payment(p_supplier uuid, p_allocations jsonb, p_method text, p_reference text)
returns public.supplier_payments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare sp public.supplier_payments; a jsonb; gr public.goods_receipts; b public.supplier_bills; v_amt numeric; v_pending numeric; v_branch uuid; v_total numeric := 0;
        v_doc_branch uuid; v_no text; v_outstanding numeric;
begin
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then raise exception 'choose at least one supplier invoice' using errcode = '22023'; end if;
  if p_method not in ('bank_transfer', 'cheque') then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if length(trim(coalesce(p_reference, ''))) < 2 then raise exception 'payment method % requires a reference number', p_method using errcode = '22023'; end if;
  -- Lock receipts then bills, each in id order (same order as release) so concurrent requests cannot deadlock.
  perform 1 from public.goods_receipts where id in (select (x->>'receipt_id')::uuid from jsonb_array_elements(p_allocations) x where x ? 'receipt_id') order by id for update;
  perform 1 from public.supplier_bills where id in (select (x->>'bill_id')::uuid from jsonb_array_elements(p_allocations) x where x ? 'bill_id') order by id for update;
  for a in select * from jsonb_array_elements(p_allocations) loop
    if a ? 'receipt_id' then
      select * into gr from public.goods_receipts where id = (a->>'receipt_id')::uuid;
      if not found or gr.supplier_id <> p_supplier then raise exception 'supplier invoice not found for this supplier' using errcode = '22023'; end if;
      if gr.confirmed_at is null then
        raise exception 'receipt % has no purchase order and must be confirmed by an approver before payment', gr.supplier_invoice_no using errcode = '22023';
      end if;
      select coalesce(sum(al.amount), 0) into v_pending from public.supplier_payment_allocations al
        join public.supplier_payments p on p.id = al.payment_id where al.receipt_id = gr.id and p.status = 'requested';
      v_doc_branch := gr.branch_id; v_no := gr.supplier_invoice_no; v_outstanding := gr.total - gr.amount_paid - v_pending;
    elsif a ? 'bill_id' then
      select * into b from public.supplier_bills where id = (a->>'bill_id')::uuid;
      if not found or b.supplier_id <> p_supplier then raise exception 'supplier invoice not found for this supplier' using errcode = '22023'; end if;
      if b.voided_at is not null then raise exception 'bill % is void', b.bill_no using errcode = '22023'; end if;
      if b.confirmed_at is null then raise exception 'bill % must be confirmed by an approver before payment', b.bill_no using errcode = '22023'; end if;
      select coalesce(sum(al.amount), 0) into v_pending from public.supplier_payment_allocations al
        join public.supplier_payments p on p.id = al.payment_id where al.bill_id = b.id and p.status = 'requested';
      v_doc_branch := b.branch_id; v_no := b.bill_no; v_outstanding := b.amount - b.amount_paid - v_pending;
    else
      raise exception 'supplier invoice not found for this supplier' using errcode = '22023';
    end if;
    if v_branch is null then
      v_branch := v_doc_branch;
      perform app.require_permission('supplier.pay.request', v_branch);
    elsif v_doc_branch <> v_branch then
      raise exception 'one payment covers one branch' using errcode = '22023';
    end if;
    v_amt := round((a->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
    if v_amt > v_outstanding then raise exception 'amount exceeds what is outstanding on %', v_no using errcode = '22023'; end if;
    v_total := v_total + v_amt;
  end loop;
  insert into public.supplier_payments (supplier_id, branch_id, amount, method, reference)
  values (p_supplier, v_branch, v_total, p_method, trim(p_reference)) returning * into sp;
  insert into public.supplier_payment_allocations (payment_id, receipt_id, bill_id, amount)
  select sp.id, nullif(x->>'receipt_id', '')::uuid, nullif(x->>'bill_id', '')::uuid, round((x->>'amount')::numeric, 2) from jsonb_array_elements(p_allocations) x;
  return sp;
exception when unique_violation then
  raise exception 'each supplier invoice can appear only once in a payment' using errcode = '22023';
end $$;

create or replace function public.decide_supplier_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns public.supplier_payments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare sp public.supplier_payments; al record; v_org uuid; v_je uuid;
begin
  select * into sp from public.supplier_payments where id = p_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform app.require_permission('supplier.pay.approve', sp.branch_id);
  if sp.status <> 'requested' then raise exception 'payment already %', sp.status using errcode = '22023'; end if;
  if sp.requested_by = auth.uid() then raise exception 'separation of duties: you cannot release a payment you requested' using errcode = '42501'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
    update public.supplier_payments set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
    where id = sp.id returning * into sp;
    return sp;
  end if;
  for al in select a.*, g.total, g.amount_paid, g.supplier_invoice_no from public.supplier_payment_allocations a
            join public.goods_receipts g on g.id = a.receipt_id where a.payment_id = sp.id order by a.receipt_id for update of g loop
    if al.amount_paid + al.amount > al.total then
      raise exception 'amount exceeds what is outstanding on %', al.supplier_invoice_no using errcode = '22023';
    end if;
    update public.goods_receipts set amount_paid = amount_paid + al.amount where id = al.receipt_id;
  end loop;
  for al in select a.*, b.amount total, b.amount_paid, b.bill_no from public.supplier_payment_allocations a
            join public.supplier_bills b on b.id = a.bill_id where a.payment_id = sp.id order by a.bill_id for update of b loop
    if al.amount_paid + al.amount > al.total then
      raise exception 'amount exceeds what is outstanding on %', al.bill_no using errcode = '22023';
    end if;
    update public.supplier_bills set amount_paid = amount_paid + al.amount where id = al.bill_id;
  end loop;
  v_org := app.org_of_branch(sp.branch_id);
  v_je := app.post_journal(v_org, sp.branch_id, app.cairo_today(), 'Supplier payment ' || sp.ref || ' (' || sp.method || ')', 'supplier_payment', sp.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'debit', sp.amount),
      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'credit', sp.amount, 'memo', sp.reference)));
  update public.supplier_payments set status = 'paid', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
         journal_entry_id = v_je
  where id = sp.id returning * into sp;
  return sp;
end $$;

-- Statement: goods receipts and bills together (kind = receipt | bill).
create or replace function public.supplier_statement(p_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_permission('purchase.read') then raise exception 'permission denied: purchase.read' using errcode = '42501'; end if;
  return (with docs as (
      select 'receipt' kind, g.id, g.ref, g.supplier_invoice_no invoice_no, g.created_at date, (g.created_at at time zone 'Africa/Cairo')::date doc_day,
             g.total, g.amount_paid paid, g.branch_id, (select ref from public.purchase_orders where id = g.po_id) po, null::text bill_kind,
             g.confirmed_at is not null confirmed, g.created_by = auth.uid() received_by_me,
             coalesce((select sum(a.amount) from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
                       where a.receipt_id = g.id and p.status = 'requested'), 0) pending
      from public.goods_receipts g where g.supplier_id = p_supplier and app.has_permission('purchase.read', g.branch_id)
      union all
      select 'bill', b.id, b.ref, b.bill_no, b.bill_date::timestamptz, b.bill_date, b.amount, b.amount_paid, b.branch_id,
             coalesce((select ref from public.lab_cases where id = b.lab_case_id), (select ref from public.maintenance_orders where id = b.maintenance_order_id)), b.kind,
             b.confirmed_at is not null, b.created_by = auth.uid(),
             coalesce((select sum(a.amount) from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
                       where a.bill_id = b.id and p.status = 'requested'), 0)
      from public.supplier_bills b where b.supplier_id = p_supplier and b.voided_at is null and app.has_permission('purchase.read', b.branch_id))
    select jsonb_build_object(
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'bill_kind', d.bill_kind, 'ref', d.ref, 'invoice_no', d.invoice_no,
          'date', d.date, 'total', d.total, 'paid', d.paid, 'outstanding', d.total - d.paid, 'pending', d.pending, 'age_days', app.cairo_today() - d.doc_day,
          'po', d.po, 'confirmed', d.confirmed, 'received_by_me', d.received_by_me) order by d.date) from docs d), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'ref', p.ref, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
          'status', p.status, 'requested_at', p.requested_at, 'decided_at', p.decided_at, 'requested_by_me', p.requested_by = auth.uid()) order by p.requested_at desc)
          from public.supplier_payments p where p.supplier_id = p_supplier and app.has_permission('purchase.read', p.branch_id)), '[]'::jsonb),
      'aging', (select jsonb_build_object(
          'd0_30',  coalesce(sum(d.total - d.paid) filter (where app.cairo_today() - d.doc_day <= 30), 0),
          'd31_60', coalesce(sum(d.total - d.paid) filter (where app.cairo_today() - d.doc_day between 31 and 60), 0),
          'd61_90', coalesce(sum(d.total - d.paid) filter (where app.cairo_today() - d.doc_day between 61 and 90), 0),
          'd90p',   coalesce(sum(d.total - d.paid) filter (where app.cairo_today() - d.doc_day > 90), 0)) from docs d)));
end $$;

-- Supplier balances for the list page (receipts + bills).
create or replace function public.supplier_balances()
returns table (supplier_id uuid, total numeric, paid numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select x.supplier_id, sum(x.total), sum(x.paid) from (
    select supplier_id, total, amount_paid paid, branch_id from public.goods_receipts
    union all select supplier_id, amount, amount_paid, branch_id from public.supplier_bills where voided_at is null) x
  where app.has_permission('purchase.read', x.branch_id)
  group by x.supplier_id
$$;

-- ---------------------------------------------------------------------------
-- Doctor contracts: optional share of lab costs, deducted in settlements
-- ---------------------------------------------------------------------------
alter table public.doctor_contracts add column lab_cost_percent numeric(5,2) not null default 0 check (lab_cost_percent between 0 and 100);
drop function public.save_doctor_contract(uuid, date, numeric, jsonb, text);
create or replace function public.save_doctor_contract(p_doctor uuid, p_from date, p_default_percent numeric, p_rates jsonb, p_notes text default null,
                                                       p_lab_cost_percent numeric default 0)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.staff; v_id uuid; prev public.doctor_contracts; r jsonb;
begin
  select * into d from public.staff where id = p_doctor and kind = 'doctor';
  if not found then raise exception 'doctor not found' using errcode = 'P0002'; end if;
  perform app.require_permission('contract.manage', d.branch_id);
  if p_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if coalesce(p_lab_cost_percent, 0) not between 0 and 100 then raise exception 'lab cost share must be 0 to 100' using errcode = '22023'; end if;
  if exists (select 1 from public.settlement_runs where doctor_id = d.id and status in ('approved', 'paid') and upper(period) > p_from) then
    raise exception 'a settlement for this period is already approved; the new contract must start after it' using errcode = '22023';
  end if;
  select * into prev from public.doctor_contracts where doctor_id = d.id and valid @> p_from;
  if found then
    if lower(prev.valid) = p_from then raise exception 'a contract already starts on this date' using errcode = '22023'; end if;
    update public.doctor_contracts set valid = daterange(lower(valid), p_from) where id = prev.id;
  end if;
  insert into public.doctor_contracts (doctor_id, valid, default_percent, notes, lab_cost_percent)
  values (d.id, daterange(p_from, null), p_default_percent, nullif(trim(p_notes), ''), round(coalesce(p_lab_cost_percent, 0), 2)) returning id into v_id;
  update public.settlement_runs set stale = true where doctor_id = d.id and status = 'draft' and upper(period) > p_from;
  for r in select * from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) loop
    insert into public.doctor_contract_rates (contract_id, service_id, percent, fixed_amount)
    values (v_id, (r->>'service_id')::uuid, nullif(r->>'percent', '')::numeric, nullif(r->>'fixed_amount', '')::numeric);
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_doctor_contract(uuid, date, numeric, jsonb, text, numeric) from public, anon;
grant execute on function public.save_doctor_contract(uuid, date, numeric, jsonb, text, numeric) to authenticated;

alter table public.settlement_lines drop constraint settlement_lines_kind_check;
alter table public.settlement_lines add constraint settlement_lines_kind_check check (kind in ('service', 'package_session', 'void_reversal', 'refund', 'lab_cost', 'carry'));
alter table public.settlement_lines add column bill_id uuid references public.supplier_bills(id);
create unique index settlement_bill_once on public.settlement_lines (bill_id, kind) where active and bill_id is not null;

-- Settlement preparation: as in 0017, plus the lab cost share (step 3b).
create or replace function public.prepare_settlement(p_doctor uuid, p_month date)
returns public.settlement_runs language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.staff; run public.settlement_runs; v_from date := date_trunc('month', p_month)::date; v_period daterange;
begin
  select * into d from public.staff where id = p_doctor and kind = 'doctor';
  if not found then raise exception 'doctor not found' using errcode = 'P0002'; end if;
  perform app.require_permission('settlement.prepare', d.branch_id);
  if v_from > date_trunc('month', (now() at time zone 'Africa/Cairo'))::date then
    raise exception 'cannot settle a future month' using errcode = '22023';
  end if;
  v_period := daterange(v_from, (v_from + interval '1 month')::date);
  insert into public.settlement_runs (doctor_id, branch_id, period) values (d.id, d.branch_id, v_period) returning * into run;

  -- 1) Services on invoices issued in the month (net of line discounts), not settled before.
  insert into public.settlement_lines (run_id, doctor_id, kind, invoice_id, invoice_no, invoice_line_id, service_id, on_date, base, percent, fixed_amount, amount, no_contract)
  select run.id, d.id, 'service', i.id, i.invoice_no, l.id, l.service_id, (i.issued_at at time zone 'Africa/Cairo')::date, l.line_total,
         rt.percent, rt.fixed_amount, rt.amount, not rt.has_contract
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  cross join lateral app.settlement_rate(d.id, l.service_id, (i.issued_at at time zone 'Africa/Cairo')::date, l.line_total, l.quantity) rt
  where l.doctor_id = d.id and i.status in ('issued', 'partially_paid', 'paid')
    and (i.issued_at at time zone 'Africa/Cairo')::date < upper(v_period)          -- catch-up: nothing is ever skipped
    and not exists (select 1 from public.settlement_lines s where s.invoice_line_id = l.id and s.kind = 'service' and s.active);

  -- 1b) Package sessions redeemed (base = the unit value recognised as revenue).
  insert into public.settlement_lines (run_id, doctor_id, kind, redemption_id, invoice_no, service_id, on_date, base, percent, fixed_amount, amount, no_contract)
  select run.id, d.id, 'package_session', r.id, ls.ref, r.service_id, r.on_date, r.value, rt.percent, rt.fixed_amount, rt.amount, not rt.has_contract
  from public.package_redemptions r join public.laser_sessions ls on ls.id = r.session_id
  cross join lateral app.settlement_rate(d.id, r.service_id, r.on_date, r.value, 1) rt
  where r.doctor_id = d.id and r.on_date < upper(v_period)
    and not exists (select 1 from public.settlement_lines s where s.redemption_id = r.id and s.active);

  -- 2) Invoices voided after their lines were settled in an approved/paid run: take the share back.
  insert into public.settlement_lines (run_id, doctor_id, kind, invoice_id, invoice_no, invoice_line_id, service_id, on_date, base, percent, fixed_amount, amount)
  select run.id, d.id, 'void_reversal', s.invoice_id, s.invoice_no, s.invoice_line_id, s.service_id, (i.voided_at at time zone 'Africa/Cairo')::date,
         -s.base, s.percent, s.fixed_amount, -s.amount
  from public.settlement_lines s join public.settlement_runs r on r.id = s.run_id join public.invoices i on i.id = s.invoice_id
  where s.doctor_id = d.id and s.kind = 'service' and s.active and r.status in ('approved', 'paid') and i.status = 'void'
    and (i.voided_at at time zone 'Africa/Cairo')::date < upper(v_period)
    and not exists (select 1 from public.settlement_lines x where x.invoice_line_id = s.invoice_line_id and x.kind = 'void_reversal' and x.active);

  -- 3) Refunds paid in the month: deduct the doctor's proportional share of each refunded invoice.
  insert into public.settlement_lines (run_id, doctor_id, kind, invoice_id, invoice_no, refund_id, on_date, base, amount)
  select run.id, d.id, 'refund', f.invoice_id, i.invoice_no, f.id, (f.paid_at at time zone 'Africa/Cairo')::date, -f.amount,
         -round(f.amount / nullif(i.total, 0) * sh.share, 2)
  from public.refunds f join public.invoices i on i.id = f.invoice_id
  cross join lateral (
    select coalesce(sum(rt.amount), 0) share
    from public.invoice_lines l
    cross join lateral app.settlement_rate(d.id, l.service_id, (i.issued_at at time zone 'Africa/Cairo')::date, l.line_total, l.quantity) rt
    where l.invoice_id = i.id and l.doctor_id = d.id) sh
  where f.status = 'paid' and (f.paid_at at time zone 'Africa/Cairo')::date < upper(v_period) and sh.share > 0 and i.total > 0
    and not exists (select 1 from public.settlement_lines x where x.refund_id = f.id and x.doctor_id = d.id and x.active);

  -- 3b) The doctor's contractual share of dental lab bills (base = the bill, amount = −bill × share %).
  insert into public.settlement_lines (run_id, doctor_id, kind, bill_id, invoice_no, service_id, on_date, base, percent, amount)
  select run.id, d.id, 'lab_cost', b.id, c.ref, c.service_id, b.bill_date, -b.amount, k.lab_cost_percent, -round(b.amount * k.lab_cost_percent / 100, 2)
  from public.supplier_bills b join public.lab_cases c on c.id = b.lab_case_id
  join public.doctor_contracts k on k.doctor_id = d.id and k.valid @> b.bill_date
  where b.kind = 'lab' and c.doctor_id = d.id and b.bill_date < upper(v_period) and k.lab_cost_percent > 0
    and b.confirmed_at is not null and b.voided_at is null
    and not exists (select 1 from public.settlement_lines x where x.bill_id = b.id and x.kind = 'lab_cost' and x.active);

  -- 3c) A lab bill voided after its share was settled in an approved/paid run: give the share back.
  insert into public.settlement_lines (run_id, doctor_id, kind, bill_id, invoice_no, service_id, on_date, base, percent, amount)
  select run.id, d.id, 'void_reversal', s.bill_id, s.invoice_no, s.service_id, (b.voided_at at time zone 'Africa/Cairo')::date, -s.base, s.percent, -s.amount
  from public.settlement_lines s join public.settlement_runs r on r.id = s.run_id join public.supplier_bills b on b.id = s.bill_id
  where s.doctor_id = d.id and s.kind = 'lab_cost' and s.active and r.status in ('approved', 'paid') and b.voided_at is not null
    and (b.voided_at at time zone 'Africa/Cairo')::date < upper(v_period)
    and not exists (select 1 from public.settlement_lines x where x.bill_id = s.bill_id and x.kind = 'void_reversal' and x.active);

  -- 4) Negative balances of earlier approved runs are carried into this one.
  insert into public.settlement_lines (run_id, doctor_id, kind, carry_from_run, on_date, base, amount)
  select run.id, d.id, 'carry', p.id, lower(p.period), p.amount, p.amount
  from public.settlement_runs p
  where p.doctor_id = d.id and p.status = 'approved' and p.amount < 0 and p.carried_to is null and p.id <> run.id;
  update public.settlement_runs set carried_to = run.id
  where doctor_id = d.id and status = 'approved' and amount < 0 and carried_to is null and id <> run.id;

  update public.settlement_runs r set
    gross_base = coalesce((select sum(base) from public.settlement_lines where run_id = r.id and kind in ('service', 'package_session')), 0),
    deductions = coalesce((select -sum(amount) from public.settlement_lines where run_id = r.id and kind in ('void_reversal', 'refund', 'lab_cost')), 0),
    carried_in = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id and kind = 'carry'), 0),
    amount = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id), 0),
    lines_without_contract = (select count(*) from public.settlement_lines where run_id = r.id and no_contract)
  where r.id = run.id returning * into run;
  return run;
end $$;

-- Profitability: as in 0017, plus dental lab costs per service and doctor (return type changes → drop first).
drop function public.report_profitability(date, date, uuid);
create or replace function public.report_profitability(p_from date, p_to date, p_branch uuid default null)
returns table (service_id uuid, service_code text, service_ar text, service_en text, doctor_id uuid, doctor_ar text, doctor_en text,
               units numeric, gross numeric, discounts numeric, refunds numeric, net_revenue numeric, doctor_share numeric,
               consumables numeric, lab_costs numeric, margin numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with br as (      -- permission evaluated once per branch, not per row
    select b.id from public.branches b where (p_branch is null or b.id = p_branch) and app.has_permission('reports.finance', b.id)
  ), inv as (
    select i.* from public.invoices i
    where i.status in ('issued', 'partially_paid', 'paid') and i.branch_id in (select id from br)
      and (i.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), inv_ref as (   -- refunds paid up to the end of the period (report is reproducible for past periods)
    select r.invoice_id, sum(r.amount) amt from public.refunds r
    where r.status = 'paid' and (r.paid_at at time zone 'Africa/Cairo')::date <= p_to and r.invoice_id in (select id from inv)
    group by r.invoice_id
  ), lines as (     -- invoice lines (package sales excluded) + redeemed package sessions
    select l.service_id, l.doctor_id, l.quantity, l.line_gross, l.discount, l.line_total, i.total inv_total, i.appointment_id,
           (i.issued_at at time zone 'Africa/Cairo')::date issued_on, coalesce(ir.amt, 0) inv_refunds
    from public.invoice_lines l join inv i on i.id = l.invoice_id left join inv_ref ir on ir.invoice_id = i.id
    join public.services s on s.id = l.service_id and not s.is_package
    union all
    select r.service_id, r.doctor_id, 1, r.value, 0, r.value, 0, r.appointment_id, r.on_date, 0
    from public.package_redemptions r
    where r.branch_id in (select id from br) and r.on_date between p_from and p_to
  ), apt_net as (   -- everything billed or redeemed for the appointment, whatever its date, so cost is never allocated twice
    select x.appointment_id, sum(x.v) net from (
      select i.appointment_id, l.line_total v from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
        join public.services s on s.id = l.service_id and not s.is_package
      where i.status in ('issued', 'partially_paid', 'paid') and i.appointment_id in (select appointment_id from lines where appointment_id is not null)
      union all
      select r.appointment_id, r.value from public.package_redemptions r where r.appointment_id in (select appointment_id from lines where appointment_id is not null)
    ) x group by x.appointment_id
  ), apt_cost as (
    select s.appointment_id, sum(s.total_cost) cost from public.stock_issues s
    where s.appointment_id in (select appointment_id from apt_net) group by s.appointment_id
  ), calc as (
    select l.service_id, l.doctor_id, l.quantity, l.line_gross, l.discount, l.line_total,
           case when l.inv_total > 0 then round(least(l.inv_refunds, l.inv_total) * l.line_total / l.inv_total, 2) else 0 end refund_part,
           case when l.doctor_id is null then 0
                else round((select rt.amount from app.settlement_rate(l.doctor_id, l.service_id, l.issued_on, l.line_total, l.quantity) rt)
                           * (1 - case when l.inv_total > 0 then least(l.inv_refunds / l.inv_total, 1) else 0 end), 2) end share,
           case when an.net > 0 then round(coalesce(ac.cost, 0) * l.line_total / an.net, 2) else 0 end cons
    from lines l left join apt_net an on an.appointment_id = l.appointment_id left join apt_cost ac on ac.appointment_id = l.appointment_id
  ), lab as (       -- dental lab bills in the period, attributed to the case's service and doctor; the doctor's
                    -- contractual share of the lab cost reduces their estimated share (it is deducted in settlement)
    select c.service_id, c.doctor_id, sum(b.amount) lab,
           sum(round(b.amount * coalesce((select k.lab_cost_percent from public.doctor_contracts k where k.doctor_id = c.doctor_id and k.valid @> b.bill_date), 0) / 100, 2)) lab_share
    from public.supplier_bills b join public.lab_cases c on c.id = b.lab_case_id
    where b.kind = 'lab' and b.voided_at is null and b.branch_id in (select id from br) and b.bill_date between p_from and p_to
    group by c.service_id, c.doctor_id
  ), rows as (
    select service_id, doctor_id, quantity, line_gross, discount, refund_part, line_total, share, cons, 0::numeric lab from calc
    union all
    select service_id, doctor_id, 0, 0, 0, 0, 0, -lab_share, 0, lab from lab
  )
  select c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, coalesce(st.full_name_en, st.full_name_ar),
         sum(c.quantity), sum(c.line_gross), sum(c.discount), sum(c.refund_part), sum(c.line_total - c.refund_part),
         sum(c.share), sum(c.cons), sum(c.lab), sum(c.line_total - c.refund_part - c.share - c.cons - c.lab)
  from rows c join public.services s on s.id = c.service_id left join public.staff st on st.id = c.doctor_id
  group by c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, st.full_name_en
  order by sum(c.line_total - c.refund_part - c.share - c.cons - c.lab) desc
$$;
grant execute on function public.report_profitability(date, date, uuid) to authenticated;
revoke execute on function public.report_profitability(date, date, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.treatment_plans enable row level security;
alter table public.treatment_plan_items enable row level security;
alter table public.plan_installments enable row level security;
alter table public.patient_deposits enable row level security;
alter table public.deposit_refunds enable row level security;
alter table public.lab_cases enable row level security;
alter table public.lab_case_events enable row level security;
alter table public.supplier_bills enable row level security;

create or replace function app.can_read_plan(p_patient uuid, p_branch uuid, p_doctor uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_doctor = app.current_staff_id() or app.can_read_clinical(p_patient, p_branch)
      or app.has_permission('plan.accept', p_branch) or app.has_permission('billing.read', p_branch)
$$;
create policy plans_read on public.treatment_plans for select to authenticated using (app.can_read_plan(patient_id, branch_id, doctor_id));
create policy plan_items_read on public.treatment_plan_items for select to authenticated
  using (exists (select 1 from public.treatment_plans p where p.id = plan_id));
create policy installments_read on public.plan_installments for select to authenticated
  using (exists (select 1 from public.treatment_plans p where p.id = plan_id));
create policy deposits_read on public.patient_deposits for select to authenticated
  using (app.has_permission('billing.read', branch_id) or app.has_permission('payment.collect', branch_id) or app.has_permission('plan.accept', branch_id));
create policy deposit_refunds_read on public.deposit_refunds for select to authenticated
  using (app.has_permission('billing.read', branch_id) or app.has_permission('refund.request', branch_id) or app.has_permission('refund.approve', branch_id)
         or app.has_permission('payment.collect', branch_id));
-- Lab cases: the case's doctor, clinical readers, lab coordinators who are not doctors, and finance staff who
-- record the lab bills — not every doctor in the branch.
create or replace function app.can_read_lab_case(p_doctor uuid, p_patient uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_doctor = app.current_staff_id() or app.can_read_clinical(p_patient, p_branch)
      or (app.has_permission('lab.read', p_branch) and not exists (select 1 from public.staff where id = app.current_staff_id() and kind = 'doctor'))
$$;
create policy lab_cases_read on public.lab_cases for select to authenticated
  using (app.can_read_lab_case(doctor_id, patient_id, branch_id));
create policy lab_events_read on public.lab_case_events for select to authenticated
  using (exists (select 1 from public.lab_cases c where c.id = case_id));
create policy supplier_bills_read on public.supplier_bills for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('supplier.bill.record', branch_id));

grant select on public.treatment_plans, public.treatment_plan_items, public.plan_installments, public.patient_deposits, public.deposit_refunds,
  public.lab_cases, public.lab_case_events, public.supplier_bills to authenticated;
grant all on public.treatment_plans, public.treatment_plan_items, public.plan_installments, public.patient_deposits, public.deposit_refunds,
  public.lab_cases, public.lab_case_events, public.supplier_bills to service_role;

-- Advance balance for one patient (staff who see deposits).
create or replace function public.patient_advance(p_patient uuid)
returns table (balance numeric, available numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.advance_balance(p_patient), app.advance_available(p_patient)
  where exists (select 1 from public.patients p where p.id = p_patient
                and (app.has_permission('billing.read', p.branch_id) or app.has_permission('payment.collect', p.branch_id)
                     or app.has_permission('plan.accept', p.branch_id)))
$$;

revoke execute on function public.save_treatment_plan(jsonb), public.propose_plan(uuid, int), public.revise_plan(uuid), public.accept_plan(uuid, text, jsonb, text),
  public.cancel_plan(uuid, text), public.complete_plan_item(uuid, uuid, text), public.cancel_plan_item(uuid, text),
  public.record_deposit(uuid, uuid, numeric, text, text, text, uuid), public.apply_advance(uuid, numeric, text),
  public.request_deposit_refund(uuid, uuid, numeric, text, text), public.decide_deposit_refund(uuid, boolean, text), public.pay_deposit_refund(uuid, text),
  public.bill_plan_items(uuid, uuid), public.overdue_installments(uuid), public.create_lab_case(jsonb), public.lab_case_set_status(uuid, text, text),
  public.record_supplier_bill(jsonb), public.confirm_supplier_bill(uuid), public.supplier_balances(), public.patient_advance(uuid), public.void_supplier_bill(uuid, text) from public, anon;
grant execute on function public.save_treatment_plan(jsonb), public.propose_plan(uuid, int), public.revise_plan(uuid), public.accept_plan(uuid, text, jsonb, text),
  public.cancel_plan(uuid, text), public.complete_plan_item(uuid, uuid, text), public.cancel_plan_item(uuid, text),
  public.record_deposit(uuid, uuid, numeric, text, text, text, uuid), public.apply_advance(uuid, numeric, text),
  public.request_deposit_refund(uuid, uuid, numeric, text, text), public.decide_deposit_refund(uuid, boolean, text), public.pay_deposit_refund(uuid, text),
  public.bill_plan_items(uuid, uuid), public.overdue_installments(uuid), public.create_lab_case(jsonb), public.lab_case_set_status(uuid, text, text),
  public.record_supplier_bill(jsonb), public.confirm_supplier_bill(uuid), public.supplier_balances(), public.patient_advance(uuid), public.void_supplier_bill(uuid, text) to authenticated;
