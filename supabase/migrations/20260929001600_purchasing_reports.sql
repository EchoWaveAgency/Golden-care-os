-- Golden Care OS — 0016 Purchasing, supplier payments, profitability report
-- Purchase orders need approval by a second person; receipts against an order must match its items,
-- quantities and prices; supplier payments are requested by one person and released by another.

insert into public.permissions (code, module, description) values
  ('purchase.read',          'purchasing', 'View purchase orders, supplier statements and aging'),
  ('purchase.request',       'purchasing', 'Create and submit purchase orders'),
  ('purchase.approve',       'purchasing', 'Approve purchase orders (never your own)'),
  ('supplier.pay.request',   'purchasing', 'Request payments to suppliers'),
  ('supplier.pay.approve',   'purchasing', 'Release supplier payments (never your own request) — posts the payment')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('inventory_controller', 'purchase.read'), ('inventory_controller', 'purchase.request'),
  ('chief_accountant', 'purchase.read'), ('chief_accountant', 'purchase.approve'), ('chief_accountant', 'supplier.pay.request'), ('chief_accountant', 'supplier.pay.approve'),
  ('accountant', 'purchase.read'), ('accountant', 'supplier.pay.request'),
  ('operations_manager', 'purchase.read'), ('operations_manager', 'purchase.approve'),
  ('center_director', 'purchase.read'), ('center_director', 'purchase.approve'), ('center_director', 'supplier.pay.approve'),
  ('financial_auditor', 'purchase.read'), ('owner', 'purchase.read')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create type public.po_status as enum ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled');

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default app.next_ref('PO'),
  branch_id     uuid not null references public.branches(id),
  location_id   uuid not null references public.inv_locations(id),
  supplier_id   uuid not null references public.suppliers(id),
  status        public.po_status not null default 'draft',
  expected_on   date,
  notes         text,
  total         numeric(14,2) not null default 0,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_by   uuid,
  approved_at   timestamptz,
  cancel_reason text
);
create table public.po_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references public.purchase_orders(id),
  item_id      uuid not null references public.inv_items(id),
  qty          numeric(14,3) not null check (qty > 0),
  unit_cost    numeric(14,4) not null check (unit_cost >= 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0),
  closed_short_qty numeric(14,3) not null default 0 check (closed_short_qty >= 0),   -- undelivered remainder when the order is closed short
  unique (po_id, item_id),
  constraint not_over_received check (received_qty <= qty),
  constraint closed_within_remainder check (closed_short_qty <= qty - received_qty)
);
create trigger trg_audit_purchase_orders after insert or update on public.purchase_orders for each row execute function app.audit_row();
create trigger trg_audit_po_lines after insert or update on public.po_lines for each row execute function app.audit_row();
alter table public.goods_receipts add column po_id uuid references public.purchase_orders(id);
alter table public.goods_receipts add column amount_paid numeric(14,2) not null default 0;
alter table public.goods_receipts add constraint receipt_paid_within_total check (amount_paid >= 0 and amount_paid <= total);
-- A receipt against an approved order is pre-approved; a receipt without an order must be confirmed by an
-- approver (not the receiver) before the supplier can be paid for it.
alter table public.goods_receipts add column confirmed_by uuid;
alter table public.goods_receipts add column confirmed_at timestamptz;

create or replace function public.confirm_receipt(p_receipt uuid)
returns public.goods_receipts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare gr public.goods_receipts;
begin
  select * into gr from public.goods_receipts where id = p_receipt for update;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.approve', gr.branch_id);
  if gr.confirmed_at is not null then return gr; end if;
  if gr.created_by = auth.uid() then raise exception 'separation of duties: you cannot confirm a receipt you recorded' using errcode = '42501'; end if;
  update public.goods_receipts set confirmed_by = auth.uid(), confirmed_at = now() where id = gr.id returning * into gr;
  perform app.audit_event('RECEIPT_CONFIRMED', 'goods_receipts', gr.id::text, gr.branch_id, 'receipt without purchase order confirmed');
  return gr;
