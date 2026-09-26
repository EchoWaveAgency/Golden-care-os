-- Golden Care OS — 0014 Doctor contracts & settlements, database-enforced two-factor sign-in
-- The clinic defines contract terms (policy); the system computes, checks and posts them.

-- ---------------------------------------------------------------------------
-- Accounts and permissions
-- ---------------------------------------------------------------------------
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, m.k, a.id from public.accounts a
join (values ('doctor_fees', '5100'), ('doctor_fees_payable', '2300')) m(k, code) on m.code = a.code
on conflict do nothing;

insert into public.permissions (code, module, description) values
  ('contract.manage',    'settlements', 'Create and change doctor contracts (share percentages and fixed fees)'),
  ('settlement.prepare', 'settlements', 'Prepare monthly doctor settlement statements'),
  ('settlement.approve', 'settlements', 'Approve doctor settlements (never ones you prepared) — posts the accrual'),
  ('settlement.pay',     'settlements', 'Record payment of approved doctor settlements')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('chief_accountant', 'contract.manage'), ('center_director', 'contract.manage'),
  ('accountant', 'settlement.prepare'), ('chief_accountant', 'settlement.prepare'),
  ('chief_accountant', 'settlement.approve'), ('center_director', 'settlement.approve'),
  ('chief_accountant', 'settlement.pay')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Contracts (effective-dated; one active contract per doctor per day)
-- ---------------------------------------------------------------------------
create table public.doctor_contracts (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references public.staff(id),
  valid           daterange not null,
  default_percent numeric(5,2) not null check (default_percent between 0 and 100),
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint one_contract_per_day exclude using gist (doctor_id with =, valid with &&)
);
create table public.doctor_contract_rates (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.doctor_contracts(id),
  service_id   uuid not null references public.services(id),
  percent      numeric(5,2) check (percent between 0 and 100),
  fixed_amount numeric(14,2) check (fixed_amount >= 0),
  unique (contract_id, service_id),
  constraint one_rate_kind check ((percent is null) <> (fixed_amount is null))
);
create trigger trg_audit_contracts after insert or update or delete on public.doctor_contracts for each row execute function app.audit_row();
create trigger trg_audit_contract_rates after insert or update or delete on public.doctor_contract_rates for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Settlement runs and lines (lines are a frozen snapshot of the calculation)
-- ---------------------------------------------------------------------------
create type public.settlement_status as enum ('draft', 'approved', 'paid', 'cancelled');

create table public.settlement_runs (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique default app.next_ref('ST'),
  doctor_id            uuid not null references public.staff(id),
  branch_id            uuid not null references public.branches(id),
  period               daterange not null,
  status               public.settlement_status not null default 'draft',
  gross_base           numeric(14,2) not null default 0,
  deductions           numeric(14,2) not null default 0,
  amount               numeric(14,2) not null default 0,
  lines_without_contract int not null default 0,
  carried_in           numeric(14,2) not null default 0,   -- negative balances brought forward from earlier runs
  carried_to           uuid references public.settlement_runs(id),
  stale                boolean not null default false,     -- a contract changed after this draft was prepared
  prepared_by          uuid not null default auth.uid(),
  prepared_at          timestamptz not null default now(),
  approved_by          uuid,
  approved_at          timestamptz,
  journal_entry_id     uuid references public.journal_entries(id),
  paid_by              uuid,
  paid_at              timestamptz,
  pay_reference        text,
  pay_journal_entry_id uuid references public.journal_entries(id),
  cancel_reason        text
);
create unique index settlement_one_active_run on public.settlement_runs (doctor_id, period) where status <> 'cancelled';
create trigger trg_audit_settlement_runs after insert or update on public.settlement_runs for each row execute function app.audit_row();
create trigger trg_settlement_runs_immutable before delete on public.settlement_runs for each row execute function app.block_delete();

