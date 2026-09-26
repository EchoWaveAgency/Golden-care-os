-- Golden Care OS — 0007 Services, price lists, invoicing, payments, cashier sessions
-- Financial state changes only through SECURITY DEFINER RPCs that post balanced journals.

create table public.services (
  id                 uuid primary key default gen_random_uuid(),
  specialty_id       uuid not null references public.specialties(id),
  code               text not null unique,
  name_ar            text not null,
  name_en            text not null,
  revenue_account_id uuid references public.accounts(id),   -- NULL = default service revenue
  default_minutes    smallint,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create trigger trg_audit_services after insert or update or delete on public.services
  for each row execute function app.audit_row();

create table public.price_lists (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id),
  code       text not null,
  name_ar    text not null,
  name_en    text not null,
  currency   char(3) not null default 'EGP',
  is_default boolean not null default false,
  unique (branch_id, code)
);
create unique index price_lists_one_default on public.price_lists (branch_id) where is_default;

create table public.price_list_items (
  id            uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id),
  service_id    uuid not null references public.services(id),
  price         numeric(14,2) not null check (price >= 0),
  effective     daterange not null default daterange(current_date, null),
  created_by    uuid default auth.uid(),
  constraint no_price_overlap exclude using gist (price_list_id with =, service_id with =, effective with &&)
);
create trigger trg_audit_price_items after insert or update or delete on public.price_list_items
  for each row execute function app.audit_row();

create or replace function public.service_price(p_service uuid, p_branch uuid, p_on date default current_date)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select pli.price from public.price_list_items pli
  join public.price_lists pl on pl.id = pli.price_list_id
  where pli.service_id = p_service and pl.branch_id = p_branch and pl.is_default and pli.effective @> p_on
  limit 1
$$;

create table public.payment_methods (
  code              text primary key,       -- cash, card, instapay, wallet, bank_transfer, payment_link
  name_ar           text not null,
  name_en           text not null,
  account_key       text not null,          -- account_settings key debited on receipt
  requires_reference boolean not null default false,
  requires_cash_session boolean not null default false,
  is_active         boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Cashier sessions (daily cash closing)
-- ---------------------------------------------------------------------------

create table public.cashier_sessions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id),
  cashier_id    uuid not null default auth.uid() references auth.users(id),
  opened_at     timestamptz not null default now(),
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  status        text not null default 'open' check (status in ('open', 'closed')),
  closed_at     timestamptz,
  expected_cash numeric(14,2),
  counted_cash  numeric(14,2) check (counted_cash >= 0),
  difference    numeric(14,2),
  close_note    text
);
create unique index cashier_one_open_session on public.cashier_sessions (cashier_id, branch_id) where status = 'open';
create trigger trg_audit_cashier_sessions after insert or update on public.cashier_sessions
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');

create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_no       text unique,                 -- assigned at issue (gapless per year)
  branch_id        uuid not null references public.branches(id),
  patient_id       uuid not null references public.patients(id),
  appointment_id   uuid references public.appointments(id),
  status           public.invoice_status not null default 'draft',
  currency         char(3) not null default 'EGP',
  subtotal         numeric(14,2) not null default 0,   -- gross before discounts
  discount_total   numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,   -- net payable
  amount_paid      numeric(14,2) not null default 0,
  balance          numeric(14,2) generated always as (total - amount_paid) stored,
  issued_at        timestamptz,
  issued_by        uuid,
  journal_entry_id uuid references public.journal_entries(id),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint paid_not_above_total check (amount_paid >= 0 and amount_paid <= total)
);
create index on public.invoices (patient_id, created_at desc);
create index on public.invoices (branch_id, status);

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id),
  service_id  uuid not null references public.services(id),
  doctor_id   uuid references public.staff(id),       -- basis for doctor settlements
  description text,
  quantity    numeric(10,2) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  line_gross  numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  line_total  numeric(14,2) generated always as (round(quantity * unit_price, 2) - discount) stored,
  constraint discount_within_line check (discount <= round(quantity * unit_price, 2))
);
create index on public.invoice_lines (invoice_id);

-- Lines may change only while the invoice is a draft; totals are recomputed.
create or replace function app.invoice_lines_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
        v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = v_inv for update;
  if v_status <> 'draft' then
    raise exception 'invoice lines can only change while the invoice is a draft' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.invoice_id <> v_inv then
    raise exception 'lines cannot move between invoices' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_guard();

create or replace function app.invoice_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i set
    subtotal = coalesce(s.g, 0), discount_total = coalesce(s.d, 0), total = coalesce(s.t, 0)
  from (select sum(line_gross) g, sum(discount) d, sum(line_total) t
        from public.invoice_lines where invoice_id = v_inv) s
  where i.id = v_inv;
  return null;
