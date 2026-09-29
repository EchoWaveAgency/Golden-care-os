-- Golden Care OS — 0015 Inventory & consumables
-- Lots with expiry and cost; every quantity change is an immutable stock move written by an RPC
-- that also posts the matching journal. Stock never goes negative; expired stock is never issued.

-- ---------------------------------------------------------------------------
-- Accounts & permissions
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, '5310', 'فروقات وتسويات المخزون', 'Inventory losses & adjustments', 'expense', true from public.organizations o
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('inventory', '1300'), ('consumables_expense', '5300'), ('suppliers_payable', '2100'), ('inventory_adjustments', '5310')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.permissions (code, module, description) values
  ('inventory.read',       'inventory', 'View stock, lots, movements and alerts'),
  ('inventory.manage',     'inventory', 'Maintain items, stores, suppliers and consumable templates'),
  ('inventory.receive',    'inventory', 'Receive goods from suppliers (posts to inventory and suppliers payable)'),
  ('inventory.issue',      'inventory', 'Issue consumables to patients / sessions'),
  ('inventory.controlled', 'inventory', 'Issue controlled items'),
  ('inventory.count',      'inventory', 'Run stock counts'),
  ('inventory.approve',    'inventory', 'Approve stock count differences (never your own count)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('inventory_controller', 'inventory.read'), ('inventory_controller', 'inventory.manage'), ('inventory_controller', 'inventory.receive'),
  ('inventory_controller', 'inventory.issue'), ('inventory_controller', 'inventory.count'),
  ('nurse', 'inventory.read'), ('nurse', 'inventory.issue'),
  ('medical_assistant', 'inventory.read'), ('medical_assistant', 'inventory.issue'),
  ('doctor', 'inventory.issue'),
  ('medical_director', 'inventory.read'), ('medical_director', 'inventory.controlled'), ('medical_director', 'inventory.issue'),
  ('chief_accountant', 'inventory.read'), ('chief_accountant', 'inventory.approve'),
  ('accountant', 'inventory.read'),
  ('operations_manager', 'inventory.read'), ('operations_manager', 'inventory.approve'),
  ('center_director', 'inventory.read'), ('financial_auditor', 'inventory.read')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
create table public.inv_items (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  name_ar       text not null,
  name_en       text not null,
  unit          text not null default 'piece',
  category      text not null default 'consumable' check (category in ('consumable', 'drug', 'laser_part', 'dental_material', 'cosmetic', 'other')),
  is_controlled boolean not null default false,
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create table public.inv_locations (
  id        uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code      text not null,
  name_ar   text not null,
  name_en   text not null,
  is_active boolean not null default true,
  unique (branch_id, code)
);
create table public.suppliers (
  id        uuid primary key default gen_random_uuid(),
  name_ar   text not null,
  name_en   text,
  tax_id    text,
  phone     text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Consumables normally used by a service (a template the nurse confirms, never auto-issued).
create table public.service_consumables (
  service_id uuid not null references public.services(id),
  item_id    uuid not null references public.inv_items(id),
  qty        numeric(14,3) not null check (qty > 0),
  primary key (service_id, item_id)
);
create trigger trg_audit_inv_items after insert or update or delete on public.inv_items for each row execute function app.audit_row();
create trigger trg_audit_inv_locations after insert or update or delete on public.inv_locations for each row execute function app.audit_row();
create trigger trg_audit_suppliers after insert or update or delete on public.suppliers for each row execute function app.audit_row();
create trigger trg_audit_service_consumables after insert or update or delete on public.service_consumables for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Lots and moves (quantities change only inside the RPCs below)
-- ---------------------------------------------------------------------------
create table public.inv_lots (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.inv_items(id),
  location_id  uuid not null references public.inv_locations(id),
  lot_no       text not null,
  expiry       date,
  unit_cost    numeric(14,4) not null check (unit_cost >= 0),
  qty_on_hand  numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  value_remaining numeric(14,2) not null default 0,   -- exact book value left in the lot (rounding never leaks)
  receipt_id   uuid,
  received_at  timestamptz not null default now()
);
create index on public.inv_lots (item_id, location_id) where qty_on_hand > 0;

create or replace function app.inv_lots_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.inventory_rpc', true), '') <> 'on' then
    raise exception 'stock changes only through receipts, issues and approved counts' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.item_id <> old.item_id or new.location_id <> old.location_id or new.unit_cost <> old.unit_cost
                           or new.lot_no <> old.lot_no or new.expiry is distinct from old.expiry) then
    raise exception 'lot identity and cost cannot change' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_inv_lots_guard before insert or update or delete on public.inv_lots for each row execute function app.inv_lots_guard();

create table public.goods_receipts (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text not null unique default app.next_ref('GRN'),
  branch_id           uuid not null references public.branches(id),
  location_id         uuid not null references public.inv_locations(id),
  supplier_id         uuid not null references public.suppliers(id),
  supplier_invoice_no text not null,
  total               numeric(14,2) not null,
  journal_entry_id    uuid references public.journal_entries(id),
  idempotency_key     text not null unique,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  unique (supplier_id, supplier_invoice_no)
);
create table public.goods_receipt_lines (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts(id),
  item_id    uuid not null references public.inv_items(id),
  lot_id     uuid not null references public.inv_lots(id),
  lot_no     text not null,
  expiry     date,
  qty        numeric(14,3) not null check (qty > 0),
  unit_cost  numeric(14,4) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null
);
create table public.stock_issues (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('ISS'),
  branch_id        uuid not null references public.branches(id),
  location_id      uuid not null references public.inv_locations(id),
  appointment_id   uuid references public.appointments(id),
  patient_id       uuid references public.patients(id),
  reason           text,
  total_cost       numeric(14,2) not null,
  journal_entry_id uuid references public.journal_entries(id),
  idempotency_key  text not null unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint issue_has_purpose check (appointment_id is not null or length(trim(coalesce(reason, ''))) >= 3)
);
create table public.stock_moves (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references public.inv_lots(id),
  item_id     uuid not null references public.inv_items(id),
  location_id uuid not null references public.inv_locations(id),
  kind        text not null check (kind in ('receipt', 'issue', 'count_adjust')),
  qty         numeric(14,3) not null check (qty <> 0),
  unit_cost   numeric(14,4) not null,
  value       numeric(14,2) not null,
  ref_type    text not null,
  ref_id      uuid not null,
  patient_id  uuid references public.patients(id),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.stock_moves (item_id, created_at desc);
create index on public.stock_moves (ref_type, ref_id);
create trigger trg_stock_moves_immutable before update or delete on public.stock_moves for each row execute function app.block_delete();
create trigger trg_audit_goods_receipts after insert on public.goods_receipts for each row execute function app.audit_row();
create trigger trg_audit_stock_issues after insert on public.stock_issues for each row execute function app.audit_row();

create type public.count_status as enum ('draft', 'submitted', 'approved', 'cancelled');
create table public.stock_counts (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('CNT'),
  branch_id        uuid not null references public.branches(id),
  location_id      uuid not null references public.inv_locations(id),
  status           public.count_status not null default 'draft',
  counted_by       uuid not null default auth.uid(),
  started_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  approved_by      uuid,
  approved_at      timestamptz,
  net_value        numeric(14,2),
  journal_entry_id uuid references public.journal_entries(id),
  note             text
);
create unique index one_open_count_per_location on public.stock_counts (location_id) where status in ('draft', 'submitted');
create table public.stock_count_lines (
  id          uuid primary key default gen_random_uuid(),
  count_id    uuid not null references public.stock_counts(id),
  lot_id      uuid not null references public.inv_lots(id),
  system_qty  numeric(14,3),
  counted_qty numeric(14,3) check (counted_qty >= 0),
  unique (count_id, lot_id)
);
create trigger trg_audit_stock_counts after insert or update on public.stock_counts for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function app.cairo_today() returns date language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- A store is frozen while a count is open (no receipts or issues until it is approved or cancelled).
create or replace function app.require_not_counting(p_location uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.stock_counts where location_id = p_location and status in ('draft', 'submitted')) then
    raise exception 'a stock count is in progress for this store; finish or cancel it first' using errcode = '22023';
  end if;
end $$;

-- Receive goods: lots + moves + Dr Inventory / Cr Suppliers payable. Idempotent.
create or replace function public.receive_goods(p_location uuid, p_supplier uuid, p_supplier_invoice_no text, p_lines jsonb, p_idempotency_key text)
returns public.goods_receipts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare loc public.inv_locations; gr public.goods_receipts; l jsonb; it public.inv_items; v_lot uuid; v_qty numeric; v_cost numeric;
        v_total numeric := 0; v_org uuid; v_exp date;
begin
  select * into loc from public.inv_locations where id = p_location and is_active;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.receive', loc.branch_id);
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  select * into gr from public.goods_receipts where idempotency_key = p_idempotency_key;
  if found then
    if gr.created_by is distinct from auth.uid() or gr.location_id <> loc.id then
      raise exception 'idempotency key reused' using errcode = '22023';
    end if;
    return gr;
  end if;
  perform app.require_not_counting(loc.id);
  if coalesce(trim(p_supplier_invoice_no), '') = '' then raise exception 'supplier invoice number is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and is_active) then raise exception 'supplier not found' using errcode = 'P0002'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'add at least one line' using errcode = '22023'; end if;

  perform set_config('app.inventory_rpc', 'on', true);
  begin
    insert into public.goods_receipts (branch_id, location_id, supplier_id, supplier_invoice_no, total, idempotency_key)
    values (loc.branch_id, loc.id, p_supplier, trim(p_supplier_invoice_no), 0, p_idempotency_key) returning * into gr;
  exception when unique_violation then
    select * into gr from public.goods_receipts where idempotency_key = p_idempotency_key;   -- concurrent retry
    if found and gr.created_by = auth.uid() and gr.location_id = loc.id then return gr; end if;
    raise;
  end;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.inv_items where id = (l->>'item_id')::uuid and is_active;
    if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
    v_qty := (l->>'qty')::numeric; v_cost := (l->>'unit_cost')::numeric; v_exp := nullif(l->>'expiry', '')::date;
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 then raise exception 'quantity and unit cost are required' using errcode = '22023'; end if;
    if v_qty <> round(v_qty, 3) or v_cost <> round(v_cost, 4) then raise exception 'too many decimals (quantity 3, cost 4)' using errcode = '22023'; end if;
    if coalesce(trim(l->>'lot_no'), '') = '' then raise exception 'lot number is required' using errcode = '22023'; end if;
    if v_exp is not null and v_exp <= app.cairo_today() then raise exception 'item % is already expired', it.code using errcode = '22023'; end if;
    if it.category in ('drug', 'cosmetic', 'dental_material') and v_exp is null then
      raise exception 'expiry date is required for %', it.code using errcode = '22023';
    end if;
    insert into public.inv_lots (item_id, location_id, lot_no, expiry, unit_cost, qty_on_hand, value_remaining, receipt_id)
    values (it.id, loc.id, trim(l->>'lot_no'), v_exp, v_cost, v_qty, round(v_qty * v_cost, 2), gr.id) returning id into v_lot;
    insert into public.goods_receipt_lines (receipt_id, item_id, lot_id, lot_no, expiry, qty, unit_cost, line_total)
    values (gr.id, it.id, v_lot, trim(l->>'lot_no'), v_exp, v_qty, v_cost, round(v_qty * v_cost, 2));
    insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id)
    values (v_lot, it.id, loc.id, 'receipt', v_qty, v_cost, round(v_qty * v_cost, 2), 'goods_receipt', gr.id);
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;
  v_org := app.org_of_branch(loc.branch_id);
  update public.goods_receipts set total = v_total,
    journal_entry_id = case when v_total > 0 then app.post_journal(v_org, loc.branch_id, app.cairo_today(),
      'Goods receipt ' || gr.ref || ' / ' || trim(p_supplier_invoice_no), 'goods_receipt', gr.id,
      jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'debit', v_total),
                        jsonb_build_object('account_id', app.account_for(v_org, 'suppliers_payable'), 'credit', v_total, 'memo', trim(p_supplier_invoice_no)))) end
  where id = gr.id returning * into gr;
  return gr;
