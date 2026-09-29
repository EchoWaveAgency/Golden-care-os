-- Golden Care OS — 0017 Devices & maintenance, laser session records, patient packages
-- Devices keep a monotonic usage counter (laser pulses). A laser session is signed only when the counter
-- readings reconcile with the pulses recorded per area. Packages are sold on an invoice whose revenue is
-- deferred (2210) and recognised one session at a time when a signed session redeems it.

-- ---------------------------------------------------------------------------
-- Accounts, settings, permissions, roles
-- ---------------------------------------------------------------------------
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, '4130', 'إيرادات باقات منتهية الصلاحية', 'Expired package revenue', 'revenue', true from public.organizations o
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('package_deferred', '2210'), ('package_breakage', '4130')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.roles (code, name_ar, name_en, is_privileged) values
  ('device_officer', 'مسؤول الأجهزة والصيانة', 'Device & Maintenance Officer', false)
on conflict (code) do nothing;

insert into public.permissions (code, module, description) values
  ('device.read',     'devices',  'View devices, counters, maintenance and alerts'),
  ('device.manage',   'devices',  'Register devices and change their configuration; reset counters after service'),
  ('device.maintain', 'devices',  'Open and close maintenance work orders; record counter readings'),
  ('laser.operate',   'laser',    'Record and sign laser sessions'),
  ('laser.override',  'laser',    'Sign a laser session despite a positive contraindication (with a written reason)'),
  ('package.read',    'packages', 'View patient packages and balances'),
  ('package.sell',    'packages', 'Sell packages to patients (creates and issues the invoice)'),
  ('package.manage',  'packages', 'Define package templates and prices (all branches)'),
  ('package.expire',  'packages', 'Expire packages past their validity (posts the unused balance)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('device_officer', 'device.read'), ('device_officer', 'device.manage'), ('device_officer', 'device.maintain'),
  ('operations_manager', 'device.read'), ('operations_manager', 'device.maintain'),
  ('center_director', 'device.read'), ('medical_director', 'device.read'), ('quality_manager', 'device.read'),
  ('nurse', 'device.read'),
  ('doctor', 'laser.operate'), ('doctor', 'laser.override'), ('nurse', 'laser.operate'),
  ('medical_director', 'laser.operate'), ('medical_director', 'laser.override'),
  ('front_desk', 'package.read'), ('front_desk', 'package.sell'), ('cashier', 'package.read'),
  ('patient_relations', 'package.read'), ('nurse', 'package.read'), ('doctor', 'package.read'),
  ('chief_accountant', 'package.read'), ('chief_accountant', 'package.manage'), ('chief_accountant', 'package.expire'),
  ('accountant', 'package.read'), ('center_director', 'package.read'), ('center_director', 'package.manage'),
  ('financial_auditor', 'package.read')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  asset_no         text not null unique check (asset_no ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  branch_id        uuid not null references public.branches(id),
  room_id          uuid references public.rooms(id),
  name_ar          text not null,
  name_en          text not null,
  category         text not null default 'laser' check (category in ('laser', 'ipl', 'rf', 'energy_other', 'dental', 'imaging', 'sterilization', 'other')),
  manufacturer     text,
  model            text,
  serial_no        text,
  supplier_id      uuid references public.suppliers(id),
  purchase_date    date,
  purchase_cost    numeric(14,2) check (purchase_cost >= 0),
  warranty_until   date,
  status           text not null default 'active' check (status in ('active', 'down', 'retired')),
  counter_unit     text check (counter_unit in ('pulses', 'shots', 'hours')),
  counter_value    bigint not null default 0 check (counter_value >= 0),
  expected_life    bigint check (expected_life > 0),          -- e.g. rated pulses of the lamp / device
  service_every    bigint check (service_every > 0),          -- service every N counter units
  counter_next_service bigint,
  pm_interval_days int check (pm_interval_days between 1 and 1095),
  next_pm_due      date,
  calibration_interval_days int check (calibration_interval_days between 1 and 1095),
  calibration_due  date,
  -- Approved treatment parameters, e.g. {"wavelengths":[755,1064],"spot_mm":[6,8,10,12,15,18],
  -- "fluence":{"755":[2,50],"1064":[2,300]},"pulse_width_ms":[0.35,300]}. Empty = not restricted.
  params           jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index devices_serial_once on public.devices (manufacturer, serial_no) where serial_no is not null;
create trigger trg_audit_devices after insert or update on public.devices for each row execute function app.audit_row();
create trigger trg_devices_no_delete before delete on public.devices for each row execute function app.block_delete();

-- Status, counter and schedule fields move only inside the RPCs below.
create or replace function app.devices_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.device_rpc', true), '') <> 'on' then
    raise exception 'devices change only through the device screens' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_devices_guard before insert or update on public.devices for each row execute function app.devices_guard();

create table public.device_counter_readings (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices(id),
  reading     bigint not null check (reading >= 0),
  delta       bigint not null,                -- change from the previous known value (sessions: pulses of the session)
  gap         bigint not null default 0,      -- pulses fired with no session recorded (before-reading above last known value)
  source      text not null check (source in ('initial', 'session', 'manual', 'service_reset')),
  session_id  uuid,
  work_order_id uuid,
  note        text,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now()
);
create index on public.device_counter_readings (device_id, recorded_at desc);
create trigger trg_counter_readings_immutable before update or delete on public.device_counter_readings for each row execute function app.block_delete();

create table public.maintenance_orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default app.next_ref('WO'),
  device_id     uuid not null references public.devices(id),
  branch_id     uuid not null references public.branches(id),
  kind          text not null check (kind in ('preventive', 'breakdown', 'calibration', 'safety_check')),
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  device_down   boolean not null default false,
  problem       text not null,
  reported_by   uuid default auth.uid(),
  reported_at   timestamptz not null default now(),
  technician    text,
  vendor_id     uuid references public.suppliers(id),
  parts         text,
  parts_cost    numeric(14,2) not null default 0 check (parts_cost >= 0),
  labor_cost    numeric(14,2) not null default 0 check (labor_cost >= 0),
  result        text,
  passed        boolean,                       -- calibration / safety check outcome
  counter_at_service bigint,
  closed_by     uuid,
  closed_at     timestamptz,
  cancel_reason text
);
create index on public.maintenance_orders (device_id, reported_at desc);
create trigger trg_audit_maintenance_orders after insert or update on public.maintenance_orders for each row execute function app.audit_row();
create trigger trg_maintenance_no_delete before delete on public.maintenance_orders for each row execute function app.block_delete();
create or replace function app.maintenance_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.device_rpc', true), '') <> 'on' then
    raise exception 'devices change only through the device screens' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_maintenance_guard before insert or update on public.maintenance_orders for each row execute function app.maintenance_guard();

-- Device status rule (one place): retired stays retired; down while an open order keeps it down or while the
-- latest calibration / safety check failed; otherwise in service.
create or replace function app.device_status(p_device uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when d.status = 'retired' then 'retired'
    when exists (select 1 from public.maintenance_orders o where o.device_id = d.id and o.status = 'open' and o.device_down) then 'down'
    when coalesce((select not o.passed from public.maintenance_orders o where o.device_id = d.id and o.status = 'closed'
                   and o.kind in ('calibration', 'safety_check') order by o.closed_at desc limit 1), false) then 'down'
    else 'active' end
  from public.devices d where d.id = p_device
$$;

-- Register or update a device's configuration. Counter/status/schedule dates are never set here after creation.
create or replace function public.save_device(p jsonb)
returns public.devices language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.devices; v_branch uuid := (p->>'branch_id')::uuid; v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_id is not null then
    select * into d from public.devices where id = v_id for update;
    if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
    v_branch := d.branch_id;          -- a device moves between branches only by re-registration (audited)
  end if;
  perform app.require_permission('device.manage', v_branch);
  if coalesce(trim(p->>'name_ar'), '') = '' or coalesce(trim(p->>'asset_no'), '') = '' then
    raise exception 'asset number and name are required' using errcode = '22023';
  end if;
  if nullif(p->>'room_id', '') is not null and not exists (select 1 from public.rooms where id = (p->>'room_id')::uuid and branch_id = v_branch) then
    raise exception 'room belongs to another branch' using errcode = '22023';
  end if;
  if p ? 'params' and jsonb_typeof(p->'params') <> 'object' then raise exception 'params must be an object' using errcode = '22023'; end if;
  perform set_config('app.device_rpc', 'on', true);
  if v_id is null then
    insert into public.devices (asset_no, branch_id, room_id, name_ar, name_en, category, manufacturer, model, serial_no, supplier_id,
      purchase_date, purchase_cost, warranty_until, counter_unit, counter_value, expected_life, service_every, counter_next_service,
      pm_interval_days, next_pm_due, calibration_interval_days, calibration_due, params, notes)
    values (upper(trim(p->>'asset_no')), v_branch, nullif(p->>'room_id', '')::uuid, trim(p->>'name_ar'), coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')),
      coalesce(nullif(p->>'category', ''), 'laser'), nullif(trim(p->>'manufacturer'), ''), nullif(trim(p->>'model'), ''), nullif(trim(p->>'serial_no'), ''),
      nullif(p->>'supplier_id', '')::uuid, nullif(p->>'purchase_date', '')::date, nullif(p->>'purchase_cost', '')::numeric, nullif(p->>'warranty_until', '')::date,
      nullif(p->>'counter_unit', ''), coalesce(nullif(p->>'counter_value', '')::bigint, 0), nullif(p->>'expected_life', '')::bigint,
      nullif(p->>'service_every', '')::bigint,
      case when nullif(p->>'service_every', '') is not null then coalesce(nullif(p->>'counter_value', '')::bigint, 0) + (p->>'service_every')::bigint end,
      nullif(p->>'pm_interval_days', '')::int, coalesce(nullif(p->>'next_pm_due', '')::date, app.cairo_today() + nullif(p->>'pm_interval_days', '')::int),
      nullif(p->>'calibration_interval_days', '')::int, coalesce(nullif(p->>'calibration_due', '')::date, app.cairo_today() + nullif(p->>'calibration_interval_days', '')::int),
      coalesce(p->'params', '{}'::jsonb), nullif(trim(p->>'notes'), ''))
    returning * into d;
    if d.counter_unit is not null then
      insert into public.device_counter_readings (device_id, reading, delta, source, note) values (d.id, d.counter_value, 0, 'initial', null);
    end if;
  else
    update public.devices set asset_no = upper(trim(p->>'asset_no')), room_id = nullif(p->>'room_id', '')::uuid, name_ar = trim(p->>'name_ar'),
      name_en = coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')), category = coalesce(nullif(p->>'category', ''), category),
      manufacturer = nullif(trim(p->>'manufacturer'), ''), model = nullif(trim(p->>'model'), ''), serial_no = nullif(trim(p->>'serial_no'), ''),
      supplier_id = nullif(p->>'supplier_id', '')::uuid, purchase_date = nullif(p->>'purchase_date', '')::date,
      purchase_cost = nullif(p->>'purchase_cost', '')::numeric, warranty_until = nullif(p->>'warranty_until', '')::date,
      expected_life = nullif(p->>'expected_life', '')::bigint, service_every = nullif(p->>'service_every', '')::bigint,
      counter_next_service = case when nullif(p->>'service_every', '') is null then null
                                  when service_every is distinct from nullif(p->>'service_every', '')::bigint then counter_value + (p->>'service_every')::bigint
                                  else counter_next_service end,
      pm_interval_days = nullif(p->>'pm_interval_days', '')::int, calibration_interval_days = nullif(p->>'calibration_interval_days', '')::int,
      next_pm_due = coalesce(next_pm_due, app.cairo_today() + nullif(p->>'pm_interval_days', '')::int),
      calibration_due = coalesce(calibration_due, app.cairo_today() + nullif(p->>'calibration_interval_days', '')::int),
      params = coalesce(p->'params', params), notes = nullif(trim(p->>'notes'), '')
    where id = d.id returning * into d;
  end if;
  return d;
exception when unique_violation then
  raise exception 'asset number or serial number already registered' using errcode = '23505';
end $$;

create or replace function public.retire_device(p_device uuid, p_reason text)
returns public.devices language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.devices;
begin
  select * into d from public.devices where id = p_device for update;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  perform app.require_permission('device.manage', d.branch_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if exists (select 1 from public.maintenance_orders where device_id = d.id and status = 'open') then
    raise exception 'close or cancel the open work orders first' using errcode = '22023';
  end if;
  perform set_config('app.device_rpc', 'on', true);
  update public.devices set status = 'retired', notes = concat_ws(E'\n', notes, 'Retired: ' || trim(p_reason)) where id = d.id returning * into d;
  return d;
end $$;

-- Manual counter reading (e.g. monthly check or after a vendor visit). A reading above the last known value is
-- recorded as unlogged use (pulses with no session). Lower readings are only allowed as a service reset.
create or replace function public.record_counter_reading(p_device uuid, p_reading bigint, p_note text default null, p_reset boolean default false)
returns public.device_counter_readings language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.devices; r public.device_counter_readings;
begin
  select * into d from public.devices where id = p_device for update;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  if d.counter_unit is null then raise exception 'this device has no usage counter' using errcode = '22023'; end if;
  if d.status = 'retired' then raise exception 'device is retired' using errcode = '22023'; end if;
  if p_reading is null or p_reading < 0 then raise exception 'reading is required' using errcode = '22023'; end if;
  perform set_config('app.device_rpc', 'on', true);
  if p_reset then
    perform app.require_permission('device.manage', d.branch_id);
    if coalesce(trim(p_note), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
    -- A reset only ever lowers the counter (new part); a higher reading is unlogged use and goes through the normal path.
    if p_reading >= d.counter_value then raise exception 'a reset must be lower than the current reading; record a normal reading instead' using errcode = '22023'; end if;
    insert into public.device_counter_readings (device_id, reading, delta, source, note)
    values (d.id, p_reading, p_reading - d.counter_value, 'service_reset', trim(p_note)) returning * into r;
    update public.devices set counter_value = p_reading,
      counter_next_service = case when service_every is not null then p_reading + service_every end where id = d.id;
    return r;
  end if;
  perform app.require_permission('device.maintain', d.branch_id);
  if p_reading < d.counter_value then
    raise exception 'counter reading is lower than the last recorded reading (%)', d.counter_value using errcode = '22023';
  end if;
  insert into public.device_counter_readings (device_id, reading, delta, gap, source, note)
  values (d.id, p_reading, p_reading - d.counter_value, p_reading - d.counter_value, 'manual', nullif(trim(p_note), '')) returning * into r;
  update public.devices set counter_value = p_reading where id = d.id;
  return r;
end $$;

create or replace function public.open_work_order(p_device uuid, p_kind text, p_problem text, p_device_down boolean default false)
returns public.maintenance_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.devices; w public.maintenance_orders;
begin
  select * into d from public.devices where id = p_device for update;
  if not found then raise exception 'device not found' using errcode = 'P0002'; end if;
  perform app.require_permission('device.maintain', d.branch_id);
  if d.status = 'retired' then raise exception 'device is retired' using errcode = '22023'; end if;
  if coalesce(trim(p_problem), '') = '' then raise exception 'describe the problem or the planned work' using errcode = '22023'; end if;
  perform set_config('app.device_rpc', 'on', true);
  insert into public.maintenance_orders (device_id, branch_id, kind, problem, device_down)
  values (d.id, d.branch_id, p_kind, trim(p_problem), coalesce(p_device_down, false) or p_kind = 'breakdown') returning * into w;
  if w.device_down then update public.devices set status = 'down' where id = d.id; end if;
  return w;
end $$;

-- Close: records the work, costs and result; brings the device back into service unless another open order keeps
-- it down or a calibration / safety check failed; moves the next preventive / calibration dates.
create or replace function public.close_work_order(p_order uuid, p jsonb)
returns public.maintenance_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare w public.maintenance_orders; d public.devices; v_passed boolean := (p->>'passed')::boolean; v_reading bigint := nullif(p->>'counter_reading', '')::bigint;
begin
  select * into w from public.maintenance_orders where id = p_order for update;
  if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
  select * into d from public.devices where id = w.device_id for update;
  perform app.require_permission('device.maintain', w.branch_id);
  if w.status <> 'open' then raise exception 'work order is already %', w.status using errcode = '22023'; end if;
  if coalesce(trim(p->>'result'), '') = '' then raise exception 'describe the work done' using errcode = '22023'; end if;
  if w.kind in ('calibration', 'safety_check') and v_passed is null then
    raise exception 'record whether the check passed' using errcode = '22023';
  end if;
  if v_reading is not null then
    if d.counter_unit is null then raise exception 'this device has no usage counter' using errcode = '22023'; end if;
    if v_reading < d.counter_value then
      raise exception 'counter reading is lower than the last recorded reading (%)', d.counter_value using errcode = '22023';
    end if;
  end if;
  perform set_config('app.device_rpc', 'on', true);
  update public.maintenance_orders set status = 'closed', result = trim(p->>'result'), technician = nullif(trim(p->>'technician'), ''),
    vendor_id = nullif(p->>'vendor_id', '')::uuid, parts = nullif(trim(p->>'parts'), ''),
    parts_cost = round(coalesce(nullif(p->>'parts_cost', '')::numeric, 0), 2), labor_cost = round(coalesce(nullif(p->>'labor_cost', '')::numeric, 0), 2),
    passed = v_passed, counter_at_service = coalesce(v_reading, d.counter_value), closed_by = auth.uid(), closed_at = now()
  where id = w.id returning * into w;
  if v_reading is not null and v_reading > d.counter_value then
    insert into public.device_counter_readings (device_id, reading, delta, gap, source, work_order_id, note)
    values (d.id, v_reading, v_reading - d.counter_value, v_reading - d.counter_value, 'manual', w.id, w.ref);
    d.counter_value := v_reading;
  end if;
  update public.devices set
    counter_value = d.counter_value,
    next_pm_due = case when w.kind = 'preventive' and pm_interval_days is not null then app.cairo_today() + pm_interval_days else next_pm_due end,
    counter_next_service = case when w.kind = 'preventive' and service_every is not null then d.counter_value + service_every else counter_next_service end,
    calibration_due = case when w.kind in ('calibration', 'safety_check') and v_passed and calibration_interval_days is not null
                           then app.cairo_today() + calibration_interval_days else calibration_due end,
    status = app.device_status(d.id)
  where id = d.id;
  return w;
end $$;

create or replace function public.cancel_work_order(p_order uuid, p_reason text)
returns public.maintenance_orders language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare w public.maintenance_orders;
begin
  select * into w from public.maintenance_orders where id = p_order for update;
  if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission('device.maintain', w.branch_id);
  if w.status <> 'open' then raise exception 'work order is already %', w.status using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.device_rpc', 'on', true);
  update public.maintenance_orders set status = 'cancelled', cancel_reason = trim(p_reason), closed_by = auth.uid(), closed_at = now()
  where id = w.id returning * into w;
  update public.devices set status = app.device_status(w.device_id) where id = w.device_id;
  return w;
end $$;

-- Alerts per device (computed, never stored).
create or replace function public.device_alerts(p_branch uuid default null)
returns table (device_id uuid, asset_no text, name_ar text, name_en text, alert text, detail text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with d as (select * from public.devices where status <> 'retired' and (p_branch is null or branch_id = p_branch)
             and app.has_permission('device.read', branch_id))
  select id, asset_no, name_ar, name_en, 'down', null from d where status = 'down'
  union all select id, asset_no, name_ar, name_en, 'pm_overdue', next_pm_due::text from d where next_pm_due < app.cairo_today()
  union all select id, asset_no, name_ar, name_en, 'pm_due_soon', next_pm_due::text from d where next_pm_due between app.cairo_today() and app.cairo_today() + 14
  union all select id, asset_no, name_ar, name_en, 'calibration_overdue', calibration_due::text from d where calibration_due < app.cairo_today()
  union all select id, asset_no, name_ar, name_en, 'calibration_due_soon', calibration_due::text from d where calibration_due between app.cairo_today() and app.cairo_today() + 14
  union all select id, asset_no, name_ar, name_en, 'service_counter', counter_next_service::text from d where counter_next_service is not null and counter_value >= counter_next_service
  union all select id, asset_no, name_ar, name_en, 'end_of_life', round(counter_value * 100.0 / expected_life)::text from d where expected_life is not null and counter_value >= expected_life * 0.9
  union all select id, asset_no, name_ar, name_en, 'warranty_ending', warranty_until::text from d where warranty_until between app.cairo_today() and app.cairo_today() + 30
  union all select d.id, d.asset_no, d.name_ar, d.name_en, 'unlogged_use', sum(r.gap)::text
    from d join public.device_counter_readings r on r.device_id = d.id
    where r.gap > 0 and r.recorded_at > now() - interval '30 days' group by d.id, d.asset_no, d.name_ar, d.name_en
$$;

-- ---------------------------------------------------------------------------
-- Laser reference data
-- ---------------------------------------------------------------------------
create table public.laser_areas (
  code       text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  name_ar    text not null,
  name_en    text not null,
  sort_order int not null default 100,
  is_active  boolean not null default true
);
insert into public.laser_areas (code, name_ar, name_en, sort_order) values
  ('upper_lip', 'الشارب', 'Upper lip', 10), ('chin', 'الذقن', 'Chin', 20), ('face', 'الوجه كامل', 'Full face', 30),
  ('neck', 'الرقبة', 'Neck', 40), ('axilla', 'الإبط', 'Underarms', 50), ('arms_full', 'الذراعان كاملان', 'Full arms', 60),
  ('forearms', 'الساعدان', 'Forearms', 70), ('chest', 'الصدر', 'Chest', 80), ('abdomen', 'البطن', 'Abdomen', 90),
  ('back', 'الظهر', 'Back', 100), ('bikini', 'منطقة البكيني', 'Bikini line', 110), ('legs_full', 'الساقان كاملتان', 'Full legs', 120),
  ('lower_legs', 'أسفل الساقين', 'Lower legs', 130), ('other', 'أخرى', 'Other', 900);

-- Pre-treatment checklist (defaults; the medical director confirms the final list). A "yes" on a blocking item
-- stops signing unless someone with laser.override records a reason.
create table public.laser_checklist_items (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  question_ar text not null,
  question_en text not null,
  blocking    boolean not null default true,
  sort_order  int not null default 100,
  is_active   boolean not null default true
);
insert into public.laser_checklist_items (code, question_ar, question_en, blocking, sort_order) values
  ('pregnancy', 'هل يوجد حمل أو احتمال حمل؟', 'Pregnant or possibly pregnant?', true, 10),
  ('isotretinoin', 'هل تناولت أيزوتريتينوين (روكتان) خلال آخر 6 أشهر؟', 'Isotretinoin in the last 6 months?', true, 20),
  ('photosensitizing', 'هل تتناول أدوية تسبب حساسية للضوء؟', 'Taking photosensitising medication?', true, 30),
  ('recent_tan', 'هل تعرضت لتسمير أو شمس قوية خلال آخر أسبوعين؟', 'Tanning or strong sun exposure in the last 2 weeks?', true, 40),
  ('active_lesion', 'هل يوجد التهاب أو جرح أو عدوى نشطة في المنطقة؟', 'Active infection, wound or lesion in the area?', true, 50),
  ('herpes_history', 'هل يوجد تاريخ للهربس في المنطقة؟', 'History of herpes in the area?', false, 60),
  ('keloid', 'هل يوجد ميل لتكوّن الجدرة (الكيلويد)؟', 'Tendency to keloid scarring?', false, 70),
  ('light_epilepsy', 'هل يوجد صرع يُثار بالضوء؟', 'Light-triggered epilepsy?', true, 80),
  ('gold_therapy', 'هل تلقيت علاجًا بأملاح الذهب؟', 'Previous gold therapy?', true, 90);

-- ---------------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------------
alter table public.services add column is_package boolean not null default false;

create table public.package_templates (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  name_ar         text not null,
  name_en         text not null,
  service_id      uuid not null references public.services(id),     -- the treatment each unit redeems
  sessions        int not null check (sessions between 1 and 100),
  price           numeric(14,2) not null check (price > 0),
  validity_days   int not null check (validity_days between 1 and 1825),
  branch_id       uuid references public.branches(id),               -- null = every branch
  sale_service_id uuid not null unique references public.services(id),
  terms_ar        text,
  is_active       boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create trigger trg_audit_package_templates after insert or update on public.package_templates for each row execute function app.audit_row();
create trigger trg_package_templates_no_delete before delete on public.package_templates for each row execute function app.block_delete();

create table public.patient_packages (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('PKG'),
  patient_id       uuid not null references public.patients(id),
  branch_id        uuid not null references public.branches(id),
  template_id      uuid not null references public.package_templates(id),
  service_id       uuid not null references public.services(id),
  branch_limit     uuid references public.branches(id),
  units_total      int not null check (units_total > 0),
  units_used       int not null default 0 check (units_used >= 0),
  value_total      numeric(14,2) not null check (value_total > 0),
  value_used       numeric(14,2) not null default 0 check (value_used >= 0),
  invoice_id       uuid not null unique references public.invoices(id),
  sold_by          uuid default auth.uid(),
  sold_at          timestamptz not null default now(),
  expires_on       date not null,
  status           text not null default 'active' check (status in ('active', 'used', 'expired', 'cancelled')),
  closed_at        timestamptz,
  journal_entry_id uuid references public.journal_entries(id),     -- expiry posting
  idempotency_key  text unique,
  constraint units_within check (units_used <= units_total),
  constraint value_within check (value_used <= value_total)
);
create index on public.patient_packages (patient_id, status);
create trigger trg_audit_patient_packages after insert or update on public.patient_packages for each row execute function app.audit_row();
create trigger trg_patient_packages_no_delete before delete on public.patient_packages for each row execute function app.block_delete();
create or replace function app.packages_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.package_rpc', true), '') <> 'on' then
    raise exception 'packages change only through the package screens' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_patient_packages_guard before insert or update on public.patient_packages for each row execute function app.packages_guard();
create trigger trg_package_templates_guard before insert or update on public.package_templates for each row execute function app.packages_guard();

-- A package-sale service can only be invoiced through sell_package (so the deferred balance always has a package).
create or replace function app.package_line_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.services where id = new.service_id and is_package)
     and coalesce(current_setting('app.package_rpc', true), '') <> 'on' then
    raise exception 'packages are sold from the package screen' using errcode = '42501';
  end if;
  -- A session already covered by a package cannot be billed again on the same appointment.
  if exists (select 1 from public.invoices i join public.package_redemptions r on r.appointment_id = i.appointment_id
             where i.id = new.invoice_id and r.service_id = new.service_id) then
    raise exception 'this session was covered by a package and cannot be invoiced again' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_invoice_lines_package_guard before insert or update on public.invoice_lines for each row execute function app.package_line_guard();

-- Voiding a package invoice cancels the unused package; a package with redeemed sessions cannot be voided.
create or replace function app.package_invoice_void()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pk public.patient_packages;
begin
  if new.status = 'void' and old.status <> 'void' then
    select * into pk from public.patient_packages where invoice_id = new.id for update;
    if found then
      if pk.units_used > 0 then
        raise exception 'package already used — it cannot be voided' using errcode = '22023';
      end if;
      if pk.status <> 'active' then
        raise exception 'package is already % — its invoice cannot be voided', pk.status using errcode = '22023';
      end if;
      perform set_config('app.package_rpc', 'on', true);
      update public.patient_packages set status = 'cancelled', closed_at = now() where id = pk.id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_invoices_package_void before update on public.invoices for each row execute function app.package_invoice_void();

-- Package refunds need a finance policy (unused value, admin fee) and a different posting (deferred, not revenue).
create or replace function app.package_refund_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.patient_packages where invoice_id = new.invoice_id) then
    raise exception 'package refunds are not supported yet — void the unused package or contact finance' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_refunds_package_guard before insert on public.refunds for each row execute function app.package_refund_guard();

create or replace function public.save_package_template(p jsonb)
returns public.package_templates language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.package_templates; s public.services; v_id uuid := nullif(p->>'id', '')::uuid; v_sale uuid; v_org uuid;
begin
  if not app.has_global_permission('package.manage') then
    raise exception 'permission denied: package.manage (all branches)' using errcode = '42501';
  end if;
  select * into s from public.services where id = (p->>'service_id')::uuid and not is_package;
  if not found then raise exception 'choose the treatment service' using errcode = '22023'; end if;
  if coalesce(trim(p->>'name_ar'), '') = '' or coalesce(trim(p->>'code'), '') = '' then raise exception 'code and name are required' using errcode = '22023'; end if;
  select id into v_org from public.organizations order by id limit 1;   -- single organisation per deployment
  perform set_config('app.package_rpc', 'on', true);
  if v_id is null then
    insert into public.services (specialty_id, code, name_ar, name_en, revenue_account_id, is_package)
    values (s.specialty_id, 'PKG-' || upper(trim(p->>'code')), 'باقة: ' || trim(p->>'name_ar'), 'Package: ' || coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')),
            app.account_for(v_org, 'package_deferred'), true)
    returning id into v_sale;
    insert into public.package_templates (code, name_ar, name_en, service_id, sessions, price, validity_days, branch_id, sale_service_id, terms_ar)
    values (upper(trim(p->>'code')), trim(p->>'name_ar'), coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')), s.id,
            (p->>'sessions')::int, round((p->>'price')::numeric, 2), (p->>'validity_days')::int, nullif(p->>'branch_id', '')::uuid, v_sale, nullif(trim(p->>'terms_ar'), ''))
    returning * into t;
  else
    -- Changes apply to future sales only: sold packages keep their own units, value and expiry.
    update public.package_templates set name_ar = trim(p->>'name_ar'), name_en = coalesce(nullif(trim(p->>'name_en'), ''), trim(p->>'name_ar')),
      sessions = (p->>'sessions')::int, price = round((p->>'price')::numeric, 2), validity_days = (p->>'validity_days')::int,
      branch_id = nullif(p->>'branch_id', '')::uuid,
      terms_ar = case when p ? 'terms_ar' then nullif(trim(p->>'terms_ar'), '') else terms_ar end, is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and service_id = s.id returning * into t;
    if not found then raise exception 'package template not found (the treatment service cannot change)' using errcode = 'P0002'; end if;
    update public.services set name_ar = 'باقة: ' || t.name_ar, name_en = 'Package: ' || t.name_en, is_active = t.is_active where id = t.sale_service_id;
  end if;
  return t;
exception when unique_violation then
  raise exception 'package code already exists' using errcode = '23505';
end $$;

-- Sell: creates and issues the invoice (Dr receivable / Cr deferred package revenue) and opens the package.
-- The patient pays at the cashier as usual; sessions can be redeemed once the invoice is fully paid.
create or replace function public.sell_package(p_patient uuid, p_template uuid, p_branch uuid, p_discount numeric default 0, p_idempotency_key text default null)
returns public.patient_packages language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.package_templates; pt public.patients; inv public.invoices; pk public.patient_packages; v_line uuid; v_disc numeric := round(coalesce(p_discount, 0), 2);
        v_org uuid;
begin
  perform app.require_permission('package.sell', p_branch);
  if nullif(trim(p_idempotency_key), '') is not null then
    perform pg_advisory_xact_lock(hashtext('sell_package:' || p_idempotency_key));
    select * into pk from public.patient_packages where idempotency_key = p_idempotency_key;
    if found then
      if pk.sold_by is distinct from auth.uid() then raise exception 'idempotency key reused' using errcode = '22023'; end if;
      return pk;
    end if;
  end if;
  select * into t from public.package_templates where id = p_template;
  if not found or not t.is_active then raise exception 'package is not available' using errcode = '22023'; end if;
  if t.branch_id is not null and t.branch_id <> p_branch then raise exception 'package is not sold in this branch' using errcode = '22023'; end if;
  select * into pt from public.patients where id = p_patient;
  if not found then raise exception 'patient not found' using errcode = 'P0002'; end if;
  if coalesce(p_discount, 0) < 0 or round(coalesce(p_discount, 0), 2) >= t.price then
    raise exception 'discount must be below the package price' using errcode = '22023';
  end if;
  perform set_config('app.package_rpc', 'on', true);
  insert into public.invoices (branch_id, patient_id) values (p_branch, p_patient) returning * into inv;
  insert into public.invoice_lines (invoice_id, service_id, description, quantity, unit_price, discount)
  values (inv.id, t.sale_service_id, t.name_ar || ' — ' || t.sessions || ' جلسات', 1, t.price, v_disc) returning id into v_line;
  inv := public.issue_invoice(inv.id);
  -- The deferred balance is what the patient actually owes (net of the discount): move the discount out of
  -- "discounts allowed" into the deferred account, so each session later recognises net revenue.
  if v_disc > 0 then
    v_org := app.org_of_branch(p_branch);
    perform app.post_journal(v_org, p_branch, app.cairo_today(), 'Package discount ' || inv.invoice_no, 'package_discount', inv.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'debit', v_disc, 'patient_id', p_patient),
        jsonb_build_object('account_id', app.account_for(v_org, 'discounts_allowed'), 'credit', v_disc, 'patient_id', p_patient)));
  end if;
  insert into public.patient_packages (patient_id, branch_id, template_id, service_id, branch_limit, units_total, value_total, invoice_id, expires_on, idempotency_key)
  values (p_patient, p_branch, t.id, t.service_id, t.branch_id, t.sessions, t.price - v_disc, inv.id, app.cairo_today() + t.validity_days, nullif(trim(p_idempotency_key), ''))
  returning * into pk;
  return pk;
end $$;

-- Expire packages past validity: the unused deferred balance becomes revenue (policy to be confirmed by finance).
create or replace function public.expire_packages(p_branch uuid default null)
returns int language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pk public.patient_packages; v_org uuid; v_je uuid; v_left numeric; n int := 0;
begin
  if p_branch is null then
    if not app.has_global_permission('package.expire') then raise exception 'permission denied: package.expire (all branches)' using errcode = '42501'; end if;
  else
    perform app.require_permission('package.expire', p_branch);
  end if;
  perform set_config('app.package_rpc', 'on', true);
  -- Only paid packages expire into revenue; an unpaid package is voided with its invoice instead.
  for pk in select p.* from public.patient_packages p join public.invoices i on i.id = p.invoice_id
            where p.status = 'active' and p.expires_on < app.cairo_today() and i.status = 'paid'
              and (p_branch is null or p.branch_id = p_branch) order by p.id for update of p skip locked loop
    v_left := pk.value_total - pk.value_used;
    v_je := null;
    if v_left > 0 then
      v_org := app.org_of_branch(pk.branch_id);
      v_je := app.post_journal(v_org, pk.branch_id, app.cairo_today(), 'Package expired ' || pk.ref, 'package_expiry', pk.id,
        jsonb_build_array(
          jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'debit', v_left, 'patient_id', pk.patient_id),
          jsonb_build_object('account_id', app.account_for(v_org, 'package_breakage'), 'credit', v_left, 'patient_id', pk.patient_id)));
    end if;
    update public.patient_packages set status = 'expired', closed_at = now(), journal_entry_id = v_je where id = pk.id;
    n := n + 1;
  end loop;
  return n;
end $$;


-- Package balances for one patient, with the payment state of the sale invoice (staff without billing access
-- still need to know whether a session can be redeemed).
create or replace function public.patient_package_balances(p_patient uuid)
returns table (id uuid, ref text, name_ar text, name_en text, service_id uuid, units_total int, units_used int, value_total numeric, value_used numeric,
               expires_on date, status text, invoice_id uuid, invoice_no text, paid boolean, branch_limit uuid, sold_at timestamptz)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.ref, t.name_ar, t.name_en, p.service_id, p.units_total, p.units_used, p.value_total, p.value_used, p.expires_on, p.status,
         p.invoice_id, i.invoice_no, i.status = 'paid', p.branch_limit, p.sold_at
  from public.patient_packages p join public.package_templates t on t.id = p.template_id join public.invoices i on i.id = p.invoice_id
  where p.patient_id = p_patient
    and (app.has_permission('package.read', p.branch_id) or app.has_permission('laser.operate', p.branch_id)
         or (p.branch_limit is null and (app.has_permission('package.read') or app.has_permission('laser.operate'))))
  order by p.sold_at desc
$$;

-- ---------------------------------------------------------------------------
-- Laser sessions
-- ---------------------------------------------------------------------------
create table public.laser_sessions (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('LAS'),
  branch_id        uuid not null references public.branches(id),
  patient_id       uuid not null references public.patients(id),
  appointment_id   uuid not null unique references public.appointments(id),
  doctor_id        uuid not null references public.staff(id),        -- appointment doctor (settlement basis)
  device_id        uuid not null references public.devices(id),
  service_id       uuid not null references public.services(id),
  operator_id      uuid not null default auth.uid(),
  fitzpatrick      smallint check (fitzpatrick between 1 and 6),
  checklist        jsonb not null default '{}'::jsonb,
  override_note    text,
  test_spot        boolean not null default false,
  test_spot_pulses int not null default 0 check (test_spot_pulses >= 0),
  test_spot_note   text,
  counter_before   bigint check (counter_before >= 0),
  counter_after    bigint check (counter_after >= 0),
  cooling          text,
  reaction         text not null default 'none' check (reaction in ('none', 'erythema', 'edema', 'perifollicular_edema', 'blister', 'burn', 'pigment_change', 'other')),
  reaction_note    text,
  outcome          text,
  follow_up_on     date,
  photo_consent    boolean,
  patient_package_id uuid references public.patient_packages(id),
  status           text not null default 'draft' check (status in ('draft', 'signed')),
  signed_by        uuid,
  signed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.laser_sessions (patient_id, created_at desc);
create index on public.laser_sessions (device_id, signed_at);
create table public.laser_session_areas (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.laser_sessions(id),
  area_code      text not null references public.laser_areas(code),
  wavelength_nm  int not null check (wavelength_nm between 200 and 12000),
  fluence        numeric(7,2) not null check (fluence > 0),          -- J/cm²
  pulse_width_ms numeric(8,3) check (pulse_width_ms > 0),
  spot_mm        numeric(5,1) not null check (spot_mm > 0),
  pulses         int not null check (pulses > 0),
  notes          text
);
create index on public.laser_session_areas (session_id);
create table public.laser_session_notes (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.laser_sessions(id),
  kind       text not null default 'addendum' check (kind in ('addendum', 'adverse_followup')),
  note       text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.package_redemptions (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references public.patient_packages(id),
  session_id       uuid not null unique references public.laser_sessions(id),
  appointment_id   uuid not null references public.appointments(id),
  patient_id       uuid not null references public.patients(id),
  branch_id        uuid not null references public.branches(id),
  doctor_id        uuid not null references public.staff(id),
  service_id       uuid not null references public.services(id),
  on_date          date not null,
  value            numeric(14,2) not null check (value >= 0),
  journal_entry_id uuid references public.journal_entries(id),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.package_redemptions (doctor_id, on_date);
create trigger trg_audit_laser_sessions after insert or update on public.laser_sessions for each row execute function app.audit_row();
create trigger trg_audit_laser_areas after insert or update or delete on public.laser_session_areas for each row execute function app.audit_row();
create trigger trg_laser_sessions_no_delete before delete on public.laser_sessions for each row execute function app.block_delete();
create trigger trg_laser_notes_immutable before update or delete on public.laser_session_notes for each row execute function app.block_delete();
create trigger trg_redemptions_immutable before update or delete on public.package_redemptions for each row execute function app.block_delete();

create or replace function app.laser_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.laser_rpc', true), '') <> 'on' then
    raise exception 'laser sessions change only through the laser session screen' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_laser_sessions_guard before insert or update on public.laser_sessions for each row execute function app.laser_guard();
create trigger trg_laser_areas_guard before insert or update or delete on public.laser_session_areas for each row execute function app.laser_guard();
create trigger trg_redemptions_guard before insert on public.package_redemptions for each row execute function app.laser_guard();

-- Parameters must be within the device's approved settings (when configured).
create or replace function app.laser_check_params(p_device public.devices, a jsonb)
returns void language plpgsql immutable as $$
declare pr jsonb := p_device.params; rng jsonb;
begin
  if pr ? 'wavelengths' and not (pr->'wavelengths') @> to_jsonb((a->>'wavelength_nm')::int) then
    raise exception 'wavelength % nm is not available on this device', a->>'wavelength_nm' using errcode = '22023';
  end if;
  if pr ? 'spot_mm' and not exists (select 1 from jsonb_array_elements_text(pr->'spot_mm') x where x::numeric = (a->>'spot_mm')::numeric) then
    raise exception 'spot size % mm is not available on this device', a->>'spot_mm' using errcode = '22023';
  end if;
  rng := pr->'fluence'->(a->>'wavelength_nm');
  if rng is not null and ((a->>'fluence')::numeric < (rng->>0)::numeric or (a->>'fluence')::numeric > (rng->>1)::numeric) then
    raise exception 'fluence % J/cm² is outside the approved range (% – %)', a->>'fluence', rng->>0, rng->>1 using errcode = '22023';
  end if;
  rng := pr->'pulse_width_ms';
  if rng is not null and nullif(a->>'pulse_width_ms', '') is not null
     and ((a->>'pulse_width_ms')::numeric < (rng->>0)::numeric or (a->>'pulse_width_ms')::numeric > (rng->>1)::numeric) then
    raise exception 'pulse width % ms is outside the approved range (% – %)', a->>'pulse_width_ms', rng->>0, rng->>1 using errcode = '22023';
  end if;
end $$;

-- Create or update the draft session for an appointment (areas are replaced as a whole while in draft).
create or replace function public.save_laser_session(p_appointment uuid, p jsonb)
returns public.laser_sessions language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare ap public.appointments; s public.laser_sessions; d public.devices; a jsonb; v_pkg uuid := nullif(p->>'patient_package_id', '')::uuid;
begin
  select * into ap from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment not found' using errcode = 'P0002'; end if;
  perform app.require_permission('laser.operate', ap.branch_id);
  if ap.status not in ('arrived', 'waiting', 'in_consultation', 'procedure_in_progress', 'awaiting_payment', 'completed') then
    raise exception 'the patient has not arrived for this appointment' using errcode = '22023';
  end if;
  select * into d from public.devices where id = (p->>'device_id')::uuid;
  if not found or d.branch_id <> ap.branch_id then raise exception 'choose a device in this branch' using errcode = '22023'; end if;
  if not exists (select 1 from public.services where id = (p->>'service_id')::uuid and not is_package) then
    raise exception 'choose the treatment service' using errcode = '22023';
  end if;
  if v_pkg is not null and not exists (select 1 from public.patient_packages where id = v_pkg and patient_id = ap.patient_id) then
    raise exception 'package belongs to another patient' using errcode = '22023';
  end if;
  if p ? 'checklist' and jsonb_typeof(p->'checklist') <> 'object' then raise exception 'checklist must be an object' using errcode = '22023'; end if;
  perform set_config('app.laser_rpc', 'on', true);
  select * into s from public.laser_sessions where appointment_id = ap.id for update;
  if found and s.status = 'signed' then raise exception 'signed laser session cannot be modified — add a note instead' using errcode = '22023'; end if;
  if not found then
    insert into public.laser_sessions (branch_id, patient_id, appointment_id, doctor_id, device_id, service_id)
    values (ap.branch_id, ap.patient_id, ap.id, ap.doctor_id, d.id, (p->>'service_id')::uuid) returning * into s;
  end if;
  update public.laser_sessions set device_id = d.id, service_id = (p->>'service_id')::uuid, operator_id = auth.uid(),
    fitzpatrick = nullif(p->>'fitzpatrick', '')::smallint, checklist = coalesce(p->'checklist', '{}'::jsonb),
    test_spot = coalesce((p->>'test_spot')::boolean, false), test_spot_pulses = coalesce(nullif(p->>'test_spot_pulses', '')::int, 0),
    test_spot_note = nullif(trim(p->>'test_spot_note'), ''),
    counter_before = nullif(p->>'counter_before', '')::bigint, counter_after = nullif(p->>'counter_after', '')::bigint,
    cooling = nullif(trim(p->>'cooling'), ''), reaction = coalesce(nullif(p->>'reaction', ''), 'none'), reaction_note = nullif(trim(p->>'reaction_note'), ''),
    outcome = nullif(trim(p->>'outcome'), ''), follow_up_on = nullif(p->>'follow_up_on', '')::date, patient_package_id = v_pkg, updated_at = now()
  where id = s.id returning * into s;
  delete from public.laser_session_areas where session_id = s.id;
  for a in select * from jsonb_array_elements(coalesce(p->'areas', '[]'::jsonb)) loop
    perform app.laser_check_params(d, a);
    insert into public.laser_session_areas (session_id, area_code, wavelength_nm, fluence, pulse_width_ms, spot_mm, pulses, notes)
    values (s.id, a->>'area_code', (a->>'wavelength_nm')::int, (a->>'fluence')::numeric, nullif(a->>'pulse_width_ms', '')::numeric,
            (a->>'spot_mm')::numeric, (a->>'pulses')::int, nullif(trim(a->>'notes'), ''));
  end loop;
  return s;
end $$;

-- Sign: the clinical record becomes immutable, the device counter moves forward, and a package unit is redeemed.
create or replace function public.sign_laser_session(p_session uuid, p_override_note text default null)
returns public.laser_sessions language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.laser_sessions; d public.devices; pk public.patient_packages; inv public.invoices; sv public.services;
        v_pulses bigint; v_positive text[]; v_missing text[]; v_value numeric; v_org uuid; v_je uuid; v_red uuid;
begin
  select * into s from public.laser_sessions where id = p_session for update;
  if not found then raise exception 'laser session not found' using errcode = 'P0002'; end if;
  perform app.require_permission('laser.operate', s.branch_id);
  if s.status = 'signed' then raise exception 'laser session is already signed' using errcode = '22023'; end if;
  select * into d from public.devices where id = s.device_id for update;
  if d.status <> 'active' then raise exception 'device is out of service — it cannot be used until maintenance closes' using errcode = '22023'; end if;
  if d.calibration_due is not null and d.calibration_due < app.cairo_today() then
    raise exception 'device calibration is overdue — record a passing calibration first' using errcode = '22023';
  end if;
  if s.fitzpatrick is null then raise exception 'record the skin type (Fitzpatrick) before signing' using errcode = '22023'; end if;
  select array_agg(c.code) filter (where not (s.checklist ? c.code) or s.checklist->>c.code not in ('yes', 'no')),
         array_agg(c.code) filter (where c.blocking and s.checklist->>c.code = 'yes')
    into v_missing, v_positive
  from public.laser_checklist_items c where c.is_active;
  if v_missing is not null then raise exception 'answer every checklist question before signing (%)', array_to_string(v_missing, ', ') using errcode = '22023'; end if;
  if v_positive is not null then
    if not app.has_permission('laser.override', s.branch_id) then
      raise exception 'contraindication present (%): a doctor must review and sign with a reason', array_to_string(v_positive, ', ') using errcode = '42501';
    end if;
    if coalesce(length(trim(p_override_note)), 0) < 10 then
      raise exception 'contraindication present (%): write the clinical reason for proceeding', array_to_string(v_positive, ', ') using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from public.laser_session_areas where session_id = s.id) then
    raise exception 'add at least one treated area' using errcode = '22023';
  end if;
  if d.counter_unit is not null then
    if s.counter_before is null or s.counter_after is null then raise exception 'enter the device counter before and after the session' using errcode = '22023'; end if;
    if s.counter_after <= s.counter_before then raise exception 'counter after must be greater than counter before' using errcode = '22023'; end if;
    if s.counter_before < d.counter_value then
      raise exception 'counter before (%) is lower than the last recorded reading (%)', s.counter_before, d.counter_value using errcode = '22023';
    end if;
    select coalesce(sum(pulses), 0) + s.test_spot_pulses into v_pulses from public.laser_session_areas where session_id = s.id;
    if s.counter_after - s.counter_before <> v_pulses then
      raise exception 'pulses do not match the counter: areas + test spot = %, counter difference = %', v_pulses, s.counter_after - s.counter_before using errcode = '22023';
    end if;
  end if;
  perform set_config('app.laser_rpc', 'on', true);
  perform set_config('app.device_rpc', 'on', true);
  if d.counter_unit is not null then
    insert into public.device_counter_readings (device_id, reading, delta, gap, source, session_id)
    values (d.id, s.counter_after, s.counter_after - s.counter_before, s.counter_before - d.counter_value, 'session', s.id);
    update public.devices set counter_value = s.counter_after where id = d.id;
  end if;

  if s.patient_package_id is not null then
    select * into pk from public.patient_packages where id = s.patient_package_id for update;
    if pk.patient_id <> s.patient_id then raise exception 'package belongs to another patient' using errcode = '22023'; end if;
    if pk.status <> 'active' then raise exception 'package is %', pk.status using errcode = '22023'; end if;
    if pk.expires_on < app.cairo_today() then raise exception 'package expired on %', pk.expires_on using errcode = '22023'; end if;
    if pk.service_id <> s.service_id then raise exception 'package does not cover this service' using errcode = '22023'; end if;
    if pk.branch_limit is not null and pk.branch_limit <> s.branch_id then raise exception 'package is limited to another branch' using errcode = '22023'; end if;
    if pk.units_used >= pk.units_total then raise exception 'no sessions left in this package' using errcode = '22023'; end if;
    select * into inv from public.invoices where id = pk.invoice_id;
    if inv.status <> 'paid' then raise exception 'package invoice % is not fully paid', inv.invoice_no using errcode = '22023'; end if;
    if exists (select 1 from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
               where i.appointment_id = s.appointment_id and i.status <> 'void' and l.service_id = s.service_id) then
      raise exception 'this session is already on an invoice — remove that line or do not use the package' using errcode = '22023';
    end if;
    -- Each unit carries an equal share of the deferred value; the last unit takes the rounding remainder.
    v_value := case when pk.units_used + 1 = pk.units_total then pk.value_total - pk.value_used
                    else least(trunc(pk.value_total / pk.units_total, 2), pk.value_total - pk.value_used) end;
    select * into sv from public.services where id = s.service_id;
    v_org := app.org_of_branch(s.branch_id);
    v_red := gen_random_uuid();
    if v_value > 0 then
      v_je := app.post_journal(v_org, s.branch_id, app.cairo_today(), 'Package session ' || pk.ref || ' / ' || s.ref, 'package_redemption', v_red,
        jsonb_build_array(
          jsonb_build_object('account_id', app.account_for(v_org, 'package_deferred'), 'debit', v_value, 'patient_id', s.patient_id),
          jsonb_build_object('account_id', coalesce(sv.revenue_account_id, app.account_for(v_org, 'revenue_services')), 'credit', v_value,
                             'patient_id', s.patient_id, 'doctor_id', s.doctor_id, 'memo', 'Package session revenue')));
    end if;
    insert into public.package_redemptions (id, package_id, session_id, appointment_id, patient_id, branch_id, doctor_id, service_id, on_date, value, journal_entry_id)
    values (v_red, pk.id, s.id, s.appointment_id, s.patient_id, s.branch_id, s.doctor_id, s.service_id, app.cairo_today(), v_value, v_je);
    perform set_config('app.package_rpc', 'on', true);
    update public.patient_packages set units_used = units_used + 1, value_used = value_used + v_value,
      status = case when units_used + 1 = units_total then 'used' else status end,
      closed_at = case when units_used + 1 = units_total then now() else closed_at end
    where id = pk.id;
  end if;

  update public.laser_sessions set status = 'signed', signed_by = auth.uid(), signed_at = now(), override_note = nullif(trim(p_override_note), ''),
    photo_consent = coalesce((select granted from public.patient_consent_current c where c.patient_id = s.patient_id and c.kind = 'clinical_photography'), false)
  where id = s.id returning * into s;
  return s;
end $$;

create or replace function public.add_laser_note(p_session uuid, p_note text, p_kind text default 'addendum')
returns public.laser_session_notes language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare s public.laser_sessions; n public.laser_session_notes;
begin
  select * into s from public.laser_sessions where id = p_session;
  if not found then raise exception 'laser session not found' using errcode = 'P0002'; end if;
  perform app.require_permission('laser.operate', s.branch_id);
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'note is required' using errcode = '22023'; end if;
  insert into public.laser_session_notes (session_id, kind, note) values (s.id, coalesce(p_kind, 'addendum'), trim(p_note)) returning * into n;
  return n;
end $$;


-- Consumable template for an appointment: services on its invoices plus the service of its laser session
-- (a package session has no invoice of its own).
create or replace function public.issue_template(p_appointment uuid)
returns table (item_id uuid, qty numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with svc as (
    select l.service_id, l.quantity from public.appointments a
    join public.invoices i on i.appointment_id = a.id and i.status <> 'void'
    join public.invoice_lines l on l.invoice_id = i.id
    where a.id = p_appointment
    union all
    select s.service_id, 1 from public.laser_sessions s
    where s.appointment_id = p_appointment
      and not exists (select 1 from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
                      where i.appointment_id = p_appointment and i.status <> 'void' and l.service_id = s.service_id)
  )
  select sc.item_id, sum(sc.qty * svc.quantity)
  from svc join public.service_consumables sc on sc.service_id = svc.service_id
  where exists (select 1 from public.appointments a where a.id = p_appointment and app.has_permission('inventory.issue', a.branch_id))
  group by sc.item_id
$$;

-- ---------------------------------------------------------------------------
-- Settlements: redeemed package sessions are paid to the appointment doctor like services
-- ---------------------------------------------------------------------------
alter table public.settlement_lines drop constraint settlement_lines_kind_check;
alter table public.settlement_lines add constraint settlement_lines_kind_check check (kind in ('service', 'package_session', 'void_reversal', 'refund', 'carry'));
alter table public.settlement_lines add column redemption_id uuid references public.package_redemptions(id);
create unique index settlement_redemption_once on public.settlement_lines (redemption_id) where active and redemption_id is not null;

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

  -- 4) Negative balances of earlier approved runs are carried into this one.
  insert into public.settlement_lines (run_id, doctor_id, kind, carry_from_run, on_date, base, amount)
  select run.id, d.id, 'carry', p.id, lower(p.period), p.amount, p.amount
  from public.settlement_runs p
  where p.doctor_id = d.id and p.status = 'approved' and p.amount < 0 and p.carried_to is null and p.id <> run.id;
  update public.settlement_runs set carried_to = run.id
  where doctor_id = d.id and status = 'approved' and amount < 0 and carried_to is null and id <> run.id;

  update public.settlement_runs r set
    gross_base = coalesce((select sum(base) from public.settlement_lines where run_id = r.id and kind in ('service', 'package_session')), 0),
    deductions = coalesce((select -sum(amount) from public.settlement_lines where run_id = r.id and kind in ('void_reversal', 'refund')), 0),
    carried_in = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id and kind = 'carry'), 0),
    amount = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id), 0),
    lines_without_contract = (select count(*) from public.settlement_lines where run_id = r.id and no_contract)
  where r.id = run.id returning * into run;
  return run;
