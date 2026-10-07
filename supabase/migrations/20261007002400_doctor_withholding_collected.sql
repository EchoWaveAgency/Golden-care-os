-- Golden Care OS — 0024 Doctor fees: withholding tax, collected-basis contracts, cash payouts, tax remittance
-- Rates are the clinic's (and its tax adviser's) decision: a contract carries its own withholding % (0 = none) and its
-- basis ('invoiced' = share due when the invoice is issued, the previous behaviour; 'collected' = due once fully paid).

-- Accounts (also for organisations created before this migration)
insert into public.accounts (organization_id, code, name_ar, name_en, type, is_postable)
select o.id, '2430', 'ضريبة خصم من المنبع مستحقة', 'Withholding tax payable', 'liability', true from public.organizations o
on conflict (organization_id, code) do nothing;
insert into public.account_settings (organization_id, key, account_id)
select a.organization_id, 'withholding_tax_payable', a.id from public.accounts a where a.code = '2430'
on conflict do nothing;

alter table public.doctor_contracts add column if not exists withholding_percent numeric(5,2) not null default 0 check (withholding_percent between 0 and 100);
alter table public.doctor_contracts add column if not exists basis text not null default 'invoiced' check (basis in ('invoiced', 'collected'));

alter table public.settlement_runs add column if not exists withholding_percent numeric(5,2) not null default 0;
alter table public.settlement_runs add column if not exists withholding numeric(14,2) not null default 0;
alter table public.settlement_runs add column if not exists net_payable numeric(14,2) not null default 0;
alter table public.settlement_runs add column if not exists pay_method text check (pay_method in ('bank_transfer', 'cash'));
alter table public.settlement_runs add column if not exists cashier_session_id uuid references public.cashier_sessions(id);
update public.settlement_runs set net_payable = amount where net_payable = 0 and amount <> 0;

create or replace function app.contract_basis(p_doctor uuid, p_on date)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select basis from public.doctor_contracts where doctor_id = p_doctor and valid @> p_on), 'invoiced')
$$;

-- Contract maintenance with the two new terms.
drop function public.save_doctor_contract(uuid, date, numeric, jsonb, text, numeric);
create or replace function public.save_doctor_contract(p_doctor uuid, p_from date, p_default_percent numeric, p_rates jsonb, p_notes text default null,
                                                       p_lab_cost_percent numeric default 0, p_withholding_percent numeric default 0, p_basis text default 'invoiced')
returns uuid language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.staff; v_id uuid; prev public.doctor_contracts; r jsonb;
begin
  select * into d from public.staff where id = p_doctor and kind = 'doctor';
  if not found then raise exception 'doctor not found' using errcode = 'P0002'; end if;
  perform app.require_permission('contract.manage', d.branch_id);
  if p_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if coalesce(p_lab_cost_percent, 0) not between 0 and 100 then raise exception 'lab cost share must be 0 to 100' using errcode = '22023'; end if;
  if coalesce(p_withholding_percent, 0) not between 0 and 100 then raise exception 'withholding tax must be 0 to 100' using errcode = '22023'; end if;
  if coalesce(p_basis, 'invoiced') not in ('invoiced', 'collected') then raise exception 'basis must be invoiced or collected' using errcode = '22023'; end if;
  if exists (select 1 from public.settlement_runs where doctor_id = d.id and status in ('approved', 'paid') and upper(period) > p_from) then
    raise exception 'a settlement for this period is already approved; the new contract must start after it' using errcode = '22023';
  end if;
  select * into prev from public.doctor_contracts where doctor_id = d.id and valid @> p_from;
  if found then
    if lower(prev.valid) = p_from then raise exception 'a contract already starts on this date' using errcode = '22023'; end if;
    update public.doctor_contracts set valid = daterange(lower(valid), p_from) where id = prev.id;
  end if;
  insert into public.doctor_contracts (doctor_id, valid, default_percent, notes, lab_cost_percent, withholding_percent, basis)
  values (d.id, daterange(p_from, null), p_default_percent, nullif(trim(p_notes), ''), round(coalesce(p_lab_cost_percent, 0), 2),
          round(coalesce(p_withholding_percent, 0), 2), coalesce(p_basis, 'invoiced')) returning id into v_id;
  update public.settlement_runs set stale = true where doctor_id = d.id and status = 'draft' and upper(period) > p_from;
  for r in select * from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) loop
    insert into public.doctor_contract_rates (contract_id, service_id, percent, fixed_amount)
    values (v_id, (r->>'service_id')::uuid, nullif(r->>'percent', '')::numeric, nullif(r->>'fixed_amount', '')::numeric);
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_doctor_contract(uuid, date, numeric, jsonb, text, numeric, numeric, text) from public, anon;
grant execute on function public.save_doctor_contract(uuid, date, numeric, jsonb, text, numeric, numeric, text) to authenticated;