end $$;

-- Issue to a patient session / purpose: FEFO across non-expired lots; Dr Consumables / Cr Inventory.
create or replace function public.issue_stock(p_location uuid, p_items jsonb, p_appointment uuid, p_reason text, p_idempotency_key text)
returns public.stock_issues language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare loc public.inv_locations; iss public.stock_issues; r jsonb; it public.inv_items; need numeric; take numeric; lot record; v_val numeric;
        v_total numeric := 0; v_org uuid; v_patient uuid; apt public.appointments;
begin
  select * into loc from public.inv_locations where id = p_location and is_active;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.issue', loc.branch_id);
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  select * into iss from public.stock_issues where idempotency_key = p_idempotency_key;
  if found then
    if iss.created_by is distinct from auth.uid() or iss.location_id <> loc.id then
      raise exception 'idempotency key reused' using errcode = '22023';
    end if;
    return iss;
  end if;
  perform app.require_not_counting(loc.id);
  if p_appointment is not null then
    select * into apt from public.appointments where id = p_appointment;
    if not found or apt.branch_id <> loc.branch_id then raise exception 'appointment not found in this branch' using errcode = 'P0002'; end if;
    v_patient := apt.patient_id;
  elsif length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'choose the appointment or write the purpose of the issue' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'add at least one line' using errcode = '22023'; end if;

  perform set_config('app.inventory_rpc', 'on', true);
  begin
    insert into public.stock_issues (branch_id, location_id, appointment_id, patient_id, reason, total_cost, idempotency_key)
    values (loc.branch_id, loc.id, p_appointment, v_patient, nullif(trim(p_reason), ''), 0, p_idempotency_key) returning * into iss;
  exception when unique_violation then
    select * into iss from public.stock_issues where idempotency_key = p_idempotency_key;   -- concurrent retry
    if found and iss.created_by = auth.uid() and iss.location_id = loc.id then return iss; end if;
    raise;
  end;
  -- Lock every candidate lot once, in id order, so concurrent issues and count approvals cannot deadlock.
  perform 1 from public.inv_lots
   where location_id = loc.id and item_id in (select (x->>'item_id')::uuid from jsonb_array_elements(p_items) x)
   order by id for update;
  for r in select * from jsonb_array_elements(p_items) loop
    select * into it from public.inv_items where id = (r->>'item_id')::uuid;
    if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
    if it.is_controlled and not app.has_permission('inventory.controlled', loc.branch_id) then
      raise exception 'controlled item % needs special authorization', it.code using errcode = '42501';
    end if;
    need := (r->>'qty')::numeric;
    if need is null or need <= 0 then raise exception 'quantity must be positive' using errcode = '22023'; end if;
    if need <> round(need, 3) then raise exception 'too many decimals (quantity 3, cost 4)' using errcode = '22023'; end if;
    -- First-expiry-first-out; lots without expiry last; expired lots never.
    for lot in select * from public.inv_lots
               where item_id = it.id and location_id = loc.id and qty_on_hand > 0 and (expiry is null or expiry > app.cairo_today())
               order by expiry nulls last, received_at, id for update loop
      exit when need <= 0;
      take := least(need, lot.qty_on_hand);
      -- Emptying a lot takes its exact remaining value, so rounding never leaves cents behind.
      v_val := case when take = lot.qty_on_hand then lot.value_remaining else least(round(take * lot.unit_cost, 2), lot.value_remaining) end;
      update public.inv_lots set qty_on_hand = qty_on_hand - take, value_remaining = value_remaining - v_val where id = lot.id;
      insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id, patient_id)
      values (lot.id, it.id, loc.id, 'issue', -take, lot.unit_cost, -v_val, 'stock_issue', iss.id, v_patient);
      v_total := v_total + v_val;
      need := need - take;
    end loop;
    if need > 0 then
      raise exception 'insufficient stock for % (short by %)', it.code, need using errcode = '22023';
    end if;
  end loop;
  v_org := app.org_of_branch(loc.branch_id);
  update public.stock_issues set total_cost = v_total,
    journal_entry_id = case when v_total > 0 then app.post_journal(v_org, loc.branch_id, app.cairo_today(),
      'Consumables issue ' || iss.ref, 'stock_issue', iss.id,
      jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'consumables_expense'), 'debit', v_total, 'patient_id', v_patient),
                        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_total))) end
  where id = iss.id returning * into iss;
  return iss;
