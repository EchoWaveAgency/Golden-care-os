-- Golden Care OS — 0025 Purchasing finance: supplier credits and refunds, VAT on purchases, approval thresholds
-- Policy values stay with the clinic: approval thresholds are empty (off) and the VAT treatment must be chosen by the
-- chief accountant (recoverable input VAT, or a cost when the clinic's services are VAT-exempt) before VAT is recorded.

insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, v.c, v.ar, v.en, v.t::public.account_type, true from public.organizations o cross join (values
  ('1170', 'ضريبة القيمة المضافة على المشتريات', 'Input VAT recoverable', 'asset'),
  ('5700', 'ضريبة قيمة مضافة غير قابلة للخصم', 'Non-recoverable VAT', 'expense')) v(c, ar, en, t)
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a join (values ('input_vat', '1170'), ('vat_expense', '5700')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.permissions (code, module, description) values
  ('purchase.approve.high', 'purchasing', 'Second approval for purchase orders and supplier payments above the clinic''s threshold')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values ('center_director', 'purchase.approve.high'), ('owner', 'purchase.approve.high')
on conflict do nothing;

create table public.purchasing_settings (
  organization_id              uuid primary key references public.organizations(id),
  po_high_approval_above       numeric(14,2) check (po_high_approval_above >= 0),
  payment_high_approval_above  numeric(14,2) check (payment_high_approval_above >= 0),
  vat_treatment                text check (vat_treatment in ('recoverable', 'expense')),
  updated_by                   uuid default auth.uid(),
  updated_at                   timestamptz not null default now()
);
create trigger trg_audit_purchasing_settings after insert or update on public.purchasing_settings for each row execute function app.audit_row();
alter table public.purchasing_settings enable row level security;
create policy purchasing_settings_read on public.purchasing_settings for select to authenticated
  using (app.has_permission('purchase.read') or app.has_permission('accounting.configure'));
grant select on public.purchasing_settings to authenticated;

create or replace function public.save_purchasing_settings(p jsonb)
returns public.purchasing_settings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid; s public.purchasing_settings;
begin
  if not app.has_global_permission('accounting.configure') then raise exception 'permission denied' using errcode = '42501'; end if;
  select organization_id into v_org from public.branches order by created_at limit 1;
  insert into public.purchasing_settings (organization_id, po_high_approval_above, payment_high_approval_above, vat_treatment)
  values (v_org, nullif(p->>'po_high_approval_above', '')::numeric, nullif(p->>'payment_high_approval_above', '')::numeric, nullif(p->>'vat_treatment', ''))
  on conflict (organization_id) do update set po_high_approval_above = excluded.po_high_approval_above,
    payment_high_approval_above = excluded.payment_high_approval_above,
    vat_treatment = coalesce(excluded.vat_treatment, public.purchasing_settings.vat_treatment),
    updated_by = auth.uid(), updated_at = now()
  returning * into s;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Approval thresholds
-- ---------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists first_approved_by uuid, add column if not exists first_approved_at timestamptz;

create or replace function public.approve_po(p_po uuid)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders; v_limit numeric;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.approve', po.branch_id);
  if po.status <> 'submitted' then raise exception 'purchase order must be submitted before approval' using errcode = '22023'; end if;
  if po.created_by = auth.uid() then raise exception 'separation of duties: you cannot approve a purchase order you created' using errcode = '42501'; end if;
  select po_high_approval_above into v_limit from public.purchasing_settings where organization_id = app.org_of_branch(po.branch_id);
  if v_limit is not null and po.total > v_limit then
    if po.first_approved_by is null then
      update public.purchase_orders set first_approved_by = auth.uid(), first_approved_at = now() where id = po.id returning * into po;
      return po;                                  -- waits for the second approval
    end if;
    if po.first_approved_by = auth.uid() then raise exception 'separation of duties: a second, different approver is required above the limit' using errcode = '42501'; end if;
    perform app.require_permission('purchase.approve.high', po.branch_id);
  end if;
  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = po.id returning * into po;
  return po;
end $$;

-- Supplier payments above the threshold are released only by someone with the higher approval.
create or replace function app.supplier_payment_limit_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_limit numeric;
begin
  if new.status = 'paid' and old.status = 'requested' then
    select payment_high_approval_above into v_limit from public.purchasing_settings where organization_id = app.org_of_branch(new.branch_id);
    if v_limit is not null and new.amount > v_limit and not app.has_permission('purchase.approve.high', new.branch_id) then
      raise exception 'payments above % need the higher approval (center director)', v_limit using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_supplier_payment_limit before update on public.supplier_payments for each row execute function app.supplier_payment_limit_guard();

-- ---------------------------------------------------------------------------
-- VAT on purchases (entered from the supplier's tax invoice; never computed by the system)
-- ---------------------------------------------------------------------------
alter table public.goods_receipts add column if not exists vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0);
alter table public.goods_receipts add column if not exists vat_account_key text not null default 'input_vat' check (vat_account_key in ('input_vat', 'vat_expense'));
alter table public.goods_receipts add column if not exists supplier_tax_invoice_no text;
alter table public.supplier_returns add column if not exists vat_amount numeric(14,2) not null default 0;

create or replace function public.set_receipt_vat(p_receipt uuid, p_vat numeric, p_tax_invoice_no text)
returns public.goods_receipts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare gr public.goods_receipts; v_org uuid; v_treat text; v_key text; v_delta numeric;
begin
  select * into gr from public.goods_receipts where id = p_receipt for update;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission('accounting.post', gr.branch_id);
  v_org := app.org_of_branch(gr.branch_id);
  select vat_treatment into v_treat from public.purchasing_settings where organization_id = v_org;
  if v_treat is null then raise exception 'choose the VAT treatment in purchasing settings first' using errcode = '22023'; end if;
  if coalesce(p_vat, -1) < 0 then raise exception 'VAT amount must be zero or more' using errcode = '22023'; end if;
  if coalesce(trim(p_tax_invoice_no), '') = '' and p_vat > 0 then raise exception 'enter the supplier''s tax invoice number' using errcode = '22023'; end if;
  if gr.returned_amount > 0 and p_vat <> gr.vat_amount then raise exception 'goods were already returned on this delivery; VAT can no longer change' using errcode = '22023'; end if;
  v_delta := round(p_vat, 2) - gr.vat_amount;
  v_key := case when gr.vat_amount > 0 then gr.vat_account_key when v_treat = 'recoverable' then 'input_vat' else 'vat_expense' end;
  if gr.total + v_delta < gr.amount_paid then raise exception 'the delivery is already paid beyond the new total' using errcode = '22023'; end if;
  if v_delta <> 0 then
    perform app.post_journal(v_org, gr.branch_id, app.cairo_today(), 'VAT on supplier invoice ' || gr.supplier_invoice_no, 'receipt_vat', gr.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, v_key), 'debit', greatest(v_delta, 0), 'credit', greatest(-v_delta, 0), 'memo', trim(p_tax_invoice_no)),
        jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'credit', greatest(v_delta, 0), 'debit', greatest(-v_delta, 0), 'memo', gr.supplier_invoice_no)));
  end if;
  update public.goods_receipts set vat_amount = round(p_vat, 2), vat_account_key = v_key, total = total + v_delta,
    supplier_tax_invoice_no = nullif(trim(p_tax_invoice_no), '') where id = gr.id returning * into gr;
  return gr;
