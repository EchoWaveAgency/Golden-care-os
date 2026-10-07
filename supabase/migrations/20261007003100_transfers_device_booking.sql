-- Golden Care OS — 0031 Stock transfers between stores and branches; device booking without double use.

-- ---------------------------------------------------------------------------
-- Stock transfers: requested → dispatched (stock leaves the source, FEFO) → received (lots recreated at the
-- destination with the same cost and expiry; shortages written off with a note). Between branches the value passes
-- through "inventory in transit" so each branch's books are right on the day.
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, '1310', 'مخزون في الطريق بين الفروع', 'Inventory in transit', 'asset'::public.account_type, true from public.organizations o
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, 'inventory_in_transit', a.id from public.accounts a where a.code = '1310'
on conflict do nothing;

alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check check (kind in ('receipt', 'issue', 'count_adjust', 'supplier_return', 'transfer_out', 'transfer_in'));

create table public.stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('TRF'),
  from_location_id uuid not null references public.inv_locations(id),
  to_location_id   uuid not null references public.inv_locations(id) check (to_location_id <> from_location_id),
  from_branch_id   uuid not null references public.branches(id),
  to_branch_id     uuid not null references public.branches(id),
  status           text not null default 'requested' check (status in ('requested', 'dispatched', 'received', 'cancelled')),
  note             text,
  requested_by     uuid not null default auth.uid(),
  requested_at     timestamptz not null default now(),
  dispatched_by    uuid,
  dispatched_at    timestamptz,
  received_by      uuid,
  received_at      timestamptz,
  value            numeric(14,2),
  shortage_value   numeric(14,2),
  receive_note     text,
  cancel_reason    text,
  out_journal_id   uuid references public.journal_entries(id),
  in_journal_id    uuid references public.journal_entries(id)
);
create table public.stock_transfer_lines (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references public.stock_transfers(id),
  item_id       uuid not null references public.inv_items(id),
  qty           numeric(14,3) not null check (qty > 0),
  unique (transfer_id, item_id)
);
-- What actually left, lot by lot (so the destination gets the same lots, costs and expiries).
create table public.stock_transfer_lots (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references public.stock_transfers(id),
  item_id       uuid not null references public.inv_items(id),
  from_lot_id   uuid not null references public.inv_lots(id),
  lot_no        text not null,
  expiry        date,
  unit_cost     numeric(14,4) not null,
  qty           numeric(14,3) not null check (qty > 0),
  value         numeric(14,2) not null,
  received_qty  numeric(14,3),
  to_lot_id     uuid references public.inv_lots(id)
);
create trigger trg_audit_stock_transfers after insert or update on public.stock_transfers for each row execute function app.audit_row();
create trigger trg_stock_transfers_no_delete before delete on public.stock_transfers for each row execute function app.block_delete();

create or replace function public.request_stock_transfer(p_from uuid, p_to uuid, p_lines jsonb, p_note text)
returns public.stock_transfers language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare a public.inv_locations; b public.inv_locations; t public.stock_transfers; l jsonb;
begin
  select * into a from public.inv_locations where id = p_from and is_active;
  select * into b from public.inv_locations where id = p_to and is_active;
  if a.id is null or b.id is null then raise exception 'store not found' using errcode = 'P0002'; end if;
  if a.id = b.id then raise exception 'choose two different stores' using errcode = '22023'; end if;
  if not (app.has_permission('inventory.manage', a.branch_id) or app.has_permission('inventory.manage', b.branch_id)) then
    raise exception 'permission denied: inventory.manage' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'add at least one line' using errcode = '22023'; end if;
  insert into public.stock_transfers (from_location_id, to_location_id, from_branch_id, to_branch_id, note)
  values (a.id, b.id, a.branch_id, b.branch_id, nullif(trim(p_note), '')) returning * into t;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'quantity must be positive' using errcode = '22023'; end if;
    insert into public.stock_transfer_lines (transfer_id, item_id, qty) values (t.id, (l->>'item_id')::uuid, round((l->>'qty')::numeric, 3));
  end loop;
  return t;
exception when unique_violation then
  raise exception 'each item can appear only once in a transfer' using errcode = '22023';
end $$;

