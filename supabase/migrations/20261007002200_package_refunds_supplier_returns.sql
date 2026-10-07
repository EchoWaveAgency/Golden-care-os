-- Golden Care OS — 0022 Package refunds and transfers; returns to suppliers
-- Package refund: the unused deferred value is returned less an administration fee the clinic keeps (fee policy is
-- the clinic's: entered per request, logged in OPEN_QUESTIONS). Requested → approved by someone else → paid.
--   Dr deferred package revenue (unused value) / Cr payment method (refund) / Cr package breakage (fee kept).
-- Package transfer: remaining sessions move to another patient (deferred balance moves with them, per patient).
-- Supplier return: goods leave stock at their lot cost and reduce what is owed on that delivery.
--   Dr suppliers payable / Cr inventory. Recorded by the store, approved by a purchasing approver.

-- ---------------------------------------------------------------------------
-- Package refunds and transfers
-- ---------------------------------------------------------------------------
alter table public.patient_packages drop constraint if exists patient_packages_status_check;
alter table public.patient_packages add constraint patient_packages_status_check
  check (status in ('active', 'used', 'expired', 'cancelled', 'refunded'));

create table public.package_refunds (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('PRF'),
  package_id       uuid not null references public.patient_packages(id),
  patient_id       uuid not null references public.patients(id),
  branch_id        uuid not null references public.branches(id),
  unused_value     numeric(14,2) not null check (unused_value > 0),
  fee              numeric(14,2) not null default 0 check (fee >= 0),
  amount           numeric(14,2) not null check (amount >= 0),
  method           text not null references public.payment_methods(code),
  reason           text not null check (length(trim(reason)) >= 3),
  status           text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'paid', 'cancelled')),
  requested_by     uuid not null default auth.uid(),
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  paid_by          uuid references auth.users(id),
  paid_at          timestamptz,
  reference        text,
  cashier_session_id uuid references public.cashier_sessions(id),
  journal_entry_id uuid references public.journal_entries(id),
  check (amount + fee = unused_value)
);
create unique index package_refunds_open_uq on public.package_refunds (package_id) where status in ('requested', 'approved');
create trigger trg_audit_package_refunds after insert or update on public.package_refunds for each row execute function app.audit_row();

create table public.package_transfers (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('PTR'),
  package_id       uuid not null references public.patient_packages(id),
  from_patient     uuid not null references public.patients(id),
  to_patient       uuid not null references public.patients(id),
  units            int not null check (units > 0),
  value            numeric(14,2) not null check (value >= 0),
  reason           text not null check (length(trim(reason)) >= 3),
  transferred_by   uuid not null default auth.uid(),
  journal_entry_id uuid references public.journal_entries(id),
  created_at       timestamptz not null default now(),
  check (from_patient <> to_patient)
);
create trigger trg_audit_package_transfers after insert on public.package_transfers for each row execute function app.audit_row();

-- No session may be redeemed while a refund of the package is open.
create or replace function app.package_refund_hold()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.units_used > old.units_used and exists (select 1 from public.package_refunds where package_id = new.id and status in ('requested', 'approved')) then
    raise exception 'a refund of this package is in progress — no sessions can be used' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_package_refund_hold before update on public.patient_packages for each row execute function app.package_refund_hold();

create or replace function public.request_package_refund(p_package uuid, p_fee numeric, p_method text, p_reason text)
returns public.package_refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare pk public.patient_packages; i public.invoices; r public.package_refunds; v_unused numeric;
begin
  select * into pk from public.patient_packages where id = p_package for update;
  if not found then raise exception 'package not found' using errcode = 'P0002'; end if;
  perform app.require_permission('refund.request', pk.branch_id);
  if pk.status <> 'active' then raise exception 'only an active package can be refunded (this one is %)', pk.status using errcode = '22023'; end if;
  select * into i from public.invoices where id = pk.invoice_id;
  if i.status <> 'paid' then raise exception 'the package invoice is not fully paid — void the unused package instead' using errcode = '22023'; end if;
  if p_method in ('advance', 'online') or not exists (select 1 from public.payment_methods where code = p_method and is_active) then
    raise exception 'refunds are paid in cash, card, transfer or wallet' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  v_unused := pk.value_total - pk.value_used;
  if v_unused <= 0 then raise exception 'nothing left to refund' using errcode = '22023'; end if;
  if coalesce(p_fee, 0) < 0 or coalesce(p_fee, 0) > v_unused then raise exception 'the fee must be between 0 and the unused value (%)', v_unused using errcode = '22023'; end if;
  insert into public.package_refunds (package_id, patient_id, branch_id, unused_value, fee, amount, method, reason)
  values (pk.id, pk.patient_id, pk.branch_id, v_unused, round(coalesce(p_fee, 0), 2), v_unused - round(coalesce(p_fee, 0), 2), p_method, trim(p_reason))
  returning * into r;
  return r;