end $$;

create or replace function public.approve_settlement(p_run uuid)
returns public.settlement_runs language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare run public.settlement_runs; v_org uuid; v_je uuid; a numeric;
begin
  select * into run from public.settlement_runs where id = p_run for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  perform app.require_permission('settlement.approve', run.branch_id);
  if run.status <> 'draft' then raise exception 'settlement already %', run.status using errcode = '22023'; end if;
  if run.prepared_by = auth.uid() then
    raise exception 'separation of duties: you cannot approve a settlement you prepared' using errcode = '42501';
  end if;
  if run.stale then
    raise exception 'the contract changed after this statement was prepared; cancel and prepare again' using errcode = '22023';
  end if;
  if exists (select 1 from public.doctor_contracts c where c.doctor_id = run.doctor_id and c.created_by = auth.uid()
             and exists (select 1 from public.settlement_lines l where l.run_id = run.id and l.kind in ('service', 'package_session') and c.valid @> l.on_date)) then
    raise exception 'separation of duties: you cannot approve a settlement based on a contract you entered' using errcode = '42501';
  end if;
  if run.lines_without_contract > 0 then
    raise exception 'settlement has % line(s) without a contract; add the contract, cancel and prepare again', run.lines_without_contract using errcode = '22023';
  end if;
  a := run.amount - run.carried_in;   -- the carried amount was already posted when its own run was approved
  if a <> 0 then
    v_org := app.org_of_branch(run.branch_id);
    v_je := app.post_journal(v_org, run.branch_id, (now() at time zone 'Africa/Cairo')::date,
      'Doctor settlement ' || run.ref || ' ' || lower(run.period)::text, 'settlement', run.id,
      jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'doctor_fees'), 'debit', greatest(a, 0), 'credit', greatest(-a, 0), 'doctor_id', run.doctor_id),
        jsonb_build_object('account_id', app.account_for(v_org, 'doctor_fees_payable'), 'credit', greatest(a, 0), 'debit', greatest(-a, 0), 'doctor_id', run.doctor_id)));
  end if;
  update public.settlement_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), journal_entry_id = v_je
  where id = run.id returning * into run;
  return run;