end $$;

-- Stock counts: count → submit (snapshot) → approval by someone else applies the differences.
create or replace function public.start_count(p_location uuid)
returns public.stock_counts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare loc public.inv_locations; c public.stock_counts;
begin
  select * into loc from public.inv_locations where id = p_location and is_active;
  if not found then raise exception 'store not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.count', loc.branch_id);
  insert into public.stock_counts (branch_id, location_id) values (loc.branch_id, loc.id) returning * into c;
  insert into public.stock_count_lines (count_id, lot_id)
  select c.id, id from public.inv_lots where location_id = loc.id and qty_on_hand > 0;
  return c;
exception when unique_violation then
  raise exception 'a count is already open for this store' using errcode = '22023';
end $$;

create or replace function public.submit_count(p_count uuid, p_lines jsonb)
returns public.stock_counts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.stock_counts; l jsonb;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'count not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.count', c.branch_id);
  if c.status <> 'draft' then raise exception 'count already %', c.status using errcode = '22023'; end if;
  if c.counted_by <> auth.uid() then raise exception 'only the person who started the count can submit it' using errcode = '42501'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.stock_count_lines set counted_qty = (l->>'counted')::numeric
    where count_id = c.id and lot_id = (l->>'lot_id')::uuid;
  end loop;
  if exists (select 1 from public.stock_count_lines where count_id = c.id and counted_qty is null) then
    raise exception 'enter a counted quantity for every lot' using errcode = '22023';
  end if;
  -- Snapshot the system quantity at submission (lots locked so the snapshot is consistent).
  perform 1 from public.inv_lots where id in (select lot_id from public.stock_count_lines where count_id = c.id) for update;
  update public.stock_count_lines cl set system_qty = lt.qty_on_hand from public.inv_lots lt where lt.id = cl.lot_id and cl.count_id = c.id;
  update public.stock_counts set status = 'submitted', submitted_at = now(),
    net_value = (select coalesce(sum(round((cl.counted_qty - cl.system_qty) * lt.unit_cost, 2)), 0)
                 from public.stock_count_lines cl join public.inv_lots lt on lt.id = cl.lot_id where cl.count_id = c.id)
  where id = c.id returning * into c;
  return c;