end $$;

create or replace function public.decide_package_refund(p_refund uuid, p_approve boolean, p_note text default null)
returns public.package_refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.package_refunds;
begin
  select * into r from public.package_refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('refund.approve', r.branch_id);
  if r.status <> 'requested' then raise exception 'refund already %', r.status using errcode = '22023'; end if;
  if r.requested_by = auth.uid() then raise exception 'separation of duties: you cannot approve your own refund request' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
  update public.package_refunds set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(trim(p_note), '') where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.pay_package_refund(p_refund uuid, p_reference text default null)
returns public.package_refunds language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.package_refunds; pk public.patient_packages; m public.payment_methods; v_org uuid; v_session uuid; v_unused numeric;
begin
  select * into r from public.package_refunds where id = p_refund for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', r.branch_id);
  if r.status = 'paid' then return r; end if;
  if r.status <> 'approved' then raise exception 'refund must be approved before payment' using errcode = '22023'; end if;
  select * into pk from public.patient_packages where id = r.package_id for update;
  v_unused := pk.value_total - pk.value_used;
  if pk.status <> 'active' or v_unused <> r.unused_value then
    raise exception 'the package changed since the request — reject it and request again' using errcode = '22023';
  end if;
  select * into m from public.payment_methods where code = r.method;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then raise exception 'payment method % requires a reference number', r.method using errcode = '22023'; end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions where cashier_id = auth.uid() and branch_id = r.branch_id and status = 'open' for update;
    if v_session is null then raise exception 'open a cashier session before paying cash' using errcode = '22023'; end if;
  end if;
  v_org := app.org_of_branch(r.branch_id);
  perform set_config('app.package_rpc', 'on', true);
  update public.package_refunds set status = 'paid', paid_by = auth.uid(), paid_at = now(), reference = nullif(trim(p_reference), ''), cashier_session_id = v_session,
    journal_entry_id = app.post_journal(v_org, r.branch_id, app.cairo_today(), 'Package refund ' || r.ref || ' (' || pk.ref || ')', 'package_refund', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'debit', r.unused_value, 'patient_id', r.patient_id, 'memo', pk.ref),
        jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'credit', r.amount, 'patient_id', r.patient_id, 'memo', coalesce(nullif(trim(p_reference), ''), r.method)),
        jsonb_build_object('account_id', app.account_for(v_org, 'package_breakage'), 'credit', r.fee, 'patient_id', r.patient_id, 'memo', 'refund fee')))
  where id = r.id returning * into r;
  update public.patient_packages set status = 'refunded', closed_at = now() where id = pk.id;
  return r;
end $$;

create or replace function public.transfer_package(p_package uuid, p_to_patient uuid, p_reason text)
returns public.package_transfers language plpgsql security definer set search_path = public, app, pg_temp as $$
declare pk public.patient_packages; t public.package_transfers; v_org uuid; v_value numeric;
begin
  select * into pk from public.patient_packages where id = p_package for update;
  if not found then raise exception 'package not found' using errcode = 'P0002'; end if;
  perform app.require_permission('package.manage', pk.branch_id);
  if pk.status <> 'active' then raise exception 'only an active package can be transferred' using errcode = '22023'; end if;
  if (select status from public.invoices where id = pk.invoice_id) <> 'paid' then raise exception 'the package invoice is not fully paid' using errcode = '22023'; end if;
  if exists (select 1 from public.package_refunds where package_id = pk.id and status in ('requested', 'approved')) then
    raise exception 'a refund of this package is in progress' using errcode = '22023';
  end if;
  if p_to_patient = pk.patient_id then raise exception 'choose another patient' using errcode = '22023'; end if;
  if not exists (select 1 from public.patients where id = p_to_patient and merged_into is null) then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  v_value := pk.value_total - pk.value_used;
  v_org := app.org_of_branch(pk.branch_id);
  insert into public.package_transfers (package_id, from_patient, to_patient, units, value, reason)
  values (pk.id, pk.patient_id, p_to_patient, pk.units_total - pk.units_used, v_value, trim(p_reason)) returning * into t;
  update public.package_transfers set journal_entry_id = case when v_value > 0 then
    app.post_journal(v_org, pk.branch_id, app.cairo_today(), 'Package transfer ' || t.ref || ' (' || pk.ref || ')', 'package_transfer', t.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'debit', v_value, 'patient_id', pk.patient_id, 'memo', 'transfer out'),
        jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'credit', v_value, 'patient_id', p_to_patient, 'memo', 'transfer in'))) end
  where id = t.id returning * into t;
  perform set_config('app.package_rpc', 'on', true);
  update public.patient_packages set patient_id = p_to_patient where id = pk.id;
  return t;