end $$;
create trigger trg_invoice_recalc after insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_recalc();

-- After draft, invoice fields change only inside billing RPCs (flag set per transaction).
create or replace function app.invoices_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued invoices cannot be deleted; void instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.amount_paid <> 0 or new.invoice_no is not null then
      raise exception 'invoices must be created as drafts' using errcode = '42501';
    end if;
    return new;
  end if;
  if coalesce(current_setting('app.billing_rpc', true), '') <> 'on' then
    if old.status <> 'draft' then
      raise exception 'issued invoices can only change through billing actions' using errcode = '42501';
    end if;
    if new.status <> 'draft' or new.amount_paid <> old.amount_paid or new.invoice_no is distinct from old.invoice_no
       or new.journal_entry_id is distinct from old.journal_entry_id then
      raise exception 'use issue_invoice / record_payment to change invoice state' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_invoices_guard before insert or update or delete on public.invoices
  for each row execute function app.invoices_guard();
create trigger trg_invoices_updated before update on public.invoices
  for each row execute function app.touch_updated_at();
create trigger trg_audit_invoices after insert or update or delete on public.invoices
  for each row execute function app.audit_row();
create trigger trg_audit_invoice_lines after insert or update or delete on public.invoice_lines
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  receipt_no         text not null unique default app.next_ref('RCT'),
  invoice_id         uuid not null references public.invoices(id),
  branch_id          uuid not null references public.branches(id),
  patient_id         uuid not null references public.patients(id),
  method             text not null references public.payment_methods(code),
  amount             numeric(14,2) not null check (amount > 0),
  currency           char(3) not null default 'EGP',
  reference          text,
  cashier_session_id uuid references public.cashier_sessions(id),
  idempotency_key    text not null unique,
  status             text not null default 'posted' check (status in ('posted', 'reversed')),
  journal_entry_id   uuid not null references public.journal_entries(id),
  received_by        uuid not null default auth.uid(),
  received_at        timestamptz not null default now()
);
create index on public.payments (invoice_id);
create index on public.payments (cashier_session_id);
create trigger trg_payments_immutable before delete on public.payments
  for each row execute function app.block_delete();
create trigger trg_audit_payments after insert or update on public.payments
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Billing RPCs
-- ---------------------------------------------------------------------------

create or replace function app.org_of_branch(p_branch uuid)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select organization_id from public.branches where id = p_branch
$$;

-- Issue a draft invoice: assign number, post Dr A/R + Dr Discounts / Cr Revenue.
create or replace function public.issue_invoice(p_invoice uuid)
returns public.invoices
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; v_org uuid; v_je uuid; v_lines jsonb; v_rev_default uuid;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('billing.write', i.branch_id);
  if i.status <> 'draft' then raise exception 'invoice is already %', i.status using errcode = '22023'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = i.id) then
    raise exception 'invoice has no lines' using errcode = '22023';
  end if;

  perform set_config('app.billing_rpc', 'on', true);
  v_org := app.org_of_branch(i.branch_id);

  if i.subtotal > 0 then
    v_rev_default := app.account_for(v_org, 'revenue_services');
    select jsonb_agg(x) into v_lines from (
      select jsonb_build_object('account_id', app.account_for(v_org, 'ar_patients'), 'debit', i.total,
                                'patient_id', i.patient_id, 'memo', 'Patient receivable') x
      union all
      select jsonb_build_object('account_id', app.account_for(v_org, 'discounts_allowed'), 'debit', i.discount_total,
                                'patient_id', i.patient_id, 'memo', 'Discounts')
      union all
      select jsonb_build_object('account_id', coalesce(s.revenue_account_id, v_rev_default),
                                'credit', sum(l.line_gross), 'doctor_id', l.doctor_id, 'patient_id', i.patient_id,
                                'memo', 'Service revenue')
      from public.invoice_lines l join public.services s on s.id = l.service_id
      where l.invoice_id = i.id
      group by coalesce(s.revenue_account_id, v_rev_default), l.doctor_id
    ) t;
    v_je := app.post_journal(v_org, i.branch_id, (now() at time zone 'Africa/Cairo')::date,
                             'Invoice issued', 'invoice_issue', i.id, v_lines);
  end if;

  update public.invoices set
    status = case when total = 0 then 'paid'::public.invoice_status else 'issued' end,
    invoice_no = app.next_ref('INV'), issued_at = now(), issued_by = auth.uid(), journal_entry_id = v_je
  where id = i.id returning * into i;
  return i;
end $$;