end $$;

create or replace function public.approve_count(p_count uuid)
returns public.stock_counts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.stock_counts; cl record; v_loss numeric := 0; v_gain numeric := 0; v_org uuid; v_je uuid; d numeric; v numeric;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'count not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.approve', c.branch_id);
  if c.status <> 'submitted' then raise exception 'count must be submitted before approval' using errcode = '22023'; end if;
  if c.counted_by = auth.uid() then raise exception 'separation of duties: you cannot approve your own count' using errcode = '42501'; end if;
  perform set_config('app.inventory_rpc', 'on', true);
  for cl in select l.*, lt.qty_on_hand, lt.unit_cost, lt.item_id, lt.location_id, lt.value_remaining from public.stock_count_lines l
            join public.inv_lots lt on lt.id = l.lot_id where l.count_id = c.id and l.counted_qty <> l.system_qty
            order by l.lot_id for update of lt loop
    d := cl.counted_qty - cl.system_qty;
    if cl.qty_on_hand + d < 0 then
      raise exception 'stock moved after the count was submitted; cancel and count again' using errcode = '22023';
    end if;
    v := case when cl.qty_on_hand + d = 0 then -cl.value_remaining else round(d * cl.unit_cost, 2) end;
    update public.inv_lots set qty_on_hand = qty_on_hand + d, value_remaining = value_remaining + v where id = cl.lot_id;
    insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id)
    values (cl.lot_id, cl.item_id, cl.location_id, 'count_adjust', d, cl.unit_cost, v, 'stock_count', c.id);
    if v < 0 then v_loss := v_loss - v; else v_gain := v_gain + v; end if;
  end loop;
  if v_loss > 0 or v_gain > 0 then
    v_org := app.org_of_branch(c.branch_id);
    v_je := app.post_journal(v_org, c.branch_id, app.cairo_today(), 'Stock count ' || c.ref, 'stock_count', c.id,
      jsonb_build_array(   -- one-sided lines: losses and gains shown separately
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory_adjustments'), 'debit', v_loss, 'memo', 'count losses'),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_loss, 'memo', 'count losses'),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'debit', v_gain, 'memo', 'count gains'),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory_adjustments'), 'credit', v_gain, 'memo', 'count gains')));
  end if;
  update public.stock_counts set status = 'approved', approved_by = auth.uid(), approved_at = now(), journal_entry_id = v_je,
         net_value = v_gain - v_loss
  where id = c.id returning * into c;
  return c;