create table public.settlement_lines (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.settlement_runs(id),
  doctor_id       uuid not null references public.staff(id),
  kind            text not null check (kind in ('service', 'void_reversal', 'refund', 'carry')),
  invoice_id      uuid references public.invoices(id),
  carry_from_run  uuid references public.settlement_runs(id),
  invoice_no      text,                -- snapshot so the doctor can reconcile without invoice access
  invoice_line_id uuid references public.invoice_lines(id),
  refund_id       uuid references public.refunds(id),
  service_id      uuid references public.services(id),
  on_date         date not null,
  base            numeric(14,2) not null,
  percent         numeric(5,2),
  fixed_amount    numeric(14,2),
  amount          numeric(14,2) not null,
  no_contract     boolean not null default false,
  active          boolean not null default true
);
create index on public.settlement_lines (run_id);
-- Each invoice line is paid to the doctor once (and reversed at most once); each refund is deducted once.
create unique index settlement_line_once on public.settlement_lines (invoice_line_id, kind) where active and invoice_line_id is not null;
create unique index settlement_refund_once on public.settlement_lines (refund_id, doctor_id) where active and refund_id is not null;
create trigger trg_settlement_lines_immutable before delete on public.settlement_lines for each row execute function app.block_delete();

-- Contracts that already fed an approved/paid settlement cannot change retroactively.
create or replace function app.contracts_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.doctor_contracts; v_locked daterange;
begin
  if tg_table_name = 'doctor_contract_rates' then
    select * into c from public.doctor_contracts where id = coalesce(new.contract_id, old.contract_id);
    v_locked := c.valid;
  elsif tg_op = 'INSERT' then
    return new;                                   -- overlaps are prevented by the exclusion constraint
  elsif tg_op = 'UPDATE' and new.doctor_id = old.doctor_id and new.default_percent = old.default_percent
        and lower(new.valid) = lower(old.valid) and new.notes is not distinct from old.notes then
    c := old;                                     -- only the end date moves: check the part being cut off
    v_locked := daterange(coalesce(upper(new.valid), 'infinity'::date), coalesce(upper(old.valid), 'infinity'::date));
  else
    c := old;
    v_locked := old.valid;
  end if;
  if exists (select 1 from public.settlement_runs r where r.doctor_id = c.doctor_id and r.status in ('approved', 'paid') and r.period && v_locked) then
    raise exception 'this contract was used in an approved settlement; end it and start a new one instead' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_contracts_guard before insert or update or delete on public.doctor_contracts for each row execute function app.contracts_guard();
create trigger trg_contract_rates_guard before insert or update or delete on public.doctor_contract_rates for each row execute function app.contracts_guard();

-- Rate for one invoice line on a date: service-specific rate, else the contract default.
create or replace function app.settlement_rate(p_doctor uuid, p_service uuid, p_on date, p_base numeric, p_qty numeric)
returns table (percent numeric, fixed_amount numeric, amount numeric, has_contract boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select * from public.doctor_contracts where doctor_id = p_doctor and valid @> p_on limit 1),
       r as (select dr.* from public.doctor_contract_rates dr join c on c.id = dr.contract_id where dr.service_id = p_service)
  select case when (select fixed_amount from r) is not null then null else coalesce((select percent from r), (select default_percent from c)) end,
         (select fixed_amount from r),
         case when not exists (select 1 from c) then 0
              when (select fixed_amount from r) is not null then round((select fixed_amount from r) * p_qty, 2)
              else round(p_base * coalesce((select percent from r), (select default_percent from c)) / 100, 2) end,
         exists (select 1 from c)
$$;

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
    gross_base = coalesce((select sum(base) from public.settlement_lines where run_id = r.id and kind = 'service'), 0),
    deductions = coalesce((select -sum(amount) from public.settlement_lines where run_id = r.id and kind in ('void_reversal', 'refund')), 0),
    carried_in = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id and kind = 'carry'), 0),
    amount = coalesce((select sum(amount) from public.settlement_lines where run_id = r.id), 0),
    lines_without_contract = (select count(*) from public.settlement_lines where run_id = r.id and no_contract)
  where r.id = run.id returning * into run;
  return run;