end $$;

-- ---------------------------------------------------------------------------
-- Supplier credits: a return worth more than what is unpaid on its delivery
-- ---------------------------------------------------------------------------
create table public.supplier_credits (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('SCR'),
  supplier_id      uuid not null references public.suppliers(id),
  branch_id        uuid not null references public.branches(id),
  source_return_id uuid unique references public.supplier_returns(id),
  amount           numeric(14,2) not null check (amount > 0),
  used             numeric(14,2) not null default 0,
  refunded         numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  constraint credit_within_amount check (used >= 0 and refunded >= 0 and used + refunded <= amount)
);
create table public.supplier_credit_uses (
  id               uuid primary key default gen_random_uuid(),
  credit_id        uuid not null references public.supplier_credits(id),
  kind             text not null check (kind in ('applied', 'refund')),
  receipt_id       uuid references public.goods_receipts(id),
  amount           numeric(14,2) not null check (amount > 0),
  method           text check (method in ('bank_transfer', 'cheque')),
  reference        text,
  journal_entry_id uuid references public.journal_entries(id),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now()
);
create trigger trg_audit_supplier_credits after insert or update on public.supplier_credits for each row execute function app.audit_row();
create trigger trg_audit_supplier_credit_uses after insert on public.supplier_credit_uses for each row execute function app.audit_row();
create trigger trg_supplier_credits_immutable before delete on public.supplier_credits for each row execute function app.block_delete();
create trigger trg_supplier_credit_uses_immutable before delete or update on public.supplier_credit_uses for each row execute function app.block_delete();

create or replace function public.decide_supplier_return(p_return uuid, p_approve boolean, p_note text default null)
returns public.supplier_returns language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.supplier_returns; gr public.goods_receipts; l record; lot public.inv_lots; v_value numeric; v_total numeric := 0; v_org uuid;
        v_vat numeric; v_gross numeric; v_pending numeric; v_settle numeric;
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
  -- VAT recorded on the delivery goes back with the goods, pro rata to cost.
  v_vat := case when gr.vat_amount > 0 and gr.total - gr.vat_amount > 0 then round(v_total * gr.vat_amount / (gr.total - gr.vat_amount), 2) else 0 end;
  v_gross := v_total + v_vat;
  -- The return first settles what is still unpaid on the delivery (net of pending payments); any excess becomes a supplier credit.
  select coalesce(sum(a.amount), 0) into v_pending from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
    where a.receipt_id = gr.id and p.status = 'requested';
  v_settle := least(v_gross, greatest(gr.total - gr.amount_paid - v_pending, 0));
  v_org := app.org_of_branch(r.branch_id);
  update public.goods_receipts set returned_amount = returned_amount + v_gross, amount_paid = amount_paid + v_settle where id = gr.id;
  update public.supplier_returns set status = 'approved', total = v_total, vat_amount = v_vat, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
    journal_entry_id = app.post_journal(v_org, r.branch_id, app.cairo_today(), 'Return to supplier ' || r.ref || ' (' || gr.supplier_invoice_no || ')', 'supplier_return', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'debit', v_gross, 'memo', gr.supplier_invoice_no),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_total, 'memo', r.ref))
      || case when v_vat > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, gr.vat_account_key), 'credit', v_vat, 'memo', r.ref)) else '[]'::jsonb end)
  where id = r.id returning * into r;
  if v_gross > v_settle then
    insert into public.supplier_credits (supplier_id, branch_id, source_return_id, amount) values (r.supplier_id, r.branch_id, r.id, v_gross - v_settle);
  end if;
  return r;