end $$;

create or replace function public.create_po(p_location uuid, p_supplier uuid, p_lines jsonb, p_expected date default null, p_notes text default null)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare loc public.inv_locations; po public.purchase_orders; l jsonb; v_qty numeric; v_cost numeric;
begin
  select * into loc from public.inv_locations where id = p_location and is_active;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.request', loc.branch_id);
  if not exists (select 1 from public.suppliers where id = p_supplier and is_active) then raise exception 'supplier not found' using errcode = 'P0002'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'add at least one line' using errcode = '22023'; end if;
  insert into public.purchase_orders (branch_id, location_id, supplier_id, expected_on, notes)
  values (loc.branch_id, loc.id, p_supplier, p_expected, nullif(trim(p_notes), '')) returning * into po;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := (l->>'qty')::numeric; v_cost := (l->>'unit_cost')::numeric;
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost <= 0 then raise exception 'quantity and unit cost are required' using errcode = '22023'; end if;
    if v_qty <> round(v_qty, 3) or v_cost <> round(v_cost, 4) then raise exception 'too many decimals (quantity 3, cost 4)' using errcode = '22023'; end if;
    if not exists (select 1 from public.inv_items where id = (l->>'item_id')::uuid and is_active) then raise exception 'item not found' using errcode = 'P0002'; end if;
    insert into public.po_lines (po_id, item_id, qty, unit_cost) values (po.id, (l->>'item_id')::uuid, v_qty, v_cost);
  end loop;
  update public.purchase_orders set total = (select sum(round(qty * unit_cost, 2)) from public.po_lines where po_id = po.id)
  where id = po.id returning * into po;
  return po;
exception when unique_violation then
  raise exception 'each item can appear only once in an order' using errcode = '22023';
end $$;

create or replace function public.submit_po(p_po uuid)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.request', po.branch_id);
  if po.status <> 'draft' then raise exception 'purchase order already %', po.status using errcode = '22023'; end if;
  update public.purchase_orders set status = 'submitted', submitted_at = now() where id = po.id returning * into po;
  return po;
end $$;

create or replace function public.approve_po(p_po uuid)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission('purchase.approve', po.branch_id);
  if po.status <> 'submitted' then raise exception 'purchase order must be submitted before approval' using errcode = '22023'; end if;
  if po.created_by = auth.uid() then raise exception 'separation of duties: you cannot approve a purchase order you created' using errcode = '42501'; end if;
  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = po.id returning * into po;
  return po;
end $$;

create or replace function public.cancel_po(p_po uuid, p_reason text)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('purchase.request', po.branch_id) or app.has_permission('purchase.approve', po.branch_id)) then
    raise exception 'permission denied: purchase.request' using errcode = '42501';
  end if;
  if po.status not in ('draft', 'submitted', 'approved') or exists (select 1 from public.po_lines where po_id = po.id and received_qty > 0) then
    raise exception 'only orders with nothing received can be cancelled' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.purchase_orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = po.id returning * into po;
  return po;
end $$;

-- Close a partly received order: the undelivered remainder is dropped (audited), never received later.
create or replace function public.close_po(p_po uuid, p_reason text)
returns public.purchase_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('purchase.request', po.branch_id) or app.has_permission('purchase.approve', po.branch_id)) then
    raise exception 'permission denied: purchase.request' using errcode = '42501';
  end if;
  if po.status <> 'partially_received' then raise exception 'only partly received orders can be closed' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  -- Lines are never deleted: the undelivered quantity is recorded as closed_short_qty (audited).
  update public.po_lines set closed_short_qty = qty - received_qty where po_id = po.id and received_qty < qty;
  update public.purchase_orders set status = 'received', cancel_reason = 'closed short: ' || trim(p_reason),
         total = (select coalesce(sum(round((qty - closed_short_qty) * unit_cost, 2)), 0) from public.po_lines where po_id = po.id)
  where id = po.id returning * into po;
  return po;