end $$;

-- Transfer by the receiving patient's file number (staff may not be able to read patient records).
create or replace function public.transfer_package_to_mrn(p_package uuid, p_mrn text, p_reason text)
returns public.package_transfers language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v uuid;
begin
  select id into v from public.patients where mrn = upper(trim(p_mrn)) and merged_into is null;
  if v is null then raise exception 'patient not found' using errcode = 'P0002'; end if;
  return public.transfer_package(p_package, v, p_reason);
end $$;

-- Refunds of a package invoice still go through the package refund (the generic guard stays, with a clearer message).
create or replace function app.package_refund_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.patient_packages where invoice_id = new.invoice_id) then
    raise exception 'use the package refund for package invoices' using errcode = '22023';
  end if;
  return new;
end $$;

-- Cash drawer: package refunds paid in cash leave the drawer too.
create or replace function app.session_expected_cash(p_session uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select s.opening_float
    + coalesce((select sum(amount) from public.payments where cashier_session_id = s.id and status = 'posted'), 0)
    - coalesce((select sum(amount) from public.refunds where cashier_session_id = s.id and status = 'paid'), 0)
    + coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'deposit'), 0)
    - coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'refund'), 0)
    - coalesce((select sum(amount) from public.package_refunds where cashier_session_id = s.id and status = 'paid'), 0)
  from public.cashier_sessions s where s.id = p_session
$$;

-- ---------------------------------------------------------------------------
-- Returns to suppliers
-- ---------------------------------------------------------------------------
alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check check (kind in ('receipt', 'issue', 'count_adjust', 'supplier_return'));
alter table public.goods_receipts add column if not exists returned_amount numeric(14,2) not null default 0;

create table public.supplier_returns (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('SRN'),
  branch_id        uuid not null references public.branches(id),
  supplier_id      uuid not null references public.suppliers(id),
  receipt_id       uuid not null references public.goods_receipts(id),
  reason           text not null check (length(trim(reason)) >= 3),
  status           text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  total            numeric(14,2),
  requested_by     uuid not null default auth.uid(),
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  journal_entry_id uuid references public.journal_entries(id)
);
create trigger trg_audit_supplier_returns after insert or update on public.supplier_returns for each row execute function app.audit_row();
create table public.supplier_return_lines (
  id        uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.supplier_returns(id),
  lot_id    uuid not null references public.inv_lots(id),
  item_id   uuid not null references public.inv_items(id),
  qty       numeric(14,3) not null check (qty > 0),
  value     numeric(14,2)
);

create or replace function public.request_supplier_return(p_receipt uuid, p_lines jsonb, p_reason text)
returns public.supplier_returns language plpgsql security definer set search_path = public, app, pg_temp as $$
declare gr public.goods_receipts; r public.supplier_returns; l jsonb; lot public.inv_lots; n int := 0;
begin
  select * into gr from public.goods_receipts where id = p_receipt;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.receive', gr.branch_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if exists (select 1 from public.supplier_returns where receipt_id = gr.id and status = 'requested') then
    raise exception 'a return for this receipt is already waiting for approval' using errcode = '22023';
  end if;
  insert into public.supplier_returns (branch_id, supplier_id, receipt_id, reason) values (gr.branch_id, gr.supplier_id, gr.id, trim(p_reason)) returning * into r;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    continue when coalesce(nullif(l->>'qty', '')::numeric, 0) = 0;
    select * into lot from public.inv_lots where id = (l->>'lot_id')::uuid;
    if not found or lot.receipt_id is distinct from gr.id then raise exception 'the lot was not received on this receipt' using errcode = '22023'; end if;
    if (l->>'qty')::numeric < 0 or (l->>'qty')::numeric > lot.qty_on_hand then
      raise exception 'return quantity must be between 0 and what is in stock (%)', lot.qty_on_hand using errcode = '22023';
    end if;
    insert into public.supplier_return_lines (return_id, lot_id, item_id, qty) values (r.id, lot.id, lot.item_id, (l->>'qty')::numeric);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'enter a quantity to return' using errcode = '22023'; end if;
  return r;
end $$;