end $$;

-- Use a credit against another unpaid delivery of the same supplier (no cash moves; the payable nets off).
create or replace function public.apply_supplier_credit(p_credit uuid, p_receipt uuid, p_amount numeric)
returns public.supplier_credits language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.supplier_credits; gr public.goods_receipts; v_pending numeric; v_amt numeric := round(p_amount, 2);
begin
  select * into c from public.supplier_credits where id = p_credit for update;
  if not found then raise exception 'credit not found' using errcode = 'P0002'; end if;
  perform app.require_permission('supplier.pay.approve', c.branch_id);
  select * into gr from public.goods_receipts where id = p_receipt for update;
  if not found or gr.supplier_id <> c.supplier_id then raise exception 'supplier invoice not found for this supplier' using errcode = '22023'; end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if v_amt > c.amount - c.used - c.refunded then raise exception 'the credit has only % left', c.amount - c.used - c.refunded using errcode = '22023'; end if;
  select coalesce(sum(a.amount), 0) into v_pending from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
    where a.receipt_id = gr.id and p.status = 'requested';
  if v_amt > gr.total - gr.amount_paid - v_pending then raise exception 'amount exceeds what is outstanding on %', gr.supplier_invoice_no using errcode = '22023'; end if;
  update public.goods_receipts set amount_paid = amount_paid + v_amt where id = gr.id;
  insert into public.supplier_credit_uses (credit_id, kind, receipt_id, amount) values (c.id, 'applied', gr.id, v_amt);
  update public.supplier_credits set used = used + v_amt where id = c.id returning * into c;
  return c;
end $$;

-- The supplier pays the credit back.
create or replace function public.record_supplier_refund(p_credit uuid, p_amount numeric, p_method text, p_reference text)
returns public.supplier_credits language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.supplier_credits; v_amt numeric := round(p_amount, 2); v_org uuid; v_je uuid;
begin
  select * into c from public.supplier_credits where id = p_credit for update;
  if not found then raise exception 'credit not found' using errcode = 'P0002'; end if;
  perform app.require_permission('supplier.pay.approve', c.branch_id);
  if p_method not in ('bank_transfer', 'cheque') then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if length(trim(coalesce(p_reference, ''))) < 2 then raise exception 'payment method % requires a reference number', p_method using errcode = '22023'; end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if v_amt > c.amount - c.used - c.refunded then raise exception 'the credit has only % left', c.amount - c.used - c.refunded using errcode = '22023'; end if;
  v_org := app.org_of_branch(c.branch_id);
  v_je := app.post_journal(v_org, c.branch_id, app.cairo_today(), 'Supplier refund ' || c.ref, 'supplier_refund', c.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'debit', v_amt, 'memo', trim(p_reference)),
      jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'credit', v_amt, 'memo', c.ref)));
  insert into public.supplier_credit_uses (credit_id, kind, amount, method, reference, journal_entry_id) values (c.id, 'refund', v_amt, p_method, trim(p_reference), v_je);
  update public.supplier_credits set refunded = refunded + v_amt where id = c.id returning * into c;
  return c;
end $$;

alter table public.supplier_credits enable row level security;
alter table public.supplier_credit_uses enable row level security;
create policy supplier_credits_read on public.supplier_credits for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('supplier.pay.approve', branch_id));
create policy supplier_credit_uses_read on public.supplier_credit_uses for select to authenticated
  using (exists (select 1 from public.supplier_credits c where c.id = credit_id and (app.has_permission('purchase.read', c.branch_id) or app.has_permission('supplier.pay.approve', c.branch_id))));
grant select on public.supplier_credits, public.supplier_credit_uses to authenticated;

revoke execute on function public.save_purchasing_settings(jsonb), public.set_receipt_vat(uuid, numeric, text),
  public.apply_supplier_credit(uuid, uuid, numeric), public.record_supplier_refund(uuid, numeric, text, text) from public, anon;
grant execute on function public.save_purchasing_settings(jsonb), public.set_receipt_vat(uuid, numeric, text),
  public.apply_supplier_credit(uuid, uuid, numeric), public.record_supplier_refund(uuid, numeric, text, text) to authenticated;