end $$;

-- Receive against an approved order: items and prices come from the order; quantities cannot exceed it.
create or replace function public.receive_po(p_po uuid, p_supplier_invoice_no text, p_lines jsonb, p_idempotency_key text)
returns public.goods_receipts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare po public.purchase_orders; gr public.goods_receipts; l jsonb; pl public.po_lines; v_lines jsonb := '[]'::jsonb; v_qty numeric;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.receive', po.branch_id);
  select * into gr from public.goods_receipts where idempotency_key = p_idempotency_key;
  if found then
    if gr.po_id is distinct from po.id or gr.created_by is distinct from auth.uid() then raise exception 'idempotency key reused' using errcode = '22023'; end if;
    return gr;                                   -- retry: nothing applied twice
  end if;
  if po.status not in ('approved', 'partially_received') then
    raise exception 'purchase order must be approved before receiving' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into pl from public.po_lines where id = (l->>'po_line_id')::uuid and po_id = po.id for update;
    if not found then raise exception 'line is not part of this purchase order' using errcode = '22023'; end if;
    v_qty := (l->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then continue; end if;
    if pl.received_qty + v_qty > pl.qty then
      raise exception 'receiving more than ordered (remaining %)', pl.qty - pl.received_qty using errcode = '22023';
    end if;
    update public.po_lines set received_qty = received_qty + v_qty where id = pl.id;
    v_lines := v_lines || jsonb_build_object('item_id', pl.item_id, 'lot_no', l->>'lot_no', 'expiry', l->>'expiry', 'qty', v_qty, 'unit_cost', pl.unit_cost);
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'add at least one line' using errcode = '22023'; end if;
  gr := public.receive_goods(po.location_id, po.supplier_id, p_supplier_invoice_no, v_lines, p_idempotency_key);
  update public.goods_receipts set po_id = po.id, confirmed_by = po.approved_by, confirmed_at = now() where id = gr.id returning * into gr;
  update public.purchase_orders set status = case when exists (select 1 from public.po_lines where po_id = po.id and received_qty < qty)
                                                  then 'partially_received'::public.po_status else 'received' end
  where id = po.id;
  return gr;
end $$;

-- ---------------------------------------------------------------------------
-- Supplier payments (request → release by another person)
-- ---------------------------------------------------------------------------
create table public.supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('SP'),
  supplier_id      uuid not null references public.suppliers(id),
  branch_id        uuid not null references public.branches(id),
  amount           numeric(14,2) not null check (amount > 0),
  method           text not null check (method in ('bank_transfer', 'cheque')),
  reference        text not null check (length(trim(reference)) >= 2),
  status           text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  requested_by     uuid not null default auth.uid(),
  requested_at     timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  journal_entry_id uuid references public.journal_entries(id)
);
create table public.supplier_payment_allocations (
  payment_id uuid not null references public.supplier_payments(id),
  receipt_id uuid not null references public.goods_receipts(id),
  amount     numeric(14,2) not null check (amount > 0),
  primary key (payment_id, receipt_id)
);
create trigger trg_audit_supplier_payments after insert or update on public.supplier_payments for each row execute function app.audit_row();