end $$;

create or replace function public.cancel_count(p_count uuid, p_reason text)
returns public.stock_counts language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'count not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('inventory.count', c.branch_id) or app.has_permission('inventory.approve', c.branch_id)) then
    raise exception 'permission denied: inventory.count' using errcode = '42501';
  end if;
  if c.status not in ('draft', 'submitted') then raise exception 'count already %', c.status using errcode = '22023'; end if;
  if c.status = 'submitted' and c.counted_by <> auth.uid() and not app.has_permission('inventory.approve', c.branch_id) then
    raise exception 'permission denied: only the counter or an approver can cancel a submitted count' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.stock_counts set status = 'cancelled', note = trim(p_reason) where id = c.id returning * into c;
  return c;
end $$;

-- Suggested consumables for an appointment, from the templates of the services invoiced for it.
-- (Issuers such as nurses cannot read invoices; this returns only item ids and quantities.)
create or replace function public.issue_template(p_appointment uuid)
returns table (item_id uuid, qty numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select sc.item_id, sum(sc.qty * l.quantity)
  from public.appointments a
  join public.invoices i on i.appointment_id = a.id and i.status <> 'void'
  join public.invoice_lines l on l.invoice_id = i.id
  join public.service_consumables sc on sc.service_id = l.service_id
  where a.id = p_appointment and app.has_permission('inventory.issue', a.branch_id)
  group by sc.item_id
$$;

-- Stock position per item for a store, with alerts (read-only helper for the UI).
create or replace function public.inventory_position(p_location uuid)
returns table (item_id uuid, code text, name_ar text, name_en text, unit text, category text, is_controlled boolean, reorder_level numeric,
               on_hand numeric, usable numeric, value numeric, expired_qty numeric, next_expiry date, below_reorder boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select i.id, i.code, i.name_ar, i.name_en, i.unit, i.category, i.is_controlled, i.reorder_level,
         coalesce(sum(l.qty_on_hand), 0),
         coalesce(sum(l.qty_on_hand) filter (where l.expiry is null or l.expiry > app.cairo_today()), 0),
         coalesce(sum(l.value_remaining), 0),
         coalesce(sum(l.qty_on_hand) filter (where l.expiry <= app.cairo_today()), 0),
         min(l.expiry) filter (where l.qty_on_hand > 0 and l.expiry > app.cairo_today()),
         coalesce(sum(l.qty_on_hand) filter (where l.expiry is null or l.expiry > app.cairo_today()), 0) <= i.reorder_level and i.reorder_level > 0
  from public.inv_items i
  left join public.inv_lots l on l.item_id = i.id and l.location_id = p_location and l.qty_on_hand > 0
  where i.is_active
    and app.has_permission('inventory.read', (select branch_id from public.inv_locations where id = p_location))
  group by i.id order by i.code
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['inv_items', 'suppliers', 'service_consumables'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_active_staff())', t || '_read', t);
    -- Shared by all branches: only an all-branch inventory manager may change them.
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_global_permission(''inventory.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_global_permission(''inventory.manage'')) with check (app.has_global_permission(''inventory.manage''))', t || '_update', t);
  end loop;
end $$;
grant delete on public.service_consumables to authenticated;
create policy service_consumables_delete on public.service_consumables for delete to authenticated using (app.has_global_permission('inventory.manage'));

-- Changing whether an item is controlled, or its category (which drives expiry rules), needs the
-- controlled-items authority (medical director by default).
create or replace function app.inv_items_guard()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.is_controlled is not true) then return new; end if;
  if (tg_op = 'INSERT' or new.is_controlled is distinct from old.is_controlled or new.category is distinct from old.category)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') and not app.has_permission('inventory.controlled') then
    raise exception 'changing controlled status or category needs the controlled-items authority' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_inv_items_guard before insert or update on public.inv_items for each row execute function app.inv_items_guard();

alter table public.inv_locations enable row level security;
grant select, insert, update on public.inv_locations to authenticated;
create policy inv_locations_read on public.inv_locations for select to authenticated using (app.is_active_staff());
create policy inv_locations_insert on public.inv_locations for insert to authenticated with check (app.has_permission('inventory.manage', branch_id));
create policy inv_locations_update on public.inv_locations for update to authenticated using (app.has_permission('inventory.manage', branch_id)) with check (app.has_permission('inventory.manage', branch_id));

create or replace function app.inv_can_read(p_location uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('inventory.read', (select branch_id from public.inv_locations where id = p_location))
      or app.has_permission('inventory.issue', (select branch_id from public.inv_locations where id = p_location))
$$;
alter table public.inv_lots enable row level security;
alter table public.stock_moves enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.stock_issues enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
grant select on public.inv_lots, public.stock_moves, public.goods_receipts, public.goods_receipt_lines, public.stock_issues,
  public.stock_counts, public.stock_count_lines to authenticated;
grant all on public.inv_items, public.inv_locations, public.suppliers, public.service_consumables, public.inv_lots, public.stock_moves,
  public.goods_receipts, public.goods_receipt_lines, public.stock_issues, public.stock_counts, public.stock_count_lines to service_role;
create policy inv_lots_read on public.inv_lots for select to authenticated using (app.inv_can_read(location_id));
create policy stock_moves_read on public.stock_moves for select to authenticated using (app.has_permission('inventory.read', (select branch_id from public.inv_locations where id = location_id)));
create policy goods_receipts_read on public.goods_receipts for select to authenticated using (app.has_permission('inventory.read', branch_id));
create policy goods_receipt_lines_read on public.goods_receipt_lines for select to authenticated using (exists (select 1 from public.goods_receipts g where g.id = receipt_id));
create policy stock_issues_read on public.stock_issues for select to authenticated using (app.has_permission('inventory.read', branch_id) or created_by = auth.uid());
create policy stock_counts_read on public.stock_counts for select to authenticated
  using (app.has_permission('inventory.read', branch_id) or app.has_permission('inventory.count', branch_id) or app.has_permission('inventory.approve', branch_id));
create policy stock_count_lines_read on public.stock_count_lines for select to authenticated using (exists (select 1 from public.stock_counts c where c.id = count_id));

revoke execute on all functions in schema public from public;
grant execute on function public.receive_goods(uuid, uuid, text, jsonb, text), public.issue_stock(uuid, jsonb, uuid, text, text),
  public.start_count(uuid), public.submit_count(uuid, jsonb), public.approve_count(uuid), public.cancel_count(uuid, text),
  public.inventory_position(uuid), public.issue_template(uuid) to authenticated;
grant execute on function app.inv_can_read(uuid), app.cairo_today() to authenticated;