-- Settlement preparation: as in 0018, plus collected-basis lines (1a) and withholding.
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
    and app.contract_basis(d.id, (i.issued_at at time zone 'Africa/Cairo')::date) = 'invoiced'
    and not exists (select 1 from public.settlement_lines s where s.invoice_line_id = l.id and s.kind = 'service' and s.active);

  -- 1a) Collected basis: the share is due once the invoice is fully paid (dated on the last payment).
  insert into public.settlement_lines (run_id, doctor_id, kind, invoice_id, invoice_no, invoice_line_id, service_id, on_date, base, percent, fixed_amount, amount, no_contract)
  select run.id, d.id, 'service', i.id, i.invoice_no, l.id, l.service_id, pd.paid_on, l.line_total,
         rt.percent, rt.fixed_amount, rt.amount, not rt.has_contract
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  cross join lateral (select (max(p.received_at) at time zone 'Africa/Cairo')::date paid_on from public.payments p where p.invoice_id = i.id and p.status = 'posted') pd
  cross join lateral app.settlement_rate(d.id, l.service_id, (i.issued_at at time zone 'Africa/Cairo')::date, l.line_total, l.quantity) rt
  where l.doctor_id = d.id and i.status = 'paid' and pd.paid_on < upper(v_period)
    and app.contract_basis(d.id, (i.issued_at at time zone 'Africa/Cairo')::date) = 'collected'
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
  -- Withholding tax on the doctor's fees (rate from the contract in force at the end of the month; 0 = none).
  update public.settlement_runs r set
    withholding_percent = w.pct,
    withholding = round(greatest(r.amount, 0) * w.pct / 100, 2),
    net_payable = r.amount - round(greatest(r.amount, 0) * w.pct / 100, 2)
  from (select coalesce((select c.withholding_percent from public.doctor_contracts c where c.doctor_id = d.id and c.valid @> (upper(v_period) - 1)), 0) pct) w
  where r.id = run.id returning r.* into run;
  return run;
end $$;


-- Approval: the accrual now splits the doctor's payable and the withholding tax.
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
        jsonb_build_object('account_id', app.account_for(v_org, 'doctor_fees_payable'), 'credit', greatest(a - run.withholding, 0), 'debit', greatest(-(a - run.withholding), 0), 'doctor_id', run.doctor_id))
      || case when run.withholding > 0 then jsonb_build_array(
        jsonb_build_object('account_id', app.account_for(v_org, 'withholding_tax_payable'), 'credit', run.withholding, 'doctor_id', run.doctor_id,
                           'memo', 'WHT ' || run.withholding_percent || '% ' || run.ref)) else '[]'::jsonb end);
  end if;
  update public.settlement_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), journal_entry_id = v_je
  where id = run.id returning * into run;
  return run;
end $$;

-- Payout of the net amount: bank transfer (reference required) or cash from the payer's open cashier session.
drop function public.pay_settlement(uuid, text);
create or replace function public.pay_settlement(p_run uuid, p_reference text, p_method text default 'bank_transfer')
returns public.settlement_runs language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare run public.settlement_runs; v_org uuid; v_je uuid; v_session uuid; v_account uuid;
begin
  select * into run from public.settlement_runs where id = p_run for update;
  if not found then raise exception 'settlement not found' using errcode = 'P0002'; end if;
  perform app.require_permission('settlement.pay', run.branch_id);
  if run.status = 'paid' then return run; end if;
  if run.status <> 'approved' then raise exception 'settlement must be approved before payment' using errcode = '22023'; end if;
  if run.approved_by = auth.uid() then
    raise exception 'separation of duties: the approver cannot also record the payment' using errcode = '42501';
  end if;
  if run.net_payable <= 0 then raise exception 'nothing to pay on this settlement' using errcode = '22023'; end if;
  v_org := app.org_of_branch(run.branch_id);
  if coalesce(p_method, 'bank_transfer') = 'cash' then
    select id into v_session from public.cashier_sessions where cashier_id = auth.uid() and branch_id = run.branch_id and status = 'open' for update;
    if v_session is null then raise exception 'open a cashier session before paying in cash' using errcode = '22023'; end if;
    v_account := app.account_for(v_org, 'cash_on_hand');
  elsif p_method = 'bank_transfer' then
    if coalesce(trim(p_reference), '') = '' then raise exception 'payment method bank_transfer requires a reference number' using errcode = '22023'; end if;
    v_account := app.account_for(v_org, 'bank_main');
  else
    raise exception 'doctors are paid by bank transfer or cash' using errcode = '22023';
  end if;
  v_je := app.post_journal(v_org, run.branch_id, (now() at time zone 'Africa/Cairo')::date,
    'Doctor settlement payment ' || run.ref, 'settlement_payment', run.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'doctor_fees_payable'), 'debit', run.net_payable, 'doctor_id', run.doctor_id),
      jsonb_build_object('account_id', v_account, 'credit', run.net_payable, 'doctor_id', run.doctor_id, 'memo', nullif(trim(p_reference), ''))));
  update public.settlement_runs set status = 'paid', paid_by = auth.uid(), paid_at = now(), pay_reference = nullif(trim(p_reference), ''),
    pay_journal_entry_id = v_je, pay_method = coalesce(p_method, 'bank_transfer'), cashier_session_id = v_session
  where id = run.id returning * into run;
  return run;