create or replace function public.request_supplier_payment(p_supplier uuid, p_allocations jsonb, p_method text, p_reference text)
returns public.supplier_payments language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare sp public.supplier_payments; a jsonb; gr public.goods_receipts; v_amt numeric; v_pending numeric; v_branch uuid; v_total numeric := 0;
begin
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then raise exception 'choose at least one supplier invoice' using errcode = '22023'; end if;
  if p_method not in ('bank_transfer', 'cheque') then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if length(trim(coalesce(p_reference, ''))) < 2 then raise exception 'payment method % requires a reference number', p_method using errcode = '22023'; end if;
  perform 1 from public.goods_receipts where id in (select (x->>'receipt_id')::uuid from jsonb_array_elements(p_allocations) x) order by id for update;
  for a in select * from jsonb_array_elements(p_allocations) loop
    select * into gr from public.goods_receipts where id = (a->>'receipt_id')::uuid for update;
    if not found or gr.supplier_id <> p_supplier then raise exception 'supplier invoice not found for this supplier' using errcode = '22023'; end if;
    if gr.confirmed_at is null then
      raise exception 'receipt % has no purchase order and must be confirmed by an approver before payment', gr.supplier_invoice_no using errcode = '22023';
    end if;
    if v_branch is null then
      v_branch := gr.branch_id;
      perform app.require_permission('supplier.pay.request', v_branch);
    elsif gr.branch_id <> v_branch then
      raise exception 'one payment covers one branch' using errcode = '22023';
    end if;
    v_amt := round((a->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
    select coalesce(sum(al.amount), 0) into v_pending from public.supplier_payment_allocations al
      join public.supplier_payments p on p.id = al.payment_id where al.receipt_id = gr.id and p.status = 'requested';
    if v_amt > gr.total - gr.amount_paid - v_pending then
      raise exception 'amount exceeds what is outstanding on %', gr.supplier_invoice_no using errcode = '22023';
    end if;
    v_total := v_total + v_amt;
  end loop;
  insert into public.supplier_payments (supplier_id, branch_id, amount, method, reference)
  values (p_supplier, v_branch, v_total, p_method, trim(p_reference)) returning * into sp;
  insert into public.supplier_payment_allocations (payment_id, receipt_id, amount)
  select sp.id, (x->>'receipt_id')::uuid, round((x->>'amount')::numeric, 2) from jsonb_array_elements(p_allocations) x;
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
  -- Lock the receipts in id order and re-check the outstanding amounts.
  for al in select a.*, g.total, g.amount_paid, g.supplier_invoice_no from public.supplier_payment_allocations a
            join public.goods_receipts g on g.id = a.receipt_id where a.payment_id = sp.id order by a.receipt_id for update of g loop
    if al.amount_paid + al.amount > al.total then
      raise exception 'amount exceeds what is outstanding on %', al.supplier_invoice_no using errcode = '22023';
    end if;
    update public.goods_receipts set amount_paid = amount_paid + al.amount where id = al.receipt_id;
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

-- Supplier statement with aging (by receipt date).
create or replace function public.supplier_statement(p_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_permission('purchase.read') then raise exception 'permission denied: purchase.read' using errcode = '42501'; end if;
  return jsonb_build_object(
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'ref', g.ref, 'invoice_no', g.supplier_invoice_no, 'date', g.created_at,
        'total', g.total, 'paid', g.amount_paid, 'outstanding', g.total - g.amount_paid,
        'pending', coalesce((select sum(a.amount) from public.supplier_payment_allocations a join public.supplier_payments p on p.id = a.payment_id
                             where a.receipt_id = g.id and p.status = 'requested'), 0),
        'age_days', app.cairo_today() - (g.created_at at time zone 'Africa/Cairo')::date, 'po', (select ref from public.purchase_orders where id = g.po_id),
        'confirmed', g.confirmed_at is not null, 'received_by_me', g.created_by = auth.uid())
        order by g.created_at) from public.goods_receipts g where g.supplier_id = p_supplier and app.has_permission('purchase.read', g.branch_id)), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'ref', p.ref, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
        'status', p.status, 'requested_at', p.requested_at, 'decided_at', p.decided_at, 'requested_by_me', p.requested_by = auth.uid()) order by p.requested_at desc)
        from public.supplier_payments p where p.supplier_id = p_supplier and app.has_permission('purchase.read', p.branch_id)), '[]'::jsonb),
    'aging', (select jsonb_build_object(
        'd0_30',  coalesce(sum(g.total - g.amount_paid) filter (where app.cairo_today() - (g.created_at at time zone 'Africa/Cairo')::date <= 30), 0),
        'd31_60', coalesce(sum(g.total - g.amount_paid) filter (where app.cairo_today() - (g.created_at at time zone 'Africa/Cairo')::date between 31 and 60), 0),
        'd61_90', coalesce(sum(g.total - g.amount_paid) filter (where app.cairo_today() - (g.created_at at time zone 'Africa/Cairo')::date between 61 and 90), 0),
        'd90p',   coalesce(sum(g.total - g.amount_paid) filter (where app.cairo_today() - (g.created_at at time zone 'Africa/Cairo')::date > 90), 0))
      from public.goods_receipts g where g.supplier_id = p_supplier and app.has_permission('purchase.read', g.branch_id)));