create or replace function public.dispatch_stock_transfer(p_id uuid)
returns public.stock_transfers language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.stock_transfers; ln record; lot record; need numeric; take numeric; v_val numeric; v_total numeric := 0; v_org uuid; it public.inv_items;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission('inventory.manage', t.from_branch_id);
  if t.status <> 'requested' then raise exception 'transfer already %', t.status using errcode = '22023'; end if;
  perform app.require_not_counting(t.from_location_id);
  perform set_config('app.inventory_rpc', 'on', true);
  perform 1 from public.inv_lots where location_id = t.from_location_id
    and item_id in (select item_id from public.stock_transfer_lines where transfer_id = t.id) order by id for update;
  for ln in select * from public.stock_transfer_lines where transfer_id = t.id order by id loop
    select * into it from public.inv_items where id = ln.item_id;
    if it.is_controlled and not app.has_permission('inventory.controlled', t.from_branch_id) then
      raise exception 'controlled item % needs special authorization', it.code using errcode = '42501';
    end if;
    need := ln.qty;
    for lot in select * from public.inv_lots
               where item_id = ln.item_id and location_id = t.from_location_id and qty_on_hand > 0 and (expiry is null or expiry > app.cairo_today())
               order by expiry nulls last, received_at, id loop
      exit when need <= 0;
      take := least(need, lot.qty_on_hand);
      v_val := case when take = lot.qty_on_hand then lot.value_remaining else least(round(take * lot.unit_cost, 2), lot.value_remaining) end;
      update public.inv_lots set qty_on_hand = qty_on_hand - take, value_remaining = value_remaining - v_val where id = lot.id;
      insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id)
      values (lot.id, lot.item_id, t.from_location_id, 'transfer_out', -take, lot.unit_cost, -v_val, 'stock_transfer', t.id);
      insert into public.stock_transfer_lots (transfer_id, item_id, from_lot_id, lot_no, expiry, unit_cost, qty, value)
      values (t.id, lot.item_id, lot.id, lot.lot_no, lot.expiry, lot.unit_cost, take, v_val);
      v_total := v_total + v_val; need := need - take;
    end loop;
    if need > 0 then raise exception 'not enough stock of % (short %)', it.code, need using errcode = '22023'; end if;
  end loop;
  v_org := app.org_of_branch(t.from_branch_id);
  update public.stock_transfers set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now(), value = v_total,
    out_journal_id = case when t.from_branch_id <> t.to_branch_id and v_total > 0 then app.post_journal(v_org, t.from_branch_id, app.cairo_today(),
      'Stock transfer out ' || t.ref, 'stock_transfer', t.id, jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory_in_transit'), 'debit', v_total, 'memo', t.ref),
        jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_total, 'memo', t.ref))) end
  where id = t.id returning * into t;
  return t;
end $$;

-- Receiving: quantities per dispatched lot (default: all). A shortage is written off with the receiver's note.
create or replace function public.receive_stock_transfer(p_id uuid, p_received jsonb, p_note text)
returns public.stock_transfers language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.stock_transfers; tl record; v_got numeric; v_in numeric := 0; v_short numeric := 0; v_val numeric; v_lot uuid; v_org uuid;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('inventory.receive', t.to_branch_id) or app.has_permission('inventory.issue', t.to_branch_id)) then
    raise exception 'permission denied: inventory.receive' using errcode = '42501';
  end if;
  if t.status <> 'dispatched' then raise exception 'only a dispatched transfer can be received' using errcode = '22023'; end if;
  if t.dispatched_by = auth.uid() then raise exception 'separation of duties: the sender cannot also confirm receipt' using errcode = '42501'; end if;
  perform set_config('app.inventory_rpc', 'on', true);
  for tl in select * from public.stock_transfer_lots where transfer_id = t.id order by id for update loop
    v_got := coalesce((p_received->>tl.id::text)::numeric, tl.qty);
    if v_got < 0 or v_got > tl.qty then raise exception 'received quantity must be between 0 and what was sent' using errcode = '22023'; end if;
    v_val := case when v_got = tl.qty then tl.value else round(tl.value * v_got / tl.qty, 2) end;
    if v_got > 0 then
      insert into public.inv_lots (item_id, location_id, lot_no, expiry, unit_cost, qty_on_hand, value_remaining, receipt_id)
      values (tl.item_id, t.to_location_id, tl.lot_no, tl.expiry, tl.unit_cost, v_got, v_val, null) returning id into v_lot;
      insert into public.stock_moves (lot_id, item_id, location_id, kind, qty, unit_cost, value, ref_type, ref_id)
      values (v_lot, tl.item_id, t.to_location_id, 'transfer_in', v_got, tl.unit_cost, v_val, 'stock_transfer', t.id);
    end if;
    update public.stock_transfer_lots set received_qty = v_got, to_lot_id = v_lot where id = tl.id;
    v_in := v_in + v_val; v_short := v_short + (tl.value - v_val); v_lot := null;
  end loop;
  if v_short > 0 and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'explain the shortage in the note' using errcode = '22023'; end if;
  v_org := app.org_of_branch(t.to_branch_id);
  update public.stock_transfers set status = 'received', received_by = auth.uid(), received_at = now(), shortage_value = v_short,
    receive_note = nullif(trim(p_note), ''),
    in_journal_id = case when t.from_branch_id <> t.to_branch_id and t.value > 0 then app.post_journal(v_org, t.to_branch_id, app.cairo_today(),
        'Stock transfer in ' || t.ref, 'stock_transfer', t.id, jsonb_build_array(
          jsonb_build_object('account_id', app.account_for(v_org, 'inventory_in_transit'), 'credit', t.value, 'memo', t.ref))
        || case when v_in > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'debit', v_in, 'memo', t.ref)) else '[]'::jsonb end
        || case when v_short > 0 then jsonb_build_array(jsonb_build_object('account_id', app.account_for(v_org, 'inventory_adjustments'), 'debit', v_short, 'memo', 'shortage ' || t.ref)) else '[]'::jsonb end)
      when v_short > 0 then app.post_journal(v_org, t.to_branch_id, app.cairo_today(), 'Stock transfer shortage ' || t.ref, 'stock_transfer', t.id, jsonb_build_array(
          jsonb_build_object('account_id', app.account_for(v_org, 'inventory_adjustments'), 'debit', v_short, 'memo', t.ref),
          jsonb_build_object('account_id', app.account_for(v_org, 'inventory'), 'credit', v_short, 'memo', t.ref)))
    end
  where id = t.id returning * into t;
  return t;