end $$;

create or replace function public.cancel_settlement(p_run uuid, p_reason text)
returns public.settlement_runs language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare run public.settlement_runs;
begin
  select * into run from public.settlement_runs where id = p_run for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  perform app.require_permission('settlement.prepare', run.branch_id);
  if run.status <> 'draft' then raise exception 'only draft settlements can be cancelled' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  update public.settlement_lines set active = false where run_id = run.id;
  update public.settlement_runs set carried_to = null where carried_to = run.id;
  update public.settlement_runs set status = 'cancelled', cancel_reason = trim(p_reason) where id = run.id returning * into run;
  return run;
end $$;

-- Maker-checker: the approver can never be the preparer. Posts the accrual.
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
             and exists (select 1 from public.settlement_lines l where l.run_id = run.id and l.kind = 'service' and c.valid @> l.on_date)) then
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

-- Payout by bank transfer (reference required). Negative balances are carried into the next run.
create or replace function public.pay_settlement(p_run uuid, p_reference text)
returns public.settlement_runs language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare run public.settlement_runs; v_org uuid; v_je uuid;
begin
  select * into run from public.settlement_runs where id = p_run for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  perform app.require_permission('settlement.pay', run.branch_id);
  if run.status = 'paid' then return run; end if;
  if run.status <> 'approved' then raise exception 'settlement must be approved before payment' using errcode = '22023'; end if;
  if run.approved_by = auth.uid() then
    raise exception 'separation of duties: the approver cannot also record the payment' using errcode = '42501';
  end if;
  if run.amount <= 0 then raise exception 'nothing to pay on this settlement' using errcode = '22023'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment method bank_transfer requires a reference number' using errcode = '22023'; end if;
  v_org := app.org_of_branch(run.branch_id);
  v_je := app.post_journal(v_org, run.branch_id, (now() at time zone 'Africa/Cairo')::date,
    'Doctor settlement payment ' || run.ref, 'settlement_payment', run.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'doctor_fees_payable'), 'debit', run.amount, 'doctor_id', run.doctor_id),
      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'credit', run.amount, 'doctor_id', run.doctor_id, 'memo', trim(p_reference))));
  update public.settlement_runs set status = 'paid', paid_by = auth.uid(), paid_at = now(), pay_reference = trim(p_reference), pay_journal_entry_id = v_je
  where id = run.id returning * into run;
  return run;
end $$;

-- Contract maintenance: ending the current contract and starting a new one is the normal change.
create or replace function public.save_doctor_contract(p_doctor uuid, p_from date, p_default_percent numeric, p_rates jsonb, p_notes text default null)
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.staff; v_id uuid; prev public.doctor_contracts; r jsonb;
begin
  select * into d from public.staff where id = p_doctor and kind = 'doctor';
  if not found then raise exception 'doctor not found' using errcode = 'P0002'; end if;
  perform app.require_permission('contract.manage', d.branch_id);
  if p_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if exists (select 1 from public.settlement_runs where doctor_id = d.id and status in ('approved', 'paid') and upper(period) > p_from) then
    raise exception 'a settlement for this period is already approved; the new contract must start after it' using errcode = '22023';
  end if;
  -- End the contract that covers the start date (if any), then refuse any later overlap.
  select * into prev from public.doctor_contracts where doctor_id = d.id and valid @> p_from;
  if found then
    if lower(prev.valid) = p_from then raise exception 'a contract already starts on this date' using errcode = '22023'; end if;
    update public.doctor_contracts set valid = daterange(lower(valid), p_from) where id = prev.id;
  end if;
  insert into public.doctor_contracts (doctor_id, valid, default_percent, notes)
  values (d.id, daterange(p_from, null), p_default_percent, nullif(trim(p_notes), '')) returning id into v_id;
  update public.settlement_runs set stale = true where doctor_id = d.id and status = 'draft' and upper(period) > p_from;
  for r in select * from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) loop
    insert into public.doctor_contract_rates (contract_id, service_id, percent, fixed_amount)
    values (v_id, (r->>'service_id')::uuid, nullif(r->>'percent', '')::numeric, nullif(r->>'fixed_amount', '')::numeric);
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Two-factor sign-in, enforced by the database: a user who must use MFA gets NO permission
-- from a password-only session (aal1). Supabase Auth puts "aal" in the JWT.
-- ---------------------------------------------------------------------------
create or replace function app.current_aal()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal')
$$;