-- Record a patient payment. Idempotent on p_idempotency_key.
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_method text,
                                                 p_idempotency_key text, p_reference text default null)
returns public.payments
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; m public.payment_methods; p public.payments; v_org uuid; v_je uuid; v_session uuid;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  -- Lock the invoice first so concurrent retries serialize, then check the key.
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('payment.collect', i.branch_id);

  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if p.invoice_id <> p_invoice or p.amount <> round(p_amount, 2) or p.method <> p_method then
      raise exception 'idempotency key reused with different payment details' using errcode = '22023';
    end if;
    return p;   -- safe retry: same result, no double posting
  end if;
  if i.status not in ('issued', 'partially_paid') then
    raise exception 'invoice in status % cannot receive payments', i.status using errcode = '22023';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if round(p_amount, 2) > i.balance then
    raise exception 'amount % exceeds outstanding balance %', round(p_amount, 2), i.balance using errcode = '22023';
  end if;

  select * into m from public.payment_methods where code = p_method and is_active;
  if not found then raise exception 'unknown payment method %', p_method using errcode = '22023'; end if;
  if m.requires_reference and coalesce(trim(p_reference), '') = '' then
    raise exception 'payment method % requires a reference number', p_method using errcode = '22023';
  end if;
  if m.requires_cash_session then
    select id into v_session from public.cashier_sessions
     where cashier_id = auth.uid() and branch_id = i.branch_id and status = 'open';
    if v_session is null then
      raise exception 'open a cashier session before receiving cash' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.billing_rpc', 'on', true);
  v_org := app.org_of_branch(i.branch_id);
  v_je := app.post_journal(v_org, i.branch_id, (now() at time zone 'Africa/Cairo')::date,
            'Patient payment (' || p_method || ')', 'payment', i.id,
            jsonb_build_array(
              jsonb_build_object('account_id', app.account_for(v_org, m.account_key), 'debit', round(p_amount, 2),
                                 'patient_id', i.patient_id, 'memo', coalesce(p_reference, p_method)),
              jsonb_build_object('account_id', app.account_for(v_org, 'ar_patients'), 'credit', round(p_amount, 2),
                                 'patient_id', i.patient_id)));

  insert into public.payments (invoice_id, branch_id, patient_id, method, amount, currency, reference,
                               cashier_session_id, idempotency_key, journal_entry_id)
  values (i.id, i.branch_id, i.patient_id, p_method, round(p_amount, 2), i.currency, p_reference,
          v_session, p_idempotency_key, v_je)
  returning * into p;

  update public.invoices set
    amount_paid = amount_paid + p.amount,
    status = case when amount_paid + p.amount >= total then 'paid'::public.invoice_status else 'partially_paid' end
  where id = i.id;
  return p;
end $$;

-- Void an issued, unpaid invoice. Separation of duties: the issuer cannot void it.
create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns public.invoices
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission('invoice.void', i.branch_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'void reason is required' using errcode = '22023'; end if;
  if i.status <> 'issued' or i.amount_paid <> 0 then
    raise exception 'only issued invoices with no payments can be voided (refund first)' using errcode = '22023';
  end if;
  if i.issued_by = auth.uid() then
    raise exception 'separation of duties: the user who issued an invoice cannot void it' using errcode = '42501';
  end if;

  perform set_config('app.billing_rpc', 'on', true);
  if i.journal_entry_id is not null then
    perform app.reverse_journal(i.journal_entry_id, p_reason, 'invoice_void', i.id);
  end if;
  update public.invoices set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = i.id returning * into i;
  return i;
end $$;

create or replace function public.open_cashier_session(p_branch uuid, p_opening_float numeric default 0)
returns public.cashier_sessions
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare s public.cashier_sessions;
begin
  perform app.require_permission('cash.session', p_branch);
  insert into public.cashier_sessions (branch_id, cashier_id, opening_float)
  values (p_branch, auth.uid(), round(coalesce(p_opening_float, 0), 2))
  returning * into s;
  return s;
exception when unique_violation then
  raise exception 'you already have an open cashier session in this branch' using errcode = '22023';
end $$;

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

  select s.opening_float + coalesce(sum(p.amount), 0) into v_expected
  from public.payments p where p.cashier_session_id = s.id and p.status = 'posted';

  if round(p_counted, 2) <> v_expected and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required when counted cash differs from expected (%)', v_expected using errcode = '22023';
  end if;

  update public.cashier_sessions set status = 'closed', closed_at = now(), expected_cash = v_expected,
         counted_cash = round(p_counted, 2), difference = round(p_counted, 2) - v_expected, close_note = p_note
  where id = s.id returning * into s;
  return s;
end $$;