end $$;

create or replace function public.cancel_stock_transfer(p_id uuid, p_reason text)
returns public.stock_transfers language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.stock_transfers;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  if not (app.has_permission('inventory.manage', t.from_branch_id) or app.has_permission('inventory.manage', t.to_branch_id)) then raise exception 'permission denied' using errcode = '42501'; end if;
  if t.status <> 'requested' then raise exception 'only a transfer not yet sent can be cancelled' using errcode = '22023'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.stock_transfers set status = 'cancelled', cancel_reason = trim(p_reason) where id = t.id returning * into t;
  return t;
end $$;

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_transfer_lots enable row level security;
create policy stock_transfers_read on public.stock_transfers for select to authenticated
  using (app.has_permission('inventory.read', from_branch_id) or app.has_permission('inventory.read', to_branch_id));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated
  using (exists (select 1 from public.stock_transfers t where t.id = transfer_id and (app.has_permission('inventory.read', t.from_branch_id) or app.has_permission('inventory.read', t.to_branch_id))));
create policy stock_transfer_lots_read on public.stock_transfer_lots for select to authenticated
  using (exists (select 1 from public.stock_transfers t where t.id = transfer_id and (app.has_permission('inventory.read', t.from_branch_id) or app.has_permission('inventory.read', t.to_branch_id))));
grant select on public.stock_transfers, public.stock_transfer_lines, public.stock_transfer_lots to authenticated;

-- ---------------------------------------------------------------------------
-- Devices on appointments: a device cannot be booked twice at the same time, nor while out of service.
-- ---------------------------------------------------------------------------
alter table public.appointments add column if not exists device_id uuid references public.devices(id);
alter table public.appointments add constraint no_device_overlap exclude using gist (device_id with =, slot with &&)
  where (device_id is not null and status not in ('canceled', 'no_show'));

create or replace function app.appointment_device_guard()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.devices;
begin
  if new.device_id is null or (tg_op = 'UPDATE' and new.device_id is not distinct from old.device_id and new.slot = old.slot) then return new; end if;
  select * into d from public.devices where id = new.device_id;
  if not found or d.branch_id <> new.branch_id then raise exception 'device not found in this branch' using errcode = '22023'; end if;
  if d.status <> 'active' then raise exception 'the device is out of service' using errcode = '22023'; end if;
  return new;
end $$;
create trigger trg_appointment_device_guard before insert or update of device_id, slot on public.appointments for each row execute function app.appointment_device_guard();

-- Upcoming bookings that need moving when a device goes down.
create or replace function public.device_bookings_at_risk(p_branch uuid)
returns table (appointment_id uuid, ref text, slot tstzrange, device_id uuid, device_ar text, device_en text, patient_id uuid)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.id, a.ref, a.slot, d.id, d.name_ar, d.name_en, a.patient_id
  from public.appointments a join public.devices d on d.id = a.device_id
  where a.branch_id = p_branch and d.status <> 'active' and a.status in ('requested', 'booked', 'pending_confirmation', 'confirmed')
    and lower(a.slot) > now() and app.has_permission('appointment.read', p_branch)
  order by lower(a.slot)
$$;

revoke execute on function public.request_stock_transfer(uuid, uuid, jsonb, text), public.dispatch_stock_transfer(uuid), public.receive_stock_transfer(uuid, jsonb, text),
  public.cancel_stock_transfer(uuid, text), public.device_bookings_at_risk(uuid) from public, anon;
grant execute on function public.request_stock_transfer(uuid, uuid, jsonb, text), public.dispatch_stock_transfer(uuid), public.receive_stock_transfer(uuid, jsonb, text),
  public.cancel_stock_transfer(uuid, text), public.device_bookings_at_risk(uuid) to authenticated;

-- Reception sees the branch's devices to book them (name, number and status; maintenance stays with device staff).
create policy devices_read_for_booking on public.devices for select to authenticated using (app.has_permission('appointment.write', branch_id));