end $$;
revoke execute on function public.pay_settlement(uuid, text, text) from public, anon;
grant execute on function public.pay_settlement(uuid, text, text) to authenticated;

-- Cash drawer: doctor fees paid in cash leave the drawer too.
create or replace function app.session_expected_cash(p_session uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select s.opening_float
    + coalesce((select sum(amount) from public.payments where cashier_session_id = s.id and status = 'posted'), 0)
    - coalesce((select sum(amount) from public.refunds where cashier_session_id = s.id and status = 'paid'), 0)
    + coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'deposit'), 0)
    - coalesce((select sum(amount) from public.patient_deposits where cashier_session_id = s.id and kind = 'refund'), 0)
    - coalesce((select sum(amount) from public.package_refunds where cashier_session_id = s.id and status = 'paid'), 0)
    - coalesce((select sum(net_payable) from public.settlement_runs where cashier_session_id = s.id and status = 'paid'), 0)
  from public.cashier_sessions s where s.id = p_session
$$;

-- Remitting withheld tax to the Tax Authority (one payment per filing period).
create table public.tax_remittances (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default app.next_ref('TAX'),
  organization_id  uuid not null references public.organizations(id),
  branch_id        uuid not null references public.branches(id),
  kind             text not null check (kind in ('doctor_withholding')),
  period           text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount           numeric(14,2) not null check (amount > 0),
  reference        text not null,
  journal_entry_id uuid not null references public.journal_entries(id),
  paid_by          uuid not null default auth.uid(),
  paid_at          timestamptz not null default now()
);
create trigger trg_audit_tax_remittances after insert or update on public.tax_remittances for each row execute function app.audit_row();
create trigger trg_tax_remittances_immutable before delete on public.tax_remittances for each row execute function app.block_delete();
alter table public.tax_remittances enable row level security;
create policy tax_remittances_read on public.tax_remittances for select to authenticated
  using (app.has_permission('settlement.pay', branch_id) or app.has_permission('accounting.read', branch_id));
grant select on public.tax_remittances to authenticated;

create or replace function app.withholding_balance(p_org uuid)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  where e.organization_id = p_org and l.account_id = app.account_for(p_org, 'withholding_tax_payable')
$$;

create or replace function public.withholding_due(p_branch uuid)
returns numeric language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.has_permission('settlement.pay', p_branch) or app.has_permission('accounting.read', p_branch)) then return null; end if;
  return app.withholding_balance(app.org_of_branch(p_branch));
end $$;

create or replace function public.pay_withholding_tax(p_branch uuid, p_period text, p_amount numeric, p_reference text)
returns public.tax_remittances language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_org uuid := app.org_of_branch(p_branch); v_je uuid; t public.tax_remittances;
begin
  perform app.require_permission('settlement.pay', p_branch);
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment method bank_transfer requires a reference number' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('wht:' || v_org::text));
  if p_amount > app.withholding_balance(v_org) then
    raise exception 'the amount is more than the withholding tax due (%)', app.withholding_balance(v_org) using errcode = '22023';
  end if;
  v_je := app.post_journal(v_org, p_branch, (now() at time zone 'Africa/Cairo')::date, 'Withholding tax remittance ' || p_period, 'tax_remittance', null,
    jsonb_build_array(
      jsonb_build_object('account_id', app.account_for(v_org, 'withholding_tax_payable'), 'debit', p_amount),
      jsonb_build_object('account_id', app.account_for(v_org, 'bank_main'), 'credit', p_amount, 'memo', trim(p_reference))));
  insert into public.tax_remittances (organization_id, branch_id, kind, period, amount, reference, journal_entry_id)
  values (v_org, p_branch, 'doctor_withholding', p_period, p_amount, trim(p_reference), v_je) returning * into t;
  return t;
end $$;
revoke execute on function app.contract_basis(uuid, date), app.withholding_balance(uuid) from public, anon, authenticated;
revoke execute on function public.withholding_due(uuid), public.pay_withholding_tax(uuid, text, numeric, text) from public, anon;
grant execute on function public.withholding_due(uuid), public.pay_withholding_tax(uuid, text, numeric, text) to authenticated;