create or replace function app.has_permission(p_permission text, p_branch uuid default null)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
    where ur.user_id = auth.uid()
      and rp.permission_code = p_permission
      and now() >= ur.valid_from
      and (ur.valid_to is null or now() < ur.valid_to)
      and (p_branch is null or ur.branch_id is null or ur.branch_id = p_branch)
      and (not pr.mfa_required or app.current_aal() = 'aal2')
  )
$$;

create or replace function app.has_global_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                 join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
                 where ur.user_id = auth.uid() and rp.permission_code = p_permission and ur.branch_id is null
                   and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)
                   and (not pr.mfa_required or app.current_aal() = 'aal2'))
$$;

create or replace function public.my_permissions()
returns table (permission_code text, branch_id uuid)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select distinct rp.permission_code, ur.branch_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_code = ur.role_code
  join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
  where ur.user_id = auth.uid()
    and now() >= ur.valid_from
    and (ur.valid_to is null or now() < ur.valid_to)
    and (not pr.mfa_required or app.current_aal() = 'aal2')
$$;

create or replace function app.is_active_staff()
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1 from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.user_id
    where pr.user_id = auth.uid() and pr.is_active
      and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)
      and (not pr.mfa_required or app.current_aal() = 'aal2')
  )
$$;

-- What the signed-in user must still do to get access (used by the UI to route to MFA screens).
create or replace function public.my_security()
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object('mfa_required', coalesce(pr.mfa_required, false), 'aal', app.current_aal(),
                            'must_change_password', coalesce(pr.must_change_password, false))
  from public.profiles pr where pr.user_id = auth.uid()
$$;

-- Privileged roles turn MFA on for the account automatically; administrators can also require it.
create or replace function app.privileged_requires_mfa()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select is_privileged from public.roles where code = new.role_code) then
    perform set_config('app.admin_rpc', 'on', true);
    update public.profiles set mfa_required = true where user_id = new.user_id and not mfa_required;
  end if;
  return new;
end $$;
create trigger trg_privileged_requires_mfa after insert on public.user_roles for each row execute function app.privileged_requires_mfa();