create or replace function public.decide_supplier_return(p_return uuid, p_approve boolean, p_note text default null)
returns public.supplier_returns language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.supplier_returns; gr public.goods_receipts; l record; lot public.inv_lots; v_value numeric; v_total numeric := 0; v_org uuid;
begin
  select * into r from public.supplier_returns where id = p_return for update;
  if not found then raise exception 'return not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.approve', r.branch_id);
  if r.status <> 'requested' then raise exception 'return already %', r.status using errcode = '22023'; end if;
  if r.requested_by = auth.uid() then raise exception 'separation of duties: you cannot approve a return you recorded' using errcode = '42501'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'a note is required to reject' using errcode = '22023'; end if;
    update public.supplier_returns set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = r.id returning * into r;
    return r;
  end if;
  select * into gr from public.goods_receipts where id = r.receipt_id for update;
  perform set_config('app.inventory_rpc', 'on', true);
  for l in select * from public.supplier_return_lines where return_id = r.id order by id loop
    select * into lot from public.inv_lots where id = l.lot_id for update;
    if l.qty > lot.qty_on_hand then raise exception 'only % left in lot % — reject and record the return again', lot.qty_on_hand, lot.lot_no using errcode = '22023'; end if;
    v_value := case when l.qty = lot.qty_on_hand then lot.value_remaining else round(l.qty * lot.unit_cost, 2) end;
    update public.inv_lots set qty_on_hand = qty_on_hand - l.qty, value_remaining = value_remaining - v_value where id = lot.id;
    insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id)
    values (lot.id, lot.item_id, lot.location_id, 'supplier_return', -l.qty, lot.unit_cost, -v_value, 'supplier_return', r.id);
    update public.supplier_return_lines set value = v_value where id = l.id;
    v_total := v_total + v_value;
  end loop;
  -- The return settles the delivery's unpaid balance; a delivery already paid needs the supplier's refund instead.
  if gr.total - gr.amount_paid - gr.returned_amount < v_total then
    raise exception 'the delivery has only % unpaid — record the supplier''s cash refund separately', gr.total - gr.amount_paid - gr.returned_amount using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
             where a.receipt_id = gr.id and p.status = 'requested'
               and gr.total - gr.amount_paid - gr.returned_amount - a.amount < v_total) then
    raise exception 'a pending supplier payment covers this delivery — decide it first' using errcode = '22023';
  end if;
  v_org := app.org_of_branch(r.branch_id);
  update public.goods_receipts set returned_amount = returned_amount + v_total, amount_paid = amount_paid + v_total where id = gr.id;
  update public.supplier_returns set status = 'approved', total = v_total, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
    journal_entry_id = app.post_journal(v_org, r.branch_id, app.cairo_today(), 'Return to supplier ' || r.ref || ' (' || gr.supplier_invoice_no || ')', 'supplier_return', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'debit', v_total, 'memo', gr.supplier_invoice_no),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_total, 'memo', r.ref)))
  where id = r.id returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.package_refunds enable row level security;
alter table public.package_transfers enable row level security;
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_lines enable row level security;
create policy package_refunds_read on public.package_refunds for select to authenticated
  using (app.has_permission('refund.request', branch_id) or app.has_permission('refund.approve', branch_id) or app.has_permission('payment.collect', branch_id)
         or app.has_permission('billing.read', branch_id));
create policy package_transfers_read on public.package_transfers for select to authenticated
  using (exists (select 1 from public.patient_packages p where p.id = package_id and app.has_permission('package.read', p.branch_id)));
create policy supplier_returns_read on public.supplier_returns for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('inventory.receive', branch_id));
create policy supplier_return_lines_read on public.supplier_return_lines for select to authenticated
  using (exists (select 1 from public.supplier_returns r where r.id = return_id and (app.has_permission('purchase.read', r.branch_id) or app.has_permission('inventory.receive', r.branch_id))));
grant select on public.package_refunds, public.package_transfers, public.supplier_returns, public.supplier_return_lines to authenticated;

revoke execute on function public.request_package_refund(uuid, numeric, text, text), public.decide_package_refund(uuid, boolean, text),
  public.pay_package_refund(uuid, text), public.transfer_package(uuid, uuid, text), public.transfer_package_to_mrn(uuid, text, text), public.request_supplier_return(uuid, jsonb, text),
  public.decide_supplier_return(uuid, boolean, text) from public, anon;
grant execute on function public.request_package_refund(uuid, numeric, text, text), public.decide_package_refund(uuid, boolean, text),
  public.pay_package_refund(uuid, text), public.transfer_package(uuid, uuid, text), public.transfer_package_to_mrn(uuid, text, text), public.request_supplier_return(uuid, jsonb, text),
  public.decide_supplier_return(uuid, boolean, text) to authenticated;