end $$;

-- ---------------------------------------------------------------------------
-- Profitability: package sales are deferred (excluded); redeemed sessions count as revenue on the session date
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
  )
  select c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, coalesce(st.full_name_en, st.full_name_ar),
         sum(c.quantity), sum(c.line_gross), sum(c.discount), sum(c.refund_part), sum(c.line_total - c.refund_part),
         sum(c.share), sum(c.cons), sum(c.line_total - c.refund_part - c.share - c.cons)
  from calc c join public.services s on s.id = c.service_id left join public.staff st on st.id = c.doctor_id
  group by c.service_id, s.code, s.name_ar, s.name_en, c.doctor_id, st.full_name_ar, st.full_name_en
  order by sum(c.line_total - c.refund_part - c.share - c.cons) desc
$$;

-- Usage and maintenance summary for a period.
create or replace function public.device_usage(p_from date, p_to date, p_branch uuid default null)
returns table (device_id uuid, asset_no text, name_ar text, name_en text, sessions bigint, pulses bigint, unlogged bigint,
               downtime_hours numeric, work_orders bigint, maintenance_cost numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select d.id, d.asset_no, d.name_ar, d.name_en,
    (select count(*) from public.laser_sessions s where s.device_id = d.id and s.status = 'signed' and (s.signed_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    coalesce((select sum(r.delta) from public.device_counter_readings r where r.device_id = d.id and r.source = 'session'
              and (r.recorded_at at time zone 'Africa/Cairo')::date between p_from and p_to), 0),
    coalesce((select sum(r.gap) from public.device_counter_readings r where r.device_id = d.id
              and (r.recorded_at at time zone 'Africa/Cairo')::date between p_from and p_to), 0),
    coalesce((select round(sum(extract(epoch from (least(coalesce(o.closed_at, now()), (p_to + 1)::timestamp at time zone 'Africa/Cairo')
                                                  - greatest(o.reported_at, p_from::timestamp at time zone 'Africa/Cairo'))) / 3600)::numeric, 1)
              from public.maintenance_orders o where o.device_id = d.id and o.device_down and o.status <> 'cancelled'
                and o.reported_at < (p_to + 1)::timestamp at time zone 'Africa/Cairo'
                and coalesce(o.closed_at, now()) > p_from::timestamp at time zone 'Africa/Cairo'), 0),
    (select count(*) from public.maintenance_orders o where o.device_id = d.id and (o.reported_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    coalesce((select sum(o.parts_cost + o.labor_cost) from public.maintenance_orders o where o.device_id = d.id and o.status = 'closed'
              and (o.closed_at at time zone 'Africa/Cairo')::date between p_from and p_to), 0)
  from public.devices d
  where (p_branch is null or d.branch_id = p_branch) and app.has_permission('device.read', d.branch_id)
  order by d.asset_no
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.device_counter_readings enable row level security;
alter table public.maintenance_orders enable row level security;
alter table public.laser_areas enable row level security;
alter table public.laser_checklist_items enable row level security;
alter table public.package_templates enable row level security;
alter table public.patient_packages enable row level security;
alter table public.laser_sessions enable row level security;
alter table public.laser_session_areas enable row level security;
alter table public.laser_session_notes enable row level security;
alter table public.package_redemptions enable row level security;

create policy devices_read on public.devices for select to authenticated
  using (app.has_permission('device.read', branch_id) or app.has_permission('laser.operate', branch_id));
create policy counter_readings_read on public.device_counter_readings for select to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id));
create policy maintenance_read on public.maintenance_orders for select to authenticated using (app.has_permission('device.read', branch_id));
create policy laser_areas_read on public.laser_areas for select to authenticated using (true);
create policy laser_checklist_read on public.laser_checklist_items for select to authenticated using (true);
create policy package_templates_read on public.package_templates for select to authenticated using (true);
create policy patient_packages_read on public.patient_packages for select to authenticated
  using (app.has_permission('package.read', branch_id) or app.has_permission('laser.operate', branch_id)
         or (branch_limit is null and (app.has_permission('package.read') or app.has_permission('laser.operate'))));
create policy laser_sessions_read on public.laser_sessions for select to authenticated
  using (app.can_read_clinical(patient_id, branch_id) or operator_id = auth.uid() or doctor_id = app.current_staff_id());
create policy laser_areas_rows_read on public.laser_session_areas for select to authenticated
  using (exists (select 1 from public.laser_sessions s where s.id = session_id));
create policy laser_notes_read on public.laser_session_notes for select to authenticated
  using (exists (select 1 from public.laser_sessions s where s.id = session_id));
create policy redemptions_read on public.package_redemptions for select to authenticated
  using (exists (select 1 from public.patient_packages p where p.id = package_id));

grant select on public.devices, public.device_counter_readings, public.maintenance_orders, public.laser_areas, public.laser_checklist_items,
  public.package_templates, public.patient_packages, public.laser_sessions, public.laser_session_areas, public.laser_session_notes,
  public.package_redemptions to authenticated;
grant all on public.devices, public.device_counter_readings, public.maintenance_orders, public.laser_areas, public.laser_checklist_items,
  public.package_templates, public.patient_packages, public.laser_sessions, public.laser_session_areas, public.laser_session_notes,
  public.package_redemptions to service_role;

revoke execute on function public.save_device(jsonb), public.retire_device(uuid, text), public.record_counter_reading(uuid, bigint, text, boolean),
  public.open_work_order(uuid, text, text, boolean), public.close_work_order(uuid, jsonb), public.cancel_work_order(uuid, text),
  public.device_alerts(uuid), public.device_usage(date, date, uuid), public.save_package_template(jsonb),
  public.sell_package(uuid, uuid, uuid, numeric, text), public.expire_packages(uuid), public.save_laser_session(uuid, jsonb),
  public.sign_laser_session(uuid, text), public.add_laser_note(uuid, text, text), public.patient_package_balances(uuid) from public, anon;
grant execute on function public.save_device(jsonb), public.retire_device(uuid, text), public.record_counter_reading(uuid, bigint, text, boolean),
  public.open_work_order(uuid, text, text, boolean), public.close_work_order(uuid, jsonb), public.cancel_work_order(uuid, text),
  public.device_alerts(uuid), public.device_usage(date, date, uuid), public.save_package_template(jsonb),
  public.sell_package(uuid, uuid, uuid, numeric, text), public.expire_packages(uuid), public.save_laser_session(uuid, jsonb),
  public.sign_laser_session(uuid, text), public.add_laser_note(uuid, text, text), public.patient_package_balances(uuid) to authenticated;
revoke execute on function app.laser_check_params(public.devices, jsonb) from public, anon;