create or replace function public.admin_set_mfa(p_user uuid, p_required boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can change sign-in security' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own sign-in security' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if not p_required and exists (select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code
                                where ur.user_id = p_user and r.is_privileged and (ur.valid_to is null or ur.valid_to > now())) then
    raise exception 'two-factor sign-in is mandatory for privileged roles' using errcode = '22023';
  end if;
  update public.profiles set mfa_required = p_required where user_id = p_user;
  perform app.audit_event(case when p_required then 'MFA_REQUIRED' else 'MFA_NOT_REQUIRED' end, 'profiles', p_user::text, null, trim(p_reason));
end $$;

-- Lost phone: an administrator records the reset (the server then removes the Auth factors).
create or replace function public.admin_mfa_reset(p_user uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can reset two-factor sign-in' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own sign-in security' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  perform app.audit_event('MFA_RESET', 'profiles', p_user::text, null, trim(p_reason));
end $$;

-- admin_users now reports the MFA flag (unchanged otherwise).

-- ---------------------------------------------------------------------------
-- MFA hardening
-- ---------------------------------------------------------------------------
-- Existing privileged accounts: require MFA now (the trigger covers future grants and role changes).
update public.profiles set mfa_required = true
where not mfa_required and user_id in (select ur.user_id from public.user_roles ur join public.roles r on r.code = ur.role_code
                                       where r.is_privileged and (ur.valid_to is null or ur.valid_to > now()));
drop trigger trg_privileged_requires_mfa on public.user_roles;
create trigger trg_privileged_requires_mfa after insert or update on public.user_roles for each row execute function app.privileged_requires_mfa();

-- A grant's identity never changes: only its end date may move (end the grant, create a new one).
create or replace function app.user_roles_guard()
returns trigger language plpgsql as $$
begin
  if current_setting('is_superuser') = 'on' then return new; end if;   -- database maintenance only
  if new.user_id <> old.user_id or new.role_code <> old.role_code or new.branch_id is distinct from old.branch_id
     or new.valid_from <> old.valid_from or new.granted_by is distinct from old.granted_by then
    raise exception 'role grants cannot be rewritten; end the grant and create a new one' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_user_roles_guard before update on public.user_roles for each row execute function app.user_roles_guard();

-- Activation, MFA and password flags change only inside the audited admin / service functions.
create or replace function app.profiles_self_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.admin_rpc', true), '') <> 'on'
     and (new.is_active is distinct from old.is_active or new.mfa_required is distinct from old.mfa_required
          or new.must_change_password is distinct from old.must_change_password) then
    raise exception 'activation, two-factor and password flags change only through the administration screens' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can activate or deactivate accounts' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot deactivate your own account' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.admin_rpc', 'on', true);
  update public.profiles set is_active = p_active where user_id = p_user;
  update public.staff set is_active = p_active where user_id = p_user;
  if not p_active then perform app.revoke_sessions(p_user); end if;
  perform app.audit_event(case when p_active then 'USER_REACTIVATED' else 'USER_DEACTIVATED' end, 'profiles', p_user::text, null, trim(p_reason));
end $$;

-- Ends every Auth session of a user (refresh tokens stop working; short-lived access tokens expire).
create or replace function app.revoke_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_user; end if;
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_user; end if;
end $$;

create or replace function public.admin_set_mfa(p_user uuid, p_required boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can change sign-in security' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own sign-in security' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  if not p_required and exists (select 1 from public.user_roles ur join public.roles r on r.code = ur.role_code
                                where ur.user_id = p_user and r.is_privileged and (ur.valid_to is null or ur.valid_to > now())) then
    raise exception 'two-factor sign-in is mandatory for privileged roles' using errcode = '22023';
  end if;
  perform set_config('app.admin_rpc', 'on', true);
  update public.profiles set mfa_required = p_required where user_id = p_user;
  perform app.audit_event(case when p_required then 'MFA_REQUIRED' else 'MFA_NOT_REQUIRED' end, 'profiles', p_user::text, null, trim(p_reason));
end $$;

-- Lost phone: sessions end and a new temporary password is required, so whoever enrolls the new
-- authenticator must have received that password from the administrator in person.
create or replace function public.admin_mfa_reset(p_user uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if not app.has_global_permission('users.manage') then
    raise exception 'permission denied: only an all-branch administrator can reset two-factor sign-in' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own sign-in security' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required' using errcode = '22023'; end if;
  perform set_config('app.admin_rpc', 'on', true);
  update public.profiles set must_change_password = true where user_id = p_user;
  perform app.revoke_sessions(p_user);
  perform app.audit_event('MFA_RESET', 'profiles', p_user::text, null, trim(p_reason));
end $$;

create or replace function public.svc_password_changed(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform set_config('app.admin_rpc', 'on', true);
  update public.profiles set must_change_password = false where user_id = p_user;
end $$;

-- Break-glass (service role, run from a trusted terminal): recover the LAST administrator who lost
-- their phone. Audited; the script also removes the Auth factors and sets a temporary password.
create or replace function public.svc_break_glass_mfa_reset(p_user uuid, p_operator text, p_reason text)
returns void language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if coalesce(trim(p_operator), '') = '' or coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'operator name and a detailed reason are required' using errcode = '22023';
  end if;
  perform set_config('app.admin_rpc', 'on', true);
  update public.profiles set must_change_password = true where user_id = p_user;
  perform app.revoke_sessions(p_user);
  insert into public.audit_events (actor_id, actor_role, action, table_name, record_id, reason)
  values (null, 'break-glass:' || trim(p_operator), 'MFA_BREAK_GLASS_RESET', 'profiles', p_user::text, trim(p_reason));
end $$;

-- Number of all-branch administrators able to sign in (the UI warns below two).
create or replace function public.admin_count()
returns int language sql stable security definer set search_path = public, app, pg_temp as $$
  select count(distinct ur.user_id)::int from public.user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
  join public.profiles pr on pr.user_id = ur.user_id and pr.is_active
  where rp.permission_code = 'users.manage' and ur.branch_id is null and now() >= ur.valid_from and (ur.valid_to is null or now() < ur.valid_to)
$$;

-- The staff identity used by doctor-only rules (own patients, own encounters, prescriptions,
-- releases, own statements) also requires the second factor when the account needs it.
create or replace function app.current_staff_id()
returns uuid language sql stable security definer set search_path = public, app, pg_temp as $$
  select s.id from public.staff s join public.profiles pr on pr.user_id = s.user_id
  where s.user_id = auth.uid() and s.is_active and pr.is_active and (not pr.mfa_required or app.current_aal() = 'aal2')
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.doctor_contracts enable row level security;
alter table public.doctor_contract_rates enable row level security;
alter table public.settlement_runs enable row level security;
alter table public.settlement_lines enable row level security;
grant select on public.doctor_contracts, public.doctor_contract_rates, public.settlement_runs, public.settlement_lines to authenticated;
grant all on public.doctor_contracts, public.doctor_contract_rates, public.settlement_runs, public.settlement_lines to service_role;

create or replace function app.can_see_settlements(p_doctor uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_permission('settlement.prepare', p_branch) or app.has_permission('settlement.approve', p_branch)
      or app.has_permission('settlement.pay', p_branch) or app.has_permission('contract.manage', p_branch)
      or app.has_permission('accounting.read', p_branch)
$$;
create policy contracts_read on public.doctor_contracts for select to authenticated
  using (doctor_id = app.current_staff_id() or app.can_see_settlements(doctor_id, (select branch_id from public.staff where id = doctor_id)));
create policy contract_rates_read on public.doctor_contract_rates for select to authenticated
  using (exists (select 1 from public.doctor_contracts c where c.id = contract_id));
-- A doctor sees their own statements once approved; finance sees all in scope.
create policy settlement_runs_read on public.settlement_runs for select to authenticated
  using ((doctor_id = app.current_staff_id() and status in ('approved', 'paid')) or app.can_see_settlements(doctor_id, branch_id));
create policy settlement_lines_read on public.settlement_lines for select to authenticated
  using (exists (select 1 from public.settlement_runs r where r.id = run_id));

revoke execute on all functions in schema public from public;
grant execute on function public.prepare_settlement(uuid, date), public.cancel_settlement(uuid, text), public.approve_settlement(uuid),
  public.pay_settlement(uuid, text), public.save_doctor_contract(uuid, date, numeric, jsonb, text),
  public.my_security(), public.admin_set_mfa(uuid, boolean, text), public.admin_mfa_reset(uuid, text), public.my_permissions(),
  public.admin_set_active(uuid, boolean, text), public.admin_count()
  to authenticated;
revoke execute on function public.svc_password_changed(uuid), public.svc_break_glass_mfa_reset(uuid, text, text) from authenticated, anon;
grant execute on function public.svc_password_changed(uuid), public.svc_break_glass_mfa_reset(uuid, text, text) to service_role;
grant execute on function app.current_aal(), app.can_see_settlements(uuid, uuid) to authenticated;