end $$;

-- ---------------------------------------------------------------------------
-- Profitability per service and doctor (invoiced basis)
-- ---------------------------------------------------------------------------
create or replace function public.report_profitability(p_from date, p_to date, p_branch uuid default null)
returns table (service_id uuid, service_code text, service_ar text, service_en text, doctor_id uuid, doctor_ar text, doctor_en text,
               units numeric, gross numeric, discounts numeric, refunds numeric, net_revenue numeric, doctor_share numeric,
               consumables numeric, margin numeric)
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
  ), lines as (
    select l.*, i.total inv_total, i.appointment_id, (i.issued_at at time zone 'Africa/Cairo')::date issued_on, coalesce(ir.amt, 0) inv_refunds
    from public.invoice_lines l join inv i on i.id = l.invoice_id left join inv_ref ir on ir.invoice_id = i.id
  ), apt_net as (   -- ALL non-void invoices of the appointment, whatever their date, so cost is never allocated twice
    select i.appointment_id, sum(l.line_total) net from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
    where i.status in ('issued', 'partially_paid', 'paid') and i.appointment_id in (select appointment_id from lines where appointment_id is not null)
    group by i.appointment_id
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
  )
  select c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, coalesce(st.full_name_en, st.full_name_ar),
         sum(c.quantity), sum(c.line_gross), sum(c.discount), sum(c.refund_part), sum(c.line_total - c.refund_part),
         sum(c.share), sum(c.cons), sum(c.line_total - c.refund_part - c.share - c.cons)
  from calc c join public.services s on s.id = c.service_id left join public.staff st on st.id = c.doctor_id
  group by c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, st.full_name_en
  order by sum(c.line_total - c.refund_part - c.share - c.cons) desc
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;
grant select on public.purchase_orders, public.po_lines, public.supplier_payments, public.supplier_payment_allocations to authenticated;
grant all on public.purchase_orders, public.po_lines, public.supplier_payments, public.supplier_payment_allocations to service_role;
create policy po_read on public.purchase_orders for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('purchase.approve', branch_id) or app.has_permission('inventory.receive', branch_id));
create policy po_lines_read on public.po_lines for select to authenticated using (exists (select 1 from public.purchase_orders p where p.id = po_id));
create policy supplier_payments_read on public.supplier_payments for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('supplier.pay.approve', branch_id) or app.has_permission('supplier.pay.request', branch_id));
create policy supplier_payment_alloc_read on public.supplier_payment_allocations for select to authenticated
  using (exists (select 1 from public.supplier_payments p where p.id = payment_id));
-- Accounting readers can also see receipts (they are supplier invoices).
create policy goods_receipts_read_finance on public.goods_receipts for select to authenticated
  using (app.has_permission('purchase.read', branch_id) or app.has_permission('supplier.pay.request', branch_id));

revoke execute on all functions in schema public from public;
grant execute on function public.create_po(uuid, uuid, jsonb, date, text), public.submit_po(uuid), public.approve_po(uuid),
  public.cancel_po(uuid, text), public.close_po(uuid, text), public.receive_po(uuid, text, jsonb, text), public.confirm_receipt(uuid),
  public.request_supplier_payment(uuid, jsonb, text, text), public.decide_supplier_payment(uuid, boolean, text),
  public.supplier_statement(uuid), public.report_profitability(date, date, uuid) to authenticated;
